import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createInlineDrafts,
  createInlineDraftStorage,
  inlineDraftKey,
  type InlineDraftContext,
  type InlineDraftStorage,
} from "../src/inline-drafts"
import type { InlineCommentInput } from "../src/review-types"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), "opengh-inline-drafts-"))
  directories.push(directory)
  return join(directory, "inline-drafts")
}
const scope = { accountId: 1, repository: "Owner/Repo", number: 7 }
const draft = (line: number, body = `Draft on ${line}`, extra: Partial<InlineCommentInput> = {}): InlineCommentInput => ({
  accountId: 1,
  repositoryId: 71,
  repository: "Owner/Repo",
  number: 7,
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  anchor: { path: "src/app.ts", line, side: "RIGHT" },
  body,
  ...extra,
})
const context = (line: number): InlineDraftContext => {
  const { body: _body, ...rest } = draft(line)
  void _body
  return rest
}
const files = (directory: string) => readdirSync(directory).filter((name) => name.endsWith(".json"))

test("storage round-trips drafts in a private file and removes it when none remain", async () => {
  const directory = temporary()
  const storage = createInlineDraftStorage(directory)
  expect(await storage.load(scope)).toEqual([])
  const range = draft(5, "Range", { anchor: { path: "src/app.ts", line: 5, side: "LEFT", startLine: 3, startSide: "LEFT" } })
  await storage.save(scope, [draft(1), range])
  expect(files(directory)).toHaveLength(1)
  const path = join(directory, files(directory)[0]!)
  if (process.platform !== "win32") {
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(directory).mode & 0o777).toBe(0o700)
  }
  expect(await storage.load(scope)).toEqual([draft(1), range])
  // Scope matches case-insensitively; drafts take the caller's casing.
  expect(await storage.load({ ...scope, repository: "owner/repo" })).toEqual([
    { ...draft(1), repository: "owner/repo" },
    { ...range, repository: "owner/repo" },
  ])
  expect(await createInlineDraftStorage(directory).load({ ...scope, number: 8 })).toEqual([])
  await storage.save(scope, [])
  expect(files(directory)).toEqual([])
  await storage.save(scope, []) // Nothing to remove.
})

test("storage whitelists fields and rejects invalid drafts without writing them", async () => {
  const directory = temporary()
  const storage = createInlineDraftStorage(directory)
  await storage.save(scope, [{ ...draft(1), token: "secret" } as InlineCommentInput])
  expect(readFileSync(join(directory, files(directory)[0]!), "utf8")).not.toContain("secret")
  expect(await storage.load(scope)).toEqual([draft(1)])
  for (const invalid of [
    draft(1, " "),
    draft(0),
    draft(1, "x", { headSha: "nope" }),
    draft(1, "x", { baseSha: undefined as unknown as string }),
    draft(1, "x", { repositoryId: 0 }),
    draft(1, "x", { accountId: 2 }),
    draft(1, "x", { number: 8 }),
    draft(1, "x", { anchor: { path: "a", line: 2, side: "RIGHT", startLine: 1, startSide: "LEFT" } }),
    draft(1, "x".repeat(70_000)),
  ])
    await expect(storage.save(scope, [invalid])).rejects.toThrow()
  await expect(storage.save(scope, [draft(1), draft(1, "duplicate")])).rejects.toThrow()
  expect(await storage.load(scope)).toEqual([draft(1)])
})

test("storage never overwrites or deletes an unreadable file", async () => {
  const directory = temporary()
  const storage = createInlineDraftStorage(directory)
  await storage.save(scope, [draft(1)])
  const path = join(directory, files(directory)[0]!)
  const original = readFileSync(path, "utf8")
  const stored = JSON.parse(original)
  for (const corrupt of [
    "{not json",
    JSON.stringify([]),
    JSON.stringify({ ...stored, version: 2 }),
    JSON.stringify({ ...stored, accountId: 2 }),
    JSON.stringify({ ...stored, drafts: [{ ...stored.drafts[0], anchor: { path: "x", line: -1, side: "RIGHT" } }] }),
    JSON.stringify({ ...stored, drafts: [{ ...stored.drafts[0], accountId: 9 }] }),
    JSON.stringify({ ...stored, drafts: "nope" }),
  ]) {
    writeFileSync(path, corrupt, { mode: 0o600 })
    await expect(storage.load(scope)).rejects.toThrow("will not be overwritten")
    await expect(storage.save(scope, [draft(2)])).rejects.toThrow("will not be overwritten")
    await expect(storage.save(scope, [])).rejects.toThrow("will not be overwritten")
    expect(readFileSync(path, "utf8")).toBe(corrupt)
  }
  writeFileSync(path, "x".repeat(4 * 1024 * 1024 + 1), { mode: 0o600 })
  await expect(storage.load(scope)).rejects.toThrow("byte limit")
})

function memoryStorage(initial: InlineCommentInput[] = []) {
  const stored = new Map<string, InlineCommentInput[]>([["1/owner/repo/7", initial]])
  const key = (s: typeof scope) => `${s.accountId}/${s.repository.toLowerCase()}/${s.number}`
  const saves: InlineCommentInput[][] = []
  let failure: Error | undefined
  let loadGate: Promise<void> | undefined
  const storage: InlineDraftStorage = {
    async load(s) {
      await loadGate
      if (failure) throw failure
      return (stored.get(key(s)) ?? []).map((d) => ({ ...d, repository: s.repository }))
    },
    async save(s, drafts) {
      if (failure) throw failure
      saves.push(drafts)
      stored.set(key(s), drafts)
    },
  }
  return {
    storage,
    stored,
    saves,
    fail: (error?: Error) => (failure = error),
    gate: (gate?: Promise<void>) => (loadGate = gate),
  }
}

test("the session debounces saves, skips blank drafts and removes posted drafts", async () => {
  const memory = memoryStorage()
  const drafts = createInlineDrafts({ storage: memory.storage, delay: 10 })
  const ctx = context(1)
  drafts.set(ctx, "f")
  drafts.set(ctx, "fi")
  drafts.set(ctx, "first")
  drafts.set(context(2), "  ")
  expect(memory.saves).toEqual([])
  await Bun.sleep(40)
  expect(memory.saves).toEqual([[draft(1, "first")]])
  expect(drafts.get(ctx)?.body).toBe("first")
  expect(drafts.get(context(2))?.body).toBe("  ") // Blank drafts stay in memory only.
  // Keys do not depend on property order.
  const { anchor: _anchor, ...rest } = ctx
  const reordered = { anchor: { side: "RIGHT" as const, line: 1, path: "src/app.ts" }, ...rest }
  expect(Object.keys(reordered)[0]).toBe("anchor")
  expect(inlineDraftKey(reordered)).toBe(inlineDraftKey(ctx))
  drafts.remove(reordered)
  await drafts.flush()
  expect(memory.saves.at(-1)).toEqual([])
  expect(drafts.drafts().size).toBe(1)
})

test("loading merges stored drafts without replacing newer edits, and saving waits for the load", async () => {
  const memory = memoryStorage([draft(1, "stored one"), draft(2, "stored two"), draft(3, "stored three")])
  const gate = Promise.withResolvers<void>()
  memory.gate(gate.promise)
  const drafts = createInlineDrafts({ storage: memory.storage, delay: 1 })
  drafts.set(context(1), "edited before load")
  drafts.remove(context(2)) // e.g. posted from another view before the load finished
  const loading = drafts.load(scope)
  await Bun.sleep(10)
  expect(memory.saves).toEqual([]) // A save must not drop drafts that were not read yet.
  gate.resolve()
  await loading
  await drafts.flush()
  expect(drafts.get(context(1))?.body).toBe("edited before load")
  expect(drafts.get(context(2))).toBeUndefined()
  expect(drafts.get(context(3))?.body).toBe("stored three")
  expect(memory.saves.at(-1)).toEqual([draft(1, "edited before load"), draft(3, "stored three")])
})

test("save failures stay visible, keep drafts in memory and are retried by flush", async () => {
  const memory = memoryStorage()
  const drafts = createInlineDrafts({ storage: memory.storage, delay: 1 })
  const ctx = context(1)
  memory.fail(new Error("disk full"))
  drafts.set(ctx, "keep me")
  await Bun.sleep(20)
  expect(drafts.error()).toContain("disk full")
  expect(drafts.get(ctx)?.body).toBe("keep me")
  await expect(drafts.flush()).rejects.toThrow("disk full")
  memory.fail()
  await drafts.flush()
  expect(drafts.error()).toBeUndefined()
  expect(memory.stored.get("1/owner/repo/7")).toEqual([draft(1, "keep me")])
})

test("an unreadable stored file is reported and blocks saving that pull request, leaving it unchanged", async () => {
  const directory = temporary()
  const writer = createInlineDraftStorage(directory)
  await writer.save(scope, [draft(1)])
  const path = join(directory, files(directory)[0]!)
  writeFileSync(path, "{corrupt", { mode: 0o600 })
  const drafts = createInlineDrafts({ storage: createInlineDraftStorage(directory), delay: 1 })
  await drafts.load(scope)
  expect(drafts.error()).toContain("will not be overwritten")
  drafts.set(context(2), "new")
  await expect(drafts.flush()).rejects.toThrow("will not be overwritten")
  expect(readFileSync(path, "utf8")).toBe("{corrupt")
  expect(drafts.get(context(2))?.body).toBe("new")
})

test("drafts persist across sessions through the disk store", async () => {
  const directory = temporary()
  const first = createInlineDrafts({ storage: createInlineDraftStorage(directory), delay: 1 })
  first.set(context(4), "survives restart")
  await first.flush()
  const second = createInlineDrafts({ storage: createInlineDraftStorage(directory) })
  expect(second.drafts().size).toBe(0)
  await second.load(scope)
  expect([...second.drafts().values()]).toEqual([draft(4, "survives restart")])
  second.remove(context(4))
  await second.flush()
  expect(files(directory)).toEqual([])
})
