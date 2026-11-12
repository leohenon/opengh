// Builds standalone opengh executables and their release archives.
//
//   bun run build                    current platform
//   bun run build linux-x64 ...      named targets
//   bun run build --all              every supported target
//
// Cross-compiling needs each target's native OpenTUI package:
//   bun install --frozen-lockfile --os='*' --cpu='*'
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import solid from "@opentui/solid/bun-plugin"
import manifest from "../package.json"
import { dist, root, targets } from "./targets"

function packageDirectory(name: string, from: string): string | undefined {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return candidate
    if (directory === dirname(directory)) return undefined
  }
}

const licenseFiles = (directory: string) => readdirSync(directory).filter((name) => /^(licen[cs]e|copying|notice)/i.test(name)).sort()

// The executable contains every runtime dependency, so their notices ship beside it.
function thirdPartyNotices(nativePackage: string): string {
  const packages = new Map<string, { directory: string; license: string }>()
  const visit = (name: string, from: string) => {
    const directory = packageDirectory(name, from)
    if (!directory) return // Optional dependency for another platform.
    const info = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
    const id = `${info.name}@${info.version}`
    if (packages.has(id)) return
    packages.set(id, { directory, license: typeof info.license === "string" ? info.license : "see package" })
    for (const dependency of Object.keys({ ...info.dependencies, ...info.optionalDependencies, ...info.peerDependencies })) {
      // Only the target's native library is embedded.
      if (/^@opentui\/core-/.test(dependency) && dependency !== nativePackage) continue
      visit(dependency, directory)
    }
  }
  for (const name of Object.keys(manifest.dependencies)) visit(name, root)

  const sections = [
    "# Third-party notices",
    "",
    `opengh ${manifest.version} is distributed as a standalone executable that contains the software listed below.`,
    "",
    "The executable embeds the Bun runtime (MIT), which statically links further libraries under their own",
    "licenses, including JavaScriptCore (LGPL-2.1). See https://bun.sh/docs/project/licensing.",
  ]
  const section = (title: string, license: string, directory: string, files = licenseFiles(directory)) => {
    sections.push("", `## ${title}`, "", `License: ${license}`)
    for (const file of files) sections.push("", "```", readFileSync(join(directory, file), "utf8").trimEnd(), "```")
  }
  for (const [id, { directory, license }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) section(id, license, directory)
  const parsers = join(root, "src/ui/parsers")
  for (const language of readdirSync(parsers).sort()) {
    if (existsSync(join(parsers, language, "LICENSE"))) section(`tree-sitter-${language} (bundled grammar)`, "MIT", join(parsers, language), ["LICENSE"])
  }
  section("OpenCode themes (bundled)", "MIT", join(root, "src/theme"), ["LICENSE-opencode"])
  return `${sections.join("\n")}\n`
}

async function build(name: string) {
  const target = targets[name]
  if (!target) throw new Error(`Unknown target "${name}". Supported: ${Object.keys(targets).join(", ")}`)
  const nativePackage = `@opentui/core-${name}`
  if (!packageDirectory(nativePackage, root))
    throw new Error(`${nativePackage} is not installed. Run: bun install --frozen-lockfile --os='*' --cpu='*'`)

  const directory = join(dist, `opengh-${name}`)
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  const result = await Bun.build({
    // The Hunk highlight worker is a separate entry so that it is embedded next to the
    // application; src/index.tsx resolves it relative to itself.
    entrypoints: [join(root, "src/index.tsx"), join(root, "src/ui/workers/hunk-highlight.js")],
    plugins: [solid],
    define: target.libc ? { "process.env.OPENTUI_LIBC": JSON.stringify(target.libc) } : undefined,
    compile: {
      target: `bun-${name}` as Bun.Build.CompileTarget,
      outfile: join(directory, "opengh"),
      // opengh runs inside untrusted checkouts: never load their bunfig.toml preloads or .env files.
      autoloadBunfig: false,
      autoloadDotenv: false,
    },
  })
  if (!result.success) throw new AggregateError(result.logs, `Build failed for ${name}`)

  await cp(join(root, "LICENSE"), join(directory, "LICENSE"))
  await writeFile(join(directory, "THIRD-PARTY-NOTICES.md"), thirdPartyNotices(nativePackage))
  const archive = `opengh-${name}.tar.gz`
  const tar = Bun.spawnSync(["tar", "-czf", archive, `opengh-${name}`], { cwd: dist, stderr: "inherit" })
  if (tar.exitCode !== 0) throw new Error(`Could not create ${archive}`)
  const digest = createHash("sha256").update(await readFile(join(dist, archive))).digest("hex")
  await writeFile(join(dist, `${archive}.sha256`), `${digest}  ${archive}\n`)
  console.log(`${name}: dist/opengh-${name}/opengh, dist/${archive}`)
}

const requested = process.argv.slice(2)
const names = requested.includes("--all") ? Object.keys(targets) : requested.length ? requested : [`${process.platform}-${process.arch}`]
for (const name of names) await build(name)
