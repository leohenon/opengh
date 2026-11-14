import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { installationUpdateHint, runUpdate } from "../src/update"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function fixture(relative = "bin/opengh") {
  const directory = await mkdtemp(join(tmpdir(), "opengh-update-"))
  directories.push(directory)
  const executable = join(directory, relative)
  await mkdir(dirname(executable), { recursive: true })
  const original = '#!/bin/sh\necho "opengh 0.1.0"\n'
  await writeFile(executable, original)
  await chmod(executable, 0o755)
  const messages: string[] = []
  const options = {
    executable, target: "darwin-arm64", installer: "fixture installer", currentVersion: "0.1.0",
    latest: async () => ({ version: "0.2.0" }), log: (message: string) => { messages.push(message) },
  }
  return { directory, executable, original, messages, options, lock: `${executable}.update-lock` }
}

test("source updates give instructions without touching Bun or contacting GitHub", async () => {
  await expect(runUpdate({ latest: async () => { throw new Error("Unexpected request") } })).rejects.toThrow("source checkout")
})

test.each([["0.1.0", "0.1.0"], ["0.1.0", "0.0.9"], ["0.3.0-rc.1", "0.2.0"]])("installed %s is never downgraded to %s", async (currentVersion, latest) => {
  const f = await fixture()
  await runUpdate({ ...f.options, currentVersion, latest: async () => ({ version: latest }), install: () => { throw new Error("Unexpected install") } })
  expect(await readFile(f.executable, "utf8")).toBe(f.original)
  expect(existsSync(f.lock)).toBe(false)
  expect(f.messages[0]).toContain(latest === currentVersion ? "up to date" : "newer than")
})

test("managed installations are identified before any release request or file replacement", async () => {
  expect(installationUpdateHint("/nix/store/hash-opengh/bin/.opengh-wrapped")).toContain("Nix")
  expect(installationUpdateHint("/opt/homebrew/Cellar/opengh/0.1.0/bin/opengh")).toContain("brew upgrade")
  for (const relative of ["node_modules/opengh-darwin-arm64/bin/opengh", "custom-cellar/opengh/0.1.0/bin/opengh"]) {
    const f = await fixture(relative)
    if (relative.startsWith("custom-cellar")) await writeFile(join(dirname(dirname(f.executable)), "INSTALL_RECEIPT.json"), "{}")
    await expect(runUpdate({ ...f.options, latest: async () => { throw new Error("Unexpected request") } })).rejects.toThrow("managed by")
    expect(await readFile(f.executable, "utf8")).toBe(f.original)
    expect(existsSync(f.lock)).toBe(false)
  }
})

test("symlinks cannot bypass package manager protection", async () => {
  const f = await fixture("node_modules/opengh-darwin-arm64/bin/opengh")
  const alias = join(f.directory, "opengh")
  await symlink(f.executable, alias)
  await expect(runUpdate({ ...f.options, executable: alias })).rejects.toThrow("JavaScript package manager")
  expect(await readFile(f.executable, "utf8")).toBe(f.original)
})

test.each([
  "opengh", "opengh-darwin-arm64", "opengh-darwin-x64", "opengh-linux-arm64",
  "opengh-linux-x64", "opengh-linux-arm64-musl", "opengh-linux-x64-musl",
])("linked %s packages are protected outside node_modules", async name => {
  const f = await fixture(`workspace/${name}/bin/opengh`)
  const packageRoot = dirname(dirname(f.executable))
  const manifestPath = join(packageRoot, "package.json")
  const manifest = `${JSON.stringify({ name, version: "0.1.0" })}\n`
  await writeFile(manifestPath, manifest)
  const modules = join(f.directory, "node_modules")
  await mkdir(modules)
  await symlink(packageRoot, join(modules, name))
  const linked = join(modules, name, "bin/opengh")
  expect((await realpath(linked)).split("/")).not.toContain("node_modules")
  let requests = 0, installs = 0
  await expect(runUpdate({ ...f.options, executable: linked,
    latest: async () => { requests++; return { version: "0.2.0" } },
    install: () => { installs++; return 0 },
  })).rejects.toThrow("JavaScript package manager")
  expect(requests).toBe(0)
  expect(installs).toBe(0)
  expect(await readFile(f.executable, "utf8")).toBe(f.original)
  expect(await readFile(manifestPath, "utf8")).toBe(manifest)
  expect(existsSync(f.lock)).toBe(false)
})

test.each(["other-project", "opengh-helper", undefined])("unrelated package metadata does not block a standalone executable: %s", async name => {
  const f = await fixture("project/bin/opengh")
  await writeFile(join(dirname(dirname(f.executable)), "package.json"), JSON.stringify({ name, version: "1.0.0" }))
  await runUpdate({ ...f.options, latest: async () => ({ version: "0.1.0" }), install: () => { throw new Error("Unexpected install") } })
  expect(f.messages.at(-1)).toContain("up to date")
  expect(await readFile(f.executable, "utf8")).toBe(f.original)
  expect(existsSync(f.lock)).toBe(false)
})

test.each(["{", "[]"])("unreadable package identity is not treated as a standalone install: %s", async manifest => {
  const f = await fixture("workspace/package/bin/opengh")
  await writeFile(join(dirname(dirname(f.executable)), "package.json"), manifest)
  await expect(runUpdate({ ...f.options, latest: async () => { throw new Error("Unexpected request") } })).rejects.toThrow("installation metadata")
  expect(await readFile(f.executable, "utf8")).toBe(f.original)
  expect(existsSync(f.lock)).toBe(false)
})

test("an existing update lock is never removed or ignored", async () => {
  const f = await fixture()
  await mkdir(f.lock)
  await writeFile(join(f.lock, "owner"), "another updater")
  await expect(runUpdate({ ...f.options, latest: async () => { throw new Error("Unexpected request") } })).rejects.toThrow("update lock already exists")
  expect(await readFile(join(f.lock, "owner"), "utf8")).toBe("another updater")
})

test("installer settings are pinned to the release and real executable, not ambient overrides", async () => {
  const f = await fixture("bin/opengh preview")
  const alias = join(f.directory, "alias")
  await symlink(f.executable, alias)
  await runUpdate({ ...f.options, executable: alias, install: async (script, options) => {
    expect(script).toBe("fixture installer")
    expect(options.env.OPENGH_VERSION).toBe("0.2.0")
    expect(options.env.OPENGH_INSTALL_DIR).toBe(dirname(await realpath(f.executable)))
    expect(options.env.OPENGH_INSTALL_NAME).toBe("opengh preview")
    expect(options.env.OPENGH_UPDATE_FROM).toBe("0.1.0")
    expect(options.env.OPENGH_DOWNLOAD_BASE_URL).toBe("")
    expect(options.cwd).toEndWith(".update-lock")
    expect(options.env.TMPDIR).toBe(options.cwd)
    expect(options.env.OPENGH_UPDATE_STAGE_DIR).toBe(options.cwd)
    return 0
  } })
  expect(f.messages.at(-1)).toBe("Updated to opengh 0.2.0.")
  expect(existsSync(f.lock)).toBe(false)
})

test("API and installer failures release only this updater's lock", async () => {
  const f = await fixture()
  await expect(runUpdate({ ...f.options, latest: async () => { throw new Error("offline") } })).rejects.toThrow("offline")
  expect(existsSync(f.lock)).toBe(false)
  await expect(runUpdate({ ...f.options, install: () => 1 })).rejects.toThrow("Check opengh --version")
  expect(existsSync(f.lock)).toBe(false)
  expect(await readFile(f.executable, "utf8")).toBe(f.original)
})

// Exercise the real bundled installer in a child, with all downloads replaced by local files.
async function installerFixture(mode: string) {
  const f = await fixture("bin/opengh preview")
  const tools = join(f.directory, "tools"), release = join(f.directory, "release"), temporary = join(f.directory, "tmp")
  const payload = join(f.directory, "opengh-darwin-arm64")
  await Promise.all([tools, release, temporary, payload].map(path => mkdir(path)))
  const script = async (path: string, body: string) => {
    await writeFile(path, `#!/bin/sh\nset -eu\n${body}\n`)
    await chmod(path, 0o755)
  }
  // Both processes ignore TERM; killing just the installer shell must not leave either behind.
  const hang = `trap '' INT TERM
printf '%s\\n' "$$" > "$FIXTURE_PARENT_PID"
sh -c 'trap "" INT TERM; printf "%s\\n" "$$" > "$FIXTURE_DESCENDANT_PID"; exec sleep 300' &
wait`
  await script(join(tools, "uname"), 'case "$1" in -s) echo Darwin;; -m) echo arm64;; *) exit 1;; esac')
  await script(join(tools, "gh"), "exit 1")
  await script(join(tools, "curl"), `test "$1" = -fsSL && test "$3" = -o || exit 2
case "$2" in
  https://github.com/leohenon/opengh/releases/download/v0.2.0/opengh-darwin-arm64.tar.gz) cp "$FIXTURE_RELEASE/opengh-darwin-arm64.tar.gz" "$4" ;;
  https://github.com/leohenon/opengh/releases/download/v0.2.0/SHA256SUMS) cp "$FIXTURE_RELEASE/SHA256SUMS" "$4" ;;
  *) echo 'Unexpected download' >&2; exit 2 ;;
esac
${mode === "hung curl" ? hang : ""}`)
  await script(join(payload, "opengh"), mode === "hung version" ? hang : `echo 'opengh ${mode === "version" ? "9.9.9" : "0.2.0"}'`)
  const archive = join(release, "opengh-darwin-arm64.tar.gz")
  const packed = Bun.spawnSync(["tar", "-czf", archive, "opengh-darwin-arm64"], { cwd: f.directory })
  expect(packed.exitCode).toBe(0)
  const checksum = mode === "checksum" ? "0".repeat(64) : createHash("sha256").update(await readFile(archive)).digest("hex")
  await writeFile(join(release, "SHA256SUMS"), `${checksum}  opengh-darwin-arm64.tar.gz\n`)
  if (mode === "changed install") await script(f.executable, "echo 'opengh 0.3.0'")
  const previous = await readFile(f.executable, "utf8")
  return { ...f, tools, release, temporary, previous }
}

type InstallerFixture = Awaited<ReturnType<typeof installerFixture>>
const pidNames = ["installer", "parent", "descendant"] as const
const pidFile = (f: InstallerFixture, name: string) => join(f.directory, `${name}.pid`)

async function fixturePids(f: InstallerFixture) {
  return Promise.all(pidNames.map(async name => {
    try {
      const pid = Number((await readFile(pidFile(f, name), "utf8")).trim())
      return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error }
  }))
}

function isRunning(pid: number) {
  const status = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)])
  const state = status.stdout.toString().trim()
  // Linux containers may not reap orphaned descendants promptly; zombies are already terminated.
  return status.exitCode === 0 && state !== "" && !state.startsWith("Z")
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  do {
    if (await check()) return true
    await Bun.sleep(20)
  } while (Date.now() < deadline)
  return false
}

async function installerChild(f: InstallerFixture, timeoutMs?: number, signal?: "SIGINT" | "SIGTERM" | "SIGHUP") {
  const driver = join(f.directory, "update.ts")
  const updater = fileURLToPath(new URL("../src/update.ts", import.meta.url))
  const installer = `printf '%s\\n' "$$" > "$FIXTURE_INSTALLER_PID"\n${await readFile(new URL("../install.sh", import.meta.url), "utf8")}`
  await writeFile(driver, `import { runUpdate${timeoutMs === undefined ? "" : ", runUpdateInstaller"} } from ${JSON.stringify(updater)}
const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const
const listeners = signals.map(signal => process.listenerCount(signal))
try {
  await runUpdate({ executable: ${JSON.stringify(f.executable)}, target: "darwin-arm64", currentVersion: "0.1.0", installer: ${JSON.stringify(installer)}, latest: async () => ({version: "0.2.0"})${timeoutMs === undefined ? "" : `, install: (script, options) => runUpdateInstaller(script, options, ${timeoutMs})`} })
} catch (error) {
  console.error(error.message)
  if (!process.exitCode) process.exitCode = 1
} finally {
  if (signals.some((signal, index) => process.listenerCount(signal) !== listeners[index])) {
    console.error("Updater leaked signal listeners")
    process.exitCode = 99
  }
}
`)
  const started = Date.now()
  const child = Bun.spawn([process.execPath, driver], {
    cwd: f.directory, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, HOME: f.directory, TMPDIR: f.temporary, PATH: `${f.tools}:${process.env.PATH}`, FIXTURE_RELEASE: f.release,
      FIXTURE_INSTALLER_PID: pidFile(f, "installer"), FIXTURE_PARENT_PID: pidFile(f, "parent"), FIXTURE_DESCENDANT_PID: pidFile(f, "descendant"),
      OPENGH_VERSION: "bad ambient version", OPENGH_DOWNLOAD_BASE_URL: "https://invalid.example", OPENGH_INSTALL_DIR: "/not-the-install",
      OPENGH_UPDATE_STAGE_DIR: "/not-the-staging-directory" },
  })
  const output = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  let watchdog: ReturnType<typeof setTimeout> | undefined
  try {
    // This watchdog lives outside the updater: a regressed spawnSync cannot block it.
    return await Promise.race([
      (async () => {
        if (signal) {
          const ready = await waitUntil(async () => (await fixturePids(f)).every(pid => pid !== undefined))
          if (!ready) throw new Error("Hung installer did not create its process markers")
          // Model a terminal hangup for SIGHUP; INT/TERM target only the updater to test forwarding.
          if (signal === "SIGHUP") process.kill(-child.pid, signal)
          else child.kill(signal)
        }
        const [code, out, error] = await output
        const elapsed = Date.now() - started
        const pids = (await fixturePids(f)).filter((pid): pid is number => pid !== undefined)
        await waitUntil(async () => pids.every(pid => !isRunning(pid)), 1_000)
        return { code, out, error, elapsed, pids, running: pids.filter(isRunning) }
      })(),
      new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error("Updater exceeded external watchdog")), 6_000) }),
    ])
  } finally {
    clearTimeout(watchdog)
    const pids = await fixturePids(f)
    const kill = (pid: number) => {
      try { process.kill(pid, "SIGKILL") }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
    }
    // Also cover broken implementations without detached installers, and failures before assertions.
    if (pids[0]) kill(-pids[0])
    kill(-child.pid)
    for (const pid of pids) if (pid) kill(pid)
    kill(child.pid)
    await child.exited
  }
}

test.each(["success", "checksum", "version", "changed install"])("standalone update preserves safety: %s", async mode => {
  const f = await installerFixture(mode)
  const { code, out, error } = await installerChild(f)
  expect(code === 0, error).toBe(mode === "success")
  if (mode === "success") {
    expect(out).toContain("Updated to opengh 0.2.0")
    expect(out).toContain('run it as "opengh preview"')
    expect(await readFile(f.executable, "utf8")).toContain("opengh 0.2.0")
  } else expect(await readFile(f.executable, "utf8")).toBe(f.previous)
  expect(await readdir(dirname(f.executable))).toEqual(["opengh preview"])
  expect(await readdir(f.temporary)).toEqual([])
}, 10_000)

test.each(["hung version", "hung curl"])("updater deadline kills installer descendants and cleans owned files: %s", async mode => {
  const f = await installerFixture(mode)
  const result = await installerChild(f, 1_000)
  expect(result.code, result.error).toBe(1)
  expect(result.error).toMatch(/timed out/i)
  expect(result.error).toContain("Check opengh --version")
  expect(result.elapsed).toBeLessThan(4_000)
  expect(result.pids).toHaveLength(3)
  expect(result.running).toEqual([])
  expect(await readFile(f.executable, "utf8")).toBe(f.original)
  expect(existsSync(f.lock)).toBe(false)
  expect(await readdir(dirname(f.executable))).toEqual(["opengh preview"])
  expect(await readdir(f.temporary)).toEqual([])
}, 10_000)

test.each([["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const)("updater forwards %s to installer descendants and preserves exit code %i", async (signal, code) => {
  const f = await installerFixture("hung version")
  const result = await installerChild(f, 30_000, signal)
  expect(result.code, result.error).toBe(code)
  expect(result.out).not.toContain("Updated to")
  expect(result.pids).toHaveLength(3)
  expect(result.running).toEqual([])
  expect(await readFile(f.executable, "utf8")).toBe(f.original)
  expect(existsSync(f.lock)).toBe(false)
  expect(await readdir(dirname(f.executable))).toEqual(["opengh preview"])
  expect(await readdir(f.temporary)).toEqual([])
}, 10_000)
