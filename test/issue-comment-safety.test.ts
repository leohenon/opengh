import { afterEach, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGitHubClient } from "../src/github/client"
import { createIssueCommentStorage, issueComment, type IssueCommentAttempt, type IssueCommentResponse } from "../src/github/issue-comments"
import { createDiskDraftStore } from "../src/drafts"
import { MAX_AUTOMATIC_PAGES } from "../src/github/request-budget"
import { GitHubApiError, GitHubRequestNotSentError, type GitHubTransport, type RequestOptions } from "../src/github/transport"
import { createRepositorySession, type RepositoryLoaders } from "../src/repository-session"
import type { PullRequestDetail } from "../src/models"
import { githubDataFixture, issueDetailFixture, commitDetailFixture, pullContextFixture } from "./fixtures/github-data"

const repository = { ...githubDataFixture.repo, id: 71, nameWithOwner: "owner/repo" }
const body = "  Exact **body**\r\n`$(untouched)`\n"
const input = { accountId: 7, repositoryId: 71, number: 42, body }
const date = "2026-01-01T00:00:00Z"
const comment = (id: number, overrides: Partial<IssueCommentResponse> = {}): IssueCommentResponse => ({
  id, user: { id: 7, login: "viewer" }, body, created_at: date, updated_at: date, ...overrides,
})
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "opengh-comment-safety-"))
  directories.push(directory)
  const storage = createIssueCommentStorage(directory)
  const data = { account: 7, writes: 0, record: true, malformed: false, failure: undefined as Error | undefined,
    lookupFailure: false, countFailure: false, viewerFailure: undefined as Error | undefined, endless: false, comments: [] as IssueCommentResponse[], reads: 0,
    beforeWrite: undefined as (() => Promise<void>) | undefined,
    afterPage: undefined as ((page: number) => void) | undefined,
    afterCount: undefined as (() => void) | undefined }
  const transport: GitHubTransport = {
    async json<T>(path: string, options?: RequestOptions): Promise<T> {
      expect(options?.budget).toBeDefined()
      if (path === "user") {
        if (data.viewerFailure) throw data.viewerFailure
        return { id: data.account, login: "viewer" } as T
      }
      if (path === "repositories/71/issues/42") {
        if (data.countFailure) throw new Error("Count lookup unavailable")
        const value = { number: 42, comments: data.comments.length }
        data.afterCount?.()
        return value as T
      }
      expect(path.startsWith("repositories/71/issues/42/comments?per_page=100&page=")).toBe(true)
      data.reads++
      if (data.lookupFailure) throw new Error("Lookup offline")
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page"))
      const values = data.endless ? Array.from({ length: 100 }, (_, index) => comment((page - 1) * 100 + index + 1))
        : data.comments.slice((page - 1) * 100, page * 100)
      data.afterPage?.(page)
      return values as T
    },
    async text() { throw new Error("Unexpected text request") },
    async mutate<T>(path: string, method: "POST" | "PATCH", payload: Record<string, unknown>, options?: RequestOptions): Promise<T> {
      expect([path, method, payload]).toEqual(["repositories/71/issues/42/comments", "POST", { body }])
      expect(options?.budget).toBeDefined()
      expect(await storage.load(input)).toBeDefined()
      data.writes++
      await data.beforeWrite?.()
      const posted = comment(10_000 + data.writes)
      if (data.record) data.comments.push(posted)
      if (data.failure) throw data.failure
      return (data.malformed ? { id: "invalid" } : posted) as T
    },
  }
  return { directory, storage, data, transport, client: createGitHubClient(transport, storage) }
}

test("timeout reconciles a new own comment, excluding an old identical body", async () => {
  const { client, data, storage } = await fixture()
  data.comments = [comment(1)]
  data.failure = new Error("Request timed out")
  expect(await client.createIssueComment(repository, 42, body, (confirmed, recovered) => {
    expect(confirmed.id).toBe(10_001)
    expect(recovered).toBe(false)
  })).toMatchObject({ id: 10_001, body, author: "viewer" })
  expect(data.writes).toBe(1)
  expect(await storage.load(input)).toBeUndefined()
})

test("deletions cannot turn an incomplete baseline into confirmation of an old comment", async () => {
  const { client, data, storage } = await fixture()
  data.comments = Array.from({ length: 101 }, (_, index) => comment(index + 1, { body: index === 100 ? body : "Earlier comment" }))
  data.afterPage = page => {
    if (page === 1) { data.comments.shift(); data.afterPage = undefined }
  }
  data.record = false
  data.failure = new Error("Request timed out")
  let acknowledgements = 0
  const acknowledge = () => { acknowledgements++ }
  await expect(client.createIssueComment(repository, 42, body, acknowledge)).rejects.toBeInstanceOf(GitHubRequestNotSentError)
  expect(data.writes).toBe(0)
  expect(await storage.load(input)).toBeUndefined()
  await expect(client.createIssueComment(repository, 42, body, acknowledge)).rejects.toThrow("No new matching comment")
  expect(data.writes).toBe(1)
  expect(await storage.load(input)).toMatchObject({ baselineCount: 100 })
  expect(acknowledgements).toBe(0)

  const legacy = await fixture()
  legacy.data.comments = [...data.comments]
  const attempt: IssueCommentAttempt = { input, commentIds: Array.from({ length: 100 }, (_, index) => index + 1), nonce: "legacy" }
  await legacy.storage.save(attempt)
  await expect(legacy.client.createIssueComment(repository, 42, body, acknowledge)).rejects.toThrow()
  expect(legacy.data.writes).toBe(0)
  expect(await legacy.storage.load(input)).toEqual(attempt)
  expect(acknowledgements).toBe(0)
})

test("durable restart stays blocked on negative, incomplete or wrong-author lookups, then confirms across a rename", async () => {
  const { client, data, storage, directory, transport } = await fixture()
  data.comments = [comment(1)]
  data.record = false; data.failure = new Error("Request timed out")
  await expect(client.createIssueComment(repository, 42, body)).rejects.toThrow("Check GitHub")
  const attempt = await storage.load(input)
  const fresh = createGitHubClient(transport, createIssueCommentStorage(directory))
  await expect(fresh.createIssueComment(repository, 42, body)).rejects.toThrow("No new matching comment")
  data.lookupFailure = true
  await expect(fresh.createIssueComment(repository, 42, body)).rejects.toThrow("Lookup offline")
  data.lookupFailure = false; data.endless = true
  const reads = data.reads
  await expect(fresh.createIssueComment(repository, 42, body)).rejects.toThrow("page limit")
  expect(data.reads - reads).toBe(MAX_AUTOMATIC_PAGES)
  data.endless = false
  data.comments.push(comment(2, { user: { id: 8, login: "viewer" } }), comment(3, { body: body.trim() }))
  await expect(fresh.createIssueComment(repository, 42, body)).rejects.toThrow("No new matching comment")
  expect(await storage.load(input)).toEqual(attempt)
  expect(await storage.load({ ...input, repositoryId: 72 })).toBeUndefined()
  data.comments.push(comment(4, { user: { id: 7, login: "renamed-viewer" } }))
  expect((await fresh.createIssueComment({ ...repository, nameWithOwner: "new/name" }, 42, body)).id).toBe(4)
  expect(data.writes).toBe(1)
})

test("malformed POST responses and failed count reads retain protection until acknowledgement", async () => {
  for (const record of [true, false]) {
    const { client, data, storage } = await fixture()
    data.malformed = true; data.record = record
    if (record) expect((await client.createIssueComment(repository, 42, body)).id).toBe(10_001)
    else {
      await expect(client.createIssueComment(repository, 42, body)).rejects.toThrow("Check GitHub")
      await expect(client.createIssueComment(repository, 42, body)).rejects.toThrow("Check GitHub")
      expect(await storage.load(input)).toBeDefined()
    }
    expect(data.writes).toBe(1)
  }
  const { client, data, storage } = await fixture()
  data.beforeWrite = async () => { data.countFailure = true }
  let acknowledged = false
  const acknowledge = () => { acknowledged = true }
  await expect(client.createIssueComment(repository, 42, body, acknowledge)).rejects.toThrow("Count lookup unavailable")
  expect(acknowledged).toBe(false)
  expect(await storage.load(input)).toBeDefined()
  data.countFailure = false
  expect((await client.createIssueComment(repository, 42, body, acknowledge)).id).toBe(10_001)
  expect(acknowledged).toBe(true)
  expect(data.writes).toBe(1)
  expect(await storage.load(input)).toBeUndefined()
})

test("definite rejection and known-unsent requests release only their marker, allowing an explicit retry", async () => {
  for (const error of [new GitHubApiError("comments", "Rejected", 422), new GitHubRequestNotSentError("Not sent")]) {
    const { client, data, storage } = await fixture()
    if (error instanceof GitHubRequestNotSentError) storage.update = async () => { throw new Error("Disk full") }
    data.failure = error; data.record = false
    await expect(client.createIssueComment(repository, 42, body)).rejects.toBe(error)
    expect(await storage.load(input)).toBeUndefined()
    data.failure = undefined; data.record = true
    expect((await client.createIssueComment(repository, 42, body)).id).toBe(10_002)
    expect(data.writes).toBe(2)
  }
})

test("cleanup failures preserve success and allow proven rejections to recover", async () => {
  for (const outcome of ["confirmed", "rejected", "memory-rejected"] as const) {
    const { client, data, storage, directory, transport } = await fixture()
    const remove = storage.remove
    const update = storage.update
    storage.remove = async () => { throw new Error("Disk unavailable") }
    if (outcome !== "confirmed") {
      if (outcome === "memory-rejected") storage.update = async () => { throw new Error("Disk unavailable") }
      data.failure = new GitHubApiError("comments", "Rejected", 403); data.record = false
      await expect(client.createIssueComment(repository, 42, body)).rejects.toThrow("marker could not be cleared")
      data.failure = undefined; data.record = true
      await expect(client.createIssueComment(repository, 42, body)).rejects.toThrow()
    } else {
      expect((await client.createIssueComment(repository, 42, body, () => {})).id).toBe(10_001)
      expect((await client.createIssueComment(repository, 42, body, () => {})).id).toBe(10_001)
    }
    expect(await storage.load(input)).toBeDefined()
    expect(data.writes).toBe(1)
    storage.remove = remove
    storage.update = update
    const resumed = outcome === "memory-rejected" ? client : createGitHubClient(transport, createIssueCommentStorage(directory))
    expect((await resumed.createIssueComment(repository, 42, body, () => {})).id).toBe(outcome === "confirmed" ? 10_001 : 10_002)
    expect(data.writes).toBe(outcome === "confirmed" ? 1 : 2)
    expect(await storage.load(input)).toBeUndefined()
  }
})

test("a retired receipt cannot consume a new identical-body draft after cleanup failed", async () => {
  for (const rejected of [false, true]) {
    const { client, data, storage, directory, transport } = await fixture()
    const disk = createDiskDraftStore(join(directory, "drafts"))
    const key = "owner/repo@71#42:comment"
    const original = { generation: randomUUID(), body, reason: "completed" as const }
    disk.save(key, original, undefined)
    const guard = (draft: typeof original) => ({ generation: draft.generation,
      withCurrent: (publish: () => Promise<void>) => disk.withCurrent(key, draft.generation, draft.body, publish) })
    const remove = storage.remove
    storage.remove = async () => { throw new Error("Cleanup unavailable") }
    const confirmations: number[] = []
    const settle = (draft: typeof original) => (posted: { id: number }) => {
      confirmations.push(posted.id)
      disk.save(key, { ...draft, generation: randomUUID(), body: "" }, draft.generation)
    }
    if (rejected) {
      data.record = false
      data.failure = new GitHubApiError("comments", "Rejected", 422)
      await expect(client.createIssueComment(repository, 42, body, settle(original), key, guard(original))).rejects.toThrow("marker could not be cleared")
      disk.save(key, { ...original, generation: randomUUID(), body: "" }, original.generation)
    } else {
      expect((await client.createIssueComment(repository, 42, body, settle(original), key, guard(original))).id).toBe(10_001)
    }
    expect(await storage.load(input)).toBeDefined()
    data.record = true
    data.failure = undefined
    storage.remove = remove
    const next = { ...original, generation: randomUUID() }
    disk.save(key, next, disk.load(key)!.generation)
    const resumed = createGitHubClient(transport, createIssueCommentStorage(directory))
    expect((await resumed.createIssueComment(repository, 42, body, settle(next), key, guard(next))).id).toBe(10_002)
    expect(confirmations).toEqual(rejected ? [10_002] : [10_001, 10_002])
    expect(data.writes).toBe(2)
    expect(await storage.load(input)).toBeUndefined()
    expect(disk.load(key)?.body).toBe("")
  }
})

test("persistence failure and concurrent submissions cannot send an extra POST; account changes cannot confirm", async () => {
  const { client, data, storage, transport } = await fixture()
  const save = storage.save
  storage.save = async () => { throw new Error("Disk full") }
  await expect(client.createIssueComment(repository, 42, body)).rejects.toThrow("no comment was sent")
  expect(data.writes).toBe(0)
  storage.save = async attempt => { await save(attempt); data.viewerFailure = new Error("Preflight offline") }
  await expect(client.createIssueComment(repository, 42, body)).rejects.toBeInstanceOf(GitHubRequestNotSentError)
  expect(await storage.load(input)).toBeUndefined()
  expect(data.writes).toBe(0)
  data.viewerFailure = undefined
  storage.save = async attempt => { await save(attempt); data.account = 9 }
  await expect(client.createIssueComment(repository, 42, body)).rejects.toThrow("account changed")
  expect(await storage.load(input)).toBeUndefined()
  expect(data.writes).toBe(0)
  data.account = 7; storage.save = save
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  data.beforeWrite = () => { entered(); return gate }
  data.failure = new Error("Request timed out"); data.record = false
  const first = client.createIssueComment(repository, 42, body)
  await started
  await expect(createGitHubClient(transport, storage).createIssueComment(repository, 42, body)).rejects.toThrow("already being submitted")
  release()
  await expect(first).rejects.toThrow("Check GitHub")
  data.account = 9
  data.comments.push(comment(10_001))
  await expect(client.createIssueComment(repository, 42, body)).rejects.toThrow("account changed")
  await expect(createGitHubClient(transport, storage).createIssueComment(repository, 42, body)).rejects.toThrow("another GitHub account")
  expect(await storage.load(input)).toBeDefined()
  data.account = 7
  expect((await client.createIssueComment(repository, 42, body)).id).toBe(10_001)
  expect(data.writes).toBe(1)
})

test("disk markers are private and exclusive; mismatched, corrupt and symlinked markers fail closed", async () => {
  const { directory, storage, client, data } = await fixture()
  const attempt: IssueCommentAttempt = { input, commentIds: [1], nonce: "owned" }
  await storage.save(attempt)
  const path = join(directory, (await readdir(directory)).find(name => name.endsWith(".json"))!)
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  await expect(createIssueCommentStorage(directory).save(attempt)).rejects.toThrow()
  await expect(storage.remove({ ...attempt, nonce: "different" })).rejects.toThrow("changed")
  await writeFile(path, "broken")
  await expect(client.createIssueComment(repository, 42, body)).rejects.toThrow("Cannot read")
  await expect(storage.save(attempt)).rejects.toThrow()
  await rm(path)
  await symlink(join(directory, "missing"), path)
  await expect(client.createIssueComment(repository, 42, body)).rejects.toThrow("Cannot read")
  expect(data.writes).toBe(0)
})

test("issue and PR recovery keeps authoritative totals with partial pages, before and after restart", async () => {
  for (const parent of ["issue", "pull"] as const) for (const kind of ["comment", "close"] as const) for (const restarting of [false, true]) {
    const { client, data, directory, transport, storage } = await fixture()
    data.comments = Array.from({ length: 100 }, (_, index) => comment(index + 1, { body: "Earlier comment" }))
    const disk = createDiskDraftStore(join(directory, "drafts"))
    const draftKey = `owner/repo@71#42${parent === "pull" ? ":pull" : ""}:${kind}`
    let failSettlement = true
    const drafts = { load: disk.load, withCurrent: disk.withCurrent,
      save: (key: string, draft: Parameters<typeof disk.save>[1], expected: string | undefined) => {
        if (failSettlement && key === draftKey && !draft.body) throw new Error("Draft disk unavailable")
        disk.save(key, draft, expected)
      } }
    let remoteState: "open" | "closed" = "open"
    const updatedAt = "2026-06-01T00:00:00Z"
    const issue = () => ({ ...issueDetailFixture, number: 42, state: remoteState, updatedAt, commentCount: data.comments.length })
    const pull = (): PullRequestDetail => ({ ...githubDataFixture.pulls.open.value!.items[0]!, number: 42, state: remoteState,
      url: "https://github.com/owner/repo/pull/42", body: "PR body", updatedAt,
      baseBranch: "main", headBranch: "next", additions: 1, deletions: 0, changedFiles: 1, commitCount: 0,
      commentCount: data.comments.length, labels: [], assignees: [], reviewers: [], mergeable: true,
      permissions: { comment: true, close: true } })
    let closes = 0
    let api = client
    const loaders: RepositoryLoaders = {
      metadata: async () => repository, documents: async () => [], document: async () => "",
      workCounts: async () => ({ issues: 0, pulls: 0 }),
      branches: async () => ({ items: [], hasMore: false }), commits: async () => ({ items: [], hasMore: false }),
      commitCount: async () => 0, commit: async () => commitDetailFixture, issue: async () => issue(),
      issues: async () => ({ items: [], hasMore: false }), pulls: async () => ({ items: [], hasMore: false }), pull: async () => pull(),
      issueComments: async (_repository, _number, page = 1) => ({
        items: data.comments.slice((page - 1) * 30, page * 30).map(issueComment), hasMore: page * 30 < data.comments.length,
      }), issueReferences: async () => [],
      pullCommits: async () => [], pullContext: async () => pullContextFixture, runs: async () => ({ items: [], hasMore: false }),
      createIssueComment: (...args) => api.createIssueComment(...args),
      updateIssueState: async () => { closes++; remoteState = "closed"; return issue() },
      updatePullState: async () => { closes++; remoteState = "closed"; return pull() },
    }
    const restart = async () => {
      const session = createRepositorySession(loaders, drafts)
      await session.load(repository.nameWithOwner)
      if (parent === "issue") await session.loadIssue(42)
      else await session.loadPull(42)
      session.prepareIssueAction(42, kind, parent)
      return session
    }
    let session = await restart()
    session.updateIssueDraft(42, { body }, parent)
    expect(session.flushDrafts!()).toBe(true)
    data.failure = new Error("Request timed out")
    await expect(session.submitIssueAction(42, kind, parent)).rejects.toThrow("draft could not be settled")
    expect(session.issueAction(42, parent).body).toBe(body)
    expect(disk.load(draftKey)?.body).toBe(body)
    expect(await storage.load(input)).toBeDefined()
    expect(closes).toBe(0)
    expect(data.writes).toBe(1)

    const pending = await storage.load(input)
    const otherKind = kind === "comment" ? "close" : "comment"
    session.prepareIssueAction(42, otherKind, parent)
    session.updateIssueDraft(42, { body }, parent)
    expect(session.flushDrafts!()).toBe(true)
    await expect(session.submitIssueAction(42, otherKind, parent)).rejects.toThrow(/draft/)
    expect(await storage.load(input)).toEqual(pending)
    expect(disk.load(draftKey)?.body).toBe(body)
    expect(session.issueAction(42, parent).body).toBe(body)
    expect(closes).toBe(0)
    expect(data.writes).toBe(1)
    session.prepareIssueAction(42, kind, parent)

    failSettlement = false
    const resumedStorage = createIssueCommentStorage(directory)
    const remove = resumedStorage.remove
    const newerBody = restarting ? "" : "A newer draft from another session"
    let newerGeneration: string | undefined
    let acknowledgements = 0
    resumedStorage.remove = async attempt => {
      expect(disk.load(draftKey)?.body ?? "").toBe(newerBody)
      expect(disk.load(draftKey)?.retry).toBe(restarting && kind === "close" ? "close" : undefined)
      acknowledgements++
      await remove(attempt)
    }
    api = createGitHubClient(transport, resumedStorage)
    if (restarting) session = await restart()
    const before = parent === "issue" ? session.issueDetail() : session.pullDetail()
    expect(before?.resource.value?.commentCount).toBe(restarting ? 101 : 100)
    expect(before?.comments.value?.items).toHaveLength(30)
    expect(session.issueAction(42, parent).body).toBe(body)
    if (!restarting) data.afterCount = () => {
      data.afterCount = undefined
      const previous = disk.load(draftKey)!
      newerGeneration = randomUUID()
      disk.save(draftKey, { ...previous, generation: newerGeneration, body: newerBody, reason: "not_planned" }, previous.generation)
    }
    expect((await session.submitIssueAction(42, kind, parent)).comment?.id).toBe(10_001)
    expect(session.issueAction(42, parent).body).toBe(newerBody)
    if (newerGeneration) expect(disk.load(draftKey)?.generation).toBe(newerGeneration)
    const detail = parent === "issue" ? session.issueDetail() : session.pullDetail()
    expect(detail?.resource.value).toMatchObject({ state: kind === "close" ? "closed" : "open", commentCount: 101, updatedAt })
    expect(detail?.comments.value?.items.map(comment => comment.id)).toEqual([...Array.from({ length: 30 }, (_, index) => index + 1), 10_001])
    expect(closes).toBe(kind === "close" ? 1 : 0)
    expect(data.writes).toBe(1)
    expect(acknowledgements).toBe(1)
    expect(await storage.load(input)).toBeUndefined()
    expect(disk.load(`owner/repo@71#42${parent === "pull" ? ":pull" : ""}:${otherKind}`)?.body).toBe(body)
  }
})
