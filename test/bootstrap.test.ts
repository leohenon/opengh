import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import manifest from "../package.json"

async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, { cwd, env, timeout: 3000, killSignal: "SIGKILL" })
  let output = "", error = ""
  child.stdout!.setEncoding("utf8").on("data", (chunk) => { output += chunk })
  child.stderr!.setEncoding("utf8").on("data", (chunk) => { error += chunk })
  child.stdin!.end("fixture input")
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject)
    child.on("close", resolve)
  })
  return { code, output, error }
}

test.skipIf(process.platform === "win32")("installed launcher ignores project startup files and preserves caller context, argv, stdio, and exit status", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "opengh-bootstrap-")))
  const app = join(root, "installed app"), cwd = join(root, "untrusted repo"), tools = join(root, "tools")
  try {
    await Promise.all([mkdir(app), mkdir(cwd), mkdir(tools)])
    await cp(join(import.meta.dir, "../bin"), join(app, "bin"), { recursive: true })
    await copyFile(join(import.meta.dir, "../bunfig.toml"), join(app, "bunfig.toml"))
    const entry = join(app, manifest.bin.opengh)
    await chmod(entry, 0o755)
    // Pin the test's Bun runtime independently of the developer's PATH.
    await symlink(process.execPath, join(tools, "bun"))

    const marker = join(root, "unexpected-preload")
    const poison = `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran"); process.exit(91)`
    await writeFile(join(cwd, "bunfig.toml"), 'preload = ["./poison.ts"]\n')
    await writeFile(join(cwd, "poison.ts"), poison)
    for (const directory of [cwd, app]) {
      await writeFile(join(directory, ".env"), "GH_BROWSER=./poison-browser\nOPENGH_REVIEW_DOTENV=poison\n")
      const pkg = join(directory, "node_modules/@opentui/solid")
      await mkdir(pkg, { recursive: true })
      await writeFile(join(pkg, "package.json"), JSON.stringify({ type: "module", exports: { "./preload": "./preload.ts" } }))
      await writeFile(join(pkg, "preload.ts"), directory === app
        ? "process.env.OPENGH_REVIEW_STARTUP_CWD = process.cwd()"
        : poison)
    }
    await mkdir(join(app, "src"))
    await writeFile(join(app, "src/index.tsx"), `
      const input: string = await Bun.stdin.text()
      console.log(JSON.stringify({
        cwd: process.env.OPENGH_LAUNCH_CWD, runtimeCwd: process.cwd(), args: process.argv.slice(2), input,
        startupCwd: process.env.OPENGH_REVIEW_STARTUP_CWD,
        browser: process.env.GH_BROWSER ?? null, dotenv: process.env.OPENGH_REVIEW_DOTENV ?? null,
        parentBrowser: process.env.BROWSER,
      }))
      console.error("fixture stderr")
      process.exitCode = 23
    `)
    const args = ["owner/repo", "literal space", "; echo no", "--preload=./poison.ts"]
    const env = {
      PATH: [tools, process.env.PATH].join(delimiter),
      HOME: root, USERPROFILE: root, SystemRoot: process.env.SystemRoot,
      BROWSER: "parent-browser",
    }
    // Exercise the OS shebang and a package-manager-style install symlink.
    const cli = join(tools, "opengh")
    await symlink(entry, cli)
    const result = await run(cli, args, cwd, env)
    expect(result.code).toBe(23)
    expect(result.error).toBe("fixture stderr\n")
    expect(JSON.parse(result.output)).toEqual({
      cwd, runtimeCwd: app, args, input: "fixture input", startupCwd: app,
      browser: null, dotenv: null, parentBrowser: "parent-browser",
    })
    expect(await readFile(marker).then(() => true, () => false)).toBe(false)

  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
