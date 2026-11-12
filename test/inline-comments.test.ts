import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInlineComments, createInlineCommentStorage, InlineCommentUncertainError, type InlineCommentStorage, type InlineCommentAttempt } from "../src/inline-comments"
import { createGitHubReviews } from "../src/github/reviews"
import { GitHubApiError, GitHubRequestNotSentError, type GitHubTransport } from "../src/github/transport"
import type { InlineCommentInput } from "../src/review-types"

// The persisted attempt identity, exactly as earlier builds fingerprinted it; the repository ID is stored alongside.
const stored: InlineCommentAttempt["input"] = { accountId: 7, repository: "o/r", number: 1, headSha: "a".repeat(40), baseSha: "b".repeat(40), body: "Public comment", anchor: { path: "a.ts", line: 2, side: "RIGHT", startLine: 1, startSide: "RIGHT" } }
const input: InlineCommentInput = { ...stored, repositoryId: 71 }
function fixture() {
  const saved = new Map<string, InlineCommentAttempt>()
  const key = (value: InlineCommentAttempt["input"]) => JSON.stringify({ ...value, repositoryId: undefined })
  const storage: InlineCommentStorage = {
    async load(input) { return structuredClone(saved.get(key(input))) },
    async save(attempt) { if (saved.has(key(attempt.input))) throw new Error("existing"); saved.set(key(attempt.input), structuredClone(attempt)) },
    async remove(attempt) { if (JSON.stringify(saved.get(key(attempt.input))) !== JSON.stringify(attempt)) throw new Error("changed"); saved.delete(key(attempt.input)) },
    async update(previous, next) { if (JSON.stringify(saved.get(key(previous.input))) !== JSON.stringify(previous)) throw new Error("changed"); saved.set(key(next.input), structuredClone(next)) },
  }
  const data = { repositoryId: 71, draft: false, account: 7, head: input.headSha, base: input.baseSha, access: true, locked: false, fail: undefined as Error | undefined,
    reads: 0, readFail: false, record: true, posts: [] as { path: string; method: string; body: Record<string, unknown> }[], comments: [] as any[] }
  const transport: GitHubTransport = {
    async json<T>(path: string): Promise<T> {
      if (path === "user") return { id: data.account, login: "me" } as T
      if (path === "repos/o/r") return { id: data.repositoryId, archived: false, private: true, permissions: { pull: data.access } } as T
      if (path === "repos/o/r/pulls/1") return { head: { sha: data.head }, base: { sha: data.base }, state: "open", draft: data.draft, locked: data.locked, user: { id: 8 } } as T
      if (path.includes("/reviews?")) return [{ id: 50, user: { id: 7 }, state: "PENDING" }] as T
      if (path.includes("/files?")) return [{ filename: "a.ts", patch: "@@ -1,2 +1,2 @@\n one\n two" }] as T
      if (path.includes("/comments?")) {
        data.reads++
        if (data.readFail) throw new Error("GET failed")
        const page = Number(new URLSearchParams(path.split("?")[1]).get("page"))
        return data.comments.slice((page - 1) * 100, page * 100) as T
      }
      throw new Error(path)
    },
    async text() { throw new Error("no access") },
    async mutate<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>): Promise<T> {
      expect(saved.size).toBeGreaterThan(0)
      data.posts.push({ path, method, body })
      const comment = { ...body, id: 1000 + data.posts.length, user: { id: 7 }, pull_request_review_id: 50 }
      if (data.record) data.comments.push(comment)
      if (data.fail) throw data.fail
      return comment as T
    },
  }
  return { data, storage, transport, service: createInlineComments({ storage, transport }) }
}
test.each([false, true])("posts exact public comment payload independently of a pending whole review (draft=%s)", async (draft) => {
  const { data, service, transport } = fixture()
  data.draft = draft
  const eligibility = await createGitHubReviews(transport).eligibility("o/r", 1)
  expect(eligibility.canComment).toBe(false)
  expect(eligibility.canInlineComment).toBe(true)
  expect((await service.post(input)).id).toBe(1001)
  expect(data.posts).toEqual([{ path: "repos/o/r/pulls/1/comments", method: "POST", body: {
    body: input.body, commit_id: input.headSha, path: "a.ts", line: 2, side: "RIGHT", start_line: 1, start_side: "RIGHT",
  } }])
})
test("denies changed head/base/account and missing permission before mutation", async () => {
  for (const change of [{ head: "c".repeat(40) }, { base: "c".repeat(40) }, { account: 9 }, { access: false }, { locked: true }]) {
    const { data, service } = fixture()
    Object.assign(data, change)
    await expect(service.post(input)).rejects.toThrow()
    expect(data.posts).toHaveLength(0)
  }
})
test("a same-name replacement repository receives no inline comment and leaves no attempt marker", async () => {
  const { data, service, storage } = fixture()
  data.repositoryId = 72 // Same name, account, PR number, head and base: only the immutable ID differs.
  await expect(service.post(input)).rejects.toThrow("Repository changed; no comment was sent.")
  expect(data.posts).toHaveLength(0)
  expect(await storage.load(input)).toBeUndefined()
  for (const repositoryId of [undefined, null, "71", 0, -1, 1.5]) {
    await expect(service.post({ ...input, repositoryId } as InlineCommentInput)).rejects.toThrow("Invalid")
    expect(data.reads).toBe(1) // Rejected before any request.
  }
  expect(data.posts).toHaveLength(0)
  data.repositoryId = 71
  expect((await service.post(input)).id).toBe(1001)
})
test("an uncertain attempt records its repository and is never reconciled or retried against a replacement", async () => {
  const { data, service, storage } = fixture()
  data.record = false; data.fail = new Error("timeout")
  await expect(service.post(input)).rejects.toMatchObject({ retryAllowed: true })
  const attempt = await storage.load(input)
  expect(attempt).toEqual({ input: stored, repositoryId: 71, commentIds: [], failure: "timeout" })
  // The replacement holds an identical comment, which reconciliation would confirm before deleting the marker.
  data.repositoryId = 72; data.fail = undefined
  data.comments.push({ ...data.posts[0]!.body, id: 2000, user: { id: 7 } })
  const reads = data.reads
  await expect(service.post({ ...input, repositoryId: 72 }, { retryUnconfirmed: true })).rejects.toThrow("Repository changed; no comment was sent.")
  expect(data.reads).toBe(reads)
  expect(await storage.load(input)).toEqual(attempt)
  // A caller still holding the original ID cannot retry into the replacement either.
  data.comments.pop()
  await expect(service.post(input, { retryUnconfirmed: true })).rejects.toThrow("Repository changed; no comment was sent.")
  expect(await storage.load(input)).toEqual(attempt)
  expect(data.posts).toHaveLength(1)
})
test("a legacy attempt stored without a repository ID is still found and reconciled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inline-legacy-id-"))
  try {
    const { data, transport } = fixture()
    const path = join(directory, `${createHash("sha256").update(JSON.stringify(stored)).digest("hex")}.json`)
    await writeFile(path, JSON.stringify({ input: stored, commentIds: [1], failure: "original timeout" }))
    const service = createInlineComments({ storage: createInlineCommentStorage(directory), transport })
    data.comments = [{ id: 1 }]
    await expect(service.post(input)).rejects.toMatchObject({ retryAllowed: true, message: expect.stringContaining("original timeout") })
    expect(data.posts).toHaveLength(0) // Found: an identical comment must not be posted blindly.
    expect(await readdir(directory)).toHaveLength(1)
    data.comments.push({ id: 1001, user: { id: 7 }, commit_id: input.headSha, body: input.body, path: "a.ts", line: 2, side: "RIGHT", start_line: 1, start_side: "RIGHT" })
    expect((await service.post(input)).id).toBe(1001)
    expect(data.posts).toHaveLength(0)
    expect(await readdir(directory)).toEqual([])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test("uncertain retry reconciles paginated own comment without duplicating; uses original anchors only when outdated", async () => {
  const { data, storage, transport } = fixture()
  data.comments = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))
  data.fail = new GitHubApiError("comments", "server failure", 502)
  // Simulate an earlier unknown write, then reconcile its outdated response.
  await storage.save({ input: stored, commentIds: data.comments.map(c => c.id) })
  data.comments.push({ id: 1001, user: { id: 7 }, commit_id: input.headSha, body: input.body, path: "a.ts", line: 2, side: "RIGHT", start_line: 1, start_side: "RIGHT" })
  const posted = data.comments[100]
  Object.assign(posted, { original_line: posted.line, original_start_line: posted.start_line, line: null, start_line: null })
  data.head = "c".repeat(40)
  const fresh = createInlineComments({ storage, transport })
  expect((await fresh.post(input)).id).toBe(1001)
  expect(data.posts).toHaveLength(0)
})
test("unresolved attempts do not block different input, ignoring baseline matches", async () => {
  const { data, service } = fixture()
  data.comments.push({ id: 1, user: { id: 7 }, commit_id: input.headSha, body: input.body, path: "a.ts", line: 2, side: "RIGHT", start_line: 1, start_side: "RIGHT" })
  data.record = false; data.fail = new Error("timeout")
  await expect(service.post(input)).rejects.toMatchObject({ checkGitHub: true })
  await expect(service.post(input)).rejects.toMatchObject({ checkGitHub: true })
  data.fail = undefined; data.record = true
  expect((await service.post({ ...input, body: "different" })).id).toBe(1002)
  expect(data.posts).toHaveLength(2)
})
test("definitive rejection releases marker; cleanup failure after success still returns success", async () => {
  const { data, service, storage } = fixture()
  data.fail = new GitHubApiError("comments", "invalid", 422); data.record = false
  await expect(service.post(input)).rejects.toThrow("invalid")
  expect(await storage.load(input)).toBeUndefined()
  data.fail = undefined; data.record = true
  storage.remove = async () => { throw new Error("disk failure") }
  expect((await service.post(input)).id).toBe(1002)
  expect((await service.post(input)).id).toBe(1002)
  expect(data.posts).toHaveLength(2)
})
test("cancellation during marker persistence prevents dispatch and releases the unsent marker", async () => {
  const { data, service, storage } = fixture()
  const controller = new AbortController()
  const save = storage.save
  storage.save = async (attempt) => { await save(attempt); controller.abort() }
  await expect(service.post(input, { signal: controller.signal })).rejects.toBeInstanceOf(GitHubRequestNotSentError)
  expect(data.posts).toHaveLength(0)
  expect(await storage.load(input)).toBeUndefined()
})

test("cancelling an unsent explicit retry preserves the original uncertain receipt", async () => {
  const { data, service, storage } = fixture()
  data.record = false
  data.fail = new Error("original timeout")
  await expect(service.post(input)).rejects.toMatchObject({ retryAllowed: true })
  const previous = await storage.load(input)
  const controller = new AbortController()
  const update = storage.update
  storage.update = async (before, after) => { await update(before, after); controller.abort() }
  await expect(service.post(input, { retryUnconfirmed: true, signal: controller.signal })).rejects.toBeInstanceOf(GitHubRequestNotSentError)
  expect(data.posts).toHaveLength(1)
  expect(await storage.load(input)).toEqual(previous)
})

test("known-unsent account guard clears the inline marker and preserves the original error", async () => {
  const { data, service, storage, transport } = fixture()
  const post = transport.mutate!
  const failure = new GitHubRequestNotSentError("Account changed; no changes were sent")
  transport.mutate = async () => { throw failure }
  await expect(service.post(input)).rejects.toBe(failure)
  expect(await storage.load(input)).toBeUndefined()
  expect(data.posts).toHaveLength(0)
  transport.mutate = post
  expect((await service.post(input)).id).toBe(1001)
})

test("explicit retry requires consent and a fresh complete read; original failure survives restart", async () => {
  const { data, service, storage, transport } = fixture()
  data.record = false; data.fail = new Error("socket timeout")
  await expect(service.post(input)).rejects.toMatchObject({ checkGitHub: true, retryAllowed: true, message: expect.stringContaining("socket timeout") })
  expect((await storage.load(input) as InlineCommentAttempt).failure).toBe("socket timeout")
  const fresh = createInlineComments({ storage, transport })
  await expect(fresh.post(input)).rejects.toBeInstanceOf(InlineCommentUncertainError)
  expect(data.posts).toHaveLength(1)
  data.readFail = true
  await expect(fresh.post(input, { retryUnconfirmed: true })).rejects.toMatchObject({ retryAllowed: false, message: expect.stringContaining("socket timeout") })
  expect(data.posts).toHaveLength(1)
  data.readFail = false; data.fail = undefined; data.record = true
  const reads = data.reads
  expect((await fresh.post(input, { retryUnconfirmed: true })).id).toBe(1002)
  expect(data.reads - reads).toBe(2) // reconciliation, then fresh baseline
  expect(data.posts).toHaveLength(2)
})
test("a match arriving before explicit retry prevents a duplicate; unknown failures reconcile immediately", async () => {
  const { data, service } = fixture()
  data.record = false; data.fail = new Error("timeout")
  await expect(service.post(input)).rejects.toMatchObject({ retryAllowed: true })
  data.comments.push({ ...data.posts[0]!.body, id: 1001, user: { id: 7 } })
  expect((await service.post(input, { retryUnconfirmed: true })).id).toBe(1001)
  expect(data.posts).toHaveLength(1)
  data.record = true
  expect((await service.post({ ...input, body: "another" })).id).toBe(1002)
})
test("legacy marker migrates when loading another input, preserving its original failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inline-legacy-"))
  try {
    const storage = createInlineCommentStorage(directory)
    const legacy = join(directory, `${createHash("sha256").update("7/o/r/1").digest("hex")}.json`)
    const attempt = { input: stored, commentIds: [123], failure: "original timeout" }
    await writeFile(legacy, JSON.stringify(attempt))
    expect(await storage.load({ ...input, body: "unrelated" })).toBeUndefined()
    await expect(readFile(legacy)).rejects.toMatchObject({ code: "ENOENT" })
    expect(await storage.load(input)).toEqual(attempt)
    await storage.save({ input: { ...input, body: "unrelated" }, commentIds: [] })
    expect(await storage.load(input)).toEqual(attempt)
    await storage.update(attempt, { ...attempt, failure: "new detail" })
    await expect(storage.remove(attempt)).rejects.toThrow("changed")
    await expect(storage.update(attempt, { ...attempt, failure: "overwrite" })).rejects.toThrow("changed")
    await writeFile(legacy, "broken")
    await expect(storage.load(input)).rejects.toThrow()
    expect(await readFile(legacy, "utf8")).toBe("broken")
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test("disk attempts are private, exclusive and corrupt files are never overwritten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inline-attempt-"))
  try {
    const storage = createInlineCommentStorage(directory), attempt = { input: stored, repositoryId: 71, commentIds: [] }
    await storage.save(attempt)
    const path = join(directory, (await readdir(directory))[0]!)
    // The repository ID does not rename the marker, so attempts stored by earlier builds are still found.
    expect(path).toEndWith(`${createHash("sha256").update(JSON.stringify(stored)).digest("hex")}.json`)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await storage.load(input)).toEqual(attempt)
    for (const repositoryId of [0, -1, 1.5, "71", null])
      await expect(storage.update(attempt, { ...attempt, repositoryId } as InlineCommentAttempt)).rejects.toThrow("Invalid inline comment attempt")
    expect(await storage.load(input)).toEqual(attempt)
    await expect(storage.save(attempt)).rejects.toThrow()
    await writeFile(path, "broken")
    await expect(storage.load(input)).rejects.toThrow()
    await expect(storage.save(attempt)).rejects.toThrow()
    await expect(storage.update(attempt, { ...attempt, failure: "timeout" })).rejects.toThrow()
    await expect(storage.remove(attempt)).rejects.toThrow()
    expect(await readFile(path, "utf8")).toBe("broken")
  } finally { await rm(directory, { recursive: true, force: true }) }
})
