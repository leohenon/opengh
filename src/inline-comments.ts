import { createHash, randomUUID } from "node:crypto"
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import { join } from "node:path"
import { configDirectory } from "./paths"
import { createGitHubReviews, validateReviewDraft } from "./github/reviews"
import { githubTransport, GitHubApiError, GitHubRequestNotSentError, type GitHubTransport } from "./github/transport"
import type { InlineCommentInput, PostedInlineComment, ReviewDraft } from "./review-types"

export type InlineCommentScope = Pick<InlineCommentInput, "accountId" | "repository" | "number">
export type InlineCommentAttempt = { input: InlineCommentInput; commentIds: number[]; failure?: string }
export type InlineCommentStorage = {
  load(input: InlineCommentInput): Promise<unknown | undefined>
  save(attempt: InlineCommentAttempt): Promise<void>
  remove(attempt: InlineCommentAttempt): Promise<void>
  update(previous: InlineCommentAttempt, next: InlineCommentAttempt): Promise<void>
}
export type InlineCommentsOptions = { transport?: GitHubTransport; storage?: InlineCommentStorage }
const key = (s: InlineCommentScope) => `${s.accountId}/${s.repository.toLowerCase()}/${s.number}`
export class InlineCommentUncertainError extends Error {
  readonly checkGitHub = true
  constructor(message: string, readonly retryAllowed: boolean) {
    super(message)
    this.name = "InlineCommentUncertainError"
  }
}
const uncertain = (retryAllowed = false, failure?: string, lookupFailure?: string) => new InlineCommentUncertainError(
  `Comment may already exist. ${retryAllowed ? "No matching comment was found on GitHub. You may explicitly retry, but this does not prove the first request failed." : "GitHub could not be checked completely; retry is blocked."}${failure ? ` Original failure: ${failure}` : " The earlier failure was not recorded."}${lookupFailure ? ` Lookup failed: ${lookupFailure}` : ""}`, retryAllowed)
const fingerprint = (input: InlineCommentInput) => createHash("sha256").update(JSON.stringify(cleanInput(input))).digest("hex")
function draft(input: InlineCommentInput): ReviewDraft {
  return { ...input, event: "COMMENT", body: "", comments: [{ ...input.anchor, id: "inline", body: input.body }] }
}
function cleanInput(input: InlineCommentInput): InlineCommentInput {
  if (!input || typeof input !== "object" || !input.anchor || typeof input.baseSha !== "string" || !/^[a-f0-9]{40,64}$/i.test(input.baseSha)) throw new Error("Invalid inline comment input.")
  validateReviewDraft(draft(input), true)
  const a = input.anchor
  return { accountId: input.accountId, repository: input.repository.toLowerCase(), number: input.number,
    headSha: input.headSha.toLowerCase(), baseSha: input.baseSha.toLowerCase(), body: input.body,
    anchor: { path: a.path, line: a.line, side: a.side, ...(a.startLine === undefined ? {} : { startLine: a.startLine, startSide: a.startSide }) } }
}
function parseAttempt(value: unknown, scope: InlineCommentScope): InlineCommentAttempt {
  if (!value || typeof value !== "object") throw new Error("Unreadable inline comment attempt; check GitHub.")
  const a = value as InlineCommentAttempt
  const input = cleanInput(a.input)
  if (key(input) !== key(scope) || !Array.isArray(a.commentIds) || a.commentIds.length > 10_000
    || a.commentIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid inline comment attempt; it was not overwritten. Check GitHub.")
  if (a.failure !== undefined && typeof a.failure !== "string") throw new Error("Invalid inline comment failure; marker was not overwritten.")
  return { input, commentIds: [...a.commentIds], ...(a.failure === undefined ? {} : { failure: a.failure }) }
}
const storageQueues = new Map<string, Promise<unknown>>()
export function createInlineCommentStorage(directory = join(configDirectory(), "inline-comment-attempts")): InlineCommentStorage {
  const pathFor = (input: InlineCommentInput) => join(directory, `${fingerprint(input)}.json`)
  // Serialize local file operations without a durable lock that could survive a crash.
  function locked<T>(run: () => Promise<T>): Promise<T> {
    const next = (storageQueues.get(directory) ?? Promise.resolve()).catch(() => {}).then(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      return run()
    })
    storageQueues.set(directory, next)
    void next.finally(() => { if (storageQueues.get(directory) === next) storageQueues.delete(directory) }).catch(() => {})
    return next
  }
  async function read(path: string, scope: InlineCommentScope) {
    try {
      const text = await readFile(path, "utf8")
      if (text.length > 1024 * 1024) throw new Error("Inline comment attempt exceeds size limit.")
      return { text, attempt: parseAttempt(JSON.parse(text), scope) }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error }
  }
  async function publish(path: string, text: string, previous?: string) {
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      const file = await open(temp, "wx", 0o600)
      try { await file.writeFile(text); await file.sync() } finally { await file.close() }
      if (previous === undefined) await link(temp, path)
      else {
        if (await readFile(path, "utf8") !== previous) throw new Error("Inline comment attempt changed; it was not overwritten.")
        await rename(temp, path)
      }
      try {
        const dir = await open(directory, "r")
        try { await dir.sync() } finally { await dir.close() }
      } catch (error) {
        if (previous === undefined && await readFile(path, "utf8") === text) await unlink(path)
        throw error
      }
    } finally { await unlink(temp).catch(() => {}) }
  }
  async function exact(attempt: InlineCommentAttempt) {
    const existing = await read(pathFor(attempt.input), attempt.input)
    if (existing && JSON.stringify(existing.attempt) !== JSON.stringify(parseAttempt(attempt, attempt.input))) throw new Error("Inline comment attempt changed; it was not cleared.")
    return existing
  }
  return {
    load: input => locked(async () => {
      const legacyPath = join(directory, `${createHash("sha256").update(key(input)).digest("hex")}.json`)
      const legacy = await read(legacyPath, input)
      if (legacy) {
        const target = pathFor(legacy.attempt.input)
        const existing = await read(target, input)
        if (!existing) await publish(target, legacy.text)
        else if (existing.text !== legacy.text) throw new Error("Legacy inline comment attempt conflicts; neither marker was overwritten.")
        if (await readFile(legacyPath, "utf8") !== legacy.text) throw new Error("Legacy inline comment attempt changed; it was not cleared.")
        await unlink(legacyPath)
      }
      const existing = await read(pathFor(input), input)
      if (existing && fingerprint(existing.attempt.input) !== fingerprint(input)) throw new Error("Inline comment attempt mismatch; it was not overwritten.")
      return existing?.attempt
    }),
    save: attempt => locked(async () => {
      await publish(pathFor(attempt.input), JSON.stringify(parseAttempt(attempt, attempt.input)))
    }),
    remove: attempt => locked(async () => {
      const existing = await exact(attempt)
      if (existing) {
        if (await readFile(pathFor(attempt.input), "utf8") !== existing.text) throw new Error("Inline comment attempt changed; it was not cleared.")
        await unlink(pathFor(attempt.input))
      }
    }),
    update: (previous, next) => locked(async () => {
      if (fingerprint(previous.input) !== fingerprint(next.input)) throw new Error("Inline comment attempt mismatch.")
      const existing = await exact(previous)
      if (!existing) throw new Error("Inline comment attempt disappeared.")
      await publish(pathFor(next.input), JSON.stringify(parseAttempt(next, next.input)), existing.text)
    }),
  }
}
type RemoteComment = { id: number; user?: { id: number }; body: string; commit_id: string; path: string; line: number | null;
  original_line?: number; side: string; start_line?: number | null; original_start_line?: number | null; start_side?: string | null }
function confirmed(input: InlineCommentInput, value: unknown, reconcile = false): PostedInlineComment | undefined {
  if (!value || typeof value !== "object") return
  const c = value as RemoteComment, a = input.anchor
  const outdated = reconcile && c.line === null
  const line = outdated ? c.original_line : c.line
  const start = outdated ? c.original_start_line : c.start_line
  if (!Number.isSafeInteger(c.id) || c.id <= 0 || c.user?.id !== input.accountId || c.commit_id !== input.headSha
    || c.path !== a.path || c.body !== input.body || c.side !== a.side || line !== a.line
    || (start ?? null) !== (a.startLine ?? null) || (c.start_side ?? null) !== (a.startSide ?? null)) return
  return { ...a, id: c.id, body: c.body, url: `https://github.com/${input.repository}/pull/${input.number}#discussion_r${c.id}` }
}
const busy = new Set<string>()
export function createInlineComments(options: InlineCommentsOptions = {}) {
  const transport = options.transport ?? githubTransport, storage = options.storage ?? createInlineCommentStorage()
  const api = createGitHubReviews(transport)
  async function comments(input: InlineCommentInput): Promise<RemoteComment[]> {
    const result: RemoteComment[] = []
    for (let page = 1; page <= 100; page++) {
      const values = await transport.json<RemoteComment[]>(`repos/${input.repository}/pulls/${input.number}/comments?per_page=100&page=${page}`)
      if (!Array.isArray(values) || values.length > 100 || values.some(c => !c || !Number.isSafeInteger(c.id) || c.id <= 0))
        throw new Error("GitHub returned an invalid inline comment listing.")
      result.push(...values)
      if (values.length < 100) return result
    }
    throw new Error("Too many inline comments to verify safely; check GitHub.")
  }
  async function reconcile(attempt: InlineCommentAttempt): Promise<PostedInlineComment | undefined> {
    let found: PostedInlineComment | undefined
    try { found = (await comments(attempt.input)).filter(c => !attempt.commentIds.includes(c.id)).map(c => confirmed(attempt.input, c, true)).find(Boolean) }
    catch (error) { throw uncertain(false, attempt.failure, error instanceof Error ? error.message : String(error)) }
    if (found) await storage.remove(attempt).catch(() => {})
    return found
  }
  return { async post(raw: InlineCommentInput, options?: { retryUnconfirmed?: boolean }): Promise<PostedInlineComment> {
    const input = cleanInput(raw), scope = key(input)
    if (busy.has(scope)) throw new Error("An inline comment is already being posted for this pull request.")
    busy.add(scope)
    try {
      const account = await transport.json<{ id: number }>("user")
      if (account?.id !== input.accountId) throw new Error("GitHub account changed; no comment was sent.")
      const stored = await storage.load(input)
      let retrying: InlineCommentAttempt | undefined
      if (stored !== undefined) {
        const attempt = parseAttempt(stored, input)
        if (fingerprint(attempt.input) !== fingerprint(input)) throw new Error("Inline comment storage returned a different attempt.")
        const found = await reconcile(attempt)
        if (found) return found
        if (!options?.retryUnconfirmed) throw uncertain(true, attempt.failure)
        retrying = attempt
      }
      if (!transport.mutate) throw new GitHubRequestNotSentError("GitHub comment writes are unavailable.")
      await api.validateAnchors(draft(input))
      const baseline = await comments(input)
      if (retrying) {
        // The first request may have appeared while preflight was running.
        const found = baseline.filter(c => !retrying!.commentIds.includes(c.id)).map(c => confirmed(input, c, true)).find(Boolean)
        if (found) { await storage.remove(retrying).catch(() => {}); return found }
      }
      const eligibility = await api.eligibility(input.repository, input.number)
      if (eligibility.accountId !== input.accountId) throw new Error("GitHub account changed; no comment was sent.")
      if (eligibility.headSha !== input.headSha || eligibility.baseSha !== input.baseSha) throw new Error("Pull request head or base changed; inspect the latest diff before commenting.")
      if (!eligibility.canInlineComment) throw new Error("Inline comment permission could not be verified.")
      let attempt: InlineCommentAttempt = { input, commentIds: baseline.map(c => c.id) }
      if (retrying) await storage.update(retrying, attempt)
      else await storage.save(attempt)
      let response: unknown
      const a = input.anchor
      try {
        response = await transport.mutate(`repos/${input.repository}/pulls/${input.number}/comments`, "POST", {
          body: input.body, commit_id: input.headSha, path: a.path, line: a.line, side: a.side,
          ...(a.startLine === undefined ? {} : { start_line: a.startLine, start_side: a.startSide }),
        })
      } catch (error) {
        if (error instanceof GitHubRequestNotSentError || (error instanceof GitHubApiError && error.status !== undefined && [400, 401, 403, 404, 409, 422, 429].includes(error.status))) {
          await storage.remove(attempt).catch(() => {})
          throw error
        }
        const next = { ...attempt, failure: error instanceof Error ? error.message : String(error) }
        try { await storage.update(attempt, next); attempt = next }
        catch { attempt = next }
        const found = await reconcile(attempt)
        if (found) return found
        throw uncertain(true, attempt.failure)
      }
      const result = confirmed(input, response)
      if (!result) {
        const next = { ...attempt, failure: "GitHub returned an invalid comment response after POST." }
        try { await storage.update(attempt, next); attempt = next }
        catch { attempt = next }
        const found = await reconcile(attempt)
        if (found) return found
        throw uncertain(true, attempt.failure)
      }
      // The public write succeeded even when local cleanup fails; retain the marker for reconciliation.
      await storage.remove(attempt).catch(() => {})
      return result
    } finally { busy.delete(scope) }
  } }
}
