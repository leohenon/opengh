// Assembles the npm packages from built executables, ready for `npm publish`.
//
//   bun run build --all && bun run npm:pack
//
// `@leohenon/opengh` is a small launcher. Each executable ships in its own package, restricted to one platform and
// listed as an optional dependency, so an install downloads only the one it can run.
import { existsSync } from "node:fs"
import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import manifest from "../package.json"
import { dist, root, targets } from "./targets"

const out = join(dist, "npm")
const shared = {
  version: manifest.version,
  license: manifest.license,
  homepage: "https://github.com/leohenon/opengh#readme",
  bugs: "https://github.com/leohenon/opengh/issues",
  repository: { type: "git", url: "git+https://github.com/leohenon/opengh.git" },
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

await rm(out, { recursive: true, force: true })
for (const [target, { os, cpu, libc }] of Object.entries(targets)) {
  const built = join(dist, `opengh-${target}`)
  if (!existsSync(join(built, "opengh"))) throw new Error(`dist/opengh-${target}/opengh is missing. Run: bun run build --all`)
  const directory = join(out, `opengh-${target}`)
  await mkdir(join(directory, "bin"), { recursive: true })
  await cp(join(built, "opengh"), join(directory, "bin", "opengh"))
  await chmod(join(directory, "bin", "opengh"), 0o755)
  for (const file of ["LICENSE", "THIRD-PARTY-NOTICES.md"]) await cp(join(built, file), join(directory, file))
  await writeFile(join(directory, "package.json"), json({
    name: `opengh-${target}`,
    ...shared,
    description: `The opengh executable for ${os} ${cpu}${libc === "musl" ? " (musl)" : ""}. Install @leohenon/opengh instead.`,
    os: [os],
    cpu: [cpu],
    ...(libc ? { libc: [libc] } : {}),
    files: ["bin", "THIRD-PARTY-NOTICES.md"],
  }))
}

const launcher = join(out, "opengh")
await mkdir(join(launcher, "bin"), { recursive: true })
await cp(join(root, "npm", "opengh.cjs"), join(launcher, "bin", "opengh.cjs"))
await chmod(join(launcher, "bin", "opengh.cjs"), 0o755)
for (const file of ["LICENSE", "README.md"]) await cp(join(root, file), join(launcher, file))
await writeFile(join(launcher, "package.json"), json({
  name: "@leohenon/opengh",
  ...shared,
  description: "A familiar terminal interface for GitHub.",
  keywords: ["github", "terminal", "tui", "cli", "pull-request", "code-review"],
  bin: { opengh: "bin/opengh.cjs" },
  files: ["bin"],
  os: [...new Set(Object.values(targets).map((target) => target.os))],
  cpu: [...new Set(Object.values(targets).map((target) => target.cpu))],
  engines: { node: ">=18" },
  optionalDependencies: Object.fromEntries(Object.keys(targets).map((target) => [`opengh-${target}`, manifest.version])),
}))
console.log(`dist/npm: @leohenon/opengh and ${Object.keys(targets).length} platform packages at ${manifest.version}`)
