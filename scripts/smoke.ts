// Smoke-tests a built executable without a terminal, network access, or GitHub credentials.
//
//   bun run smoke [path/to/opengh]
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import manifest from "../package.json"

const binary = resolve(process.argv[2] ?? join(import.meta.dir, "..", "dist", `opengh-${process.platform}-${process.arch}`, "opengh"))
if (!existsSync(binary)) throw new Error(`No executable at ${binary}. Run: bun run build`)

// A foreign working directory whose Bun configuration must be ignored: opengh is run inside
// arbitrary checkouts, and a compiled executable loads bunfig.toml and .env by default.
const cwd = await realpath(await mkdtemp(join(tmpdir(), "opengh-smoke-")))
const marker = join(cwd, "preload-ran")
await writeFile(join(cwd, "bunfig.toml"), 'preload = ["./preload.ts"]\n')
await writeFile(join(cwd, "preload.ts"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")\n`)
// If .env were loaded, the launch directory override would move the GitHub CLI elsewhere.
const elsewhere = join(cwd, "elsewhere"), tools = join(cwd, "tools"), ghLog = join(cwd, "gh-cwd")
await Promise.all([mkdir(elsewhere), mkdir(tools)])
await writeFile(join(cwd, ".env"), `OPENGH_LAUNCH_CWD=${elsewhere}\n`)
// A stand-in GitHub CLI: records where it ran and fails, so nothing reaches the network.
await writeFile(join(tools, "gh"), `#!/bin/sh\npwd -P > ${JSON.stringify(ghLog)}\nexit 1\n`)
await chmod(join(tools, "gh"), 0o755)

function run(...args: string[]) {
  const child = Bun.spawnSync([binary, ...args], {
    cwd, stdin: "ignore", timeout: 30_000,
    env: { PATH: `${tools}:/usr/bin:/bin`, HOME: cwd, XDG_CONFIG_HOME: join(cwd, "config") },
  })
  return { code: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() }
}
function check(name: string, passed: boolean, detail: unknown) {
  if (!passed) throw new Error(`${name} failed: ${JSON.stringify(detail)}`)
  console.log(`ok  ${name}`)
}

try {
  const version = run("--version")
  check("--version prints the package version", version.code === 0 && version.stdout === `opengh ${manifest.version}\n`, version)
  const help = run("--help")
  check("--help prints usage", help.code === 0 && help.stdout.startsWith("Usage:") && help.stderr === "", help)
  const invalid = run("--not-an-option")
  check("invalid arguments exit 1 with guidance", invalid.code === 1 && invalid.stderr.startsWith("opengh: ") && invalid.stdout === "", invalid)
  const inline = run(".", "--inline")
  check("the GitHub CLI runs as a subprocess and its failure is reported", inline.code === 1 && inline.stderr.startsWith("opengh: ") && inline.stdout === "", inline)
  const ghCwd = (await readFile(ghLog, "utf8")).trim()
  check(".env in the working directory is not loaded", ghCwd === cwd, { ghCwd, cwd })
  check("bunfig.toml in the working directory is not loaded", !existsSync(marker), marker)
} finally {
  await rm(cwd, { recursive: true, force: true })
}
