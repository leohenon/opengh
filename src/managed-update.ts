import { existsSync, readFileSync } from "node:fs"
import { readFile, readlink, realpath } from "node:fs/promises"
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path"

const brewTap = "leohenon/tap"
const npmPackage = "@leohenon/opengh"
const updateHints = {
  brew: `Run: brew update && brew upgrade ${brewTap}/opengh`,
  npm: `Run: npm install --global ${npmPackage}`,
  nix: "Run: nix profile upgrade opengh",
}
const manual = {
  brew: `Use the original Homebrew installation and tap to update opengh. For the official tap:\n${updateHints.brew}`,
  npm: `Update opengh with the package manager and scope that installed it. For a global npm install only (pass --prefix for a custom prefix):\n${updateHints.npm}`,
  nix: `Use nix profile list in the owning profile. For an unpinned entry named opengh (pass --profile for a custom profile):\n${updateHints.nix}\nFor pinned or declarative installs, update the flake or system configuration.`,
}

type Manager = keyof typeof updateHints
type ManagedUpdateOptions = {
  target: string
  currentVersion: string
  log: (message: string) => void
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
const metadata = async (path: string) => object(JSON.parse(await readFile(path, "utf8")))
const canonical = (path: string) => realpath(path).catch(() => undefined)
const absolutePath = () => (process.env.PATH ?? "/usr/bin:/bin").split(delimiter).filter(isAbsolute).join(delimiter)

export function installationManager(executable: string): Manager | undefined {
  if (executable.startsWith("/nix/store/")) return "nix"
  const root = dirname(dirname(executable))
  if (executable.includes("/Cellar/opengh/") || existsSync(join(root, "INSTALL_RECEIPT.json"))) return "brew"
  if (executable.split("/").includes("node_modules")) return "npm"
  // npm/workspace links can resolve the native package outside node_modules.
  const path = join(root, "package.json")
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return
    throw new Error(`Cannot inspect installation metadata at ${path}. Use the original installation method to update.`)
  }
  const info = object(manifest)
  if (!info) throw new Error(`Invalid installation metadata at ${path}. Use the original installation method to update.`)
  const { name } = info
  if (
    typeof name === "string" &&
    (name === "opengh" || name === npmPackage || /^opengh-(?:darwin-(?:arm64|x64)|linux-(?:arm64|x64)(?:-musl)?)$/.test(name))
  )
    return "npm"
}

export function installationUpdateHint(executable: string) {
  const manager = installationManager(executable)
  return manager ? updateHints[manager] : undefined
}

async function runPackageManager(manager: Manager, args: string[], capture = false) {
  // Don't run in the caller's checkout or let relative PATH entries select executables there.
  const PATH = absolutePath()
  const binary = PATH && Bun.which(manager, { PATH })
  if (!binary) throw new Error(`${manager} is not on PATH.`)
  const child = Bun.spawn([binary, ...args], {
    cwd: "/",
    env: {
      ...process.env,
      PATH,
      ...(manager === "brew" ? { HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK: "1", HOMEBREW_NO_INSTALL_CLEANUP: "1" } : {}),
    },
    stdin: capture ? "ignore" : "inherit",
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
    timeout: capture ? 45_000 : undefined,
  })
  const [code, output] = await Promise.all([child.exited, child.stdout ? new Response(child.stdout).text() : ""])
  if (code !== 0) throw new Error(`${manager} ${args[0]} did not complete successfully (exit ${code}).`)
  return output
}

async function updateBrew(executable: string) {
  const keg = dirname(dirname(executable))
  const receipt = await metadata(join(keg, "INSTALL_RECEIPT.json"))
  const unknown = "Cannot verify the active opengh keg for this Homebrew."
  if (object(receipt?.source)?.tap !== brewTap) throw new Error(unknown)
  const prefix = (await runPackageManager("brew", ["--prefix"], true)).trim()
  const cellar = (await runPackageManager("brew", ["--cellar"], true)).trim()
  if (
    !isAbsolute(prefix) ||
    !isAbsolute(cellar) ||
    (await canonical(join(cellar, "opengh"))) !== dirname(keg) ||
    (await canonical(join(prefix, "opt/opengh/bin/opengh"))) !== executable
  )
    throw new Error(unknown)
  await runPackageManager("brew", ["update"])
  await runPackageManager("brew", ["upgrade", "--formula", `${brewTap}/opengh`])
}

async function updateNpm(executable: string, { target, currentVersion, log }: ManagedUpdateOptions) {
  const platform = `opengh-${target}`
  const modules = "lib/node_modules"
  const suffix = [`/${modules}/${platform}/bin/opengh`, `/${modules}/${npmPackage}/node_modules/${platform}/bin/opengh`].find((path) =>
    executable.endsWith(path),
  )
  const unknown = "Cannot verify that this is a global npm installation of opengh."
  if (!suffix) throw new Error(unknown)
  const prefix = executable.slice(0, -suffix.length) || "/"
  const launcher = join(prefix, modules, npmPackage)
  if ((await canonical(join(prefix, "bin/opengh"))) !== join(launcher, "bin/opengh.cjs")) throw new Error(unknown)
  const nativePath = `${platform}/bin/opengh`
  const resolved = (await canonical(join(launcher, "node_modules", nativePath))) ?? (await canonical(join(prefix, modules, nativePath)))
  if (resolved !== executable) throw new Error(unknown)
  const manifest = await metadata(join(launcher, "package.json"))
  const native = await metadata(join(dirname(dirname(executable)), "package.json"))
  if (
    manifest?.name !== npmPackage ||
    manifest.version !== currentVersion ||
    object(manifest.optionalDependencies)?.[platform] !== currentVersion ||
    native?.name !== platform ||
    native.version !== currentVersion
  )
    throw new Error(unknown)

  const global = ["--global", "--prefix", prefix]
  const latest: unknown = JSON.parse(await runPackageManager("npm", [...global, "view", `${npmPackage}@latest`, "version", "--json"], true))
  if (typeof latest !== "string" || latest !== latest.trim() || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(latest))
    throw new Error("npm did not return a stable opengh version.")
  const order = Bun.semver.order(latest, currentVersion)
  if (order <= 0) {
    log(
      order === 0
        ? `opengh ${currentVersion} is up to date.`
        : `opengh ${currentVersion} is newer than npm latest (${latest}); nothing changed.`,
    )
    return
  }
  log(`Updating opengh ${currentVersion} → ${latest} with npm…`)
  await runPackageManager("npm", [...global, "install", `${npmPackage}@${latest}`, "--include=optional"])
}

async function nixProfile(invocation: string, output: string) {
  const PATH = absolutePath()
  const wrapper = invocation.includes("/") ? resolve(invocation) : PATH && Bun.which(invocation, { PATH })
  if (!wrapper || basename(wrapper) !== "opengh" || basename(dirname(wrapper)) !== "bin") return
  if ((await canonical(wrapper)) !== join(output, "bin/opengh")) return
  let profile = dirname(dirname(wrapper))
  for (let i = 0; i < 8; i++) {
    const link = await readlink(profile).catch(() => undefined)
    if (!link) return
    const next = resolve(dirname(profile), link)
    const stem = `${profile}-`
    if (next.startsWith(stem) && /^\d+-link$/.test(next.slice(stem.length)))
      return existsSync(join(profile, "manifest.json")) ? profile : undefined
    profile = next
  }
}

async function updateNix(executable: string) {
  const output = dirname(dirname(executable))
  const profile = await nixProfile(process.argv0, output)
  const unknown = "Cannot verify an active, unpinned opengh entry in the profile that launched this executable."
  if (!profile) throw new Error(unknown)
  const args = ["--extra-experimental-features", "nix-command flakes", "profile"]
  const listing = object(JSON.parse(await runPackageManager("nix", [...args, "list", "--profile", profile, "--json"], true)))
  const elements =
    listing?.version === 2 && Array.isArray(listing.elements)
      ? listing.elements
      : listing?.version === 3
        ? object(listing.elements)
        : undefined
  const matches = Object.values(elements ?? {})
    .map(object)
    .filter((entry) => Array.isArray(entry?.storePaths) && entry.storePaths.includes(output))
  const [entry] = matches
  if (
    matches.length !== 1 ||
    entry?.active !== true ||
    entry.originalUrl !== "github:leohenon/opengh" ||
    typeof entry.attrPath !== "string" ||
    !/^packages\.[^.]+\.(opengh|default)$/.test(entry.attrPath)
  )
    throw new Error(unknown)
  await runPackageManager("nix", [...args, "upgrade", "--profile", profile, output])
}

export async function runManagedUpdate(manager: Manager, executable: string, options: ManagedUpdateOptions) {
  try {
    switch (manager) {
      case "brew":
        return await updateBrew(executable)
      case "npm":
        return await updateNpm(executable, options)
      case "nix":
        return await updateNix(executable)
    }
  } catch (error) {
    throw new Error(`${(error as Error).message}\n${manual[manager]}`, { cause: error })
  }
}
