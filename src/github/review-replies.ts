import { createHash } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { atomicPrivateWrite, readPrivateJson } from "../filesystem"
import type { ReviewThreadComment } from "../models"
import { configDirectory } from "../paths"
import { boolean, comment, commentFields, object, optionalText, text } from "./pull-context"
import type { RepositoryTarget } from "./repository-target"
import { MAX_AUTOMATIC_PAGES } from "./request-budget"
import { GitHubApiError, githubTransport, isDefiniteRejection, REQUEST_TIMEOUT_MS, type GitHubTransport } from "./transport"

export class ReviewReplyUncertainError extends Error {}
export class ReviewThreadChangedError extends Error {}

const REPLY_SETTLE_MS = 15_000
const READ_LAG_MS = 3_000
const answered = (error: unknown) => error instanceof GitHubApiError && error.status === 200

type Attempt = { body: string; login: string; known: readonly string[]; whole: boolean; settles: number }
function parseAttempt(value: unknown): Attempt | undefined {
  const attempt = value as Attempt | null | undefined
  return attempt &&
    typeof attempt === "object" &&
    typeof attempt.body === "string" &&
    typeof attempt.login === "string" &&
    Array.isArray(attempt.known) &&
    attempt.known.every((id) => typeof id === "string") &&
    typeof attempt.whole === "boolean" &&
    Number.isFinite(attempt.settles)
    ? { body: attempt.body, login: attempt.login, known: attempt.known, whole: attempt.whole, settles: attempt.settles }
    : undefined
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
  const recorded = async (key: string) =>
    attempts.get(key) ??
    parseAttempt(
      await store()
        .load(key)
        .catch(() => undefined),
    )
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
  const staged = (node: unknown) => text(object(node).state) === "PENDING"
  const commentPage = `nodes { ${commentFields} state } pageInfo { hasPreviousPage startCursor }`
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
      viewer { login }
      node(id: $id) { ... on PullRequestReviewThread {
        id viewerCanReply pullRequest { number repository { id } reviews(first: 1, states: PENDING) { nodes { id } } }
        root: comments(first: 1) { nodes { id } }
        comments(last: 25) { ${commentPage} }
      } }
    }`,
      { id },
    )
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
      const older = comments(
        object(
          (
            await request(
              `query ReviewReplyThreadPage($id: ID!, $before: String!) {
              node(id: $id) { ... on PullRequestReviewThread { comments(last: 100, before: $before) { ${commentPage} } } }
            }`,
              { id, before: previous },
            )
          ).node,
        ).comments,
        100,
      )
      nodes = [...older.nodes, ...nodes]
      previous = older.nodes.length ? older.previous : undefined
    }
    return {
      login: text(object(data.viewer).login),
      root: text(object(roots[0]).id),
      comments: nodes.map(comment),
      staged: new Set(nodes.filter(staged).map((node) => text(object(node).id))),
      whole: previous === undefined,
      pendingReview: pending.length > 0,
      canReply: boolean(thread.viewerCanReply),
    }
  }
  type Thread = Awaited<ReturnType<typeof snapshot>>
  const reconcile = (attempt: Attempt, current: Thread) => {
    const known = new Set(attempt.known)
    const boundary = current.comments.findLastIndex((item) => known.has(item.id))
    if (boundary < 0 && !(attempt.whole && current.whole)) return
    const matches = current.comments
      .slice(boundary + 1)
      .filter((item) => item.body === attempt.body && item.author.toLowerCase() === attempt.login.toLowerCase())
    const reply = matches.find((item) => !current.staged.has(item.id)) ?? matches[0]
    return reply ? { reply, hidden: current.staged.has(reply.id) } : ("absent" as const)
  }
  const settle = async (attempt: Attempt, read: () => Promise<Thread>) => {
    let failure: unknown
    let thread = await read().catch((error) => {
      failure = error
      return undefined
    })
    if ((!thread || reconcile(attempt, thread) === "absent") && attempt.settles > now()) {
      await wait(attempt.settles - now())
      thread = await read()
    }
    if (!thread) throw failure
    return { thread, found: reconcile(attempt, thread) }
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
    const key = `${repository.id}:${number}:${id}`
    if (posting.has(key)) throw new Error("A reply is already being posted to this thread.")
    posting.add(key)
    try {
      const unconfirmed = (cause?: unknown) =>
        new ReviewReplyUncertainError(
          `Your reply may already be on GitHub. Check the thread before trying again.${cause instanceof Error ? ` ${cause.message}` : ""}`,
        )
      const read = (known?: readonly string[]) => snapshot(repository, number, id, known && new Set(known))
      const earlier = await recorded(key)
      let before: Thread
      if (earlier) {
        const { thread, found } = await settle(earlier, () => read(earlier.known)).catch((error) => {
          throw unconfirmed(error)
        })
        if (!found) throw unconfirmed()
        await forget(key)
        if (found !== "absent") {
          const reply = published(found)
          if (body === earlier.body) return reply
          throw new ReviewThreadChangedError("Your earlier reply is already on this thread. Send again to add this one as another reply.")
        }
        before = thread
      } else before = await read()
      if (!before.canReply) throw new Error("GitHub does not allow you to reply to this review thread.")
      // GitHub would add the reply to that review and report success while nobody else can see it.
      if (before.pendingReview) throw new Error("Finish your pending review on GitHub before replying to this thread.")
      const known = before.comments.map((item) => item.id)
      const attempt = { body, login: before.login, known, whole: before.whole, settles: now() + REQUEST_TIMEOUT_MS + REPLY_SETTLE_MS }
      await remember(key, attempt)
      let failure: unknown
      try {
        const data = await request(
          `mutation ReplyToReviewThread($id: ID!, $body: String!) {
          addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) {
            comment { ${commentFields} state }
          }
        }`,
          { id, body },
        )
        const node = object(data.addPullRequestReviewThreadReply).comment
        const reply = comment(node)
        if (
          !reply.id ||
          known.includes(reply.id) ||
          reply.replyToId !== before.root ||
          reply.body !== body ||
          reply.author.toLowerCase() !== before.login.toLowerCase()
        )
          throw new Error("GitHub returned an unexpected reply.")
        await forget(key)
        return published({ reply, hidden: staged(node) })
      } catch (error) {
        if (isDefiniteRejection(error) || error instanceof ReviewThreadChangedError) {
          await forget(key)
          throw error
        }
        failure = error
      }
      const failed = { ...attempt, settles: now() + (answered(failure) ? READ_LAG_MS : REPLY_SETTLE_MS) }
      await remember(key, failed)
      const settled = await settle(failed, () => read(known)).catch(() => undefined)
      if (!settled?.found) throw unconfirmed(failure)
      await forget(key)
      if (settled.found === "absent") throw failure
      return published(settled.found)
    } finally {
      posting.delete(key)
    }
  }
}

export const postGitHubReviewReply = createGitHubReviewReplies(githubTransport)
