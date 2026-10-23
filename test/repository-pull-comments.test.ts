import { describe, expect, test } from "bun:test"
import type { IssueActionKind, IssueComment, PullRequestDetail } from "../src/models"
import { createRepositorySession, type RepositoryLoaders } from "../src/repository-session"
import { commitDetailFixture, githubDataFixture, issueCommentsFixture, issueDetailFixture, pullContextFixture } from "./fixtures/github-data"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const pull = (number = 421): PullRequestDetail => ({
  ...githubDataFixture.pulls.open.value!.items[0]!, number,
  url: `https://github.com/owner/repo/pull/${number}`, body: "PR body",
  updatedAt: "2026-01-01T00:00:00Z", baseBranch: "main", headBranch: "next",
  additions: 1, deletions: 0, changedFiles: 1, commitCount: 1, commentCount: 1,
  permissions: { comment: true },
  labels: [], assignees: [], reviewers: [], mergeable: true,
})
const comment: IssueComment = { ...issueCommentsFixture[0]!, id: 98765, body: "New conversation comment", createdAt: "2026-06-01T00:00:00Z" }
function loaders(overrides: Partial<RepositoryLoaders> = {}): RepositoryLoaders {
  return {
    metadata: async (repository) => ({ ...githubDataFixture.repo, nameWithOwner: repository }),
    workCounts: async () => ({ issues: 1, pulls: 1 }),
    documents: async () => [], document: async () => "", branches: async () => ({ items: ["main"], hasMore: false }),
    commits: async () => ({ items: [], hasMore: false }), commitCount: async () => 0,
    commit: async () => structuredClone(commitDetailFixture),
    issue: async (_repository, number) => ({ ...structuredClone(issueDetailFixture), number }),
    issueComments: async () => ({ items: structuredClone(issueCommentsFixture), hasMore: false }),
    issueReferences: async () => [], issues: async () => ({ items: [], hasMore: false }),
    pulls: async () => ({ items: [], hasMore: false }), pull: async (_repository, number) => pull(number),
    pullCommits: async () => structuredClone(githubDataFixture.commits.value!.items),
    pullContext: async () => structuredClone(pullContextFixture), runs: async () => ({ items: [], hasMore: false }),
    createIssueComment: async () => structuredClone(comment), ...overrides,
  }
}
async function setup(overrides: Partial<RepositoryLoaders> = {}) {
  const session = createRepositorySession(loaders(overrides))
  await session.load("owner/repo")
  await session.loadPull(421)
  session.updateIssueDraft(421, { body: comment.body }, "pull")
  return session
}

describe("pull request conversation comments", () => {
  test("posts via issue comment loader once, guards pending drafts, and preserves PR context", async () => {
    const pending = deferred<IssueComment>()
    const calls: unknown[][] = []
    const session = await setup({ createIssueComment: async (...args) => { calls.push(args); return pending.promise } })
    const before = session.pullDetail()!
    const posting = session.submitIssueAction(421, "comment", "pull")
    expect(session.issueAction(421, "pull").operation.status).toBe("loading")
    session.updateIssueDraft(421, { body: "replacement" }, "pull")
    session.discardIssueDraft(421, "pull")
    session.prepareIssueAction(421, "comment", "pull")
    await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("already in progress")
    pending.resolve(comment)
    expect(await posting).toEqual({ comment })
    expect(calls).toEqual([["owner/repo", 421, comment.body]])
    expect(session.issueAction(421, "pull").body).toBe("")
    expect(session.pullDetail()?.resource.value).toMatchObject({ commentCount: 2, updatedAt: comment.createdAt })
    expect(session.pullDetail()?.comments.value?.items.at(-1)).toEqual(comment)
    expect(session.pullDetail()?.context).toEqual(before.context)
    expect(session.pullDetail()?.commits).toEqual(before.commits)
  })

  test("errors retain draft; blank, missing loader and denied permission never write", async () => {
    let calls = 0
    const session = await setup({ createIssueComment: async () => { calls++; throw new Error("Offline") } })
    await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("Offline")
    expect(session.issueAction(421, "pull")).toMatchObject({ body: comment.body, operation: { status: "error" } })
    session.updateIssueDraft(421, { body: "  \n " }, "pull")
    await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("Write a comment")
    expect(calls).toBe(1)
    const denied = await setup({ pull: async () => ({ ...pull(), permissions: { comment: false } }), createIssueComment: async () => { calls++; return comment } })
    await expect(denied.submitIssueAction(421, "comment", "pull")).rejects.toThrow("permission")
    expect(denied.issueAction(421, "pull").body).toBe(comment.body)
    expect(calls).toBe(1)
    const unavailable = await setup({ createIssueComment: undefined })
    await expect(unavailable.submitIssueAction(421, "comment", "pull")).rejects.toThrow("unavailable")
  })

  test("requires the matching loaded PR and never writes while its metadata is loading", async () => {
    const header = deferred<PullRequestDetail>()
    let calls = 0
    let refreshing = false
    const session = await setup({
      pull: async () => refreshing ? header.promise : pull(),
      createIssueComment: async () => { calls++; return comment },
    })
    await expect(session.submitIssueAction(422, "comment", "pull")).rejects.toThrow("Wait for the pull request")
    refreshing = true
    const refresh = session.loadPull(421)
    await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("Wait for the pull request")
    header.resolve(pull())
    await refresh
    session.clearPull()
    await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("Wait for the pull request")
    expect(calls).toBe(0)
  })

  test("rejects non-comment pull actions before mutation and isolates issue and repository drafts", async () => {
    const session = await setup()
    session.updateIssueDraft(421, { body: "issue draft" })
    const before = session.issueAction(421, "pull")
    for (const kind of ["close", "reopen", "assignees", "duplicate"] as IssueActionKind[]) {
      expect(() => session.prepareIssueAction(421, kind, "pull")).toThrow("Only comments")
      await expect(session.submitIssueAction(421, kind, "pull")).rejects.toThrow("Only comments")
      expect(session.issueAction(421, "pull")).toBe(before)
    }
    session.discardIssueDraft(421, "pull")
    expect(session.issueAction(421).body).toBe("issue draft")
    await session.load("owner/other")
    expect(session.issueAction(421).body).toBe("")
    expect(session.issueAction(421, "pull").body).toBe("")
    session.updateIssueDraft(421, { body: "other PR" }, "pull")
    await session.load("owner/repo")
    expect(session.issueAction(421).body).toBe("issue draft")
    expect(session.issueAction(421, "pull").body).toBe("")
  })

  test("pending pagination retains confirmed comments, deduplicates server entries and sorts chronologically", async () => {
    const next = deferred<{ items: IssueComment[]; hasMore: boolean }>()
    const session = await setup({ issueComments: async (_repo, _number, page = 1) => page === 2 ? next.promise : { items: [issueCommentsFixture[0]!], hasMore: true } })
    const pagination = session.loadMorePullComments()
    await session.submitIssueAction(421, "comment", "pull")
    next.resolve({ items: [comment, issueCommentsFixture[0]!], hasMore: false })
    await pagination
    expect(session.pullDetail()?.comments.value?.items.map((item) => item.id)).toEqual([issueCommentsFixture[0]!.id, comment.id])
  })

  test("in-flight comment reads and stale zero-count reloads retain confirmed comments until server reconciliation", async () => {
    const read = deferred<{ items: IssueComment[]; hasMore: boolean }>()
    let phase = "initial"
    const session = await setup({
      pull: async () => ({ ...pull(), commentCount: phase === "zero" ? 0 : 1 }),
      issueComments: async () => phase === "reading" ? read.promise : { items: phase === "server" ? [comment] : [], hasMore: false },
    })
    phase = "reading"
    const refresh = session.loadPull(421)
    await Bun.sleep(0)
    await session.submitIssueAction(421, "comment", "pull")
    read.resolve({ items: [], hasMore: false })
    await refresh
    expect(session.pullDetail()?.comments.value?.items).toEqual([comment])
    phase = "zero"
    await session.loadPull(421)
    expect(session.pullDetail()?.comments.value?.items).toEqual([comment])
    phase = "server"
    await session.loadPull(421)
    expect(session.pullDetail()?.comments.value?.items).toEqual([comment])
    // Once returned by the server, it owns later deletion/editing semantics.
    phase = "zero"
    await session.loadPull(421)
    expect(session.pullDetail()?.comments.value?.items).toEqual([])
  })

  test("a metadata read started during posting cannot undo confirmed comment metadata", async () => {
    const write = deferred<IssueComment>()
    const header = deferred<PullRequestDetail>()
    let refresh = false
    const session = await setup({ pull: async () => refresh ? header.promise : pull(), createIssueComment: async () => write.promise })
    const posting = session.submitIssueAction(421, "comment", "pull")
    refresh = true
    const reloading = session.loadPull(421)
    write.resolve(comment)
    await posting
    header.resolve(pull())
    await reloading
    expect(session.pullDetail()?.resource.value).toMatchObject({ commentCount: 2, updatedAt: comment.createdAt })
    expect(session.pullDetail()?.comments.value?.items.filter((item) => item.id === comment.id)).toHaveLength(1)
  })

  test("overlapping comment confirmation preserves refreshed lock, permissions, state and title", async () => {
    for (const permission of [false, undefined]) {
      const write = deferred<IssueComment>()
      const header = deferred<PullRequestDetail>()
      let refreshing = false
      const session = await setup({ pull: async () => refreshing ? header.promise : pull(), createIssueComment: async () => write.promise })
      const posting = session.submitIssueAction(421, "comment", "pull")
      refreshing = true
      const refresh = session.loadPull(421)
      write.resolve(comment)
      await posting
      expect(session.pullDetail()?.resource.status).toBe("loading")
      session.updateIssueDraft(421, { body: "Wait for refreshed permission" }, "pull")
      await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("Wait for the pull request")
      header.resolve({ ...pull(), state: "closed", title: "Fresh PR title", locked: true,
        permissions: permission === undefined ? undefined : { comment: permission } })
      await refresh
      expect(session.pullDetail()?.resource.value).toMatchObject({ state: "closed", title: "Fresh PR title", locked: true, commentCount: 2 })
      expect(session.pullDetail()?.resource.value?.permissions?.comment).toBe(permission)
      session.updateIssueDraft(421, { body: "Do not post with stale permission" }, "pull")
      await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("permission")
    }
  })

  test("a read that already includes the posted comment cannot double-count it or roll back newer metadata", async () => {
    const write = deferred<IssueComment>()
    let refreshing = false
    const updatedAt = "2026-06-02T00:00:00Z"
    const session = await setup({
      pull: async () => refreshing ? { ...pull(), commentCount: 2, updatedAt } : pull(),
      issueComments: async () => ({ items: refreshing ? [issueCommentsFixture[0]!, comment] : [issueCommentsFixture[0]!], hasMore: false }),
      createIssueComment: async () => write.promise,
    })
    const posting = session.submitIssueAction(421, "comment", "pull")
    refreshing = true
    await session.loadPull(421)
    write.resolve(comment)
    await posting
    expect(session.pullDetail()?.resource.value).toMatchObject({ commentCount: 2, updatedAt })
    expect(session.pullDetail()?.comments.value?.items.filter((item) => item.id === comment.id)).toHaveLength(1)
  })

  test("late success or failure after repository replacement cannot mutate replacement detail or drafts", async () => {
    for (const succeeds of [true, false]) {
      const write = deferred<IssueComment>()
      const session = await setup({ createIssueComment: async () => write.promise })
      const posting = session.submitIssueAction(421, "comment", "pull").catch((error) => error)
      await session.load("owner/other")
      await session.loadPull(421)
      session.updateIssueDraft(421, { body: "replacement draft" }, "pull")
      const before = session.pullDetail()
      if (succeeds) write.resolve(comment)
      else write.reject(new Error("Late failure"))
      await posting
      expect(session.pullDetail()).toBe(before)
      expect(session.issueAction(421, "pull")).toMatchObject({ body: "replacement draft", operation: { status: "idle" } })
      await session.load("owner/repo")
      expect(session.issueAction(421, "pull")).toMatchObject({
        body: succeeds ? "" : comment.body,
        operation: { status: succeeds ? "idle" : "error" },
      })
    }
  })
})
