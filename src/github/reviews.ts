import type { ReviewAnchor, ReviewDraft, ReviewEligibility } from "../review-types"
import { githubTransport, GitHubRequestNotSentError, type GitHubTransport, type RequestOptions } from "./transport"

import { createRequestBudget, isRequestInterrupted, MAX_AUTOMATIC_PAGES, RequestBudgetLimitError } from "./request-budget"

async function bounded<T>(options: RequestOptions | undefined, run: (options: RequestOptions) => Promise<T>): Promise<T> {
  const owned = options?.budget ? undefined : createRequestBudget(options?.signal)
  try { return await run({ ...options, budget: options?.budget ?? owned }) }
  finally { owned?.dispose() }
}

const MAX_BODY = 65_536
export function validateReviewAnchor(anchor: ReviewAnchor): void {
  if (typeof anchor.path !== "string" || !anchor.path || anchor.path.length > 4096 || /[\x00-\x1f]/.test(anchor.path)
    || !Number.isSafeInteger(anchor.line) || anchor.line <= 0 || !["LEFT", "RIGHT"].includes(anchor.side)
    || (anchor.startLine !== undefined && (!Number.isSafeInteger(anchor.startLine) || anchor.startLine <= 0
      || anchor.startLine > anchor.line || anchor.startSide !== anchor.side))
    || (anchor.startSide !== undefined && anchor.startLine === undefined)) throw new Error("Invalid review comment anchor; ranges must stay on one side.")
}
export function validateReviewDraft(draft: ReviewDraft, submitting = false): void {
  endpoint(draft.repository, draft.number)
  if (!Number.isSafeInteger(draft.accountId) || draft.accountId <= 0 || !/^[a-f0-9]{40,64}$/i.test(draft.headSha)
    || (draft.baseSha !== undefined && (typeof draft.baseSha !== "string" || !/^[a-f0-9]{40,64}$/i.test(draft.baseSha)))
    || typeof draft.body !== "string" || draft.body.length > MAX_BODY || !["COMMENT", "APPROVE", "REQUEST_CHANGES"].includes(draft.event)
    || !Array.isArray(draft.comments) || draft.comments.length > 100) throw new Error("Invalid review draft or review exceeds limits (65,536 characters / 100 comments).")
  const ids = new Set<string>()
  for (const comment of draft.comments) {
    validateReviewAnchor(comment)
    if (typeof comment.id !== "string" || !comment.id || ids.has(comment.id) || typeof comment.body !== "string"
      || !comment.body.trim() || comment.body.length > MAX_BODY) throw new Error("Review comments need a unique ID and nonempty body (at most 65,536 characters).")
    ids.add(comment.id)
  }
  if (submitting && draft.event !== "APPROVE" && !draft.body.trim() && !draft.comments.length) throw new Error("Write a review body or add an inline comment before submitting.")
  if (submitting && draft.event === "REQUEST_CHANGES" && !draft.body.trim()) throw new Error("Request changes requires a review body.")
  if (draft.submission && (typeof draft.submission.startedAt !== "string" || !Number.isFinite(Date.parse(draft.submission.startedAt))
    || !Array.isArray(draft.submission.reviewIds) || draft.submission.reviewIds.some(id => !Number.isSafeInteger(id) || id <= 0))) throw new Error("Invalid review submission marker.")
}
function endpoint(repository: string, number: number) {
  if (!/^[a-z\d][a-z\d-]*\/[a-z\d_.-]+$/i.test(repository) || repository.split("/").some(part => part === "." || part === "..")
    || !Number.isSafeInteger(number) || number <= 0) throw new Error("Invalid review repository or pull request.")
  return `repos/${repository}/pulls/${number}`
}
type RemoteReview = { id: number; user: { id: number } | null; state: string; body: string; commit_id: string; html_url?: string; submitted_at?: string }
type RemoteComment = { path: string; line: number | null; original_line?: number; side: string; start_line?: number | null; original_start_line?: number | null; start_side?: string | null; body: string }
const reviewState = { COMMENT: "COMMENTED", APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED" }

export function createGitHubReviews(transport: GitHubTransport = githubTransport) {
  async function pages<T>(path: string, options: RequestOptions): Promise<T[]> {
    const result: T[] = []
    for (let page = 1; page <= MAX_AUTOMATIC_PAGES; page++) {
      options.signal?.throwIfAborted()
      options.budget?.signal.throwIfAborted()
      const values = await transport.json<T[]>(`${path}?per_page=100&page=${page}`, options)
      if (!Array.isArray(values) || values.length > 100) throw new Error("Invalid paginated GitHub review response.")
      options.budget?.consumeItems(values.length)
      result.push(...values)
      if (values.length < 100) return result
    }
    throw new RequestBudgetLimitError("Too many GitHub review records to verify safely")
  }
  const list = (repository: string, number: number, options?: RequestOptions) => bounded(options, options => pages<RemoteReview>(`${endpoint(repository, number)}/reviews`, options))
  async function eligibilityRead(repository: string, number: number, options: RequestOptions): Promise<ReviewEligibility> {
    const path = endpoint(repository, number)
    const account = await transport.json<{ id: number; login: string }>("user", options)
    if (!Number.isSafeInteger(account?.id) || account.id <= 0 || typeof account.login !== "string" || !account.login.trim()) throw new Error("Cannot verify the current GitHub account.")
    const [pull, repo, reviews] = await Promise.all([
      transport.json<{ head: { sha: string }; base?: { sha: string }; state: string; draft: boolean; locked: boolean; user: { id: number }; html_url: string }>(path, options),
      transport.json<{ archived: boolean; private?: boolean; permissions?: { pull?: boolean; triage?: boolean; push?: boolean; maintain?: boolean; admin?: boolean } }>(`repos/${repository}`, options), list(repository, number, options),
    ])
    options.budget?.consumeItems(3)
    if (!/^[a-f0-9]{40,64}$/i.test(pull?.head?.sha) || !Number.isSafeInteger(pull?.user?.id)) throw new Error("Cannot verify pull request head or author.")
    if (pull.base !== undefined && (typeof pull.base?.sha !== "string" || !/^[a-f0-9]{40,64}$/i.test(pull.base.sha))) throw new Error("Cannot verify pull request base.")
    // Public repositories can restrict approvals to explicitly granted READ or
    // higher access (including organization overrides). Public read visibility
    // alone cannot prove that grant; the restriction itself has no public API.
    let explicitAccess = repo.private === true && repo.permissions?.pull === true
      || repo.permissions?.triage === true || repo.permissions?.push === true
      || repo.permissions?.maintain === true || repo.permissions?.admin === true
    if (!explicitAccess) {
      try {
        // This documented GET returns 204 with an empty body for collaborators.
        explicitAccess = await transport.text(`repos/${repository}/collaborators/${encodeURIComponent(account.login)}`, undefined, options) === ""
      } catch (error) { if (isRequestInterrupted(error, options)) throw error /* Otherwise keep approval disabled. */ }
    }
    if (reviews.some(review => !review || typeof review !== "object" || Array.isArray(review)
      || !Number.isSafeInteger(review.id) || review.id <= 0
      || (review.user !== null && (!review.user || typeof review.user !== "object" || Array.isArray(review.user)
        || !Number.isSafeInteger(review.user.id) || review.user.id <= 0))
      || !["PENDING", "COMMENTED", "APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state))) throw new Error("Cannot verify existing GitHub reviews.")
    const pending = reviews.find(review => review.user?.id === account.id && review.state === "PENDING")
    const active = pull.state === "open" && repo.archived === false
    const access = repo.permissions?.pull === true
    const unlocked = pull.locked === false || (pull.locked === true && (repo.permissions?.push === true || repo.permissions?.maintain === true || repo.permissions?.admin === true))
    const canInlineComment = active && access && unlocked
    const canComment = canInlineComment && !pending
    const canApprove = canComment && pull.draft === false && explicitAccess && pull.user.id !== account.id
    return { accountId: account.id, login: account.login, repository, number, headSha: pull.head.sha, baseSha: pull.base?.sha,
      url: `https://github.com/${repository}/pull/${number}`, canComment, canInlineComment, canApprove, canRequestChanges: canApprove,
      pendingReviewUrl: pending ? `https://github.com/${repository}/pull/${number}/files#pending-review` : undefined,
      reason: pending ? "An existing pending GitHub review must be finished on GitHub first." : !active ? "Reviews require an open pull request in an unarchived repository."
        : !access || !unlocked ? "Review comment permission could not be verified."
          : pull.draft !== false ? "Approval and request changes require a non-draft pull request." : pull.user.id === account.id ? "You cannot approve or request changes on your own pull request."
          : !explicitAccess ? "Approval permission cannot be verified; use GitHub." : undefined }
  }
  async function validateAnchorsRead(draft: ReviewDraft, options: RequestOptions) {
    if (!draft.comments.length) return
    const files = await pages<{ filename: string; patch?: string }>(`${endpoint(draft.repository, draft.number)}/files`, options)
    for (const comment of draft.comments) {
      const patch = files.find(file => file.filename === comment.path)?.patch
      if (!patch) throw new Error(`Cannot verify diff anchor for ${comment.path}; inspect the latest diff.`)
      let left = 0, right = 0, hunk = 0
      const lines = new Map<number, number>()
      for (const row of patch.split("\n")) {
        const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row)
        if (header) { left = Number(header[1]); right = Number(header[2]); hunk++; continue }
        if (!hunk) continue
        if (row.startsWith(" ") || row.startsWith("-")) { if (comment.side === "LEFT") lines.set(left, hunk); left++ }
        if (row.startsWith(" ") || row.startsWith("+")) { if (comment.side === "RIGHT") lines.set(right, hunk); right++ }
      }
      const start = comment.startLine ?? comment.line
      if (!lines.has(comment.line) || lines.get(start) !== lines.get(comment.line)) throw new Error(`Review anchor is outside a single current diff hunk: ${comment.path}:${start}-${comment.line}.`)
    }
  }
  function confirmedResponse(draft: ReviewDraft, review: unknown): boolean {
    if (!review || typeof review !== "object") return false
    const value = review as RemoteReview
    return Number.isSafeInteger(value.id) && value.id > 0 && value.user?.id === draft.accountId
      && value.state === reviewState[draft.event] && (value.body ?? "") === draft.body
      && value.commit_id === draft.headSha && Number.isFinite(Date.parse(value.submitted_at ?? ""))
  }
  async function reconcileRead(draft: ReviewDraft, options: RequestOptions): Promise<boolean> {
    if (!draft.submission) return false
    const reviews = await list(draft.repository, draft.number, options)
    const candidates = reviews.filter(review => !draft.submission!.reviewIds.includes(review.id) && review.user?.id === draft.accountId
      && review.state === reviewState[draft.event] && review.body === draft.body && review.commit_id === draft.headSha && Boolean(review.submitted_at))
    for (const review of candidates) {
      const comments = await pages<RemoteComment>(`${endpoint(draft.repository, draft.number)}/reviews/${review.id}/comments`, options)
      const actual = comments.map(comment => JSON.stringify([comment.path, comment.line ?? comment.original_line, comment.side,
        comment.start_line ?? comment.original_start_line ?? null, comment.start_side ?? null, comment.body])).sort()
      const expected = draft.comments.map(comment => JSON.stringify([comment.path, comment.line, comment.side, comment.startLine ?? null, comment.startSide ?? null, comment.body])).sort()
      if (JSON.stringify(actual) === JSON.stringify(expected)) return true
    }
    return false
  }
  async function post(draft: ReviewDraft, options?: RequestOptions) {
    validateReviewDraft(draft, true)
    if (!transport.mutate) throw new GitHubRequestNotSentError("GitHub review writes are unavailable.")
    return transport.mutate<RemoteReview>(`${endpoint(draft.repository, draft.number)}/reviews`, "POST", {
      commit_id: draft.headSha, event: draft.event, body: draft.body,
      comments: draft.comments.map(comment => ({ path: comment.path, line: comment.line, side: comment.side,
        ...(comment.startLine === undefined ? {} : { start_line: comment.startLine, start_side: comment.startSide }), body: comment.body })),
    }, options)
  }
  return {
    eligibility: (repository: string, number: number, options?: RequestOptions) => bounded(options, options => eligibilityRead(repository, number, options)),
    list,
    validateAnchors: (draft: ReviewDraft, options?: RequestOptions) => bounded(options, options => validateAnchorsRead(draft, options)),
    confirmedResponse,
    reconcile: (draft: ReviewDraft, options?: RequestOptions) => bounded(options, options => reconcileRead(draft, options)),
    post,
  }
}
