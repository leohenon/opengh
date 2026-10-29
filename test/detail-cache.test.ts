import { describe, expect, test } from "bun:test"
import { createCacheBudget, createDetailCache, estimateBytes } from "../src/detail-cache"
import type { RepositoryLoaders } from "../src/repository-session"
import { createRepositorySession } from "../src/repository-session"
import { commitDetailFixture, githubDataFixture, issueCommentsFixture, issueDetailFixture, pullContextFixture } from "./fixtures/github-data"

function loaders(overrides: Partial<RepositoryLoaders> = {}): RepositoryLoaders {
  return {
    metadata: async () => structuredClone(githubDataFixture.repo),
    workCounts: async () => ({ issues: 1, pulls: 1 }),
    commitCount: async () => 4,
    documents: async () => [], document: async () => "",
    branches: async () => ({ items: ["main"], hasMore: false }),
    commits: async () => ({ items: [], hasMore: false }),
    commit: async () => structuredClone(commitDetailFixture),
    issue: async (_repository, number) => ({ ...structuredClone(issueDetailFixture), number }),
    issueComments: async () => ({ items: structuredClone(issueCommentsFixture), hasMore: false }),
    issueReferences: async () => [],
    issues: async () => ({ items: [], hasMore: false }),
    pulls: async () => ({ items: [], hasMore: false }),
    pull: async (_repository, number) => ({ ...githubDataFixture.pulls.open.value!.items[0]!, number,
      url: `https://github.com/o/r/pull/${number}`, body: "PR body", updatedAt: "2026-01-01T00:00:00Z",
      baseBranch: "main", headBranch: "next", additions: 1, deletions: 0, changedFiles: 1, commitCount: 0, commentCount: 1,
      labels: [], assignees: [], reviewers: [], mergeable: true }),
    pullCommits: async () => [], pullContext: async () => structuredClone(pullContextFixture),
    runs: async () => ({ items: [], hasMore: false }),
    ...overrides,
  }
}

describe("detail cache", () => {
  test("bounded LRU evicts by count, estimated bytes and idle time while reporting freshness", () => {
    let time = 0
    const cache = createDetailCache<string>({ maxEntries: 2, maxBytes: 40, freshMs: 10, retainMs: 100, now: () => time })
    cache.set("a", "aaaa"); cache.set("b", "bbbb")
    expect(cache.get("a")?.stale).toBe(false)
    cache.set("c", "cccc")
    expect(cache.get("b")).toBeUndefined() // least recently used
    expect(cache.get("a")?.value).toBe("aaaa")
    cache.set("big", "x".repeat(30))
    expect(cache.get("big")).toBeUndefined() // oversized values are never retained
    expect(cache.get("a")?.value).toBe("aaaa")
    cache.set("medium", "x".repeat(14)) // 28 bytes forces the older small entry out of the byte budget
    expect(cache.get("c")).toBeUndefined()
    expect(cache.get("a")?.value).toBe("aaaa")
    time = 11
    expect(cache.get("a")?.stale).toBe(true)
    time = 200
    expect(cache.get("a")).toBeUndefined()
    expect(estimateBytes({ text: "ab", list: [1, 2] })).toBeGreaterThan(0)
  })

  test("reopening a recently closed issue reuses retained data, then revalidates only once stale", async () => {
    let time = 0
    let detailCalls = 0
    const session = createRepositorySession(loaders({
      issue: async (_repository, number) => { detailCalls++; return { ...structuredClone(issueDetailFixture), number, title: `Load ${detailCalls}` } },
    }), undefined, { freshMs: 30_000, now: () => time })
    await session.load("owner/repo")
    await session.loadIssue(1)
    expect(detailCalls).toBe(1)
    session.clearIssue()
    expect(session.issueDetail()).toBeUndefined()
    const reopen = session.loadIssue(1)
    expect(session.issueDetail()?.resource).toMatchObject({ status: "ready", value: { title: "Load 1" } })
    expect(session.issueDetail()?.comments.value?.items).toEqual(issueCommentsFixture)
    await reopen
    expect(detailCalls).toBe(1)
    session.clearIssue()
    time = 31_000
    const revalidate = session.loadIssue(1)
    expect(session.issueDetail()?.resource).toMatchObject({ status: "loading", value: { title: "Load 1" } })
    await revalidate
    expect(detailCalls).toBe(2)
    expect(session.issueDetail()?.resource).toMatchObject({ status: "ready", value: { title: "Load 2" } })
    session.clearIssue()
    await session.loadIssue(1, { force: true })
    expect(detailCalls).toBe(3)
    await session.load("owner/other")
    await session.loadIssue(1)
    expect(detailCalls).toBe(4)
  })

  test("pull requests reopen from cache and repository refresh marks retained details stale", async () => {
    let pullCalls = 0
    const session = createRepositorySession(loaders({
      pull: async (repository, number) => { pullCalls++; return (await loaders().pull!(repository, number)) },
    }), undefined, { freshMs: 60_000 })
    await session.load("owner/repo")
    await session.loadPull(7)
    session.clearPull()
    await session.loadPull(7)
    expect(pullCalls).toBe(1)
    expect(session.pullDetail()?.resource.status).toBe("ready")
    session.clearPull()
    await session.refresh()
    await session.loadPull(7)
    expect(pullCalls).toBe(2)
  })
})

describe("detail cache invalidation", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
  }

  test("a comment confirmed after closing makes the retained issue revalidate instead of hiding it", async () => {
    const pending = deferred<(typeof issueCommentsFixture)[number]>()
    const posted = { ...issueCommentsFixture[0]!, id: 9009, body: "Posted after closing" }
    let detailCalls = 0
    const session = createRepositorySession(loaders({
      issue: async (_repository, number) => { detailCalls++; return { ...structuredClone(issueDetailFixture), number, commentCount: 1 } },
      issueComments: async () => ({ items: [issueCommentsFixture[0]!], hasMore: false }),
      createIssueComment: async () => pending.promise,
    }), undefined, { freshMs: 60_000 })
    await session.load("owner/repo")
    await session.loadIssue(1)
    session.updateIssueDraft(1, { body: posted.body })
    const posting = session.submitIssueAction(1, "comment")
    session.clearIssue()
    pending.resolve(posted)
    await posting
    const reopen = session.loadIssue(1)
    expect(session.issueDetail()?.resource.status).toBe("loading")
    await reopen
    expect(detailCalls).toBe(2)
    expect(session.issueDetail()?.comments.value?.items.map((comment) => comment.id)).toContain(posted.id)
  })

  test("failed sections are retained as errors, never as fresh empty data", async () => {
    let failComments = true
    const session = createRepositorySession(loaders({
      issueComments: async () => { if (failComments) throw new Error("Comments offline"); return { items: issueCommentsFixture, hasMore: false } },
    }), undefined, { freshMs: 60_000 })
    await session.load("owner/repo")
    await session.loadIssue(1)
    expect(session.issueDetail()?.comments.status).toBe("error")
    session.clearIssue()
    const reopen = session.loadIssue(1)
    expect(session.issueDetail()?.comments).toMatchObject({ status: "loading" })
    failComments = false
    await reopen
    expect(session.issueDetail()?.comments).toMatchObject({ status: "ready", value: { items: issueCommentsFixture } })
  })

  test("a cache hit retires an in-flight load for another issue", async () => {
    const slow = deferred<typeof issueDetailFixture>()
    const session = createRepositorySession(loaders({
      issue: async (_repository, number) => number === 5 ? slow.promise : { ...structuredClone(issueDetailFixture), number },
    }), undefined, { freshMs: 60_000 })
    await session.load("owner/repo")
    await session.loadIssue(7)
    session.clearIssue()
    const stale = session.loadIssue(5)
    await session.loadIssue(7)
    expect(session.issueDetail()?.number).toBe(7)
    slow.resolve({ ...structuredClone(issueDetailFixture), number: 5 })
    await stale
    expect(session.issueDetail()?.number).toBe(7)
  })
})

test("caches sharing one budget evict across each other rather than each using the full limit", () => {
  const budget = createCacheBudget(40)
  const a = createDetailCache<string>({ budget })
  const b = createDetailCache<string>({ budget })
  a.set("a1", "x".repeat(10)) // 20 bytes
  b.set("b1", "x".repeat(10)) // 20 bytes
  b.set("b2", "x".repeat(10)) // forces the oldest entry out of whichever cache holds it
  expect(budget.used).toBeLessThanOrEqual(40)
  expect(a.get("a1")).toBeUndefined()
  expect(b.get("b1")?.value).toBe("x".repeat(10))
  expect(b.get("b2")?.value).toBe("x".repeat(10))
  b.clear()
  expect(budget.used).toBe(0)
})

describe("repository cache", () => {
  test("returning to a recent repository reuses its overview data and revalidates only when stale", async () => {
    let time = 0
    const calls: Record<string, number> = {}
    const count = (name: string) => { calls[name] = (calls[name] ?? 0) + 1 }
    const base = loaders()
    const session = createRepositorySession(loaders({
      metadata: async (repository) => { count("metadata"); return { ...structuredClone(githubDataFixture.repo), nameWithOwner: repository, url: `https://github.com/${repository}` } },
      issues: async (...args) => { count("issues"); return base.issues(...args) },
      pulls: async (...args) => { count("pulls"); return base.pulls(...args) },
      branches: async (...args) => { count("branches"); return base.branches(...args) },
      documents: async (...args) => { count("documents"); return base.documents(...args) },
      workCounts: async (...args) => { count("workCounts"); return base.workCounts(...args) },
    }), undefined, { freshMs: 30_000, now: () => time })
    await session.load("owner/first")
    await session.load("owner/second")
    const before = { ...calls }
    const back = session.load("owner/first")
    const state = session.state()
    expect(state.status).toBe("ready")
    if (state.status !== "ready") throw new Error("expected ready")
    expect(state.repository).toBe("owner/first")
    expect(state.data.branches.status).toBe("ready")
    await back
    expect(calls).toEqual(before)
    time = 31_000
    await session.load("owner/second")
    expect(calls.metadata).toBe(before.metadata! + 1)
    const revalidated = session.state()
    expect(revalidated.status === "ready" && revalidated.operations.refresh.status).toBe("idle")
    expect(revalidated.status === "ready" && revalidated.data.issues.open.status).toBe("ready")
    // A differently cased name still revalidates every section under the typed repository string.
    time = 62_000
    await session.load("Owner/First")
    const recased = session.state()
    expect(recased.status === "ready" && recased.repository).toBe("Owner/First")
    expect(recased.status === "ready" && recased.data.branches.status).toBe("ready")
    expect(recased.status === "ready" && recased.operations.refresh.status).toBe("idle")
    await session.load("owner/unknown")
    expect(session.state().status).toBe("ready")
  })
})

describe("diff, run and commit caches", () => {
  test("commit diffs reopen from cache while PR diffs require the loaded head to match", async () => {
    const headSha = "a".repeat(40), baseSha = "b".repeat(40)
    let diffCalls = 0
    let pullHead = headSha
    const session = createRepositorySession(loaders({
      diff: async (_repository, target) => { diffCalls++; return target.kind === "commit" ? { kind: "patch", patch: `commit ${diffCalls}` } : { kind: "patch", patch: `pr ${diffCalls}`, headSha: pullHead, baseSha } },
      pull: async (repository, number) => ({ ...(await loaders().pull!(repository, number)), headSha: pullHead }),
    }))
    await session.load("owner/repo")
    const sha = "c".repeat(40)
    await session.loadDiff!({ kind: "commit", sha })
    session.clearDiff!({ kind: "commit", sha })
    await session.loadDiff!({ kind: "commit", sha })
    expect(diffCalls).toBe(1)
    expect(session.diffs!().commit?.resource).toMatchObject({ status: "ready", value: { patch: "commit 1" } })
    await session.loadDiff!({ kind: "commit", sha }, false, { force: true })
    expect(diffCalls).toBe(2)
    await session.loadPull(7)
    await session.loadDiff!({ kind: "pull", number: 7 })
    session.clearDiff!({ kind: "pull", number: 7 })
    await session.loadDiff!({ kind: "pull", number: 7 })
    expect(diffCalls).toBe(3)
    pullHead = "d".repeat(40)
    await session.loadPull(7, { force: true })
    session.clearDiff!({ kind: "pull", number: 7 })
    await session.loadDiff!({ kind: "pull", number: 7 })
    expect(diffCalls).toBe(4)
    expect(session.diffs!().pull?.resource.value).toMatchObject({ headSha: pullHead })
  })

  test("oversized patches are never retained", async () => {
    let diffCalls = 0
    const session = createRepositorySession(loaders({
      diff: async () => { diffCalls++; return { kind: "patch", patch: "x".repeat(5 * 1024 * 1024) } },
    }))
    await session.load("owner/repo")
    const sha = "e".repeat(40)
    await session.loadDiff!({ kind: "commit", sha })
    session.clearDiff!({ kind: "commit", sha })
    await session.loadDiff!({ kind: "commit", sha })
    expect(diffCalls).toBe(2)
  })

  test("in-progress workflow runs always revalidate while completed runs and commits reopen instantly", async () => {
    const { workflowRunFixture, workflowJobFixture } = await import("./fixtures/workflow-run")
    let runCalls = 0, commitCalls = 0
    let status = "in_progress"
    const session = createRepositorySession(loaders({
      run: async () => { runCalls++; return { ...workflowRunFixture, status, conclusion: status === "completed" ? "success" : "" } },
      runJobs: async () => ({ items: [workflowJobFixture], hasMore: false }),
      commit: async () => { commitCalls++; return structuredClone(commitDetailFixture) },
    }), undefined, { freshMs: 60_000 })
    await session.load("owner/repo")
    await session.loadRun(workflowRunFixture.id)
    session.clearRun()
    const reopen = session.loadRun(workflowRunFixture.id)
    expect(session.runDetail()?.resource).toMatchObject({ status: "loading", value: { status: "in_progress" } })
    await reopen
    expect(runCalls).toBe(2)
    status = "completed"
    await session.loadRun(workflowRunFixture.id, { force: true })
    session.clearRun()
    await session.loadRun(workflowRunFixture.id)
    expect(runCalls).toBe(3)
    await session.loadCommit(commitDetailFixture.sha)
    session.clearCommit()
    await session.loadCommit(commitDetailFixture.sha)
    expect(commitCalls).toBe(1)
    expect(session.commitDetail()?.resource.status).toBe("ready")
  })
})

test("the shared budget evicts the globally least recently used entry and sweeps idle entries in every cache", () => {
  let time = 0
  const budget = createCacheBudget(60)
  const issues = createDetailCache<string>({ budget, retainMs: 100, now: () => time })
  const diffs = createDetailCache<string>({ budget, retainMs: 100, now: () => time })
  diffs.set("diff", "x".repeat(10)); time = 1
  issues.set("old", "x".repeat(10)); time = 2
  diffs.get("diff"); time = 3 // the diff is now more recent than the issue
  issues.set("new", "x".repeat(10)); time = 4
  issues.set("newest", "x".repeat(10))
  expect(issues.get("old")).toBeUndefined()
  expect(diffs.get("diff")?.value).toBe("x".repeat(10))
  time = 200
  issues.set("later", "y")
  expect(diffs.size).toBe(0) // idle diff swept although only the issue cache was written
  expect(budget.used).toBe(issues.bytes)
})
