import { expect, test } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test.skipIf(process.platform === "win32")("durable directories sync checked parents on first use, failure, retry, and symlink traversal", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "opengh-directory-durability-")))
  const filesystem = new URL("../src/filesystem.ts", import.meta.url).pathname
  // Keep the fs mock isolated from other tests; mkdir/open/stat use real temporary paths.
  const script = `
    import { expect, mock } from "bun:test"
    import { dirname, join } from "node:path"
    const fs = { ...await import("node:fs/promises") }
    const base = ${JSON.stringify(directory)}
    const events = []
    let failParent
    mock.module("node:fs/promises", () => ({
      ...fs,
      mkdir: async (...args) => {
        await fs.mkdir(...args)
        events.push(["mkdir", args[0]])
      },
      open: async (...args) => {
        const handle = await fs.open(...args)
        const path = args[0]
        events.push(["open", path])
        return {
          stat: () => handle.stat(),
          sync: async () => {
            events.push(["sync", path])
            if (path === failParent) throw new Error("injected parent sync failure")
          },
          close: async () => {
            await handle.close()
            events.push(["close", path])
          },
        }
      },
    }))
    const { ensureTrustedDirectory } = await import(${JSON.stringify(filesystem)})
    const parents = path => {
      const result = []
      while (dirname(path) !== path) {
        path = dirname(path)
        result.unshift(path)
      }
      return result
    }
    const synced = () => events.filter(([event]) => event === "sync").map(([, path]) => path)
    const syncEvents = path => ["open", "sync", "close"].map(event => [event, path])
    const localEvents = () => events.filter(([, path]) => path === base || path.startsWith(base + "/"))

    await ensureTrustedDirectory(join(base, "default", "leaf"))
    expect(events.map(([event]) => event)).toEqual(["mkdir", "mkdir"])
    events.length = 0

    const first = join(base, "config", "opengh", "recovery")
    await ensureTrustedDirectory(first, true)
    expect(synced()).toEqual(parents(first))
    expect(localEvents()).toEqual([
      ["mkdir", join(base, "config")], ...syncEvents(base),
      ["mkdir", join(base, "config", "opengh")], ...syncEvents(join(base, "config")),
      ["mkdir", first], ...syncEvents(dirname(first)),
    ])
    events.length = 0

    const retry = join(base, "retry-one", "retry-two", "recovery")
    failParent = join(base, "retry-one")
    await expect(ensureTrustedDirectory(retry, true)).rejects.toThrow("injected parent sync failure")
    expect(localEvents()).toEqual([
      ["mkdir", failParent], ...syncEvents(base),
      ["mkdir", dirname(retry)], ...syncEvents(failParent),
    ])
    expect(await fs.lstat(retry).catch(error => error.code)).toBe("ENOENT")
    events.length = 0
    failParent = undefined
    await ensureTrustedDirectory(retry, true)
    expect(synced()).toEqual(parents(retry))
    expect(localEvents()).toEqual([
      ...syncEvents(base), ...syncEvents(join(base, "retry-one")),
      ["mkdir", retry], ...syncEvents(dirname(retry)),
    ])

    const links = join(base, "links")
    const target = join(base, "target")
    await fs.mkdir(links, { mode: 0o700 })
    await fs.mkdir(target, { mode: 0o700 })
    for (const absolute of [false, true]) {
      const name = absolute ? "absolute" : "relative"
      await fs.symlink(absolute ? target : "../target", join(links, name))
      events.length = 0
      const leaf = join(target, name, "recovery")
      await ensureTrustedDirectory(join(links, name, name, "recovery"), true)
      expect(localEvents()).toEqual([
        ...syncEvents(base), ...syncEvents(links), ...syncEvents(base),
        ["mkdir", dirname(leaf)], ...syncEvents(target),
        ["mkdir", leaf], ...syncEvents(dirname(leaf)),
      ])
    }
    await fs.chmod(target, 0o777)
    await expect(ensureTrustedDirectory(join(links, "relative", "unsafe"), true))
      .rejects.toThrow("Untrusted writable directory")
    expect(await fs.lstat(join(target, "unsafe")).catch(error => error.code)).toBe("ENOENT")
  `
  const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" })
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000)
  const output = new Response(child.stdout).text()
  const errors = new Response(child.stderr).text()
  try {
    expect({ code: await child.exited, stdout: await output, stderr: await errors })
      .toEqual({ code: 0, stdout: "", stderr: "" })
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
    await rm(directory, { recursive: true, force: true })
  }
}, 15_000)
