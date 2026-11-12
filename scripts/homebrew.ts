// Writes the Homebrew formula for the current version from the release archives' checksums.
//
//   bun run build --all && bun run brew:formula
//
// The release workflow commits the result to the leohenon/homebrew-tap repository.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import manifest from "../package.json"
import { dist } from "./targets"

// OPENGH_RELEASE_BASE_URL points the formula at other copies of the archives, such as file:// for a local test install.
const base = process.env.OPENGH_RELEASE_BASE_URL ?? `https://github.com/leohenon/opengh/releases/download/v${manifest.version}`

async function archive(target: string) {
  const name = `opengh-${target}.tar.gz`
  const sha256 = (await readFile(join(dist, `${name}.sha256`), "utf8").catch(() => "")).split(/\s+/)[0] ?? ""
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`dist/${name}.sha256 is missing or invalid. Run: bun run build --all`)
  return `      url "${base}/${name}"\n      sha256 "${sha256}"`
}

// Homebrew on Linux uses glibc, so the musl executables are not offered here.
const formula = `class Opengh < Formula
  desc "Familiar terminal interface for GitHub"
  homepage "https://github.com/leohenon/opengh"
  version "${manifest.version}"
  license "${manifest.license}"

  depends_on "gh"

  on_macos do
    if Hardware::CPU.arm?
${await archive("darwin-arm64")}
    else
${await archive("darwin-x64")}
    end
  end

  on_linux do
    if Hardware::CPU.arm?
${await archive("linux-arm64")}
    else
${await archive("linux-x64")}
    end
  end

  def install
    bin.install "opengh"
    prefix.install "THIRD-PARTY-NOTICES.md"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/opengh --version")
  end
end
`
await mkdir(join(dist, "homebrew"), { recursive: true })
await writeFile(join(dist, "homebrew", "opengh.rb"), formula)
console.log(`dist/homebrew/opengh.rb for ${manifest.version}`)
