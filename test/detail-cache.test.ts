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
      metadata: async (repository) => ({ ...structuredClone(githubDataFixture.repo),
        id: githubDataFixture.repo.id + (repository === "owner/other" ? 1 : 0), nodeId: `R_${repository}`,
        nameWithOwner: repository, url: `https://github.com/${repository}` }),
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
    // Details are repository-scoped and survive switching back.
    await session.load("owner/repo")
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

  test.each((["issue", "pull"] as const).flatMap(parent =>
    (["offscreen", "returned", "replaced", "read failure"] as const).map(scenario => [parent, scenario] as const),
  ))("a %s close confirmed %s revalidates only the origin overview", async (parent, scenario) => {
    const pending = deferred<void>()
    const started = deferred<void>()
    const oldReads = deferred<void>()
    const oldReadsStarted = deferred<void>()
    const freshReads = deferred<void>()
    let oldReadCount = 0
    let holdOldReads = false
    let now = 0
    let firstId = 1
    let closed = false
    const waitForRead = async (wasClosed: boolean) => {
      if (wasClosed && scenario !== "offscreen") {
        await freshReads.promise
        if (scenario === "read failure") throw new Error("Overview offline")
      } else if (holdOldReads) {
        if (++oldReadCount === 3) oldReadsStarted.resolve()
        await oldReads.promise
      }
    }
    const metadataCalls: Record<string, number> = {}
    const issue = { ...structuredClone(issueDetailFixture), number: 1, state: "open" as const }
    const pull = { ...await loaders().pull!({ ...githubDataFixture.repo, nameWithOwner: "owner/first" }, 1), state: "open" as const,
      merged: false, permissions: { comment: true, close: true, reopen: true, assignees: true } }
    const list: RepositoryLoaders["pulls"] = async (repository, state) => {
      const wasClosed = closed
      await waitForRead(wasClosed)
      return { items: repository.nameWithOwner === "owner/first" && state === (wasClosed ? "closed" : "open")
        ? [{ ...pull, state }] : [], hasMore: false }
    }
    const session = createRepositorySession(loaders({
      metadata: async (repository) => {
        metadataCalls[repository] = (metadataCalls[repository] ?? 0) + 1
        return { ...structuredClone(githubDataFixture.repo), nameWithOwner: repository,
          id: repository === "owner/first" ? firstId : 2, nodeId: `R_${repository}` }
      },
      issue: async () => ({ ...issue, state: closed ? "closed" : "open" }),
      pull: async () => ({ ...pull, state: closed ? "closed" : "open" }),
      ...(parent === "issue" ? { issues: list } : { pulls: list }),
      workCounts: async (repository) => {
        const wasClosed = closed
        await waitForRead(wasClosed)
        return { issues: parent === "issue" && repository.nameWithOwner === "owner/first" && !wasClosed ? 1 : 0,
          pulls: parent === "pull" && repository.nameWithOwner === "owner/first" && !wasClosed ? 1 : 0 }
      },
      updateIssueState: async () => { started.resolve(); await pending.promise; closed = true; return { ...issue, state: "closed" } },
      updatePullState: async () => { started.resolve(); await pending.promise; closed = true; return { ...pull, state: "closed" } },
    }), undefined, { freshMs: 60_000, now: () => now })
    const section = parent === "issue" ? "issues" : "pulls"
    await session.load("owner/first")
    const initial = session.state()
    if (initial.status !== "ready") throw new Error("expected ready")
    expect(initial.data[section].open.value?.items).toMatchObject([{ number: 1, state: "open" }])
    expect(initial.data[section].closed.value?.items).toEqual([])
    expect(initial.data.workCounts.value?.[section]).toBe(1)
    if (parent === "issue") await session.loadIssue(1)
    else await session.loadPull(1)
    const closing = session.submitIssueAction(1, "close", parent)
    await started.promise
    await session.load("owner/second")
    if (scenario === "replaced") { firstId = 3; now = 60_001 }
    if (scenario !== "offscreen") await session.load("owner/first")
    if (scenario === "replaced") {
      expect(session.state().status).toBe("error")
      await session.load("owner/first")
      const replacement = session.state()
      if (replacement.status !== "ready") throw new Error("expected replacement ready")
      expect(replacement.data.repo.id).toBe(3)
    }
    const before = session.state()
    let refreshing: Promise<void> | undefined
    if (scenario === "returned") {
      holdOldReads = true
      refreshing = session.refresh()
      await oldReadsStarted.promise
      holdOldReads = false
    }
    pending.resolve()
    await closing
    if (scenario === "offscreen" || scenario === "replaced") expect(session.state()).toBe(before)
    if (scenario === "replaced") return
    if (scenario === "offscreen") await session.load("owner/first")
    else {
      const revalidating = session.state()
      if (revalidating.status !== "ready") throw new Error("expected ready")
      expect(revalidating.data[section].open).toMatchObject({ status: "loading", value: { items: [{ number: 1, state: "open" }] } })
      expect(revalidating.data[section].closed.status).toBe("loading")
      expect(revalidating.data.workCounts).toMatchObject({ status: "loading", value: { [section]: 1 } })
      freshReads.resolve()
      // Let the background list/count reads settle, without starting another refresh.
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    if (scenario === "read failure") {
      const failed = session.state()
      if (failed.status !== "ready") throw new Error("expected ready")
      expect(failed.data[section].open).toMatchObject({ status: "error", message: "Overview offline" })
      expect(failed.data[section].closed.status).toBe("error")
      expect(failed.data.workCounts).toMatchObject({ status: "error", message: "Overview offline" })
      expect(session.issueAction(1, parent).operation.status).toBe("idle")
      return
    }
    const returned = session.state()
    expect(returned.status).toBe("ready")
    if (returned.status !== "ready") throw new Error("expected ready")
    expect(returned.data[section].open.value?.items).toEqual([])
    expect(returned.data[section].closed.value?.items).toMatchObject([{ number: 1, state: "closed" }])
    expect(returned.data.workCounts.value?.[section]).toBe(0)
    expect(metadataCalls["owner/first"]).toBe(2)
    if (refreshing) {
      oldReads.resolve()
      await refreshing
      const settled = session.state()
      if (settled.status !== "ready") throw new Error("expected ready")
      expect(settled.data[section]).toEqual(returned.data[section])
      expect(settled.data.workCounts).toEqual(returned.data.workCounts)
    }
    // The unrelated repository remains fresh, and the retained origin detail still revalidates.
    if (parent === "issue") await session.loadIssue(1)
    else await session.loadPull(1)
    expect((parent === "issue" ? session.issueDetail() : session.pullDetail())?.resource.value?.state).toBe("closed")
    await session.load("owner/second")
    expect(metadataCalls["owner/second"]).toBe(1)
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
  test("commit diffs reopen from cache while PR diffs require the PR's base and head commits to match", async () => {
    let diffCalls = 0
    let pullHead = "a".repeat(40), pullBase = "b".repeat(40)
    const session = createRepositorySession(loaders({
      diff: async (_repository, target) => { diffCalls++; return target.kind === "commit" ? { kind: "patch", patch: `commit ${diffCalls}` } : { kind: "patch", patch: `pr ${diffCalls}`, headSha: pullHead, baseSha: pullBase } },
      pull: async (repository, number) => ({ ...(await loaders().pull!(repository, number)), headSha: pullHead, baseSha: pullBase }),
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
    // From the list, a fresh retained PR vouches for its diff; a retargeted base does not match.
    session.clearPull()
    session.clearDiff!({ kind: "pull", number: 7 })
    await session.loadDiff!({ kind: "pull", number: 7 })
    expect(diffCalls).toBe(4)
    pullBase = "e".repeat(40)
    await session.loadPull(7, { force: true })
    session.clearDiff!({ kind: "pull", number: 7 })
    await session.loadDiff!({ kind: "pull", number: 7 })
    expect(diffCalls).toBe(5)
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

test("external PR changes invalidate a retained PR; reactions on an open page do not force a refetch", async () => {
  let pullCalls = 0
  const session = createRepositorySession(loaders({
    pull: async (repository, number) => { pullCalls++; return { ...(await loaders().pull!(repository, number)), canReact: true, nodeId: "PR_7" } },
    addReaction: async () => ({ reactions: { heart: 1 }, viewerReactions: ["heart"], canReact: true }),
  }), undefined, { freshMs: 60_000 })
  await session.load("owner/repo")
  await session.loadPull(7)
  await session.addReaction({ kind: "pull", number: 7 }, "heart")
  session.clearPull()
  await session.loadPull(7)
  expect(pullCalls).toBe(1)
  expect(session.pullDetail()?.resource.value?.reactions).toEqual({ heart: 1 })
  session.clearPull()
  // e.g. a review submitted after navigating away; the app names the repository as GitHub reports it,
  // which differs from the requested "owner/repo" here, as for a renamed repository.
  session.invalidatePull!(githubDataFixture.repo.nameWithOwner, 7)
  await session.loadPull(7)
  expect(pullCalls).toBe(2)
  // A reaction still pending when switching straight to another PR cannot reach the retained page.
  const pending = session.addReaction({ kind: "pull", number: 7 }, "heart").catch(() => undefined)
  await session.loadPull(8)
  await pending
  await session.loadPull(7)
  expect(pullCalls).toBe(4)
})

test("a completed repository refresh is retained as fresh", async () => {
  let metadataCalls = 0
  const session = createRepositorySession(loaders({
    metadata: async (repository) => { metadataCalls++; return { ...structuredClone(githubDataFixture.repo), nameWithOwner: repository } },
  }), undefined, { freshMs: 60_000 })
  await session.load("owner/first")
  await session.refresh()
  await session.load("owner/second")
  await session.load("owner/first")
  expect(metadataCalls).toBe(3) // first, refresh, second — returning to first reuses its refreshed data
})
