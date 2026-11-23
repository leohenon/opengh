import { expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createGitHubReviewReplies,
  createReviewReplyAttemptStorage,
  ReviewReplyUncertainError,
  ReviewThreadChangedError,
} from "../src/github/review-replies"
import { GitHubApiError } from "../src/github/transport"

const repository = { id: 1, nodeId: "repo-id", nameWithOwner: "owner/repo" }
const body = "Thanks!\n\nI'll update this."
const root = {
  id: "root",
  author: { login: "reviewer" },
  authorAssociation: "MEMBER",
  body: "Could we simplify this?",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  url: "https://github.com/owner/repo/pull/42#discussion_r1",
  state: "SUBMITTED",
}

type Failure = "lost" | "unsent" | "partial" | "rejected" | "answered"
function harness(
  options: {
    canReply?: boolean
    repoId?: string
    pendingReview?: boolean
    staged?: boolean
    failure?: Failure
    cut?: boolean
    lag?: number
  } = {},
) {
  let now = 0
  let waited = 0
  let comments = [root]
  let failure = options.failure
  let down = false
  let lag = 0
  let whileWaiting: (() => void) | undefined
  const sent: string[] = []
  const reads = { older: 0 }
  const stored = new Map<string, unknown>()
  const replyWith = (text: string, id: string) => ({
    ...root,
    id,
    author: { login: "author" },
    body: text,
    replyTo: { id: "root" },
    state: options.staged ? "PENDING" : "SUBMITTED",
  })
  const transport = {
    async json() {
      throw new Error("Unexpected REST request")
    },
    async text() {
      throw new Error("Unexpected text request")
    },
    async graphql<T>(query: string, variables: Record<string, string>) {
      const { id } = variables
      expect(id).toBe("thread-id")
      if (query.startsWith("mutation")) {
        sent.push(variables.body!)
        expect(query).toContain("pullRequestReviewThreadId: $id")
        const reply = replyWith(variables.body!, `reply-${sent.length}`)
        if (failure) {
          down = !!options.cut
          lag = options.lag ?? 0
        }
        if (failure === "unsent") throw new Error("Connection lost")
        if (failure === "rejected") throw new GitHubApiError("graphql", "Body is too long", 200)
        if (failure === "partial")
          return { errors: [{ message: "Partial response" }], data: { addPullRequestReviewThreadReply: { comment: reply } } } as T
        comments = [...comments, reply]
        if (failure === "lost") throw new Error("Connection lost")
        if (failure === "answered") throw new GitHubApiError("graphql", "Something went wrong", 200)
        return { data: { addPullRequestReviewThreadReply: { comment: reply } } } as T
      }
      if (down) throw new Error("Offline")
      const visible = lag > 0 && !variables.before ? (lag--, comments.slice(0, -1)) : comments
      const page = (end: number, size: number) => {
        const start = Math.max(0, end - size)
        return { nodes: visible.slice(start, end), pageInfo: { hasPreviousPage: start > 0, startCursor: String(start) } }
      }
      if (variables.before !== undefined) {
        reads.older++
        expect(query).toContain("comments(last: 100, before: $before)")
        return { data: { node: { comments: page(Number(variables.before), 100) } } } as T
      }
      expect(query).toContain("viewerCanReply")
      expect(query).toContain("reviews(first: 1, states: PENDING)")
      return {
        data: {
          viewer: { id: "viewer", login: "author" },
          node: {
            id,
            viewerCanReply: options.canReply ?? true,
            pullRequest: {
              number: 42,
              repository: { id: options.repoId ?? repository.nodeId },
              reviews: { nodes: options.pendingReview ? [{ id: "pending-review" }] : [] },
            },
            root: { nodes: [root] },
            comments: page(visible.length, 25),
          },
        },
      } as T
    },
  }
  const create = () =>
    createGitHubReviewReplies(transport, {
      now: () => now,
      wait: async (ms) => {
        now += ms
        waited += ms
        whileWaiting?.()
      },
      storage: {
        load: async (key) => stored.get(key),
        save: async (key, attempt) => void stored.set(key, attempt),
        remove: async (key) => void stored.delete(key),
      },
    })
  let post = create()
  const api = {
    post: (text = body) => post(repository, 42, "thread-id", text),
    sent: () => sent,
    waited: () => waited,
    olderReads: () => reads.older,
    recorded: () => stored.size,
    recover: () => {
      failure = undefined
    },
    online: () => {
      down = false
    },
    restart: () => {
      post = create()
    },
    during: (action: () => void) => {
      whileWaiting = action
    },
    discover: (id = "reply-1", text = body) => {
      comments = [...comments, replyWith(text, id)]
    },
    others: (count: number) => {
      comments = [...comments, ...Array.from({ length: count }, (_, index) => ({ ...root, id: `other-${index}`, replyTo: { id: "root" } }))]
    },
  }
  return api
}

test("posts a reply to the existing review thread, preserving Markdown, and keeps no record of it", async () => {
  const api = harness()
  expect(await api.post()).toMatchObject({ id: "reply-1", replyToId: "root", body, author: "author" })
  expect([api.sent(), api.waited(), api.recorded()]).toEqual([[body], 0, 0])
  expect(await api.post()).toMatchObject({ id: "reply-2" })
  expect(await api.post("Another thought")).toMatchObject({ id: "reply-3", body: "Another thought" })
})

test("a read-only or wrong-repository thread, or one GitHub would hide the reply on, cannot be written to", async () => {
  for (const [options, message] of [
    [{ canReply: false }, "does not allow"],
    [{ repoId: "other-repo" }, "does not belong"],
    [{ pendingReview: true }, "pending review"],
  ] as const) {
    const api = harness(options)
    await expect(api.post()).rejects.toThrow(message)
    expect(api.sent()).toEqual([])
  }
})

test("a lost response is settled at once by the reply on the thread", async () => {
  const api = harness({ failure: "lost" })
  expect(await api.post()).toMatchObject({ id: "reply-1" })
  expect([api.sent().length, api.waited(), api.recorded()]).toEqual([1, 0, 0])
})

test("a failed send is not reported until GitHub has settled: posted if the reply arrives, otherwise not posted", async () => {
  for (const failure of ["unsent", "partial"] as const) {
    const late = harness({ failure })
    late.during(() => late.discover())
    expect(await late.post()).toMatchObject({ id: "reply-1" })
    expect([late.sent().length, late.waited(), late.recorded()]).toEqual([1, 15_000, 0])

    const never = harness({ failure })
    const error = await never.post().catch((error) => error)
    expect(error).not.toBeInstanceOf(ReviewReplyUncertainError)
    expect(error.message).toContain(failure === "unsent" ? "Connection lost" : "Partial response")
    expect([never.sent().length, never.waited(), never.recorded()]).toEqual([1, 15_000, 0])
    never.recover()
    expect(await never.post()).toMatchObject({ id: "reply-2" })
  }
})

test("an error GitHub answered with is a rejection only if the reply stays off the thread", async () => {
  const rejected = harness({ failure: "rejected" })
  const error = await rejected.post().catch((error) => error)
  expect(error).not.toBeInstanceOf(ReviewReplyUncertainError)
  expect(error.message).toContain("Body is too long")
  expect([rejected.sent().length, rejected.waited(), rejected.recorded()]).toEqual([1, 3_000, 0])

  const created = harness({ failure: "answered", lag: 1 })
  expect(await created.post()).toMatchObject({ id: "reply-1" })
  expect([created.sent().length, created.waited(), created.recorded()]).toEqual([1, 3_000, 0])
})

test("when the thread cannot be read the reply stays unconfirmed, and the next send settles it first", async () => {
  const landed = harness({ failure: "lost", cut: true })
  await expect(landed.post()).rejects.toBeInstanceOf(ReviewReplyUncertainError)
  await expect(landed.post()).rejects.toBeInstanceOf(ReviewReplyUncertainError)
  expect([landed.sent().length, landed.recorded()]).toEqual([1, 1])
  landed.online()
  expect(await landed.post()).toMatchObject({ id: "reply-1" })
  expect([landed.sent().length, landed.recorded()]).toEqual([1, 0])

  const missing = harness({ failure: "unsent", cut: true })
  await expect(missing.post()).rejects.toBeInstanceOf(ReviewReplyUncertainError)
  missing.online()
  missing.recover()
  expect(await missing.post()).toMatchObject({ id: "reply-2" })
  expect([missing.sent().length, missing.waited(), missing.recorded()]).toEqual([2, 15_000, 0])
})

test("a connection that comes back while GitHub settles confirms the reply without another send", async () => {
  const api = harness({ failure: "lost", cut: true })
  api.during(() => api.online())
  expect(await api.post()).toMatchObject({ id: "reply-1" })
  expect([api.sent().length, api.waited(), api.recorded()]).toEqual([1, 15_000, 0])
})

test("an unconfirmed reply is still settled first after a restart", async () => {
  const api = harness({ failure: "lost", cut: true })
  await expect(api.post()).rejects.toBeInstanceOf(ReviewReplyUncertainError)
  api.online()
  api.restart()
  expect(await api.post()).toMatchObject({ id: "reply-1" })
  expect([api.sent().length, api.recorded()]).toEqual([1, 0])
})

test("an edited retry does not add a second reply unasked once the first is found on the thread", async () => {
  const api = harness({ failure: "lost", cut: true })
  await expect(api.post()).rejects.toBeInstanceOf(ReviewReplyUncertainError)
  api.online()
  api.recover()
  const error = await api.post("An edited reply").catch((error) => error)
  expect(error).toBeInstanceOf(ReviewThreadChangedError)
  expect(error.message).toContain("earlier reply is already on this thread")
  expect(api.sent()).toEqual([body])
  expect(await api.post("An edited reply")).toMatchObject({ id: "reply-2", body: "An edited reply" })
})

test("an unconfirmed reply is settled by identical replies, and behind a page of newer comments", async () => {
  const twice = harness({ failure: "unsent", cut: true })
  await expect(twice.post()).rejects.toBeInstanceOf(ReviewReplyUncertainError)
  twice.online()
  twice.discover()
  twice.discover("reply-again")
  expect(await twice.post()).toMatchObject({ id: "reply-1" })
  expect(twice.sent().length).toBe(1)

  const buried = harness({ failure: "lost", cut: true })
  await expect(buried.post()).rejects.toBeInstanceOf(ReviewReplyUncertainError)
  buried.online()
  buried.others(30)
  expect(await buried.post()).toMatchObject({ id: "reply-1" })
  expect([buried.sent().length, buried.olderReads()]).toEqual([1, 1])

  const missing = harness({ failure: "unsent", cut: true })
  await expect(missing.post()).rejects.toBeInstanceOf(ReviewReplyUncertainError)
  missing.online()
  missing.others(30)
  missing.recover()
  expect(await missing.post()).toMatchObject({ id: "reply-2" })
  expect(missing.sent().length).toBe(2)
})

test("a reply GitHub staged in a pending review is not reported as posted, with or without a response", async () => {
  for (const failure of [undefined, "lost"] as const) {
    const api = harness({ staged: true, failure })
    const error = await api.post().catch((error) => error)
    expect(error).toBeInstanceOf(ReviewThreadChangedError)
    expect(error.message).toContain("added to your pending review")
    expect([api.sent().length, api.recorded()]).toEqual([1, 0])
  }
})

test("the record of an attempt is one private file per thread, read back by a later session and removed when settled", async () => {
  const parent = mkdtempSync(join(tmpdir(), "opengh-reply-attempts-"))
  try {
    const directory = join(parent, "attempts")
    const storage = createReviewReplyAttemptStorage(directory)
    expect(await storage.load("1:42:thread-id")).toBeUndefined()
    await storage.save("1:42:thread-id", { body })
    await storage.save("1:42:other", { body: "Other" })
    expect(readdirSync(directory)).toHaveLength(2)
    expect(await createReviewReplyAttemptStorage(directory).load("1:42:thread-id")).toEqual({ body })
    await storage.remove("1:42:thread-id")
    expect(await storage.load("1:42:thread-id")).toBeUndefined()
    expect(readdirSync(directory)).toHaveLength(1)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})
