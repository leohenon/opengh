import { createHash } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { atomicPrivateWrite, readPrivateJson } from "../filesystem"
import type { ReviewThreadComment } from "../models"
import { configDirectory } from "../paths"
import { boolean, comment, commentFields, object, optionalText, text } from "./pull-context"
import type { RepositoryTarget } from "./repository-target"
import { MAX_AUTOMATIC_PAGES } from "./request-budget"
import {
  GitHubApiError,
  GitHubRequestNotSentError,
  githubTransport,
  isDefiniteRejection,
  REQUEST_TIMEOUT_MS,
  type GitHubTransport,
} from "./transport"

export class ReviewReplyUncertainError extends Error {}
export class ReviewThreadChangedError extends Error {}

const REPLY_SETTLE_MS = 15_000
const READ_LAG_MS = 3_000
const answered = (error: unknown) => error instanceof GitHubApiError && error.status === 200

type Attempt = { body: string; viewerId?: string; login: string; known: readonly string[]; whole: boolean; settles: number }
function parseAttempt(value: unknown): Attempt | undefined {
  if (value === undefined) return
  const attempt = value as Attempt | null
  if (
    attempt &&
    typeof attempt === "object" &&
    typeof attempt.body === "string" &&
    (attempt.viewerId === undefined || (typeof attempt.viewerId === "string" && attempt.viewerId.trim())) &&
    typeof attempt.login === "string" &&
    attempt.login.trim() &&
    Array.isArray(attempt.known) &&
    attempt.known.every((id) => typeof id === "string") &&
    typeof attempt.whole === "boolean" &&
    Number.isFinite(attempt.settles)
  )
    return attempt
  throw new Error("Cannot verify the saved review reply attempt.")
}

export type ReviewReplyAttemptStorage = {
  load(key: string): Promise<unknown>
  save(key: string, attempt: unknown): Promise<void>
  remove(key: string): Promise<void>
}
export function createReviewReplyAttemptStorage(directory = join(configDirectory(), "review-reply-attempts")): ReviewReplyAttemptStorage {
  const pathFor = (key: string) => join(directory, `${createHash("sha256").update(key).digest("hex")}.json`)
  return {
    async load(key) {
      try {
        return await readPrivateJson(pathFor(key), { maxBytes: 1024 * 1024 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return
        throw error
      }
    },
    save: (key, attempt) => atomicPrivateWrite(pathFor(key), JSON.stringify(attempt) + "\n"),
    remove: (key) => rm(pathFor(key), { force: true }),
  }
}

export function createGitHubReviewReplies(
  transport: GitHubTransport,
  options: { now?: () => number; wait?: (ms: number) => Promise<void>; storage?: ReviewReplyAttemptStorage } = {},
) {
  const now = options.now ?? Date.now
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let storage = options.storage
  const store = () => (storage ??= createReviewReplyAttemptStorage())
  const attempts = new Map<string, Attempt>()
  const remember = async (key: string, attempt: Attempt) => {
    attempts.set(key, attempt)
    await store()
      .save(key, attempt)
      .catch(() => {})
  }
  const forget = async (key: string) => {
    attempts.delete(key)
    await store()
      .remove(key)
      .catch(() => {})
  }
  const recorded = async (key: string) => attempts.get(key) ?? parseAttempt(await store().load(key))
  const posting = new Set<string>()
  const request = async (query: string, variables: Record<string, string>) => {
    if (!transport.graphql) throw new Error("Review replies require GitHub GraphQL access.")
    const response = object(await transport.graphql<unknown>(query, variables))
    if (response.errors != null) {
      if (!Array.isArray(response.errors)) throw new Error("Invalid GitHub errors response.")
      if (response.errors.length)
        throw new Error(response.errors.map((error) => optionalText(object(error).message) || "GitHub request failed.").join("; "))
    }
    return object(response.data)
  }
  const replyFields = `${commentFields} author { ... on Node { id } } state`
  const threadReply = (value: unknown) => {
    const node = object(value)
    return {
      reply: comment(node),
      authorId: node.author == null ? undefined : optionalText(object(node.author).id),
      hidden: text(node.state) === "PENDING",
    }
  }
  const commentPage = `nodes { ${replyFields} } pageInfo { hasPreviousPage startCursor }`
  const comments = (value: unknown, limit: number) => {
    const connection = object(value)
    const nodes = connection.nodes
    const info = object(connection.pageInfo)
    if (!Array.isArray(nodes) || nodes.length > limit) throw new Error("GitHub did not return the review thread's comments.")
    return { nodes: nodes as unknown[], previous: boolean(info.hasPreviousPage) ? text(info.startCursor) : undefined }
  }
  const snapshot = async (repository: RepositoryTarget, number: number, id: string, known?: ReadonlySet<string>) => {
    const data = await request(
      `query ReviewReplyThread($id: ID!) {
      viewer { id login }
      node(id: $id) { ... on PullRequestReviewThread {
        id viewerCanReply pullRequest { number repository { id } reviews(first: 1, states: PENDING) { nodes { id } } }
        root: comments(first: 1) { nodes { id } }
        comments(last: 25) { ${commentPage} }
      } }
    }`,
      { id },
    )
    const viewer = object(data.viewer)
    const viewerId = text(viewer.id),
      login = text(viewer.login)
    if (!viewerId.trim() || !login.trim()) throw new Error("Cannot verify the GitHub account for this reply.")
    const thread = object(data.node)
    const pull = object(thread.pullRequest)
    if (thread.id !== id || pull.number !== number || object(pull.repository).id !== repository.nodeId)
      throw new Error("Review thread does not belong to this pull request.")
    const roots = object(thread.root).nodes
    const pending = object(pull.reviews).nodes
    let { nodes, previous } = comments(thread.comments, 25)
    if (!Array.isArray(roots) || roots.length !== 1 || !nodes.length || !Array.isArray(pending))
      throw new Error("GitHub did not return the review thread's comments.")
    for (let pages = 1; known && previous && !nodes.some((node) => known.has(text(object(node).id))); pages++) {
      if (pages >= MAX_AUTOMATIC_PAGES) throw new Error("The review thread has too many new comments to check.")
      const page = await request(
        `query ReviewReplyThreadPage($id: ID!, $before: String!) {
          viewer { id }
          node(id: $id) { ... on PullRequestReviewThread { comments(last: 100, before: $before) { ${commentPage} } } }
        }`,
        { id, before: previous },
      )
      if (object(page.viewer).id !== viewerId) throw new Error("The GitHub account changed while checking the reply.")
      const older = comments(object(page.node).comments, 100)
      nodes = [...older.nodes, ...nodes]
      previous = older.nodes.length ? older.previous : undefined
    }
    return {
      viewerId,
      login,
      root: text(object(roots[0]).id),
      comments: nodes.map(threadReply),
      whole: previous === undefined,
      pendingReview: pending.length > 0,
      canReply: boolean(thread.viewerCanReply),
    }
  }
  type Thread = Awaited<ReturnType<typeof snapshot>>
  const reconcile = (attempt: Attempt, current: Thread, viewerId: string) => {
    if (current.viewerId !== viewerId) throw new Error("The GitHub account changed while checking the reply.")
    const known = new Set(attempt.known)
    const boundary = current.comments.findLastIndex(({ reply }) => known.has(reply.id))
    if (boundary < 0 && !(attempt.whole && current.whole)) return
    const candidates = current.comments.slice(boundary + 1).filter(({ reply }) => reply.body === attempt.body)
    const mine = candidates.filter(({ authorId }) => authorId === current.viewerId)
    if (!attempt.viewerId && mine.length !== candidates.length) return
    const match = mine.find(({ hidden }) => !hidden) ?? mine[0]
    if (match) return match
    if (candidates.every(({ authorId }) => authorId?.trim())) return "absent" as const
  }
  const settle = async (attempt: Attempt, viewerId: string, read: () => Promise<Thread>) => {
    let failure: unknown
    const readStartedAt = now()
    let thread = await read().catch((error) => {
      failure = error
      return undefined
    })
    if (readStartedAt < attempt.settles && (!thread || reconcile(attempt, thread, viewerId) === "absent")) {
      const remaining = attempt.settles - now()
      if (remaining > 0) await wait(remaining)
      thread = await read()
    }
    if (!thread) throw failure
    return { thread, found: reconcile(attempt, thread, viewerId) }
  }
  const published = ({ reply, hidden }: { reply: ReviewThreadComment; hidden: boolean }) => {
    if (hidden)
      throw new ReviewThreadChangedError(
        "Your reply was added to your pending review. It stays hidden until you submit that review on GitHub.",
      )
    return reply
  }
  return async (repository: RepositoryTarget, number: number, id: string, body: string): Promise<ReviewThreadComment> => {
    if (!id.trim() || !body.trim()) throw new Error("A review thread and a non-empty reply are required.")
    const threadKey = `${repository.id}:${number}:${id}`
    if (posting.has(threadKey)) throw new Error("A reply is already being posted to this thread.")
    posting.add(threadKey)
    try {
      const unconfirmed = (cause?: unknown) =>
        new ReviewReplyUncertainError(
          `Your reply may already be on GitHub. Check the thread before trying again.${cause instanceof Error ? ` ${cause.message}` : ""}`,
        )
      const read = (known?: readonly string[]) => snapshot(repository, number, id, known && new Set(known))
      const load = (key: string) =>
        recorded(key).catch((error) => {
          throw unconfirmed(error)
        })
      const old = await load(threadKey)
      const prefix = `${JSON.stringify(threadKey)}:`
      let before = await read().catch((error) => {
        if (old || [...attempts.keys()].some((key) => key.startsWith(prefix))) throw unconfirmed(error)
        throw new GitHubRequestNotSentError(error instanceof Error ? error.message : String(error))
      })
      const viewerId = before.viewerId
      const key = prefix + viewerId
      for (const savedKey of [key, threadKey]) {
        const earlier = savedKey === threadKey ? old : await load(savedKey)
        if (!earlier) continue
        const legacy = savedKey === threadKey && earlier.viewerId === undefined
        if (legacy ? earlier.login.toLowerCase() !== before.login.toLowerCase() : earlier.viewerId !== viewerId)
          throw new ReviewReplyUncertainError(
            "Cannot verify the account for the saved reply. Check the thread on GitHub; no reply was sent.",
          )
        const { thread, found } = await settle(earlier, viewerId, () => read(earlier.known)).catch((error) => {
          throw unconfirmed(error)
        })
        if (!found) throw unconfirmed()
        if (legacy && found === "absent")
          throw new ReviewReplyUncertainError(
            "The saved reply has only a login, not an account ID. Check the thread and reply on GitHub if needed; nothing was resent.",
          )
        await forget(savedKey)
        if (found !== "absent") {
          const reply = published(found)
          if (body === earlier.body) return reply
          throw new ReviewThreadChangedError("Your earlier reply is already on this thread. Send again to add this one as another reply.")
        }
        before = thread
      }
      if (!before.canReply) throw new Error("GitHub does not allow you to reply to this review thread.")
      // GitHub would add the reply to that review and report success while nobody else can see it.
      if (before.pendingReview) throw new Error("Finish your pending review on GitHub before replying to this thread.")
      const known = before.comments.map(({ reply }) => reply.id)
      const attempt = {
        body,
        viewerId,
        login: before.login,
        known,
        whole: before.whole,
        settles: now() + REQUEST_TIMEOUT_MS + REPLY_SETTLE_MS,
      }
      await remember(key, attempt)
      let failure: unknown
      try {
        const data = await request(
          `mutation ReplyToReviewThread($id: ID!, $body: String!) {
          addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) {
            comment { ${replyFields} }
          }
        }`,
          { id, body },
        )
        const confirmed = threadReply(object(data.addPullRequestReviewThreadReply).comment)
        const { reply } = confirmed
        if (
          !reply.id ||
          known.includes(reply.id) ||
          reply.replyToId !== before.root ||
          reply.body !== body ||
          confirmed.authorId !== viewerId
        )
          throw new Error("GitHub returned an unexpected reply.")
        await forget(key)
        return published(confirmed)
      } catch (error) {
        if (isDefiniteRejection(error) || error instanceof ReviewThreadChangedError) {
          await forget(key)
          throw error
        }
        failure = error
      }
      const failed = { ...attempt, settles: now() + (answered(failure) ? READ_LAG_MS : REPLY_SETTLE_MS) }
      await remember(key, failed)
      const settled = await settle(failed, viewerId, () => read(known)).catch(() => undefined)
      if (!settled?.found) throw unconfirmed(failure)
      await forget(key)
      if (settled.found === "absent") throw failure
      return published(settled.found)
    } finally {
      posting.delete(threadKey)
    }
  }
}

export const postGitHubReviewReply = createGitHubReviewReplies(githubTransport)
