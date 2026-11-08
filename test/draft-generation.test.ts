import { afterEach, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDiskDraftStore, DraftConflictError, type IssueDraft } from "../src/drafts"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const key = "owner/repo#42:comment"
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "opengh-draft-generation-"))
  directories.push(directory)
  return {
    directory,
    path: join(directory, `${createHash("sha256").update(key).digest("hex")}.json`),
    store: createDiskDraftStore(directory),
  }
}
const draft = (body = "Original comment"): IssueDraft => ({ generation: randomUUID(), body, reason: "completed" })

test("competing legacy loaders migrate durably to one shared generation", async () => {
  const { directory, path, store } = fixture()
  const legacy = { body: "Saved before generations", reason: "not_planned", retry: "close" }
  writeFileSync(path, JSON.stringify(legacy), { mode: 0o600 })
  const drafts = new URL("../src/drafts.ts", import.meta.url).pathname
  // Pause a real competing loader after its unlocked legacy read. It must
  // re-read under the lock, rather than replace the first loader's generation.
  const script = `
    import { mock } from "bun:test"
    const fs = { ...await import("node:fs") }
    let paused = false
    mock.module("node:fs", () => ({
      ...fs,
      readFileSync: (...args) => {
        const text = fs.readFileSync(...args)
        if (!paused && text === ${JSON.stringify(JSON.stringify(legacy))}) {
          paused = true
          fs.writeSync(1, "read-legacy\\n")
          fs.readFileSync(0, "utf8")
        }
        return text
      },
    }))
    const { createDiskDraftStore } = await import(${JSON.stringify(drafts)})
    console.log(JSON.stringify(createDiskDraftStore(${JSON.stringify(directory)}).load(${JSON.stringify(key)})))
  `
  const child = Bun.spawn([process.execPath, "--eval", script], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000)
  const errors = new Response(child.stderr).text()
  const output = child.stdout.getReader()
  try {
    const signal = await output.read()
    expect(new TextDecoder().decode(signal.value).trim()).toBe("read-legacy")
    const first = store.load(key)!
    child.stdin.end()
    let text = ""
    for (;;) {
      const chunk = await output.read()
      if (chunk.done) break
      text += new TextDecoder().decode(chunk.value)
    }
    const second = JSON.parse(text)
    expect(await child.exited).toBe(0)
    expect(await errors).toBe("")
    expect(first).toMatchObject(legacy)
    expect(first.generation).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    expect(second).toEqual(first)
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(first)
    expect(statSync(path).mode & 0o777).toBe(0o600)

    writeFileSync(path, "malformed legacy draft")
    expect(() => store.load(key)).toThrow("Cannot read saved draft")
    expect(() => store.save(key, draft(), undefined)).toThrow("Cannot read saved draft")
    expect(readFileSync(path, "utf8")).toBe("malformed legacy draft")
  } finally {
    output.releaseLock()
    clearTimeout(timeout)
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
  }
}, 15_000)

test("a versioned clear prevents cached generations from resurrecting a settled draft", () => {
  const { directory, path, store } = fixture()
  const original = draft()
  store.save(key, original, undefined)
  const other = createDiskDraftStore(directory)
  const cached = other.load(key)!
  const cleared = draft("")
  store.save(key, cleared, original.generation)
  expect(store.load(key)).toEqual(cleared)
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(cleared)
  expect(() => other.save(key, cached, cached.generation)).toThrow(DraftConflictError)
  expect(() => other.save(key, draft("Resurrected"), cached.generation)).toThrow(DraftConflictError)
  expect(() => other.save(key, draft(), undefined)).toThrow(DraftConflictError)
  expect(() => store.save(key, { ...cleared, body: "Reused generation" }, cleared.generation)).toThrow(DraftConflictError)
  expect(() => store.save(key, { ...cleared, reason: "not_planned" }, cleared.generation)).toThrow(DraftConflictError)
  expect(() => store.save(key, { ...cleared, retry: "close" }, cleared.generation)).toThrow(DraftConflictError)
  expect(other.load(key)).toEqual(cleared)
})

test("an exact save retries file and directory fsync after a published write reports failure", async () => {
  const { directory, path } = fixture()
  const drafts = new URL("../src/drafts.ts", import.meta.url).pathname
  // Isolate the injected failure so other tests retain the real filesystem API.
  const script = `
    import { expect, mock } from "bun:test"
    const fs = { ...await import("node:fs") }
    const directory = ${JSON.stringify(directory)}, path = ${JSON.stringify(path)}
    const handles = new Map(), synced = []
    let failDirectory = true
    mock.module("node:fs", () => ({
      ...fs,
      openSync: (...args) => {
        const fd = fs.openSync(...args)
        handles.set(fd, args[0])
        return fd
      },
      closeSync: fd => { handles.delete(fd); fs.closeSync(fd) },
      fsyncSync: fd => {
        const target = handles.get(fd)
        synced.push(target)
        if (failDirectory && target === directory) {
          failDirectory = false
          throw new Error("injected draft directory fsync failure")
        }
        fs.fsyncSync(fd)
      },
    }))
    const { createDiskDraftStore, DraftConflictError } = await import(${JSON.stringify(drafts)})
    const store = createDiskDraftStore(directory), key = ${JSON.stringify(key)}
    const original = ${JSON.stringify(draft())}
    expect(() => store.save(key, original, undefined)).toThrow("injected draft directory fsync failure")
    expect(store.load(key)).toEqual(original)
    synced.length = 0
    store.save(key, original, undefined)
    expect(synced.filter(target => target === path || target === directory)).toEqual([path, directory])
    expect(store.load(key)).toEqual(original)
    expect(() => store.save(key, { ...original, body: "Changed under same generation" }, original.generation))
      .toThrow(DraftConflictError)
    expect(fs.statSync(path).mode & 0o777).toBe(0o600)
  `
  const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" })
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000)
  const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text()
  try {
    expect({ code: await child.exited, stdout: await stdout, stderr: await stderr })
      .toEqual({ code: 0, stdout: "", stderr: "" })
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
  }
}, 15_000)

test("the async publication guard excludes sync writes and rejects a generation changed before authorization", async () => {
  const { directory, store } = fixture()
  const original = draft()
  store.save(key, original, undefined)
  const other = createDiskDraftStore(directory)
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const pause = new Promise<void>(resolve => { release = resolve })
  let published = false
  const publishing = store.withCurrent(key, original.generation, original.body, async () => {
    entered()
    await pause
    published = true
  })
  const cleared = draft("")
  try {
    await started
    expect(() => other.save(key, cleared, original.generation)).toThrow("storage is locked")
    expect(other.load(key)).toEqual(original)
    expect(published).toBe(false)
  } finally { release(); await publishing }
  expect(published).toBe(true)

  let unauthorized = false
  const late = other.withCurrent(key, original.generation, original.body, async () => { unauthorized = true })
  store.save(key, cleared, original.generation)
  await expect(late).rejects.toThrow(DraftConflictError)
  await expect(other.withCurrent(key, cleared.generation, original.body, async () => { unauthorized = true }))
    .rejects.toThrow(DraftConflictError)
  expect(unauthorized).toBe(false)
  await store.withCurrent(key, cleared.generation, cleared.body, async () => {})
})
