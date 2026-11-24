import { describe, expect, test } from "bun:test"
import type { IssueComment, PullContext, PullRequestDetail, PullReviewThread } from "../src/models"
import { createRepositorySession, type RepositoryLoaders } from "../src/repository-session"
import type { AssigneeChanges } from "../src/github/client"
import { ReviewThreadChangedError } from "../src/github/review-replies"
import {
  commitDetailFixture,
  githubDataFixture,
  issueCommentsFixture,
  issueDetailFixture,
  pullContextFixture,
} from "./fixtures/github-data"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const pull = (number = 421): PullRequestDetail => ({
  ...githubDataFixture.pulls.open.value!.items[0]!,
  number,
  url: `https://github.com/owner/repo/pull/${number}`,
  body: "PR body",
  updatedAt: "2026-01-01T00:00:00Z",
  baseBranch: "main",
  headBranch: "next",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  commitCount: 1,
  commentCount: 1,
  permissions: { comment: true },
  labels: [],
  assignees: [],
  reviewers: [],
  mergeable: true,
})
const comment: IssueComment = {
  ...issueCommentsFixture[0]!,
  id: 98765,
  body: "New conversation comment",
  createdAt: "2026-06-01T00:00:00Z",
}
function loaders(overrides: Partial<RepositoryLoaders> = {}): RepositoryLoaders {
  return {
    metadata: async (repository) => ({ ...githubDataFixture.repo, nameWithOwner: repository }),
    workCounts: async () => ({ issues: 1, pulls: 1 }),
    documents: async () => [],
    document: async () => "",
    branches: async () => ({ items: ["main"], hasMore: false }),
    commits: async () => ({ items: [], hasMore: false }),
    commitCount: async () => 0,
    commit: async () => structuredClone(commitDetailFixture),
    issue: async (_repository, number) => ({ ...structuredClone(issueDetailFixture), number }),
    issueComments: async () => ({ items: structuredClone(issueCommentsFixture), hasMore: false }),
    issueReferences: async () => [],
    issues: async () => ({ items: [], hasMore: false }),
    pulls: async () => ({ items: [], hasMore: false }),
    pull: async (_repository, number) => pull(number),
    pullCommits: async () => structuredClone(githubDataFixture.commits.value!.items),
    pullContext: async () => structuredClone(pullContextFixture),
    runs: async () => ({ items: [], hasMore: false }),
    createIssueComment: async () => structuredClone(comment),
    ...overrides,
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
  test("close/reopen retries only the state write after a confirmed comment", async () => {
    let current = { ...pull(), permissions: { comment: true, close: true, reopen: true, assignees: true } }
    let comments = 0
    let writes = 0
    const session = await setup({
      pull: async () => ({ ...current, reactions: { heart: 2 }, viewerReactions: ["heart"], canReact: true }),
      pulls: async (_repo, state) => ({ items: current.state === state ? [current] : [], hasMore: false }),
      workCounts: async () => ({ issues: 1, pulls: current.state === "open" ? 1 : 0 }),
      createIssueComment: async () => {
        comments++
        return comment
      },
      updatePullState: async (_repo, _number, state) => {
        if (++writes === 1) throw new Error("Offline")
        current = { ...current, state }
        return current
      },
    })
    await expect(session.submitIssueAction(421, "close", "pull")).rejects.toThrow("Comment posted, but closing failed")
    expect(session.issueAction(421, "pull")).toMatchObject({ body: "", retry: "close" })
    session.updateIssueDraft(421, { body: "must not post" }, "pull")
    await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("pending action")
    expect((await session.submitIssueAction(421, "close", "pull")).pull?.state).toBe("closed")
    expect(session.pullDetail()?.resource.value).toMatchObject({
      state: "closed",
      commentCount: 2,
      reactions: { heart: 2 },
      viewerReactions: ["heart"],
      canReact: true,
    })
    await Bun.sleep(0)
    const state = session.state()
    expect(state.status === "ready" && state.data.pulls.closed.value?.items[0]?.number).toBe(421)
    expect(state.status === "ready" && state.data.workCounts.value?.pulls).toBe(0)
    expect((await session.submitIssueAction(421, "reopen", "pull")).pull?.state).toBe("open")
    expect(comments).toBe(1)
    expect(writes).toBe(3)
  })

  test("assignees initialize from PR, validate suggestions, preserve merged PR fields and never post drafts", async () => {
    let comments = 0
    const calls: AssigneeChanges[] = []
    const original = {
      ...pull(),
      merged: true,
      state: "closed" as const,
      assignees: ["alice"],
      permissions: { comment: true, close: true, reopen: true, assignees: true },
    }
    const session = await setup({
      pull: async () => original,
      assignableUsers: async () => ({ items: [{ login: "bob" }], hasMore: false }),
      createIssueComment: async () => {
        comments++
        return comment
      },
      updateIssueAssignees: async (_repo, number, changes) => {
        calls.push(changes)
        return { ...issueDetailFixture, number, assignees: ["bob"], commentCount: 999 }
      },
    })
    session.prepareIssueAction(421, "assignees", "pull")
    expect(session.issueAction(421, "pull").selectedAssignees).toEqual(["alice"])
    await Bun.sleep(0)
    session.updateIssueDraft(421, { selectedAssignees: ["unknown"] }, "pull")
    await expect(session.submitIssueAction(421, "assignees", "pull")).rejects.toThrow("suggested users")
    session.updateIssueDraft(421, { selectedAssignees: ["bob", "BOB"] }, "pull")
    const result = await session.submitIssueAction(421, "assignees", "pull")
    expect(result.pull).toMatchObject({ ...original, assignees: ["bob"], updatedAt: issueDetailFixture.updatedAt })
    // Only the change is sent: alice is removed and bob added.
    expect(calls).toEqual([{ add: ["bob"], remove: ["alice"] }])
    expect(comments).toBe(0)
    expect(session.issueAction(421, "pull").body).toBe(comment.body)
    await expect(session.submitIssueAction(421, "reopen", "pull")).rejects.toThrow("Merged")
  })

  test("an overlapping stale PR read reloads after a state write instead of undoing it", async () => {
    const write = deferred<PullRequestDetail>()
    const read = deferred<PullRequestDetail>()
    let reads = 0
    const session = await setup({
      pull: async () =>
        ++reads === 1
          ? { ...pull(), permissions: { comment: true, close: true } }
          : reads === 2
            ? read.promise
            : { ...pull(), state: "closed" },
      updatePullState: async () => write.promise,
    })
    session.updateIssueDraft(421, { body: "" }, "pull")
    const writing = session.submitIssueAction(421, "close", "pull")
    const refreshing = session.loadPull(421)
    write.resolve({ ...pull(), state: "closed" })
    await writing
    read.resolve(pull())
    await refreshing
    expect(session.pullDetail()?.resource.value?.state).toBe("closed")
    expect(reads).toBe(3)
  })

  test("late PR state writes cannot mutate another repository", async () => {
    const pending = deferred<PullRequestDetail>()
    const session = await setup({
      pull: async () => ({ ...pull(), permissions: { comment: true, close: true } }),
      updatePullState: async () => pending.promise,
    })
    session.updateIssueDraft(421, { body: "" }, "pull")
    const writing = session.submitIssueAction(421, "close", "pull")
    await expect(session.submitIssueAction(421, "close", "pull")).rejects.toThrow("already in progress")
    await session.load("owner/other")
    await session.loadPull(421)
    const before = session.pullDetail()
    pending.resolve({ ...pull(), state: "closed" })
    await writing
    expect(session.pullDetail()).toBe(before)
  })

  test("posts via issue comment loader once, guards pending drafts, and preserves PR context", async () => {
    const pending = deferred<IssueComment>()
    const calls: unknown[][] = []
    const session = await setup({
      createIssueComment: async (...args) => {
        calls.push(args)
        return pending.promise
      },
    })
    const before = session.pullDetail()!
    const posting = session.submitIssueAction(421, "comment", "pull")
    expect(session.issueAction(421, "pull").operation.status).toBe("loading")
    session.updateIssueDraft(421, { body: "replacement" }, "pull")
    session.discardIssueDraft(421, "pull")
    session.prepareIssueAction(421, "comment", "pull")
    await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("already in progress")
    pending.resolve(comment)
    expect(await posting).toEqual({ comment })
    expect(calls).toEqual([
      [
        expect.objectContaining({ nameWithOwner: "owner/repo", id: githubDataFixture.repo.id, nodeId: githubDataFixture.repo.nodeId }),
        421,
        comment.body,
        expect.any(Function),
        `owner/repo@${githubDataFixture.repo.id}#421:pull:comment`,
      ],
    ])
    expect(session.issueAction(421, "pull").body).toBe("")
    expect(session.pullDetail()?.resource.value).toMatchObject({ commentCount: 2, updatedAt: comment.createdAt })
    expect(session.pullDetail()?.comments.value?.items.at(-1)).toEqual(comment)
    expect(session.pullDetail()?.context).toEqual(before.context)
    expect(session.pullDetail()?.commits).toEqual(before.commits)
  })

  test("errors retain draft; blank, missing loader and denied permission never write", async () => {
    let calls = 0
    const session = await setup({
      createIssueComment: async () => {
        calls++
        throw new Error("Offline")
      },
    })
    await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("Offline")
    expect(session.issueAction(421, "pull")).toMatchObject({ body: comment.body, operation: { status: "error" } })
    session.updateIssueDraft(421, { body: "  \n " }, "pull")
    await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("Write a comment")
    expect(calls).toBe(1)
    const denied = await setup({
      pull: async () => ({ ...pull(), permissions: { comment: false } }),
      createIssueComment: async () => {
        calls++
        return comment
      },
    })
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
      pull: async () => (refreshing ? header.promise : pull()),
      createIssueComment: async () => {
        calls++
        return comment
      },
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

  test("a failed PR reload cannot post with previously loaded permissions and retains the draft", async () => {
    let failReload = false
    let calls = 0
    const session = await setup({
      pull: async () => {
        if (failReload) throw new Error("Access revoked")
        return pull()
      },
      createIssueComment: async () => {
        calls++
        return comment
      },
    })
    failReload = true
    await session.loadPull(421)
    expect(session.pullDetail()?.resource).toMatchObject({ status: "error", value: { permissions: { comment: true } } })
    await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("Reload the pull request successfully")
    expect(calls).toBe(0)
    expect(session.issueAction(421, "pull")).toMatchObject({ body: comment.body, operation: { status: "idle" } })
    failReload = false
    await session.loadPull(421)
    expect(await session.submitIssueAction(421, "comment", "pull")).toEqual({ comment })
    expect(calls).toBe(1)
  })

  test("rejects duplicate pull actions before mutation and isolates issue and repository drafts", async () => {
    const session = await setup()
    session.updateIssueDraft(421, { body: "issue draft" })
    const before = session.issueAction(421, "pull")
    expect(() => session.prepareIssueAction(421, "duplicate", "pull")).toThrow("duplicates")
    await expect(session.submitIssueAction(421, "duplicate", "pull")).rejects.toThrow("duplicates")
    expect(session.issueAction(421, "pull")).toBe(before)
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
    const session = await setup({
      issueComments: async (_repo, _number, page = 1) => (page === 2 ? next.promise : { items: [issueCommentsFixture[0]!], hasMore: true }),
    })
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
      issueComments: async () => (phase === "reading" ? read.promise : { items: phase === "server" ? [comment] : [], hasMore: false }),
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
    const session = await setup({ pull: async () => (refresh ? header.promise : pull()), createIssueComment: async () => write.promise })
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
      const session = await setup({
        pull: async () => (refreshing ? header.promise : pull()),
        createIssueComment: async () => write.promise,
      })
      const posting = session.submitIssueAction(421, "comment", "pull")
      refreshing = true
      const refresh = session.loadPull(421)
      write.resolve(comment)
      await posting
      expect(session.pullDetail()?.resource.status).toBe("loading")
      session.updateIssueDraft(421, { body: "Wait for refreshed permission" }, "pull")
      await expect(session.submitIssueAction(421, "comment", "pull")).rejects.toThrow("Wait for the pull request")
      header.resolve({
        ...pull(),
        state: "closed",
        title: "Fresh PR title",
        locked: true,
        permissions: permission === undefined ? undefined : { comment: permission },
      })
      await refresh
      expect(session.pullDetail()?.resource.value).toMatchObject({
        state: "closed",
        title: "Fresh PR title",
        locked: true,
        commentCount: 2,
      })
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
      pull: async () => (refreshing ? { ...pull(), commentCount: 2, updatedAt } : pull()),
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

const root = {
  id: "root",
  body: "Review comment",
  url: "https://github.com/owner/repo/pull/421#discussion_r1",
  author: "alice",
  authorAssociation: "MEMBER",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
}
const reply = { ...root, id: "reply", replyToId: root.id, body: "Review thread reply" }
const replyThread: PullReviewThread = {
  kind: "review-thread",
  id: "thread",
  path: "example.ts",
  isResolved: false,
  isOutdated: true,
  canReply: true,
  comments: [root],
}
const replyContext = { ...pullContextFixture, threads: [replyThread] }

test("a confirmed inline reply updates just its thread without appending to the PR conversation", async () => {
  const session = await setup({
    pullContext: async () => ({
      ...pullContextFixture,
      threads: [
        replyThread,
        {
          kind: "review-thread",
          id: "locked",
          path: "example.ts",
          isResolved: false,
          isOutdated: false,
          canReply: false,
          comments: [root],
        },
      ],
    }),
    postReviewReply: async (repository, number, threadId, body) => {
      expect([repository.nameWithOwner, number, threadId, body]).toEqual(["owner/repo", 421, "thread", reply.body])
      return reply
    },
  })
  await expect(session.postReviewReply!(421, "locked", reply.body)).rejects.toThrow("Refresh the pull request")
  await session.postReviewReply!(421, "thread", reply.body)
  expect(session.pullDetail()?.context.value?.threads.map((thread) => thread.comments)).toEqual([[root, reply], [root]])
  expect(session.pullDetail()?.comments.value?.items).toEqual(issueCommentsFixture)
})

for (const outcome of ["fails", "returns the old thread"]) {
  test(`a confirmed thread reply stays visible when an overlapping PR refresh ${outcome}`, async () => {
    const write = deferred<typeof reply>()
    const read = deferred<PullRequestDetail>()
    let loads = 0
    const session = await setup({
      pull: async () => (++loads === 1 ? pull() : read.promise),
      pullContext: async () => replyContext,
      postReviewReply: async () => write.promise,
    })
    const posting = session.postReviewReply!(421, replyThread.id, reply.body)
    const refreshing = session.loadPull(421, { force: true })
    write.resolve(reply)
    await posting
    expect(session.pullDetail()?.context.status).toBe("loading")
    expect(session.pullDetail()?.context.value?.threads[0]?.comments).toEqual([root, reply])
    if (outcome === "fails") read.reject(new Error("Offline"))
    else read.resolve(pull())
    await refreshing
    expect(session.pullDetail()?.resource.status).toBe(outcome === "fails" ? "error" : "ready")
    expect(session.pullDetail()?.context.value?.threads[0]?.comments).toEqual([root, reply])
    expect(loads).toBe(2)
  })
}

test("an overlapping thread read keeps confirmed replies without overriding server updates or resurrecting threads", async () => {
  const edited = { ...reply, body: "Edited on GitHub" }
  for (const [returned, expected] of [
    [[root], [root, reply]],
    [
      [root, edited],
      [root, edited],
    ],
    [undefined, undefined],
  ] as const) {
    const write = deferred<typeof reply>()
    const read = deferred<PullContext>()
    let loads = 0
    const session = await setup({
      pullContext: async () => (++loads === 1 ? replyContext : read.promise),
      postReviewReply: async () => write.promise,
    })
    const posting = session.postReviewReply!(421, replyThread.id, reply.body)
    const refreshing = session.retryPullContext()
    write.resolve(reply)
    await posting
    read.resolve({ ...replyContext, threads: returned ? [{ ...replyThread, isResolved: true, comments: [...returned] }] : [] })
    await refreshing
    expect(session.pullDetail()?.context.value?.threads).toEqual(
      expected ? [{ ...replyThread, isResolved: true, comments: [...expected] }] : [],
    )
    expect(loads).toBe(2)
  }
})

test("a reply that changed the thread without being published as written reloads the thread", async () => {
  let reads = 0
  const session = await setup({
    pullContext: async () => ({
      ...pullContextFixture,
      threads: [
        {
          kind: "review-thread",
          id: "thread",
          path: "example.ts",
          isResolved: false,
          isOutdated: false,
          canReply: true,
          comments: reads++ ? [root, { ...root, id: "earlier", replyToId: root.id }] : [root],
        },
      ],
    }),
    postReviewReply: async () => {
      throw new ReviewThreadChangedError("Your earlier reply is already on this thread.")
    },
  })
  await expect(session.postReviewReply!(421, "thread", "Edited reply")).rejects.toThrow("earlier reply")
  await Bun.sleep(0)
  expect(session.pullDetail()?.context.value?.threads[0]?.comments.map((item) => item.id)).toEqual(["root", "earlier"])
})
