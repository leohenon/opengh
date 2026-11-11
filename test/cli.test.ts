import { expect, test } from "bun:test"
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { version } from "../package.json"

test("CLI follows install symlinks without loading checkout-controlled Bun configuration", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "opengh-cli-")))
  const installDirectory = join(directory, "installed bin")
  const executable = join(installDirectory, "opengh")
  try {
    await mkdir(installDirectory)
    await symlink(relative(installDirectory, resolve(import.meta.dir, "../bin/opengh")), executable)
    await writeFile(join(directory, "bunfig.toml"), 'preload = ["./preload.ts"]\n')
    await writeFile(join(directory, "preload.ts"), 'console.error("UNTRUSTED_PRELOAD_RAN")\n')
    const shadowPackage = join(directory, "node_modules/@opentui/solid")
    await mkdir(shadowPackage, { recursive: true })
    await writeFile(join(shadowPackage, "package.json"), JSON.stringify({ type: "module", exports: { "./preload": "./preload.js" } }))
    await writeFile(join(shadowPackage, "preload.js"), 'console.error("UNTRUSTED_DEPENDENCY_PRELOAD_RAN"); process.exit(42)\n')
    await writeFile(join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "*": ["./hostile.ts"] } } }))
    await writeFile(join(directory, "hostile.ts"), 'console.error("UNTRUSTED_TSCONFIG_RAN"); process.exit(42)\n')

    const run = async (args: string[], env = process.env) => {
      const child = Bun.spawn([executable, ...args], {
        cwd: directory, env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      })
      const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000)
      try {
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
        ])
        return { stdout, stderr, code }
      } finally {
        clearTimeout(timeout)
        if (child.exitCode === null) child.kill("SIGKILL")
      }
    }
    const help = await run(["--help"])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain("Usage:")
    expect(help.stdout).toContain("--commit")
    expect(help.stderr).toBe("")

    for (const flag of ["--version", "-v"]) {
      const result = await run([flag])
      expect(result.code).toBe(0)
      expect(result.stdout).toBe(`opengh ${version}\n`)
      expect(result.stderr).toBe("")
    }

    const invalid = await run(["https://example.com/owner/repo/issues/123"])
    expect(invalid.code).toBe(1)
    expect(invalid.stderr).toContain("Only GitHub.com URLs")
    expect(invalid.stderr).not.toContain("UNTRUSTED_PRELOAD_RAN")
    expect(invalid.stdout).toBe("")

    // Runtime discovery is trusted, but repository discovery must still use the caller's directory.
    const fakeBin = join(directory, "fake bin")
    await mkdir(fakeBin)
    await writeFile(join(fakeBin, "bun"), '#!/bin/sh\nprintf "%s\\n" "$PWD" "$OPENGH_LAUNCH_CWD" "$@"\n', { mode: 0o755 })
    const context = await run(["cli/cli", "14784"], { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` })
    expect(context.code).toBe(0)
    const lines = context.stdout.trim().split("\n")
    expect(lines.slice(0, 2)).toEqual([await realpath(resolve(import.meta.dir, "..")), directory])
    expect(lines.slice(-2)).toEqual(["cli/cli", "14784"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
