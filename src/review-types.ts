export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES"
export type ReviewAnchor = {
  path: string
  line: number
  side: "LEFT" | "RIGHT"
  startLine?: number
  startSide?: "LEFT" | "RIGHT"
}
export type DraftReviewComment = ReviewAnchor & { id: string; body: string }
export type ReviewEligibility = {
  accountId: number
  login: string
  // Immutable; the owner/name below can be reused by a different repository.
  repositoryId: number
  repository: string
  number: number
  headSha: string
  baseSha?: string
  url: string
  canComment: boolean
  canInlineComment?: boolean
  canApprove: boolean
  canRequestChanges: boolean
  pendingReviewUrl?: string
  reason?: string
}
export type ReviewDraft = {
  accountId: number
  // Optional only because drafts persisted by earlier builds lack it.
  repositoryId?: number
  repository: string
  number: number
  headSha: string
  baseSha?: string
  body: string
  event: ReviewEvent
  comments: DraftReviewComment[]
  // Persisted before the request; an uncertain write must never be blindly retried.
  submission?: { startedAt: string; reviewIds: number[] }
}
export type ReviewSessionState = {
  status: "idle" | "loading" | "ready" | "submitting" | "error"
  eligibility?: ReviewEligibility
  draft?: ReviewDraft
  message?: string
  uncertain?: boolean
}
export type InlineCommentInput = {
  accountId: number
  repositoryId: number
  repository: string
  number: number
  headSha: string
  baseSha: string
  anchor: ReviewAnchor
  body: string
}
export type PostedInlineComment = ReviewAnchor & { id: number; body: string; url: string }

export type PullReviewSession = {
  state(): ReviewSessionState
  open(repository: string, number: number): Promise<void>
  setBody(body: string): void
  setEvent(event: ReviewEvent): void
  addComment(anchor: ReviewAnchor, body: string): void
  updateComment(id: string, body: string): void
  removeComment(id: string): void
  discard(): Promise<void>
  // Explicit acknowledgement after inspecting a new head; only allowed with no inline comments.
  useCurrentHead(): void
  submit(): Promise<boolean>
  flush(): Promise<void>
}
