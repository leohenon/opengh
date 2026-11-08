import { createHash, randomUUID } from "node:crypto"
import { link, open, rename, unlink } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"
import { cleanupDraftTemporaryFiles } from "../draft-cleanup"
import { configDirectory } from "../paths"
import { ensureTrustedDirectory, readPrivateJson } from "../filesystem"
import type { IssueComment } from "../models"
import { withIssueCommentLock } from "./issue-comment-lock"
import { parseReactions } from "./reactions"
import { repositoryPath, type RepositoryTarget } from "./repository-target"
import { createRequestBudget, MAX_AUTOMATIC_PAGES } from "./request-budget"
import { GitHubApiError, GitHubRequestNotSentError, type GitHubTransport, type RequestOptions } from "./transport"

export type IssueCommentResponse = {
  id: number
  node_id?: string
  user: { id?: number; login: string } | null
  author_association?: string
  body: string | null
  created_at: string
  updated_at: string
  reactions?: unknown
}
export function issueComment(item: IssueCommentResponse): IssueComment {
  return {
    id: item.id,
    ...(typeof item.node_id === "string" && item.node_id.trim() ? { nodeId: item.node_id } : {}),
    author: item.user?.login ?? "ghost",
    authorAssociation: item.author_association ?? "NONE",
    body: item.body ?? "",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    reactions: parseReactions(item.reactions),
  }
}

type CommentInput = { accountId: number; repositoryId: number; number: number; body: string }
export type IssueCommentDraft = { generation: string; withCurrent(publish: () => Promise<void>): Promise<void> }
export type IssueCommentOwner = { pid: number; hostname: string; draftKey?: string; generation?: string }
export type IssueCommentAttempt = { input: CommentInput; commentIds: number[]; nonce: string; baselineCount?: number; owner?: IssueCommentOwner; phase?: "rejected" }
export type IssueCommentConfirmation = (comment: IssueComment, recovered: boolean, commentCount?: number) => void | Promise<void>
export type IssueCommentStorage = {
  load(input: CommentInput): Promise<unknown | undefined>
  save(attempt: IssueCommentAttempt, authorize?: IssueCommentDraft["withCurrent"]): Promise<void>
  claim(attempt: IssueCommentAttempt, draftKey?: string, draft?: IssueCommentDraft, retiring?: boolean): Promise<IssueCommentAttempt>
  update(previous: IssueCommentAttempt, next: IssueCommentAttempt): Promise<void>
  remove(attempt: IssueCommentAttempt, authorize?: IssueCommentDraft["withCurrent"]): Promise<void>
}
const positiveId = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0
// One intent slot across accounts prevents an account switch from bypassing an unresolved attempt.
const fingerprint = (input: CommentInput) => createHash("sha256")
  .update(JSON.stringify([input.repositoryId, input.number, input.body])).digest("hex")
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const uncertain = (detail?: string) => new Error(`Comment may already exist. Check GitHub; another POST is blocked until the exact comment is confirmed.${detail ? ` ${detail}` : ""}`)
const validDraftKey = (key: unknown): key is string => typeof key === "string" && Boolean(key.trim())
  && key.length <= 4096 && !/[\x00-\x1f\x7f-\x9f]/.test(key)
const validGeneration = (generation: unknown): generation is string => validDraftKey(generation) && generation.length <= 256
const currentOwner = (draftKey?: string, generation?: string): IssueCommentOwner => ({ pid: process.pid, hostname: hostname(),
  ...(draftKey === undefined ? {} : { draftKey }), ...(generation === undefined ? {} : { generation }) })
const isCurrentOwner = (owner: IssueCommentOwner) => owner.pid === process.pid && owner.hostname === hostname()
const ownedElsewhere = () => uncertain("Saved attempt belongs to a live or unverifiable opengh process. Retry in the originating process, or exit it before retrying the original draft here; do not delete its marker.")
function checkDraftGuard(draftKey?: string, draft?: IssueCommentDraft) {
  if (draftKey !== undefined && !validDraftKey(draftKey)) throw new Error("Invalid originating comment draft key.")
  if (draft !== undefined && (!draft || !validGeneration(draft.generation) || typeof draft.withCurrent !== "function" || !validDraftKey(draftKey)))
    throw new GitHubRequestNotSentError("Invalid comment draft generation or guard; no comment was sent.")
}
function checkDraft(attempt: IssueCommentAttempt, draftKey?: string, draft?: IssueCommentDraft, retiring = false) {
  checkDraftGuard(draftKey, draft)
  if (attempt.owner && attempt.owner.draftKey !== draftKey)
    throw uncertain("Saved attempt belongs to another draft. Retry the original draft; its marker was not changed.")
  if (!retiring && attempt.owner?.generation !== undefined && attempt.owner.generation !== draft?.generation)
    throw uncertain("Saved attempt belongs to another draft generation. Retry the original draft; its marker was not changed.")
}
function checkMutationOwner(attempt: IssueCommentAttempt) {
  if (attempt.owner && !isCurrentOwner(attempt.owner)) throw ownedElsewhere()
}
function parseAttempt(value: unknown, input: CommentInput): IssueCommentAttempt {
  const attempt = value as IssueCommentAttempt | null
  const saved = attempt?.input, owner = attempt?.owner
  if (!saved || !positiveId(saved.accountId) || !positiveId(saved.repositoryId) || !positiveId(saved.number)
    || typeof saved.body !== "string" || !saved.body.trim() || fingerprint(saved) !== fingerprint(input)
    || typeof attempt?.nonce !== "string" || !attempt.nonce
    || (attempt.phase !== undefined && attempt.phase !== "rejected")
    || (owner !== undefined && (!owner || !positiveId(owner.pid) || typeof owner.hostname !== "string" || !owner.hostname.trim()
      || (owner.draftKey !== undefined && !validDraftKey(owner.draftKey))
      || (owner.generation !== undefined && (!validGeneration(owner.generation) || !validDraftKey(owner.draftKey)))))
    || !Array.isArray(attempt.commentIds) || attempt.commentIds.length > MAX_AUTOMATIC_PAGES * 100
    || attempt.commentIds.some((id, index, ids) => !positiveId(id) || (index > 0 && id <= ids[index - 1]!))
    || (attempt.baselineCount !== undefined && (!Number.isSafeInteger(attempt.baselineCount)
      || attempt.baselineCount < 0 || attempt.baselineCount > attempt.commentIds.length)))
    throw uncertain("Invalid stored attempt; it was not changed.")
  if (saved.accountId !== input.accountId) throw uncertain("Saved attempt belongs to another GitHub account; switch back to that account to check it.")
  return { input: { accountId: saved.accountId, repositoryId: saved.repositoryId, number: saved.number, body: saved.body },
    commentIds: [...attempt.commentIds], nonce: attempt.nonce,
    ...(attempt.baselineCount === undefined ? {} : { baselineCount: attempt.baselineCount }),
    ...(owner === undefined ? {} : { owner: { pid: owner.pid, hostname: owner.hostname,
      ...(owner.draftKey === undefined ? {} : { draftKey: owner.draftKey }),
      ...(owner.generation === undefined ? {} : { generation: owner.generation }) } }),
    ...(attempt.phase === "rejected" ? { phase: "rejected" } : {}) }
}
const diskQueues = new Map<string, Promise<unknown>>()
export function createIssueCommentStorage(directory = join(configDirectory(), "issue-comment-attempts")): IssueCommentStorage {
  const pathFor = (input: CommentInput) => join(directory, `${fingerprint(input)}.json`)
  function serialized<T>(input: CommentInput, run: () => Promise<T>): Promise<T> {
    const path = pathFor(input)
    const next = (diskQueues.get(path) ?? Promise.resolve()).catch(() => {}).then(run)
    diskQueues.set(path, next)
    void next.finally(() => { if (diskQueues.get(path) === next) diskQueues.delete(path) }).catch(() => {})
    return next
  }
  function mutate<T>(input: CommentInput, run: () => Promise<T>): Promise<T> {
    return serialized(input, async () => {
      await ensureTrustedDirectory(directory, true)
      return withIssueCommentLock(pathFor(input), run)
    })
  }
  async function read(input: CommentInput) {
    try {
      return parseAttempt(await readPrivateJson(pathFor(input), { maxBytes: 1024 * 1024 }), input)
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error }
  }
  async function syncDirectory() {
    const dir = await open(directory, "r")
    try { await dir.sync() } finally { await dir.close() }
  }
  async function write(attempt: IssueCommentAttempt, replace = false) {
    const text = JSON.stringify(parseAttempt(attempt, attempt.input))
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("Comment attempt exceeds the storage limit; no comment was sent.")
    cleanupDraftTemporaryFiles(directory)
    const path = pathFor(attempt.input), temp = `${path}.${randomUUID()}.tmp`
    try {
      const file = await open(temp, "wx", 0o600)
      try { await file.writeFile(text); await file.sync() } finally { await file.close() }
      if (replace) await rename(temp, path)
      else await link(temp, path)
      await syncDirectory()
    } finally { await unlink(temp).catch(() => {}) }
  }
  return {
    load: input => serialized(input, () => read(input)),
    save: (attempt, authorize) => mutate(attempt.input, async () => {
      if (attempt.owner?.generation !== undefined && typeof authorize !== "function")
        throw new GitHubRequestNotSentError("Draft generation authorization is required; no comment was sent.")
      // Lock order is body slot, then draft key. Authorization must retain the
      // draft lock through exclusive marker publication and directory fsync.
      if (authorize) await authorize(() => write(attempt))
      else await write(attempt)
    }),
    claim: (attempt, draftKey, draft, retiring = false) => mutate(attempt.input, async () => {
      const expected = parseAttempt(attempt, attempt.input)
      if (JSON.stringify(await read(attempt.input)) !== JSON.stringify(expected))
        throw new Error("Stored comment attempt changed; it was not claimed. Retry the original draft.")
      checkDraft(expected, draftKey, draft, retiring)
      const owner = expected.owner
      if (retiring && (!owner?.generation || !draft || owner.generation === draft.generation))
        throw new GitHubRequestNotSentError("A retired receipt requires a different current draft generation.")
      const attachGeneration = owner !== undefined && owner.generation === undefined && draft !== undefined
      if (owner && isCurrentOwner(owner) && !attachGeneration) {
        if (retiring) await draft!.withCurrent(async () => {})
        return expected
      }
      if (owner && !isCurrentOwner(owner)) {
        if (owner.hostname !== hostname())
          throw uncertain("Saved attempt belongs to another host. Retry in the originating opengh process on that host; do not delete its marker.")
        let dead = false
        try { process.kill(owner.pid, 0) }
        catch (error) { dead = (error as NodeJS.ErrnoException).code === "ESRCH" }
        if (!dead) throw ownedElsewhere()
      } else if (!owner && expected.phase !== "rejected") {
        throw uncertain("This legacy attempt has no process owner; automatic recovery is blocked. Check GitHub and settle the originating draft manually; do not delete its marker.")
      }
      // Ownerless rejected markers prove non-dispatch, not draft identity. They
      // may be cleared, but must not acquire an incoming generation's identity.
      const claimed = parseAttempt({ ...expected, owner: currentOwner(draftKey,
        attachGeneration ? draft!.generation : owner?.generation) }, expected.input)
      if (attachGeneration || retiring) await draft!.withCurrent(() => write(claimed, true))
      else await write(claimed, true)
      return claimed
    }),
    update: (previous, next) => mutate(previous.input, async () => {
      const expected = parseAttempt(previous, previous.input), replacement = parseAttempt(next, previous.input)
      if (replacement.phase !== "rejected" || JSON.stringify({ ...replacement, phase: expected.phase }) !== JSON.stringify(expected))
        throw new Error("Comment attempt update must preserve its identity and record rejection.")
      if (JSON.stringify(await read(previous.input)) !== JSON.stringify(expected))
        throw new Error("Stored comment attempt changed; it was not updated.")
      checkMutationOwner(expected)
      await write(replacement, true)
    }),
    remove: (attempt, authorize) => mutate(attempt.input, async () => {
      const remove = async () => {
        const expected = parseAttempt(attempt, attempt.input), existing = await read(attempt.input)
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(expected))
            throw new Error("Stored comment attempt changed; it was not cleared.")
          checkMutationOwner(expected)
          await unlink(pathFor(attempt.input))
        }
        // Also sync an already-absent marker: a previous unlink's sync may have failed.
        await syncDirectory()
      }
      if (authorize) await authorize(remove)
      else await remove()
    }),
  }
}

function confirmed(attempt: IssueCommentAttempt, value: unknown): IssueComment | undefined {
  if (!value || typeof value !== "object") return
  const comment = value as IssueCommentResponse
  // Only IDs above the verified pre-dispatch baseline can confirm a new comment.
  if (!positiveId(comment.id) || comment.id <= (attempt.commentIds.at(-1) ?? 0)
    || comment.user?.id !== attempt.input.accountId || typeof comment.user.login !== "string" || !comment.user.login.trim()
    || (comment.author_association !== undefined && typeof comment.author_association !== "string")
    || comment.body !== attempt.input.body || typeof comment.created_at !== "string" || !Number.isFinite(Date.parse(comment.created_at))
    || typeof comment.updated_at !== "string" || !Number.isFinite(Date.parse(comment.updated_at))) return
  return issueComment(comment)
}
const busy = new Set<string>()
export function createIssueComments(transport: GitHubTransport, suppliedStorage?: IssueCommentStorage) {
  let storage = suppliedStorage
  let accountId: number | undefined
  // Exact in-process proof survives a failed rejection-state write. A restart
  // without durable proof still treats the old pending marker as uncertain.
  const rejected = new Map<string, IssueCommentAttempt>()
  async function clearRejected(attempt: IssueCommentAttempt, missing = false) {
    const key = fingerprint(attempt.input), next: IssueCommentAttempt = { ...attempt, phase: "rejected" }
    rejected.set(key, attempt)
    try {
      let current = attempt
      if (!missing && attempt.phase !== "rejected") {
        try { await storage!.update(attempt, next); current = next }
        catch { /* An exact removal can still succeed when recording rejection fails. */ }
      }
      rejected.set(key, current)
      await storage!.remove(current)
      rejected.delete(key)
    } catch (error) {
      throw new Error(`Request was rejected or not sent, but its marker could not be cleared: ${message(error)} Retry explicitly when storage is available; no new comment was sent.`)
    }
  }
  async function commentCount(input: Pick<CommentInput, "repositoryId" | "number">, options: RequestOptions) {
    const issue = await transport.json<{ number?: number; comments?: number } | null>(`repositories/${input.repositoryId}/issues/${input.number}`, options)
    if (issue?.number !== input.number || !Number.isSafeInteger(issue.comments) || issue.comments! < 0)
      throw new Error("GitHub did not return a valid conversation comment count.")
    return issue.comments!
  }
  async function acknowledge(attempt: IssueCommentAttempt, comment: IssueComment, recovered: boolean, options: RequestOptions, onConfirmed?: IssueCommentConfirmation) {
    if (onConfirmed) {
      // The caller must durably settle its draft before acknowledging. A failed
      // callback retains the marker and is never treated as a POST failure.
      await onConfirmed(comment, recovered, await commentCount(attempt.input, options))
      await storage!.remove(attempt).catch(() => {})
    }
    return comment
  }
  async function verifyAccount(options: RequestOptions) {
    const viewer = await transport.json<{ id?: number } | null>("user", options)
    if (!positiveId(viewer?.id)) throw new GitHubRequestNotSentError("GitHub account could not be verified; no comment was sent.")
    accountId ??= viewer.id
    if (viewer.id !== accountId) throw new GitHubRequestNotSentError("GitHub account changed; restart with the original account before commenting.")
    return viewer.id
  }
  async function comments(path: string, options: RequestOptions) {
    const result: IssueCommentResponse[] = []
    for (let page = 1; page <= MAX_AUTOMATIC_PAGES; page++) {
      const values = await transport.json<IssueCommentResponse[]>(`${path}?per_page=100&page=${page}`, options)
      if (!Array.isArray(values) || values.length > 100) throw new Error("Invalid GitHub comment listing.")
      options.budget?.consumeItems(values.length)
      for (const value of values) {
        if (!value || !positiveId(value.id) || value.id <= (result.at(-1)?.id ?? 0)) throw new Error("Invalid GitHub comment IDs.")
        result.push(value)
      }
      if (values.length < 100) return result
    }
    throw new Error("Comment lookup exceeded the page limit.")
  }
  async function reconcile(attempt: IssueCommentAttempt, path: string, options: RequestOptions): Promise<IssueComment> {
    if (attempt.baselineCount === undefined && attempt.commentIds.length >= 100)
      throw uncertain("This older attempt has an unverified paginated baseline; automatic recovery is blocked.")
    let found: IssueComment | undefined
    try {
      const values = await comments(path, options)
      await verifyAccount(options)
      found = values.map(value => confirmed(attempt, value)).find(Boolean)
    } catch (error) { throw uncertain(`Lookup failed: ${message(error)}`) }
    if (!found) throw uncertain("No new matching comment was found; this does not prove the request failed.")
    return found
  }
  return async (repository: RepositoryTarget, number: number, body: string, onConfirmed?: IssueCommentConfirmation, draftKey?: string, draft?: IssueCommentDraft): Promise<IssueComment> => {
    const root = repositoryPath(repository), repositoryId = repository.id
    if (!positiveId(number)) throw new Error("Issue number must be a positive safe integer.")
    if (typeof body !== "string" || !body.trim()) throw new Error("Issue comment body must not be blank.")
    checkDraftGuard(draftKey, draft)
    const scope = `${repositoryId}/${number}`, path = `${root}/issues/${number}/comments`
    if (busy.has(scope)) throw new Error("A conversation comment is already being submitted for this issue or pull request.")
    busy.add(scope)
    const budget = createRequestBudget(), options = { budget }
    try {
      if (!transport.mutate) throw new GitHubRequestNotSentError("GitHub transport does not support mutations.")
      const input = { accountId: await verifyAccount(options), repositoryId, number, body }
      storage ??= createIssueCommentStorage()
      let stored: unknown
      try { stored = await storage.load(input) } catch (error) { throw uncertain(`Cannot read the saved attempt: ${message(error)}`) }
      const proof = rejected.get(fingerprint(input))
      if (stored !== undefined) {
        const saved = parseAttempt(stored, input)
        const retiring = saved.owner?.generation !== undefined && draft !== undefined && saved.owner.generation !== draft.generation
        checkDraft(saved, draftKey, draft, retiring)
        const attempt = await storage.claim(saved, draftKey, draft, retiring)
        const rejectedAttempt = attempt.phase === "rejected" || (proof && JSON.stringify(attempt) === JSON.stringify(proof))
        if (retiring) {
          // Clean up the older intent without acknowledging it as the new draft's submission.
          if (!rejectedAttempt) await reconcile(attempt, path, options)
          await storage.remove(attempt, draft!.withCurrent)
          rejected.delete(fingerprint(input))
        } else if (rejectedAttempt) await clearRejected(attempt)
        else return await acknowledge(attempt, await reconcile(attempt, path, options), true, options, onConfirmed)
      } else if (proof) {
        if (proof.owner?.draftKey !== draftKey || proof.owner?.generation !== draft?.generation)
          rejected.delete(fingerprint(input))
        else {
          checkDraft(proof, draftKey, draft)
          await clearRejected(parseAttempt(proof, input), true)
        }
      }
      const baselineCount = await commentCount(input, options)
      const baseline = await comments(path, options)
      // Deletions can shift offset pages past older comments; never publish a short baseline.
      if (baseline.length < baselineCount)
        throw new GitHubRequestNotSentError("Comments changed while establishing the submission baseline. Retry; no comment was sent.")
      const attempt = { input, commentIds: baseline.map(comment => comment.id), nonce: randomUUID(), baselineCount, owner: currentOwner(draftKey, draft?.generation) }
      try { await storage.save(attempt, draft?.withCurrent) }
      catch (error) {
        // A failed fsync may still have published this exact marker, but this
        // call certainly has not dispatched a POST. Never apply that proof to
        // a competing save's different nonce.
        rejected.set(fingerprint(input), attempt)
        throw uncertain(`Attempt could not be saved; no comment was sent by this call: ${message(error)}`)
      }
      let response: unknown, result: IssueComment | undefined
      try {
        try { await verifyAccount(options) }
        catch (error) { throw error instanceof GitHubRequestNotSentError ? error : new GitHubRequestNotSentError(message(error)) }
        response = await transport.mutate(path, "POST", { body }, options)
      } catch (error) {
        if (error instanceof GitHubRequestNotSentError || (error instanceof GitHubApiError && error.status !== undefined
          && [400, 401, 403, 404, 409, 410, 422, 429].includes(error.status))) {
          await clearRejected(attempt)
          throw error
        }
        try { result = await reconcile(attempt, path, options) }
        catch (lookupError) { throw new Error(`${message(lookupError)} Original failure: ${message(error)}`) }
      }
      if (!result) {
        result = confirmed(attempt, response)
        if (!result) result = await reconcile(attempt, path, options)
      }
      // Deliberately outside the POST/reconciliation catch: callback failures
      // propagate unchanged, with neither a second callback nor a second POST.
      return await acknowledge(attempt, result, false, options, onConfirmed)
    } finally { budget.dispose(); busy.delete(scope) }
  }
}
