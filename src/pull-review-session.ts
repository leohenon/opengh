import { createHash, randomUUID } from "node:crypto"
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import { join } from "node:path"
import { createSignal } from "solid-js"
import { configDirectory } from "./paths"
import { createGitHubReviews, validateReviewAnchor, validateReviewDraft } from "./github/reviews"
import { GitHubApiError, GitHubRequestNotSentError, type GitHubTransport } from "./github/transport"
import type { PullReviewSession, ReviewDraft, ReviewEligibility, ReviewSessionState } from "./review-types"

export type ReviewDraftScope = Pick<ReviewDraft, "accountId" | "repository" | "number">
export type ReviewDraftStorage = {
  load(scope: ReviewDraftScope): Promise<unknown | undefined>
  // Releasing a submission marker requires a definite rejection or a known-unsent request.
  save(draft: ReviewDraft, rejected?: ReviewDraft): Promise<void>
  remove(draft: ReviewDraft): Promise<void>
}
export type PullReviewSessionOptions = { transport?: GitHubTransport; storage?: ReviewDraftStorage }
const scopeKey = (scope: ReviewDraftScope) => `${scope.accountId}/${scope.repository.toLowerCase()}/${scope.number}`
function parsedDraft(value: unknown, scope: ReviewDraftScope): ReviewDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unreadable review draft; existing file was not changed.")
  const draft = value as ReviewDraft
  validateReviewDraft(draft)
  if (scopeKey(draft) !== scopeKey(scope)) throw new Error("Review draft belongs to another account or pull request.")
  // Whitelist persisted fields: no authentication state or arbitrary API data.
  return { accountId: draft.accountId, repository: draft.repository, number: draft.number, headSha: draft.headSha,
    ...(draft.baseSha === undefined ? {} : { baseSha: draft.baseSha }),
    body: draft.body, event: draft.event, comments: draft.comments.map(c => ({ id: c.id, path: c.path, line: c.line, side: c.side,
      ...(c.startLine === undefined ? {} : { startLine: c.startLine, startSide: c.startSide }), body: c.body })),
    ...(draft.submission ? { submission: { startedAt: draft.submission.startedAt, reviewIds: [...draft.submission.reviewIds] } } : {}) }
}
// Shared per-path serialization also covers multiple session/storage instances.
const diskQueues = new Map<string, Promise<unknown>>()
export function createReviewDraftStorage(directory = join(configDirectory(), "review-drafts")): ReviewDraftStorage {
  const pathFor = (scope: ReviewDraftScope) => join(directory, `${createHash("sha256").update(scopeKey(scope)).digest("hex")}.json`)
  const markerPath = (scope: ReviewDraftScope) => `${pathFor(scope)}.submission`
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  function unmarked(draft: ReviewDraft): ReviewDraft {
    const result = { ...draft }
    delete result.submission
    return result
  }
  async function read(scope: ReviewDraftScope, path = pathFor(scope)) {
    try {
      const text = await readFile(path, "utf8")
      if (text.length > 8 * 1024 * 1024) throw new Error("Review draft is too large.")
      return parsedDraft(JSON.parse(text), scope)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw new Error(`Cannot read review draft; file will not be overwritten: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  function serialized<T>(scope: ReviewDraftScope, operation: () => Promise<T>): Promise<T> {
    const path = pathFor(scope)
    const next = (diskQueues.get(path) ?? Promise.resolve()).catch(() => {}).then(operation)
    diskQueues.set(path, next)
    void next.finally(() => { if (diskQueues.get(path) === next) diskQueues.delete(path) }).catch(() => {})
    return next
  }
  async function readMarker(scope: ReviewDraftScope) {
    const marker = await read(scope, markerPath(scope))
    if (marker && !marker.submission) throw new Error("Invalid review submission marker; file was not changed.")
    return marker
  }
  async function syncDirectory() {
    const dir = await open(directory, "r")
    try { await dir.sync() } finally { await dir.close() }
  }
  async function publish(path: string, draft: ReviewDraft, exclusive = false) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      const file = await open(temp, "wx", 0o600)
      try { await file.writeFile(JSON.stringify(draft)); await file.sync() } finally { await file.close() }
      if (exclusive) await link(temp, path)
      else await rename(temp, path)
    } finally { await unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error }) }
  }
  async function clearMarker(draft: ReviewDraft) {
    if (!same(await readMarker(draft), draft)) throw new Error("Stored review submission changed; it was not cleared.")
    await unlink(markerPath(draft))
    await syncDirectory()
  }
  return {
    load: scope => serialized(scope, async () => await readMarker(scope) ?? await read(scope)),
    save: (draft, rejected) => serialized(draft, async () => {
      const clean = parsedDraft(draft, draft)
      const marker = await readMarker(draft)
      const existing = await read(draft) // Never overwrite corrupt data, including the underlying draft.
      if (rejected) {
        const owned = parsedDraft(rejected, draft)
        if (clean.submission || !owned.submission || !same(unmarked(owned), clean)
          || !same(marker ?? existing, owned)) throw new Error("Stored review submission changed; it was not released.")
        if (marker) {
          // The original body remains on disk throughout rejection handling.
          // Preserve edits from another process, and restore only if missing.
          if (!existing) await publish(pathFor(draft), clean, true)
          await syncDirectory()
          await clearMarker(owned)
        } else {
          // Legacy versions stored their marker in the editable draft itself.
          await publish(pathFor(draft), clean)
          await syncDirectory()
        }
        return
      }
      if (marker || existing?.submission) throw new Error("An unresolved review submission is stored; check GitHub before changing it.")
      if (!clean.submission) {
        await publish(pathFor(draft), clean)
        return
      }
      const original = unmarked(clean)
      if (!same(existing, original)) throw new Error("Stored review draft changed; submission was not started.")
      // A separate, exclusively published marker survives crashes without being
      // a stale lock: load() always exposes it for reconciliation.
      await publish(markerPath(draft), clean, true)
      try {
        await syncDirectory()
        // Another process may have completed a submission after our first read.
        if (!same(await read(draft), original)) throw new Error("Stored review draft changed; submission was not started.")
      } catch (error) {
        await clearMarker(clean)
        throw error
      }
    }),
    remove: draft => serialized(draft, async () => {
      const clean = parsedDraft(draft, draft)
      const marker = await readMarker(draft)
      const existing = await read(draft)
      if (marker) {
        if (!same(marker, clean)) throw new Error("Stored review submission changed; it was not cleared.")
        // Clear the submitted body before releasing the exclusive marker, but
        // retain any different draft written concurrently by another process.
        if (same(existing, unmarked(clean))) await unlink(pathFor(draft))
        await syncDirectory()
        await clearMarker(clean)
        return
      }
      if (!existing) return
      if (!same(existing, clean)) throw new Error("Stored review draft changed; it was not cleared.")
      await unlink(pathFor(draft)) // Also handles legacy marked drafts.
      await syncDirectory()
    }),
  }
}
const uncertainMessage = "Submission may already exist. Check GitHub; automatic retry is blocked until the exact submitted review can be confirmed."
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const blank = (e: ReviewEligibility): ReviewDraft => ({ accountId: e.accountId, repository: e.repository, number: e.number,
  headSha: e.headSha, baseSha: e.baseSha, body: "", event: "COMMENT", comments: [] })

export function createPullReviewSession(options: PullReviewSessionOptions = {}): PullReviewSession {
  const api = createGitHubReviews(options.transport)
  const storage = options.storage ?? createReviewDraftStorage()
  const [state, setState] = createSignal<ReviewSessionState>({ status: "idle" })
  let generation = 0
  let queue = Promise.resolve()
  let persistenceError: unknown
  let busy = false
  function schedule(draft: ReviewDraft) {
    const token = generation
    queue = queue.catch(() => {}).then(() => storage.save(draft)).then(() => { persistenceError = undefined }, error => {
      persistenceError = error
      if (token === generation) setState(s => ({ ...s, message: `Draft was not saved: ${message(error)}` }))
    })
  }
  async function flush() {
    await queue
    if (persistenceError) throw persistenceError
  }
  function edit(transform: (draft: ReviewDraft) => ReviewDraft) {
    const current = state()
    if (!current.draft || busy || current.status === "loading" || current.draft.submission) {
      const error = new Error(current.draft?.submission ? uncertainMessage : "Review draft is not available for editing right now.")
      setState({ ...current, message: error.message })
      throw error
    }
    try {
      const draft = transform(current.draft)
      validateReviewDraft(draft)
      setState({ ...current, draft, status: "ready", message: undefined })
      schedule(draft)
    } catch (error) { setState({ ...current, message: message(error) }); throw error }
  }
  async function confirm(draft: ReviewDraft, token: number, response?: unknown) {
    if (!api.confirmedResponse(draft, response) && !await api.reconcile(draft)) return false
    try { await storage.remove(draft) }
    catch (error) {
      if (token === generation) setState(s => ({ ...s, status: "error", uncertain: true,
        message: `GitHub confirmed this review, but local draft cleanup failed: ${message(error)}. Do not resubmit; reopen Review to retry cleanup.` }))
      return true
    }
    if (token === generation) setState(s => ({ ...s, status: "ready", draft: s.eligibility ? blank(s.eligibility) : undefined,
      uncertain: false, message: "Review submitted." }))
    return true
  }
  let opening: { key: string; promise: Promise<void> } | undefined
  async function loadReview(repository: string, number: number) {
    const token = ++generation
    // Only a different target or a retry needs to lock editing and fetch again.
    setState(s => ({ ...s, status: "loading" }))
    try { await flush() } catch (error) {
      if (token === generation) setState(s => ({ ...s, status: "error", message: `Draft was not saved: ${message(error)}` }))
      return
    }
    if (busy || token !== generation) return
    setState({ status: "loading" })
    try {
      const eligibility = await api.eligibility(repository, number)
      const loaded = await storage.load(eligibility)
      const draft = loaded === undefined ? blank(eligibility) : parsedDraft(loaded, eligibility)
      if (token !== generation) return
      setState({ status: "ready", eligibility, draft, uncertain: Boolean(draft.submission),
        message: draft.submission ? uncertainMessage : draft.headSha !== eligibility.headSha ? "Pull request head changed; draft preserved. Inspect the new diff before using the current head."
          : draft.comments.length && (!draft.baseSha || draft.baseSha !== eligibility.baseSha) ? "Pull request base changed or is unknown; inline draft preserved. Inspect the latest diff and recreate inline comments." : eligibility.reason })
      if (draft.submission) await confirm(draft, token)
    } catch (error) { if (token === generation) setState(s => ({ ...s, status: "error", message: message(error) })) }
  }
  return {
    state, flush,
    open(repository, number) {
      if (busy) return Promise.resolve()
      const key = `${repository.toLowerCase()}#${number}`
      if (opening?.key === key) return opening.promise
      const current = state()
      if (current.status === "ready" && !current.uncertain && !current.draft?.submission
        && current.draft?.repository.toLowerCase() === repository.toLowerCase() && current.draft.number === number
        && current.eligibility?.repository.toLowerCase() === repository.toLowerCase() && current.eligibility.number === number)
        return Promise.resolve()
      const promise = loadReview(repository, number).finally(() => {
        if (opening?.promise === promise) opening = undefined
      })
      opening = { key, promise }
      return promise
    },
    setBody: body => edit(draft => ({ ...draft, body })),
    setEvent: event => edit(draft => ({ ...draft, event })),
    addComment: (anchor, body) => edit(draft => {
      validateReviewAnchor(anchor)
      return { ...draft, comments: [...draft.comments, { ...anchor, body, id: randomUUID() }] }
    }),
    updateComment: (id, body) => edit(draft => ({ ...draft, comments: draft.comments.map(c => c.id === id ? { ...c, body } : c) })),
    removeComment: id => edit(draft => ({ ...draft, comments: draft.comments.filter(c => c.id !== id) })),
    useCurrentHead: () => edit(draft => {
      if (draft.comments.length) throw new Error("Remove inline comments before explicitly using a changed head; anchors are never relocated.")
      const e = state().eligibility
      if (!e || e.accountId !== draft.accountId) throw new Error("Reopen this pull request with the draft's account first.")
      return { ...draft, headSha: e.headSha, baseSha: e.baseSha }
    }),
    async discard() {
      const current = state(), token = generation
      if (!current.draft || busy) return
      if (current.draft.submission) { setState(s => ({ ...s, message: uncertainMessage })); return }
      busy = true
      try {
        await flush()
        await storage.remove(current.draft)
        if (token === generation) setState(s => ({ ...s, draft: s.eligibility ? blank(s.eligibility) : undefined, message: undefined }))
      } catch (error) { if (token === generation) setState(s => ({ ...s, message: message(error) })) }
      finally { busy = false }
    },
    async submit() {
      const current = state(), token = generation
      if (!current.draft || busy || current.status === "loading") return false
      busy = true
      let draft = current.draft
      setState(s => ({ ...s, status: "submitting", message: undefined }))
      try {
        await flush()
        if (draft.submission) {
          if (await confirm(draft, token)) return true
          throw new Error(uncertainMessage)
        }
        validateReviewDraft(draft, true)
        await api.validateAnchors(draft)
        const reviews = await api.list(draft.repository, draft.number)
        const eligibility = await api.eligibility(draft.repository, draft.number)
        if (token !== generation) return false
        setState(s => ({ ...s, eligibility }))
        if (eligibility.accountId !== draft.accountId) throw new Error("GitHub account changed; draft preserved for its original account. Reopen the pull request.")
        if (eligibility.headSha !== draft.headSha) throw new Error("Pull request head changed; draft preserved. Inspect the latest diff before explicitly using the current head.")
        if (draft.comments.length && (!draft.baseSha || draft.baseSha !== eligibility.baseSha)) throw new Error("Pull request base changed or is unknown; inline draft preserved. Inspect the latest diff and recreate inline comments.")
        if (eligibility.pendingReviewUrl || !(draft.event === "COMMENT" ? eligibility.canComment : draft.event === "APPROVE" ? eligibility.canApprove : eligibility.canRequestChanges)) throw new Error(eligibility.reason ?? "Review permission could not be verified.")
        const marked = { ...draft, submission: { startedAt: new Date().toISOString(), reviewIds: reviews.map(review => review.id) } }
        // Keep the editable state unmarked unless durable publication succeeds.
        schedule(marked)
        await flush()
        draft = marked
        if (token !== generation) return false
        setState(s => ({ ...s, draft, uncertain: true }))
        let response: unknown
        try { response = await api.post(draft) } catch (error) {
          // Only known pre-dispatch failures and explicit HTTP rejections are safe.
          // Timeouts, connection failures, 408 and 5xx remain ambiguous.
          if (error instanceof GitHubRequestNotSentError || (error instanceof GitHubApiError && error.status !== undefined && [400, 401, 403, 404, 409, 422, 429].includes(error.status))) {
            const { submission: _, ...unsent } = draft
            // Atomically release only this rejected marker; never delete the user's draft first.
            await storage.save(unsent, draft)
            draft = unsent
            throw error
          }
        }
        if (await confirm(draft, token, response)) return true
        throw new Error(uncertainMessage)
      } catch (error) {
        if (token === generation) setState(s => ({ ...s, status: "error", draft, uncertain: Boolean(draft.submission), message: message(error) }))
        return false
      } finally {
        busy = false
        if (token === generation && state().status === "submitting") setState(s => ({ ...s, status: "ready" }))
      }
    },
  }
}
