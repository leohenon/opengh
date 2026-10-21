import { workflowJobFixture, workflowRunFixture } from "./fixtures/workflow-run"

import { describe, expect, test } from "bun:test"
import type { DiffContent, CommitDetail, CommitSummary, IssueDetail, IssueComment, IssueTimeline, RepositoryDocument } from "../src/models"
import type { RepositoryLoaders } from "../src/repository-session"
import { createRepositorySession } from "../src/repository-session"
import { commitDetailFixture, githubDataFixture, issueDetailFixture, issueCommentsFixture, issuePullReferenceFixture, pullContextFixture } from "./fixtures/github-data"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function loaders(overrides: Partial<RepositoryLoaders> = {}): RepositoryLoaders {
  return {
    metadata: async () => structuredClone(githubDataFixture.repo),
    workCounts: async () => ({ issues: 61, pulls: 24 }),
    commitCount: async () => 4,
    documents: async (repo, branch) => githubDataFixture.documents.value!.map(({ resource, ...source }) => ({
      ...source, id: `${repo.nameWithOwner}:${source.path}`, repository: repo.nameWithOwner, ref: branch,
    })),
    document: async (source) => githubDataFixture.documents.value!.find((document) => document.path === source.path)!.resource.value!,
    branches: async () => ({ items: structuredClone(githubDataFixture.branches.value!.items), hasMore: false }),
    commits: async () => ({ items: structuredClone(githubDataFixture.commits.value!.items), hasMore: false }),
    commit: async () => structuredClone(commitDetailFixture),
    issue: async () => structuredClone(issueDetailFixture),
    issueComments: async () => ({ items: structuredClone(issueCommentsFixture), hasMore: false }),
    issueReferences: async () => [],
    issues: async (_repository, state) => ({ items: structuredClone(githubDataFixture.issues[state].value!.items), hasMore: false }),
    pulls: async (_repository, state) => ({ items: structuredClone(githubDataFixture.pulls[state].value!.items), hasMore: false }),
    pullCommits: async () => structuredClone(githubDataFixture.commits.value!.items),
    pullContext: async () => structuredClone(pullContextFixture),
    runs: async () => ({ items: structuredClone(githubDataFixture.runs.value!.items), hasMore: false }),
    ...overrides,
  }
}

function ready(session: ReturnType<typeof createRepositorySession>) {
  const state = session.state()
  if (state.status !== "ready") throw new Error(`Expected ready state, got ${state.status}`)
  return state
}

describe("repository session", () => {
  test("replacing a diff aborts only its same-kind request and rejects late results", async () => {
    const first = deferred<DiffContent>()
    const signals: AbortSignal[] = []
    const session = createRepositorySession(loaders({
      diff: async (_repository, target, signal) => {
        signals.push(signal)
        return target.kind === "commit" && target.sha === "abc" ? first.promise : { kind: "patch", patch: "New diff" }
      },
    }))
    await session.load("owner/repo")
    await session.loadDiff!({ kind: "pull", number: 42 })
    const pending = session.loadDiff!({ kind: "commit", sha: "abc" })
    await session.loadDiff!({ kind: "commit", sha: "def" })
    expect(signals[0]?.aborted).toBe(false)
    expect(signals[1]?.aborted).toBe(true)
    first.resolve({ kind: "patch", patch: "Old diff" })
    await pending
    expect(session.diffs!().commit?.target).toEqual({ kind: "commit", sha: "def" })
    expect(session.diffs!().commit?.resource.value).toEqual({ kind: "patch", patch: "New diff" })
    expect(session.diffs!().pull?.target).toEqual({ kind: "pull", number: 42 })
  })

  test("commit and pull diffs coexist and clearing one leaves the other intact", async () => {
    const commit = deferred<DiffContent>()
    const pull = deferred<DiffContent>()
    const signals: AbortSignal[] = []
    const session = createRepositorySession(loaders({
      diff: async (_repository, target, signal) => {
        signals.push(signal)
        return target.kind === "commit" ? commit.promise : pull.promise
      },
    }))
    await session.load("owner/repo")
    const pendingCommit = session.loadDiff!({ kind: "commit", sha: "abc" })
    const pendingPull = session.loadDiff!({ kind: "pull", number: 42 })
    expect(signals.every((signal) => !signal.aborted)).toBe(true)
    expect(session.diffs!().commit?.resource.status).toBe("loading")
    expect(session.diffs!().pull?.resource.status).toBe("loading")
    commit.resolve({ kind: "patch", patch: "Commit diff" })
    await pendingCommit
    session.clearDiff!({ kind: "pull", number: 42 })
    expect(signals[0]?.aborted).toBe(false)
    expect(signals[1]?.aborted).toBe(true)
    pull.resolve({ kind: "patch", patch: "Old PR diff" })
    await pendingPull
    expect(session.diffs!().pull).toBeUndefined()
    expect(session.diffs!().commit?.resource.value).toEqual({ kind: "patch", patch: "Commit diff" })
    await session.loadDiff!({ kind: "pull", number: 43 })
    expect(session.diffs!().pull?.resource.status).toBe("ready")
    session.clearDiff!({ kind: "commit", sha: "abc" })
    expect(session.diffs!().commit).toBeUndefined()
    expect(session.diffs!().pull?.target).toEqual({ kind: "pull", number: 43 })
  })

  test("clearing all diffs or replacing the repository aborts both slots and rejects late results", async () => {
    for (const replaceRepository of [false, true]) {
      const commit = deferred<DiffContent>()
      const pull = deferred<DiffContent>()
      const signals: AbortSignal[] = []
      const session = createRepositorySession(loaders({
        diff: async (_repository, target, signal) => {
          signals.push(signal)
          return target.kind === "commit" ? commit.promise : pull.promise
        },
      }))
      await session.load("owner/repo")
      const pendingCommit = session.loadDiff!({ kind: "commit", sha: "abc" })
      const pendingPull = session.loadDiff!({ kind: "pull", number: 42 })
      if (replaceRepository) await session.load("owner/other")
      else session.clearDiff!()
      expect(signals.every((signal) => signal.aborted)).toBe(true)
      expect(session.diffs!()).toEqual({})
      commit.resolve({ kind: "patch", patch: "Old commit diff" })
      pull.reject(new Error("Old PR diff failed"))
      await Promise.all([pendingCommit, pendingPull])
      expect(session.diffs!()).toEqual({})
    }
  })
  test("loads branch commit totals independently, preserves them during pagination, and refreshes them", async () => {
    const pending = deferred<number>()
    const calls: string[] = []
    let fail = false
    let total = 1284
    const session = createRepositorySession(loaders({
      commitCount: async (_repository, branch) => {
        calls.push(branch)
        if (fail) throw new Error("Count offline")
        return calls.length === 1 ? pending.promise : total
      },
      commits: async (_repository, _branch, page = 1) => ({
        items: [{ ...commitDetailFixture, sha: `sha-${page}` }], hasMore: page === 1,
      }),
    }))
    const load = session.load("owner/repo")
    await Bun.sleep(0)
    expect(ready(session).data.commits.status).toBe("ready")
    expect(ready(session).data.commitCount).toEqual({ status: "loading", phase: "load" })
    pending.resolve(1284)
    await load
    expect(ready(session).data.commitCount.value).toBe(1284)
    await session.loadMoreCommits()
    expect(ready(session).data.commits.value?.items).toHaveLength(2)
    expect(ready(session).data.commitCount.value).toBe(1284)
    expect(calls).toEqual(["main"])
    fail = true
    await session.refresh()
    expect(ready(session).data.commitCount).toEqual({
      status: "error", phase: "load", message: "Count offline", value: 1284,
    })
    fail = false
    total = 1285
    await session.refresh()
    expect(ready(session).data.commitCount).toEqual({ status: "ready", value: 1285 })
  })

  test("clears the previous branch commit total and ignores late branch and repository counts", async () => {
    const next = deferred<number>()
    const other = deferred<number>()
    const session = createRepositorySession(loaders({
      metadata: async (repository) => ({ ...githubDataFixture.repo, nameWithOwner: repository }),
      commitCount: async (repository, branch) => {
        if (repository === "owner/other") return other.promise
        return branch === "feature/next" ? next.promise : 1284
      },
    }))
    await session.load("owner/repo")
    const switching = session.switchBranch("feature/next")
    await Bun.sleep(0)
    expect(ready(session).data.currentBranch).toBe("feature/next")
    expect(ready(session).data.commitCount).toEqual({ status: "loading", phase: "load" })
    await session.switchBranch("main")
    next.resolve(12)
    await switching
    expect(ready(session).data.commitCount.value).toBe(1284)
    const loading = session.load("owner/other")
    await Bun.sleep(0)
    await session.load("owner/new")
    other.resolve(99)
    await loading
    expect(ready(session).repository).toBe("owner/new")
    expect(ready(session).data.commitCount.value).toBe(1284)
  })

  test("a failed commit total does not fail the list or branch switch", async () => {
    const session = createRepositorySession(loaders({
      commitCount: async () => { throw new Error("Count unavailable") },
    }))
    await session.load("owner/repo")
    expect(ready(session).data.commits.status).toBe("ready")
    expect(ready(session).data.commitCount).toEqual({ status: "error", phase: "load", message: "Count unavailable" })
    await session.switchBranch("next")
    expect(ready(session).data.currentBranch).toBe("next")
    expect(ready(session).operations.branch.status).toBe("idle")
    expect(ready(session).data.commits.status).toBe("ready")
    expect(ready(session).data.commitCount.status).toBe("error")
  })

  test("loads true open totals independently and retains them across refresh failures", async () => {
    const pending = deferred<{ issues: number; pulls: number }>()
    let fail = false
    let calls = 0
    const session = createRepositorySession(loaders({
      workCounts: async () => {
        calls++
        if (fail) throw new Error("Counts offline")
        return calls === 1 ? pending.promise : { issues: 0, pulls: 1200 }
      },
    }))
    const loading = session.load("owner/repo")
    await Bun.sleep(0)
    expect(ready(session).data.workCounts).toEqual({ status: "loading", phase: "load" })
    expect(ready(session).data.issues.open.status).toBe("ready")
    pending.resolve({ issues: 2450, pulls: 1200 })
    await loading
    expect(ready(session).data.workCounts.value).toEqual({ issues: 2450, pulls: 1200 })
    await session.loadMoreIssues("open")
    expect(calls).toBe(1)
    fail = true
    await session.refresh()
    expect(ready(session).data.workCounts).toEqual({
      status: "error", phase: "load", message: "Counts offline", value: { issues: 2450, pulls: 1200 },
    })
    fail = false
    await session.refresh()
    expect(ready(session).data.workCounts).toEqual({ status: "ready", value: { issues: 0, pulls: 1200 } })
  })

  test("does not leak late count responses into another repository", async () => {
    const pending = deferred<{ issues: number; pulls: number }>()
    const session = createRepositorySession(loaders({
      metadata: async (repository) => ({ ...githubDataFixture.repo, nameWithOwner: repository }),
      workCounts: async (repository) => repository === "owner/old" ? pending.promise : { issues: 0, pulls: 0 },
    }))
    const old = session.load("owner/old")
    await Bun.sleep(0)
    await session.load("owner/new")
    pending.resolve({ issues: 999, pulls: 999 })
    await old
    expect(ready(session).repository).toBe("owner/new")
    expect(ready(session).data.workCounts.value).toEqual({ issues: 0, pulls: 0 })
  })

  test("refreshes totals after a confirmed issue state change", async () => {
    let open = 61
    const session = createRepositorySession(loaders({
      workCounts: async () => ({ issues: open, pulls: 24 }),
      updateIssueState: async (_repository, _number, state) => {
        open = state === "closed" ? 60 : 61
        return { ...issueDetailFixture, state }
      },
    }))
    await session.load("owner/repo")
    await session.loadIssue(issueDetailFixture.number)
    await session.submitIssueAction(issueDetailFixture.number, "close")
    await Bun.sleep(0)
    expect(ready(session).data.workCounts.value).toEqual({ issues: 60, pulls: 24 })
  })

  test("confirms empty PR-only issue pages without scanning every PR page", async () => {
    const checked: string[] = []
    const session = createRepositorySession(loaders({
      issues: async (_repository, state) => ({ items: [], hasMore: state === "open" }),
      hasIssues: async (_repository, state) => { checked.push(state); return false },
    }))
    await session.load("owner/repo")
    expect(checked).toEqual(["open"])
    expect(ready(session).data.issues.open).toMatchObject({ status: "ready", value: { items: [], hasMore: false, page: 1 } })
  })

  test("issue actions refresh the shared timeline without letting an older read overwrite closure events", async () => {
    const pending = deferred<IssueTimeline>()
    const closedAt = "2026-10-19T12:00:00Z"
    let issue: IssueDetail = { ...issueDetailFixture, commentCount: 0 }
    let timelineCalls = 0
    const closed: IssueTimeline = { references: [], events: [
      { kind: "state", event: "closed", id: "state:closed", actor: "maintainer", createdAt: closedAt },
    ] }
    const session = createRepositorySession(loaders({
      issue: async () => issue,
      issueTimeline: async () => ++timelineCalls === 1 ? pending.promise : closed,
      issues: async (_repository, state) => ({ items: issue.state === state ? [issue] : [], hasMore: false }),
      updateIssueState: async (_repository, _number, state) => {
        issue = { ...issue, state, stateReason: "completed", closedAt }
        return issue
      },
    }))
    await session.load("anomalyco/opentui")
    const loadingIssue = session.loadIssue(issue.number)
    await Promise.resolve()
    expect(session.issueDetail()?.resource.status).toBe("ready")
    await session.submitIssueAction(issue.number, "close")
    await Promise.resolve()
    expect(timelineCalls).toBe(2)
    expect(session.issueDetail()?.events).toEqual(closed.events)
    pending.resolve({ references: [], events: [
      { kind: "state", event: "reopened", id: "state:old", actor: "earlier-reader", createdAt: "2026-10-18T12:00:00Z" },
    ] })
    await loadingIssue
    expect(session.issueDetail()?.resource.value?.state).toBe("closed")
    expect(session.issueDetail()?.events).toEqual(closed.events)
  })

  test("pull discussion retries independently, retains loaded pages, and rejects cleared results", async () => {
    const summary = githubDataFixture.pulls.open.value!.items[0]!
    const pages: number[] = []
    const held = deferred<{ items: IssueComment[]; hasMore: boolean }>()
    let holdComments = false
    let failPagination = true
    let failReferences = true
    let failCommits = true
    let failContext = true
    let detailCalls = 0
    const session = createRepositorySession(loaders({
      pull: async (_repository, number) => {
        detailCalls++
        return { ...summary, number, url: `https://github.com/anomalyco/opentui/pull/${number}`,
          body: "Keep focus during layout changes.", updatedAt: summary.createdAt,
          baseBranch: "main", headBranch: "fix/focus", additions: 18, deletions: 7,
          changedFiles: 2, commitCount: 3, commentCount: 2,
          labels: [], assignees: [], reviewers: [], mergeable: null }
      },
      pullCommits: async () => {
        if (failCommits) throw new Error("Commits offline")
        return githubDataFixture.commits.value!.items.slice(0, 3)
      },
      pullContext: async () => {
        if (failContext) throw new Error("PR context offline")
        return pullContextFixture
      },
      issueComments: async (_repository, _number, page = 1) => {
        pages.push(page)
        if (holdComments) return held.promise
        if (page === 2 && failPagination) throw new Error("Comments offline")
        return { items: [issueCommentsFixture[page - 1]!], hasMore: page === 1 }
      },
      issueReferences: async () => {
        if (failReferences) throw new Error("References offline")
        return [issuePullReferenceFixture]
      },
    }))
    await session.load("anomalyco/opentui")
    await session.loadPull(summary.number)
    expect(session.pullDetail()?.resource.status).toBe("ready")
    expect(session.pullDetail()?.commits.status).toBe("error")
    expect(session.pullDetail()?.context.status).toBe("error")
    failContext = false
    await session.retryPullContext()
    expect(session.pullDetail()?.context).toEqual({ status: "ready", value: pullContextFixture })
    failCommits = false
    await session.retryPullCommits()
    expect(session.pullDetail()?.commits.value).toEqual(githubDataFixture.commits.value!.items.slice(0, 3))
    expect(session.pullDetail()?.comments).toMatchObject({ status: "ready", value: { page: 1, hasMore: true } })
    expect(session.pullDetail()?.references.status).toBe("error")
    failReferences = false
    await session.retryPullReferences()
    expect(session.pullDetail()?.references).toEqual({ status: "ready", value: [issuePullReferenceFixture] })
    expect(detailCalls).toBe(1)
    await session.loadMorePullComments()
    expect(session.pullDetail()?.comments).toMatchObject({ status: "error", phase: "pagination", value: { page: 1 } })
    failPagination = false
    await session.loadMorePullComments()
    expect(session.pullDetail()?.comments.value?.items).toEqual(issueCommentsFixture)
    await session.loadPull(summary.number)
    expect(session.pullDetail()?.comments.value?.page).toBe(2)
    expect(session.pullDetail()?.comments.value?.items).toEqual(issueCommentsFixture)
    expect(pages).toEqual([1, 2, 2, 1, 2])
    holdComments = true
    const pending = session.loadPull(summary.number)
    await Promise.resolve()
    session.clearPull()
    held.resolve({ items: issueCommentsFixture, hasMore: false })
    await pending
    expect(session.pullDetail()).toBeUndefined()
  })

  test("issue details load on demand and reject results after back or repository replacement", async () => {
    const pending = new Map<number, ReturnType<typeof deferred<IssueDetail>>>()
    let commentCalls = 0
    let referenceCalls = 0
    const session = createRepositorySession(loaders({
      issue: async (_repository, number) => {
        const request = deferred<IssueDetail>()
        pending.set(number, request)
        return request.promise
      },
      issueComments: async () => { commentCalls++; return { items: [], hasMore: false } },
      issueReferences: async () => { referenceCalls++; return [issuePullReferenceFixture] },
    }))
    await session.load("anomalyco/opentui")
    expect(pending.size).toBe(0)
    const first = session.loadIssue(1)
    const second = session.loadIssue(2)
    pending.get(2)!.resolve({ ...issueDetailFixture, number: 2, commentCount: 0 })
    await second
    pending.get(1)!.reject(new Error("Old issue unavailable"))
    await first
    expect(session.issueDetail()?.resource.value?.number).toBe(2)
    expect(session.issueDetail()?.comments.value?.items).toEqual([])
    expect(commentCalls).toBe(0)
    expect(referenceCalls).toBe(1)
    expect(session.issueDetail()?.references.value).toEqual([issuePullReferenceFixture])
    const closed = session.loadIssue(3)
    session.clearIssue()
    pending.get(3)!.resolve({ ...issueDetailFixture, number: 3 })
    await closed
    expect(session.issueDetail()).toBeUndefined()
    const replaced = session.loadIssue(4)
    await session.load("owner/another-repository")
    pending.get(4)!.resolve({ ...issueDetailFixture, number: 4 })
    await replaced
    expect(session.issueDetail()).toBeUndefined()
    expect(commentCalls).toBe(0)
  })

  test("issue comments fail independently, retry with deduplication, and preserve loaded pages", async () => {
    const initial = deferred<{ items: IssueComment[]; hasMore: boolean }>()
    const pages: number[] = []
    let metadataCalls = 0
    let failPage = true
    let failReferences = true
    let holdComments = false
    const lateComments = deferred<{ items: IssueComment[]; hasMore: boolean }>()
    const session = createRepositorySession(loaders({
      issue: async () => { metadataCalls++; return issueDetailFixture },
      issueReferences: async () => {
        if (failReferences) throw new Error("References unavailable")
        return [issuePullReferenceFixture]
      },
      issueComments: async (_repository, _number, page = 1) => {
        pages.push(page)
        if (holdComments) return lateComments.promise
        if (pages.length === 1) return initial.promise
        if (page === 2 && failPage) throw new Error("Next comments unavailable")
        return { items: page === 1 ? [issueCommentsFixture[0]!] : issueCommentsFixture, hasMore: page === 1 }
      },
    }))
    await session.load("anomalyco/opentui")
    const loading = session.loadIssue(issueDetailFixture.number)
    await Promise.resolve()
    expect(session.issueDetail()?.resource.status).toBe("ready")
    expect(session.issueDetail()?.comments.status).toBe("loading")
    await session.loadMoreIssueComments()
    expect(pages).toEqual([1])
    initial.reject(new Error("Comments unavailable"))
    await loading
    expect(session.issueDetail()?.resource.value).toBe(issueDetailFixture)
    expect(session.issueDetail()?.comments).toMatchObject({ status: "error", phase: "load" })
    expect(session.issueDetail()?.references).toMatchObject({ status: "error", message: "References unavailable" })
    await session.loadMoreIssueComments()
    expect(metadataCalls).toBe(1)
    await session.loadMoreIssueComments()
    expect(session.issueDetail()?.comments).toMatchObject({ status: "error", phase: "pagination" })
    expect(session.issueDetail()?.comments.value?.items).toEqual([issueCommentsFixture[0]!])
    failPage = false
    await session.loadMoreIssueComments()
    expect(pages).toEqual([1, 1, 2, 2])
    expect(session.issueDetail()?.comments.value?.items).toEqual(issueCommentsFixture)
    failReferences = false
    await session.retryIssueReferences()
    expect(session.issueDetail()?.references.value).toEqual([issuePullReferenceFixture])
    expect(metadataCalls).toBe(1)
    await session.loadIssue(issueDetailFixture.number)
    expect(pages).toEqual([1, 1, 2, 2, 1, 2])
    expect(session.issueDetail()?.comments.value?.items).toEqual(issueCommentsFixture)
    expect(metadataCalls).toBe(2)
    holdComments = true
    const obsolete = session.loadIssue(issueDetailFixture.number)
    await Promise.resolve()
    session.clearIssue()
    lateComments.resolve({ items: issueCommentsFixture, hasMore: false })
    await obsolete
    expect(session.issueDetail()).toBeUndefined()
  })

  test("confirmed comments survive in-flight pagination and refreshes without duplicates", async () => {
    const first = issueCommentsFixture[0]!
    const posted = { ...first, id: 9000, body: "A new comment", createdAt: "2026-07-01T00:00:00Z" }
    const next = deferred<{ items: IssueComment[]; hasMore: boolean }>()
    let paginationPending = true
    const session = createRepositorySession(loaders({
      issueComments: async (_repository, _number, page = 1) => page === 2 && paginationPending ? next.promise
        : { items: page === 3 ? [posted] : [first], hasMore: page < 3 },
      createIssueComment: async () => posted,
    }))
    await session.load("anomalyco/opentui")
    await session.loadIssue(issueDetailFixture.number)
    const pagination = session.loadMoreIssueComments()
    session.updateIssueDraft(issueDetailFixture.number, { body: posted.body })
    await session.submitIssueAction(issueDetailFixture.number, "comment")
    expect(session.issueDetail()?.resource.value?.commentCount).toBe(issueDetailFixture.commentCount + 1)
    expect(session.issueDetail()?.comments.value?.items).toContainEqual(posted)
    expect(session.issueAction(issueDetailFixture.number).body).toBe("")
    paginationPending = false
    next.resolve({ items: [first], hasMore: true })
    await pagination
    await session.loadIssue(issueDetailFixture.number)
    expect(session.issueDetail()?.comments.value?.page).toBe(2)
    expect(session.issueDetail()?.comments.value?.items).toContainEqual(posted)
    await session.loadMoreIssueComments()
    expect(session.issueDetail()?.comments.value?.items.filter((comment) => comment.id === posted.id)).toHaveLength(1)
    expect(session.issueDetail()?.comments.value?.hasMore).toBe(false)
  })

  test("a failed issue reload cannot reuse previously loaded write permissions", async () => {
    let failReload = false
    let writes = 0
    const session = createRepositorySession(loaders({
      issue: async () => {
        if (failReload) throw new Error("Access revoked")
        return structuredClone(issueDetailFixture)
      },
      createIssueComment: async () => { writes++; return issueCommentsFixture[0]! },
    }))
    await session.load("owner/repo")
    await session.loadIssue(issueDetailFixture.number)
    session.updateIssueDraft(issueDetailFixture.number, { body: "Preserved draft" })
    failReload = true
    await session.loadIssue(issueDetailFixture.number)
    expect(session.issueDetail()?.resource.status).toBe("error")
    await expect(session.submitIssueAction(issueDetailFixture.number, "comment")).rejects.toThrow("Reload the issue successfully")
    expect(writes).toBe(0)
    expect(session.issueAction(issueDetailFixture.number).body).toBe("Preserved draft")
  })

  test("comment-and-close preserves failures and retries only the unconfirmed state change", async () => {
    const number = issueDetailFixture.number
    const posted = { ...issueCommentsFixture[0]!, id: 9001, body: "Resolved", createdAt: "2026-07-01T00:00:00Z" }
    let remote = { ...issueDetailFixture }
    let commentCalls = 0
    let stateCalls = 0
    const reasons: unknown[] = []
    const session = createRepositorySession(loaders({
      issue: async () => remote,
      issues: async (_repository, state) => ({ items: remote.state === state ? [remote] : [], hasMore: false }),
      createIssueComment: async () => {
        if (++commentCalls === 1) throw new Error("Comment denied")
        return posted
      },
      updateIssueState: async (_repository, _number, state, reason) => {
        stateCalls++
        reasons.push(reason)
        if (stateCalls === 1) throw new Error("Closing denied")
        remote = { ...remote, state, stateReason: reason, commentCount: remote.commentCount + 1 }
        return remote
      },
    }))
    await session.load("anomalyco/opentui")
    await session.loadIssue(number)
    session.updateIssueDraft(number, { body: posted.body, reason: "not_planned" })
    await expect(session.submitIssueAction(number, "close")).rejects.toThrow("Comment denied")
    expect(stateCalls).toBe(0)
    expect(session.issueAction(number).body).toBe(posted.body)
    await expect(session.submitIssueAction(number, "close")).rejects.toThrow("Comment posted, but closing failed")
    expect(session.issueAction(number)).toMatchObject({ body: "", retry: "close", operation: { status: "error" } })
    expect(session.issueDetail()?.resource.value?.state).toBe("open")
    expect(session.issueDetail()?.comments.value?.items).toContainEqual(posted)
    session.clearIssue()
    await session.loadIssue(number)
    expect(session.issueAction(number).retry).toBe("close")
    session.updateIssueDraft(number, { body: "Do not repost", reason: "completed" })
    expect(session.issueAction(number).body).toBe("")
    session.prepareIssueAction(number, "close")
    expect(session.issueAction(number).retry).toBe("close")
    session.prepareIssueAction(number, "reopen")
    expect(session.issueAction(number).retry).toBeUndefined()
    expect(session.issueAction(number)).toMatchObject({ body: "", reason: "not_planned", operation: { status: "idle" } })
    session.prepareIssueAction(number, "close")
    await session.submitIssueAction(number, "close")
    expect(commentCalls).toBe(2)
    expect(stateCalls).toBe(2)
    expect(reasons).toEqual(["not_planned", "not_planned"])
    expect(session.issueDetail()?.resource.value?.state).toBe("closed")
    expect(session.issueAction(number)).toMatchObject({ body: "", operation: { status: "idle" } })
    expect(session.issueAction(number).retry).toBeUndefined()
    expect(ready(session).data.issues.open.value?.items).toEqual([])
    expect(ready(session).data.issues.closed.value?.items.map((issue) => issue.number)).toEqual([number])
  })

  test("issue actions prevent duplicate writes and stay scoped to their original repository", async () => {
    const number = issueDetailFixture.number
    const pending = deferred<IssueComment>()
    const posted = { ...issueCommentsFixture[0]!, id: 9002, body: "Original repository draft" }
    const calls: string[] = []
    const session = createRepositorySession(loaders({
      createIssueComment: async (repository) => { calls.push(repository); return pending.promise },
    }))
    await session.load("owner/original")
    await session.loadIssue(number)
    session.updateIssueDraft(number, { body: posted.body })
    session.clearIssue()
    await session.loadIssue(number)
    expect(session.issueAction(number).body).toBe(posted.body)
    const submission = session.submitIssueAction(number, "comment")
    await expect(session.submitIssueAction(number, "comment")).rejects.toThrow("already in progress")
    await session.load("owner/other")
    await session.loadIssue(number)
    session.updateIssueDraft(number, { body: "Other repository draft" })
    pending.resolve(posted)
    await submission
    expect(calls).toEqual(["owner/original"])
    expect(session.issueAction(number).body).toBe("Other repository draft")
    expect(session.issueDetail()?.comments.value?.items.some((comment) => comment.id === posted.id)).toBe(false)
    expect(session.issueDetail()?.resource.value?.commentCount).toBe(issueDetailFixture.commentCount)
  })

  test("duplicate marking preserves comment drafts, confirms state, and supports reopening", async () => {
    const number = issueDetailFixture.number
    let remote = { ...issueDetailFixture }
    const pending = deferred<IssueDetail>()
    const targets: number[] = []
    let commentCalls = 0
    const session = createRepositorySession(loaders({
      issue: async () => remote,
      issues: async (_repository, state) => ({ items: remote.state === state ? [remote] : [], hasMore: false }),
      createIssueComment: async () => { commentCalls++; return issueCommentsFixture[0]! },
      markIssueDuplicate: async (_repository, _number, target) => {
        targets.push(target)
        if (targets.length === 1) throw new Error("Duplicate marking denied")
        return pending.promise
      },
      updateIssueState: async (_repository, _number, state) => {
        remote = { ...remote, state, stateReason: "reopened" }
        return remote
      },
    }))
    await session.load("anomalyco/opentui")
    await session.loadIssue(number)
    session.updateIssueDraft(number, { body: "An unrelated comment draft", duplicateTarget: `#${number}` })
    await expect(session.submitIssueAction(number, "duplicate")).rejects.toThrow("duplicate of itself")
    expect(targets).toEqual([])
    session.updateIssueDraft(number, { duplicateTarget: "#123" })
    await expect(session.submitIssueAction(number, "duplicate")).rejects.toThrow("Duplicate marking denied")
    expect(session.issueDetail()?.resource.value?.state).toBe("open")
    expect(session.issueAction(number)).toMatchObject({ body: "An unrelated comment draft", duplicateTarget: "#123" })
    const marking = session.submitIssueAction(number, "duplicate")
    await expect(session.submitIssueAction(number, "duplicate")).rejects.toThrow("already in progress")
    remote = { ...remote, state: "closed", stateReason: "duplicate" }
    pending.resolve(remote)
    expect(await marking).toMatchObject({ duplicateOf: 123, issue: { state: "closed", stateReason: "duplicate" } })
    expect(targets).toEqual([123, 123])
    expect(commentCalls).toBe(0)
    expect(session.issueAction(number)).toMatchObject({ body: "An unrelated comment draft", duplicateTarget: "", operation: { status: "idle" } })
    expect(ready(session).data.issues.open.value?.items).toEqual([])
    expect(ready(session).data.issues.closed.value?.items.map((issue) => issue.number)).toEqual([number])
    // The user clears the optional comment before confirming reopening.
    session.updateIssueDraft(number, { body: "" })
    await session.submitIssueAction(number, "reopen")
    expect(session.issueDetail()?.resource.value?.state).toBe("open")
    expect(ready(session).data.issues.open.value?.items.map((issue) => issue.number)).toEqual([number])
    expect(ready(session).data.issues.closed.value?.items).toEqual([])
    expect(commentCalls).toBe(0)
  })

  test("assignment preserves comment drafts, guards writes and reconciles without stale reads", async () => {
    const number = issueDetailFixture.number
    let remote: IssueDetail = { ...issueDetailFixture, state: "closed", permissions: { ...issueDetailFixture.permissions!, comment: false } }
    const pending = deferred<IssueDetail>()
    const stale = deferred<IssueDetail>()
    let staleRead = false
    let fail = true
    let commentCalls = 0
    const updates: string[][] = []
    const candidates = Array.from({ length: 11 }, (_, index) => `user${index}`)
    const session = createRepositorySession(loaders({
      issue: async () => staleRead ? stale.promise : remote,
      issues: async (_repository, state) => ({ items: remote.state === state ? [remote] : [], hasMore: false }),
      assignableUsers: async () => ({ items: ["octocat", ...candidates], hasMore: false }),
      createIssueComment: async () => { commentCalls++; return issueCommentsFixture[0]! },
      setIssueAssignees: async (_repository, _number, selected) => {
        updates.push(selected)
        if (fail) throw new Error("Assignment denied")
        if (!selected.length) return pending.promise
        remote = { ...remote, assignees: selected }
        return remote
      },
    }))
    await session.load("owner/repo")
    await session.loadIssue(number)
    session.updateIssueDraft(number, { body: "Unrelated comment draft" })
    session.prepareIssueAction(number, "assignees")
    expect(session.issueAction(number).selectedAssignees).toEqual(remote.assignees)
    session.updateIssueDraft(number, { selectedAssignees: ["invented"] })
    await expect(session.submitIssueAction(number, "assignees")).rejects.toThrow("suggested")
    await session.loadAssignableUsers!()
    session.updateIssueDraft(number, { selectedAssignees: candidates })
    await expect(session.submitIssueAction(number, "assignees")).rejects.toThrow("at most 10")
    expect(updates).toHaveLength(0)
    session.updateIssueDraft(number, { selectedAssignees: [] })
    await expect(session.submitIssueAction(number, "assignees")).rejects.toThrow("Assignment denied")
    expect(session.issueAction(number).selectedAssignees).toEqual([])
    fail = false
    const saving = session.submitIssueAction(number, "assignees")
    await expect(session.submitIssueAction(number, "assignees")).rejects.toThrow("already in progress")
    session.updateIssueDraft(number, { selectedAssignees: ["octocat"] })
    expect(session.issueAction(number).selectedAssignees).toEqual([])
    staleRead = true
    const reading = session.loadIssue(number)
    const old = remote
    remote = { ...remote, assignees: [] }
    pending.resolve(remote)
    await saving
    stale.resolve(old)
    await reading
    expect(session.issueDetail()?.resource.value).toMatchObject({ assignees: [], title: old.title, body: old.body, labels: old.labels })
    expect(ready(session).data.issues.closed.value?.items.some((item) => item.number === number)).toBe(true)
    expect(updates).toEqual([[], []])
    session.prepareIssueAction(number, "assignees")
    session.updateIssueDraft(number, { selectedAssignees: ["octocat", "OCTOCAT"] })
    await session.submitIssueAction(number, "assignees")
    expect(updates).toEqual([[], [], ["octocat"]])
    expect(session.issueDetail()?.resource.value?.assignees).toEqual(["octocat"])
    expect(session.issueAction(number).body).toBe("Unrelated comment draft")
    expect(commentCalls).toBe(0)
    staleRead = false
    remote = { ...remote, permissions: { ...remote.permissions!, assignees: false } }
    await session.loadIssue(number)
    session.prepareIssueAction(number, "assignees")
    expect(session.issueAction(number).selectedAssignees).toEqual(["octocat"])
    await expect(session.submitIssueAction(number, "assignees")).rejects.toThrow("permission")
    expect(updates).toHaveLength(3)
  })

  test("assignable users cache by repository, dedupe pages, retry the failed page and guard concurrent requests", async () => {
    const first = deferred<{ items: string[]; hasMore: boolean }>()
    let firstPage = first.promise
    const calls: [string, number | undefined][] = []
    let fail = true
    const session = createRepositorySession(loaders({
      assignableUsers: async (repository, page) => {
        calls.push([repository, page])
        if (repository === "owner/repo" && page === 1) return firstPage
        if (repository === "owner/other") return { items: ["other"], hasMore: false }
        if (fail) throw new Error("Try again")
        return { items: ["ALICE", "bob"], hasMore: false }
      },
    }))
    await session.load("owner/repo")
    await session.loadIssue(issueDetailFixture.number)
    session.prepareIssueAction(issueDetailFixture.number, "assignees")
    await session.loadAssignableUsers!()
    expect(calls).toEqual([["owner/repo", 1]])
    await session.load("owner/other")
    expect(session.assignableUsers!()).toBeUndefined()
    await session.loadAssignableUsers!()
    first.resolve({ items: ["alice"], hasMore: true })
    await first.promise
    await Promise.resolve()
    expect(session.assignableUsers!()?.value?.items).toEqual(["other"])
    await session.load("owner/repo")
    expect(session.assignableUsers!()?.value?.items).toEqual(["alice"])
    await session.loadIssue(issueDetailFixture.number)
    session.prepareIssueAction(issueDetailFixture.number, "assignees")
    expect(calls).toHaveLength(2)
    await session.loadAssignableUsers!()
    expect(session.assignableUsers!()).toMatchObject({ status: "error", value: { page: 1, items: ["alice"], hasMore: true } })
    fail = false
    await session.loadAssignableUsers!()
    expect(session.assignableUsers!()).toEqual({ status: "ready", value: { page: 2, items: ["alice", "bob"], hasMore: false } })
    await session.loadAssignableUsers!()
    expect(calls).toEqual([["owner/repo", 1], ["owner/other", 1], ["owner/repo", 2], ["owner/repo", 2]])
    firstPage = Promise.resolve({ items: ["new-collaborator"], hasMore: false })
    await session.refresh()
    expect(session.assignableUsers!()).toBeUndefined()
    await session.loadAssignableUsers!()
    expect(session.assignableUsers!()?.value?.items).toEqual(["new-collaborator"])
    const late = deferred<{ items: string[]; hasMore: boolean }>()
    firstPage = late.promise
    await session.refresh()
    const loading = session.loadAssignableUsers!()
    await session.refresh()
    late.resolve({ items: ["stale"], hasMore: false })
    await loading
    expect(session.assignableUsers!()).toBeUndefined()
  })

  test("loads commit details on demand and ignores obsolete responses", async () => {
    const pending = new Map<string, ReturnType<typeof deferred<CommitDetail>>>()
    const session = createRepositorySession(loaders({
      commit: async (_repository, sha) => {
        const request = deferred<CommitDetail>()
        pending.set(sha, request)
        return request.promise
      },
    }))
    await session.load("anomalyco/opentui")
    expect(pending.size).toBe(0)

    const first = session.loadCommit("first")
    const second = session.loadCommit("second")
    pending.get("second")!.resolve({ ...commitDetailFixture, sha: "second" })
    await second
    pending.get("first")!.reject(new Error("Obsolete failure"))
    await first
    expect(session.commitDetail()?.resource.value?.sha).toBe("second")
    expect(session.commitDetail()?.resource.status).toBe("ready")

    const closed = session.loadCommit("closed")
    session.clearCommit()
    pending.get("closed")!.resolve({ ...commitDetailFixture, sha: "closed" })
    await closed
    expect(session.commitDetail()).toBeUndefined()

    const switched = session.loadCommit("switched")
    await session.load("owner/another-repo")
    pending.get("switched")!.resolve({ ...commitDetailFixture, sha: "switched" })
    await switched
    expect(session.commitDetail()).toBeUndefined()
  })

  test("retains commit files on pagination failure and retries the same page", async () => {
    const requests: number[] = []
    let fail = true
    const session = createRepositorySession(loaders({
      commit: async (_repository, _sha, page = 1) => {
        requests.push(page)
        if (page === 2 && fail) throw new Error("Files unavailable")
        return {
          ...commitDetailFixture,
          files: {
            page,
            hasMore: page === 1,
            items: page === 1 ? [commitDetailFixture.files.items[0]!] : [commitDetailFixture.files.items[1]!],
          },
        }
      },
    }))
    await session.load("anomalyco/opentui")
    await session.loadCommit(commitDetailFixture.sha)
    await session.loadMoreCommitFiles()
    expect(session.commitDetail()?.resource).toMatchObject({
      status: "error", phase: "pagination", message: "Files unavailable",
    })
    expect(session.commitDetail()?.resource.value?.files.items).toHaveLength(1)
    fail = false
    await session.loadMoreCommitFiles()
    expect(requests).toEqual([1, 2, 2])
    expect(session.commitDetail()?.resource.value?.files.items).toEqual(commitDetailFixture.files.items)
    expect(session.commitDetail()?.resource.value?.files.hasMore).toBe(false)

    await session.loadCommit(commitDetailFixture.sha)
    expect(requests).toEqual([1, 2, 2, 1, 2])
    expect(session.commitDetail()?.resource.value?.files.items).toEqual(commitDetailFixture.files.items)
  })

  test("renders metadata before child resources settle", async () => {
    const pending = deferred<{ items: CommitSummary[]; hasMore: boolean }>()
    let metadataCalls = 0
    const session = createRepositorySession(loaders({
      metadata: async () => {
        metadataCalls++
        return structuredClone(githubDataFixture.repo)
      },
      commits: async () => pending.promise,
    }))

    const load = session.load("anomalyco/opentui")
    await Promise.resolve()
    await Promise.resolve()

    const state = ready(session)
    expect(state.data.repo.nameWithOwner).toBe("anomalyco/opentui")
    expect(state.data.commits.status).toBe("loading")
    expect(state.data.documents.value?.[0]?.label).toBe("README")
    await session.refresh()
    expect(metadataCalls).toBe(1)

    pending.resolve({ items: [], hasMore: false })
    await load
    expect(ready(session).data.commits.status).toBe("ready")
  })

  test("keeps resource and document failures independent and retries only the failed file", async () => {
    const defaults = loaders()
    let failDocument = true
    const documentCalls: string[] = []
    const session = createRepositorySession(loaders({
      document: async (source) => {
        documentCalls.push(source.path)
        if (failDocument && source.path === "CODE_OF_CONDUCT.md") throw new Error("Code of conduct unavailable")
        return defaults.document(source)
      },
      issues: async (_repository, state) => {
        if (state === "open") throw new Error("Open issues unavailable")
        return { items: [], hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    const state = ready(session)
    expect(state.data.issues.open.status).toBe("error")
    expect(state.data.issues.closed.status).toBe("ready")
    expect(state.data.commits.status).toBe("ready")
    expect(state.data.pulls.open.status).toBe("ready")
    expect(state.data.documents.value?.[0]?.resource.status).toBe("ready")
    const failed = state.data.documents.value!.find((document) => document.path === "CODE_OF_CONDUCT.md")!
    expect(failed.resource.status).toBe("error")
    failDocument = false
    documentCalls.length = 0
    await session.retryResource({ kind: "document", id: failed.id })
    expect(documentCalls).toEqual(["CODE_OF_CONDUCT.md"])
    expect(ready(session).data.documents.value?.find((document) => document.id === failed.id)?.resource.status).toBe("ready")
  })

  test("retries only the selected resource", async () => {
    let issueCalls = 0
    let runCalls = 0
    const session = createRepositorySession(loaders({
      issues: async (_repository, state) => {
        issueCalls++
        if (state === "open" && issueCalls === 1) throw new Error("Temporary failure")
        return { items: [], hasMore: false }
      },
      runs: async () => {
        runCalls++
        return { items: [], hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    const initialRuns = runCalls
    await session.retryResource({ kind: "issues", state: "open" })
    expect(ready(session).data.issues.open.status).toBe("ready")
    expect(runCalls).toBe(initialRuns)
  })

  test("ignores older repository resources", async () => {
    const defaults = loaders()
    const firstDocuments = deferred<RepositoryDocument[]>()
    const documentCalls: string[] = []
    const firstCommits = deferred<{ items: CommitSummary[]; hasMore: boolean }>()
    const session = createRepositorySession(loaders({
      metadata: async (repository) => ({ ...githubDataFixture.repo, nameWithOwner: repository }),
      documents: async (repo, branch) => repo.nameWithOwner === "first/repository"
        ? firstDocuments.promise : defaults.documents(repo, branch),
      document: async (source) => { documentCalls.push(source.repository); return defaults.document(source) },
      commits: async (repository) => repository === "first/repository"
        ? firstCommits.promise
        : { items: [], hasMore: false },
    }))

    const first = session.load("first/repository")
    await Promise.resolve()
    await session.load("second/repository")
    firstDocuments.resolve(await defaults.documents({ ...githubDataFixture.repo, nameWithOwner: "first/repository" }, "main"))
    firstCommits.resolve({
      items: [{ sha: "stale", message: "stale", author: "ghost", date: "" }],
      hasMore: false,
    })
    await first

    const state = ready(session)
    expect(state.repository).toBe("second/repository")
    expect(state.data.commits.value?.items).toEqual([])
    expect(documentCalls.every((repository) => repository === "second/repository")).toBe(true)
    expect(state.data.documents.value?.[0]?.repository).toBe("second/repository")
  })

  test("refresh retains stale values when one resource fails", async () => {
    let failRuns = false
    const session = createRepositorySession(loaders({
      runs: async () => {
        if (failRuns) throw new Error("Runs unavailable")
        return { items: structuredClone(githubDataFixture.runs.value!.items), hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    const oldRuns = ready(session).data.runs.value
    failRuns = true
    await session.refresh()

    const state = ready(session)
    expect(state.data.runs.status).toBe("error")
    expect(state.data.runs.value).toEqual(oldRuns)
    expect(state.data.commits.status).toBe("ready")
  })

  test("retries an initial branch failure from page one", async () => {
    const pages: number[] = []
    const session = createRepositorySession(loaders({
      branches: async (_repository, _fallback, page = 1) => {
        pages.push(page)
        if (pages.length === 1) throw new Error("Branches unavailable")
        return { items: ["main"], hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    const failed = ready(session).data.branches
    expect(failed.status).toBe("error")
    if (failed.status !== "error") throw new Error("Expected initial branch error")
    expect(failed.phase).toBe("load")

    await session.retryResource({ kind: "branches" })
    expect(pages).toEqual([1, 1])
    expect(ready(session).data.branches.value).toEqual({ items: ["main"], page: 1, hasMore: false })
  })

  test("paginates branches with deduplication and blocks duplicate requests", async () => {
    let calls = 0
    const pending = deferred<{ items: string[]; hasMore: boolean }>()
    const session = createRepositorySession(loaders({
      branches: async (_repository, _fallback, page) => {
        calls++
        return page === 2 ? pending.promise : { items: ["main", "shared"], hasMore: true }
      },
    }))

    await session.load("anomalyco/opentui")
    const pagination = session.loadMoreBranches()
    void session.loadMoreBranches()
    const loading = ready(session).data.branches
    expect(calls).toBe(2)
    expect(loading.status).toBe("loading")
    expect(loading.value?.items).toEqual(["main", "shared"])

    pending.resolve({ items: ["shared", "next", "next"], hasMore: false })
    await pagination

    const branches = ready(session).data.branches
    expect(branches.status).toBe("ready")
    expect(branches.value).toEqual({ items: ["main", "shared", "next"], page: 2, hasMore: false })
  })

  test("retries failed branch pagination without discarding loaded branches", async () => {
    let secondPageCalls = 0
    const session = createRepositorySession(loaders({
      branches: async (_repository, _fallback, page) => {
        if (page !== 2) return { items: ["main"], hasMore: true }
        secondPageCalls++
        if (secondPageCalls === 1) throw new Error("Branches unavailable")
        return { items: ["next"], hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    await session.loadMoreBranches()
    const failed = ready(session).data.branches
    expect(failed.status).toBe("error")
    if (failed.status !== "error") throw new Error("Expected branch pagination error")
    expect(failed.phase).toBe("pagination")
    expect(failed.value?.items).toEqual(["main"])

    await session.retryResource({ kind: "branches" })
    const branches = ready(session).data.branches
    expect(secondPageCalls).toBe(2)
    expect(branches.status).toBe("ready")
    expect(branches.value).toEqual({ items: ["main", "next"], page: 2, hasMore: false })
  })

  test("paginates with full-SHA deduplication and blocks duplicates", async () => {
    const first = structuredClone(githubDataFixture.commits.value!.items[0]!)
    let calls = 0
    const pending = deferred<{ items: CommitSummary[]; hasMore: boolean }>()
    const session = createRepositorySession(loaders({
      commits: async (_repository, _branch, page) => {
        calls++
        return page === 2 ? pending.promise : { items: [first], hasMore: true }
      },
    }))

    await session.load("anomalyco/opentui")
    const pagination = session.loadMoreCommits()
    void session.loadMoreCommits()
    expect(calls).toBe(2)
    pending.resolve({
      items: [first, { sha: "b".repeat(40), message: "next", author: "octocat", date: "" }],
      hasMore: false,
    })
    await pagination

    const commits = ready(session).data.commits.value!
    expect(commits.items).toHaveLength(2)
    expect(commits.items[0]?.sha).toHaveLength(40)
    expect(commits.page).toBe(2)
  })

  test("retries the failed pagination page without discarding loaded items", async () => {
    let secondPageCalls = 0
    const session = createRepositorySession(loaders({
      commits: async (_repository, _branch, page) => {
        if (page !== 2) return { items: [structuredClone(githubDataFixture.commits.value!.items[0]!)], hasMore: true }
        secondPageCalls++
        if (secondPageCalls === 1) throw new Error("Page unavailable")
        return {
          items: [{ sha: "c".repeat(40), message: "retried", author: "octocat", date: "" }],
          hasMore: false,
        }
      },
    }))

    await session.load("anomalyco/opentui")
    await session.loadMoreCommits()
    expect(ready(session).data.commits.status).toBe("error")
    await session.retryResource({ kind: "commits" })

    const commits = ready(session).data.commits
    expect(secondPageCalls).toBe(2)
    expect(commits.status).toBe("ready")
    expect(commits.value?.page).toBe(2)
    expect(commits.value?.items.map((commit) => commit.message)).toEqual(["fix: avoid duplicate key events", "retried"])
  })

  test("refreshes every page already loaded", async () => {
    const pages: number[] = []
    const session = createRepositorySession(loaders({
      commits: async (_repository, _branch, page = 1) => {
        pages.push(page)
        return {
          items: [{ sha: String(page).repeat(40), message: `page ${page}`, author: "octocat", date: "" }],
          hasMore: page === 1,
        }
      },
    }))

    await session.load("anomalyco/opentui")
    await session.loadMoreCommits()
    pages.length = 0
    await session.refresh()

    expect(pages).toEqual([1, 2])
    expect(ready(session).data.commits.value?.items.map((commit) => commit.message)).toEqual(["page 1", "page 2"])
    expect(ready(session).data.commits.value?.page).toBe(2)
  })

  test("ignores stale pagination after changing repositories", async () => {
    const pending = deferred<{ items: CommitSummary[]; hasMore: boolean }>()
    const session = createRepositorySession(loaders({
      metadata: async (repository) => ({ ...githubDataFixture.repo, nameWithOwner: repository }),
      commits: async (repository, _branch, page) => page === 2
        ? pending.promise
        : { items: [{ sha: repository.padEnd(40, "0"), message: repository, author: "octocat", date: "" }], hasMore: true },
    }))

    await session.load("first/repository")
    const pagination = session.loadMoreCommits()
    await session.load("second/repository")
    pending.reject(new Error("Old repository failed"))
    await pagination

    const state = ready(session)
    expect(state.repository).toBe("second/repository")
    expect(state.data.commits.status).toBe("ready")
    expect(state.data.commits.value?.items[0]?.message).toBe("second/repository")
  })

  test("does not switch branches while commit pagination is loading", async () => {
    const pending = deferred<{ items: CommitSummary[]; hasMore: boolean }>()
    let branchLoads = 0
    const session = createRepositorySession(loaders({
      commits: async (_repository, branch, page) => {
        if (page === 2) return pending.promise
        if (branch === "next") branchLoads++
        return { items: structuredClone(githubDataFixture.commits.value!.items), hasMore: true }
      },
    }))

    await session.load("anomalyco/opentui")
    expect(session.canSwitchBranch()).toBe(true)
    const pagination = session.loadMoreCommits()
    expect(session.canSwitchBranch()).toBe(false)
    await session.switchBranch("next")
    expect(branchLoads).toBe(0)
    pending.resolve({ items: [], hasMore: false })
    await pagination
    expect(ready(session).data.commits.status).toBe("ready")
    expect(session.canSwitchBranch()).toBe(true)
  })

  test("does not retry resources during refresh", async () => {
    const metadata = deferred<typeof githubDataFixture.repo>()
    let metadataCalls = 0
    let issueCalls = 0
    const session = createRepositorySession(loaders({
      metadata: async () => {
        metadataCalls++
        return metadataCalls === 1 ? structuredClone(githubDataFixture.repo) : metadata.promise
      },
      issues: async (_repository, state) => {
        if (state === "open") issueCalls++
        return { items: [], hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    const refresh = session.refresh()
    await session.retryResource({ kind: "issues", state: "open" })
    expect(issueCalls).toBe(1)
    metadata.resolve(structuredClone(githubDataFixture.repo))
    await refresh
    expect(issueCalls).toBe(2)
  })

  test("reloads documents without letting their content failures block branch switching", async () => {
    const defaults = loaders()
    const session = createRepositorySession(loaders({
      document: async (source) => {
        if (source.path === "CONTRIBUTING.md") return `${source.ref} contributing`
        if (source.path === "SECURITY.md" && source.ref === "next") throw new Error("Security unavailable")
        return defaults.document(source)
      },
    }))

    await session.load("anomalyco/opentui")
    await session.switchBranch("next")
    const state = ready(session)
    expect(state.data.currentBranch).toBe("next")
    expect(state.data.documents.value?.find((document) => document.path === "CONTRIBUTING.md")?.resource.value).toBe("next contributing")
    expect(state.data.documents.value?.find((document) => document.path === "SECURITY.md")?.resource.status).toBe("error")
  })

  test("keeps branch switching atomic when document discovery fails", async () => {
    const defaults = loaders()
    const session = createRepositorySession(loaders({
      documents: async (repo, branch) => {
        if (branch === "next") throw new Error("Documents unavailable")
        return defaults.documents(repo, branch)
      },
    }))

    await session.load("anomalyco/opentui")
    await session.switchBranch("next")
    const state = ready(session)
    expect(state.data.currentBranch).toBe("main")
    expect(state.operations.branch.status).toBe("error")
  })
})

test("run details paginate jobs, retain data on failure, and reset jobs for a new attempt", async () => {
  let attempt = 2
  let fail = false
  const requested: number[] = []
  const session = createRepositorySession(loaders({
    run: async () => ({ ...workflowRunFixture, attempt }),
    runJobs: async (_repository, _id, runAttempt, page = 1) => {
      requested.push(runAttempt)
      if (fail) throw new Error("Jobs unavailable")
      return { items: [{ ...workflowJobFixture, id: page }], hasMore: page < 3 }
    },
  }))
  await session.load("owner/repo")
  await session.loadRun(9812)
  expect(ready(session).data.runs.value?.items.find((run) => run.id === 9812)?.title).toBe(workflowRunFixture.title)
  await session.loadMoreRunJobs()
  expect(session.runDetail()?.jobs.value?.items.map((job) => job.id)).toEqual([1, 2])
  fail = true
  await session.loadRun(9812)
  expect(session.runDetail()?.jobs.status).toBe("error")
  expect(session.runDetail()?.jobs.value?.items).toHaveLength(2)
  const requestsBeforePagination = requested.length
  await session.loadMoreRunJobs()
  expect(requested).toHaveLength(requestsBeforePagination)
  expect(session.runDetail()?.jobs.status).toBe("error")
  fail = false
  await session.loadRun(9812)
  expect(session.runDetail()?.jobs.status).toBe("ready")
  expect(session.runDetail()?.jobs.value?.page).toBe(2)
  attempt = 3
  fail = false
  await session.loadRun(9812)
  expect(session.runDetail()?.jobs.value?.page).toBe(1)
  expect(session.runDetail()?.jobs.value?.items).toHaveLength(1)
  expect(requested.at(-1)).toBe(3)
})

test("closing a workflow detail rejects pending results", async () => {
  const pending = deferred<typeof workflowRunFixture>()
  const session = createRepositorySession(loaders({ run: async () => pending.promise }))
  await session.load("owner/repo")
  const loading = session.loadRun(9812)
  session.clearRun()
  pending.resolve(workflowRunFixture)
  await loading
  expect(session.runDetail()).toBeUndefined()
})

test("late run lists preserve newer detail responses without blocking subsequent list updates", async () => {
  const pendingList = deferred<{ items: typeof workflowRunFixture[]; hasMore: boolean }>()
  const listStarted = deferred<void>()
  const pendingRun = deferred<typeof workflowRunFixture>()
  let holdList = false
  let runLoads = 0
  const session = createRepositorySession(loaders({
    runs: async () => {
      if (holdList) {
        listStarted.resolve()
        return pendingList.promise
      }
      return { items: [{ ...workflowRunFixture, title: "Newer list title" }], hasMore: false }
    },
    run: async () => { runLoads++; return pendingRun.promise },
    runJobs: async () => ({ items: [workflowJobFixture], hasMore: false }),
  }))
  await session.load("owner/repo")
  holdList = true
  const refresh = session.refresh()
  await listStarted.promise
  const detail = session.loadRun(9812)
  await session.loadRun(9812)
  expect(runLoads).toBe(1)
  pendingRun.resolve(workflowRunFixture)
  await detail
  session.clearRun()
  pendingList.resolve({ items: [{ ...workflowRunFixture, status: "in_progress", conclusion: "" }], hasMore: false })
  await refresh
  expect(ready(session).data.runs.value?.items[0]?.status).toBe("completed")
  holdList = false
  await session.refresh()
  expect(ready(session).data.runs.value?.items[0]?.title).toBe("Newer list title")
})
