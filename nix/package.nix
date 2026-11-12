{
  autoPatchelfHook,
  bun2nix,
  fetchurl,
  gh,
  lib,
  makeWrapper,
  patchelf,
  stdenv,
}:
let
  manifest = lib.importJSON ../package.json;
  bunVersion = lib.removePrefix "bun@" manifest.packageManager;

  # The Bun that compiles opengh is also the runtime embedded in the executable, so this is the
  # release pinned in package.json rather than nixpkgs' Bun. Update every hash with `packageManager`:
  #   npm view @oven/bun-<name>@<version> dist.integrity
  bunArchives = {
    aarch64-darwin = {
      name = "darwin-aarch64";
      hash = "sha512-Omj20SuiHBOUjUBIyqtkNjSUIjOtEOJwmbix/ZyFH4BaQ6OZTaaRWIR4TjHVz0yadHgli6lLTiAh1uarnvD49A==";
    };
    aarch64-linux = {
      name = "linux-aarch64";
      hash = "sha512-X5SsPZHs+iYO8R/efIcRtc7gT2Q2DgPfliCxEkx4cXBumwkw0c/EsHMNwH3EgGpCDaZ7IYVPhpCG/xBOQHEwZw==";
    };
    x86_64-linux = {
      name = "linux-x64";
      hash = "sha512-7OVTAKvwfPmSbIV1HpdOoVVx5VRc427GuPPne93N6vk4eQBPId9nXmZDh9/zGaKPdbVjVtQSZafWQoUjx38Utw==";
    };
  };
  bunArchive = bunArchives.${stdenv.hostPlatform.system};
  # Embedded as released: Bun 1.3 writes the application into the runtime's ELF layout, and a
  # runtime that patchelf has already rewritten produces an executable that crashes on start.
  bunRuntime = stdenv.mkDerivation {
    pname = "bun-runtime";
    version = bunVersion;
    src = fetchurl {
      url = "https://registry.npmjs.org/@oven/bun-${bunArchive.name}/-/bun-${bunArchive.name}-${bunVersion}.tgz";
      inherit (bunArchive) hash;
    };
    sourceRoot = "package";
    dontBuild = true;
    dontFixup = true;
    installPhase = ''
      mkdir -p $out/bin
      cp -p bin/bun $out/bin/bun
    '';
  };
  # Runs the build. On Linux the released Bun cannot start without a Nix dynamic linker.
  bunCompiler =
    if stdenv.hostPlatform.isLinux then
      bunRuntime.overrideAttrs {
        pname = "bun-compiler";
        dontFixup = false;
        dontStrip = true;
        nativeBuildInputs = [ autoPatchelfHook ];
      }
    else
      bunRuntime;
in
bun2nix.mkDerivation {
  pname = "opengh";
  inherit (manifest) version;

  src = ../.;

  # Regenerate after every bun.lock change, or the offline install below fails:
  #   nix run 'github:nix-community/bun2nix?ref=2.1.2' -- -o nix/bun.lock.nix
  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.lock.nix;
    # opengh does not run without the patches in patches/.
    overrides = bun2nix.patchedDependenciesToOverrides {
      patchedDependencies = lib.mapAttrs (_: path: ../. + "/${path}") manifest.patchedDependencies;
    };
  };
  # The build reads licences from a flat node_modules, as `bun install` produces by default.
  bunInstallFlags = [ "--linker=hoisted" ] ++ lib.optionals stdenv.hostPlatform.isDarwin [ "--backend=copyfile" ];

  nativeBuildInputs = [ makeWrapper ] ++ lib.optionals stdenv.hostPlatform.isLinux [ patchelf ];

  # The same script builds the release executables.
  buildPhase = ''
    runHook preBuild
    OPENGH_BUN_EXECUTABLE=${bunRuntime}/bin/bun ${bunCompiler}/bin/bun scripts/build.ts
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin $out/share/doc/opengh
    cp -p dist/opengh-*/opengh $out/bin/opengh
    cp dist/opengh-*/LICENSE dist/opengh-*/THIRD-PARTY-NOTICES.md $out/share/doc/opengh/
  ''
  # Patching only the interpreter of the finished executable leaves the embedded application intact.
  + lib.optionalString stdenv.hostPlatform.isLinux ''
    patchelf --set-interpreter ${stdenv.cc.bintools.dynamicLinker} $out/bin/opengh
  ''
  + ''
    # opengh talks to GitHub through the GitHub CLI; one already on PATH takes precedence.
    wrapProgram $out/bin/opengh --suffix PATH : ${lib.makeBinPath [ gh ]}
    runHook postInstall
  '';

  # The default fixups strip and rewrite the executable, which detaches the application embedded in it.
  dontFixup = true;
  dontStrip = true;
  dontRunLifecycleScripts = true;

  meta = {
    description = "Familiar terminal interface for GitHub";
    homepage = "https://github.com/leohenon/opengh";
    license = lib.licenses.mit;
    mainProgram = "opengh";
    platforms = lib.attrNames bunArchives;
  };
}
