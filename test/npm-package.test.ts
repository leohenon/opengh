import { afterEach, expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { targets } from "../scripts/targets"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

test("the scoped npm launcher packs and installs with unscoped platform dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengh-npm-package-"))
  directories.push(directory)
  await mkdir(join(directory, "scripts"))
  await mkdir(join(directory, "npm"))
  for (const file of ["npm.ts", "targets.ts"]) {
    await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(directory, "scripts", file))
  }
  await copyFile(new URL("../npm/opengh.cjs", import.meta.url), join(directory, "npm/opengh.cjs"))
  await writeFile(join(directory, "package.json"), JSON.stringify({ version: "0.0.0-beta.2", license: "MIT" }))
  await writeFile(join(directory, "README.md"), "# Fixture\n")
  await writeFile(join(directory, "LICENSE"), "MIT License\n")
  for (const target of Object.keys(targets)) {
    const built = join(directory, "dist", `opengh-${target}`)
    await mkdir(built, { recursive: true })
    await writeFile(join(built, "opengh"), "#!/bin/sh\nprintf 'fixture opengh\\n'\n")
    await writeFile(join(built, "LICENSE"), "MIT License\n")
    await writeFile(join(built, "THIRD-PARTY-NOTICES.md"), "Fixture notices\n")
  }
  const env = { ...process.env, npm_config_cache: join(directory, "cache"), npm_config_userconfig: "/dev/null", NODE_AUTH_TOKEN: "" }
  const run = async (args: string[]) => {
    const child = Bun.spawn(args, { cwd: directory, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ code, error }, error).toMatchObject({ code: 0 })
    return out
  }
  await run([process.execPath, "scripts/npm.ts"])
  const launcher = JSON.parse(await readFile(join(directory, "dist/npm/opengh/package.json"), "utf8"))
  expect(launcher.name).toBe("@leohenon/opengh")
  expect(launcher.bin).toEqual({ opengh: "bin/opengh.cjs" })
  expect(launcher.optionalDependencies).toEqual(Object.fromEntries(Object.keys(targets).map(target => [`opengh-${target}`, "0.0.0-beta.2"])))
  for (const target of Object.keys(targets)) {
    const platform = JSON.parse(await readFile(join(directory, "dist/npm", `opengh-${target}`, "package.json"), "utf8"))
    expect(platform.name).toBe(`opengh-${target}`)
  }
  const report = process.report.getReport() as { header: { glibcVersionRuntime?: string } }
  const musl = process.platform === "linux" && !report.header.glibcVersionRuntime
  const target = `${process.platform}-${process.arch}${musl ? "-musl" : ""}`
  const packed = JSON.parse(await run(["npm", "pack", `./dist/npm/opengh-${target}`, "./dist/npm/opengh", "--json", "--ignore-scripts"])) as Array<{ filename: string }>
  expect(packed[1]!.filename).toBe("leohenon-opengh-0.0.0-beta.2.tgz")
  // An empty cache and offline mode ensure the installation never reaches the registry.
  await run(["npm", "install", "--prefix", join(directory, "check"), "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
    ...packed.map(pkg => join(directory, pkg.filename))])
  expect(await run(["node", join(directory, "check/node_modules/.bin/opengh")])).toBe("fixture opengh\n")
}, 20_000)
