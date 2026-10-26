export type Repo = {
  nameWithOwner: string
  parentRepository?: string
  url: string
  description: string
  visibility: string
  defaultBranch: string
  stars: number
  forks: number
  watchers: number
  language: string
  license: string
  updatedAt: string
}

export type RepositoryDocument = {
  id: string
  label: string
  repository: string
  ref: string
  path: string
}

export type ListState = "open" | "closed"

export type IssueSummary = {
  number: number
  state: ListState
  title: string
  author: string
  createdAt: string
}

export type IssueDetail = IssueSummary & Partial<ReactionState> & {
  nodeId?: string
  url: string
  body: string
  updatedAt: string
  closedAt?: string
  stateReason?: string
  locked: boolean
  permissions?: Record<IssueActionKind, boolean>
  permissionsError?: string
  labels: string[]
  assignees: string[]
  milestone?: { title: string; dueAt?: string }
  commentCount: number
}

export type IssueActionParent = "issue" | "pull"
export type IssueCloseReason = "completed" | "not_planned"
export type IssueActionKind = "comment" | "close" | "reopen" | "duplicate" | "assignees"
export type IssueActionResult = { comment?: IssueComment; issue?: IssueDetail; pull?: PullRequestDetail; duplicateOf?: number }

export const reactionKinds = ["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"] as const
export type ReactionKind = typeof reactionKinds[number]
export type ReactionCounts = Partial<Record<ReactionKind, number>>
export type ReactionState = { reactions: ReactionCounts; viewerReactions: ReactionKind[]; canReact: boolean }
export type ReactionTarget = (
  | { kind: "issue"; number: number }
  | { kind: "pull"; number: number }
  | { kind: "comment"; parent: "issue" | "pull"; number: number; id: number }
  | { kind: "review-comment"; number: number; id: string }
) & { nodeId?: string }

export type IssueComment = Partial<ReactionState> & {
  id: number
  nodeId?: string
  author: string
  authorAssociation: string
  body: string
  createdAt: string
  updatedAt: string
}

type IssueReferenceBase = {
  id: string
  repository: string
  title: string
  url: string
  actor: string
  createdAt: string
}

export type IssuePullReference = IssueReferenceBase & {
  kind: "pull"
  number: number
  state: ListState
  merged: boolean
  draft: boolean
}

export type IssueIssueReference = IssueReferenceBase & {
  kind: "issue"
  number: number
  state: ListState
}

export type IssueCommitReference = IssueReferenceBase & {
  kind: "commit"
  sha: string
}

export type IssueReference = IssuePullReference | IssueIssueReference | IssueCommitReference

export type IssueCloser =
  | { kind: "pull"; number: number; title: string; url: string; repository: string }
  | { kind: "commit"; sha: string; title: string; url: string; repository: string }

export type IssueStateEvent = {
  kind: "state"
  id: string
  event: "closed" | "reopened" | "merged"
  closer?: IssueCloser
  actor: string
  createdAt: string
}

export type ForcePushCommit = { sha: string; url: string }

export type PullForcePushEvent = {
  kind: "force-push"
  event: "head_ref_force_pushed"
  id: string
  actor: string
  createdAt: string
  beforeCommit?: ForcePushCommit
  afterCommit?: ForcePushCommit
}

export type PullReviewState = "approved" | "changes_requested" | "commented" | "dismissed"

export type PullReviewEvent = {
  kind: "review"
  event: "reviewed"
  id: string
  reviewId: number
  actor: string
  createdAt: string
  state: PullReviewState
  originalState?: Exclude<PullReviewState, "dismissed">
  body: string
  authorAssociation: string
  url: string
  commitSha?: string
}

export type PullReviewDismissedEvent = {
  kind: "review-dismissed"
  event: "review_dismissed"
  id: string
  actor: string
  createdAt: string
  reviewId?: number
  reviewer?: string
  body: string
}

export type PullDraftEvent = {
  kind: "draft"
  event: "convert_to_draft" | "ready_for_review"
  id: string
  actor: string
  createdAt: string
}

export type ReviewTarget =
  | { kind: "user"; login: string }
  | { kind: "team"; name: string; slug?: string; organization?: string }

export type PullReviewRequestEvent = {
  kind: "review-request"
  event: "review_requested" | "review_request_removed"
  id: string
  actor: string
  createdAt: string
  target: ReviewTarget
  reRequested: boolean
}

export type PullCommitEvent = {
  kind: "commit-added"
  event: "committed"
  id: string
  sha: string
  message: string
  author: string
  createdAt: string
  url: string
  timelineIndex?: number
}

export type IssueTimelineEvent = IssueStateEvent | PullForcePushEvent | PullReviewEvent
  | PullReviewDismissedEvent | PullDraftEvent | PullReviewRequestEvent | PullCommitEvent

export type IssueTimeline = {
  references: IssueReference[]
  events: IssueTimelineEvent[]
}

export type PullRequestSummary = IssueSummary & {
  merged: boolean
  draft?: boolean
}

export type ReviewThreadComment = Partial<ReactionState> & {
  id: string
  author: string
  authorAssociation: string
  body: string
  createdAt: string
  updatedAt: string
  url: string
  reviewId?: number
  replyToId?: string
}

export type PullReviewThread = {
  kind: "review-thread"
  id: string
  path: string
  line?: number
  originalLine?: number
  isResolved: boolean
  isOutdated: boolean
  resolvedBy?: string
  createdAt?: string
  comments: ReviewThreadComment[]
}

export type PullCheck = {
  id: string
  name: string
  state: "success" | "failure" | "pending" | "neutral" | "skipped" | "cancelled" | "unknown"
  required?: boolean
  url?: string
}

export type PullReadiness = {
  headSha: string
  isDraft?: boolean
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  mergeStateStatus: string
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null
  checks: PullCheck[]
  checksComplete: boolean
}

export type PullContext = {
  threads: PullReviewThread[]
  milestone?: { title: string; url: string; dueAt?: string }
  projects?: { id: string; title: string; url: string }[]
  closingIssues?: { number: number; title: string; url: string; repository: string; state: ListState }[]
  readiness: PullReadiness
  warnings: string[]
}

export type PullMergeMethod = "merge" | "squash" | "rebase"
export type PullMergeMessage = { headline: string; body: string }
export type PullMergeDraft = PullMergeMessage & { headSha: string }

export type PullRequestDetail = PullRequestSummary & Partial<ReactionState> & {
  nodeId?: string
  locked?: boolean
  permissions?: { comment: boolean; close?: boolean; reopen?: boolean; assignees?: boolean; merge?: boolean; markDraft?: boolean; markReady?: boolean }
  merge?: { methods: PullMergeMethod[]; queueRequired: boolean }
  url: string
  body: string
  updatedAt: string
  mergedAt?: string
  closedAt?: string
  baseBranch: string
  headBranch: string
  headRepository?: string
  headSha?: string
  additions: number
  deletions: number
  changedFiles: number
  commitCount: number
  commentCount: number
  labels: string[]
  assignees: string[]
  reviewers: string[]
  mergeable: boolean | null
}

export type WorkflowRunSummary = {
  id: number
  name: string
  title: string
  status: string
  conclusion: string
  createdAt: string
}

export type WorkflowRunDetail = WorkflowRunSummary & {
  url: string
  number: number
  attempt: number
  event: string
  branch: string
  sha: string
  actor: string
  startedAt: string | null
  updatedAt: string
  workflowPath: string
}

export type WorkflowStep = {
  number: number
  name: string
  status: string
  conclusion: string
  startedAt: string | null
  completedAt: string | null
}

export type WorkflowJob = {
  id: number
  name: string
  status: string
  conclusion: string
  startedAt: string | null
  completedAt: string | null
  runner: string
  steps: WorkflowStep[]
}

export type CommitSummary = {
  sha: string
  message: string
  author: string
  date: string
  committedAt?: string
}

export type CommitFile = {
  path: string
  previousPath?: string
  status: string
  additions: number
  deletions: number
}

export type CommitDetail = CommitSummary & {
  fullMessage: string
  committer?: { name: string; date: string }
  additions: number
  deletions: number
  files: Paginated<CommitFile>
  filesTruncated: boolean
}

export type DiffTarget =
  | { kind: "commit"; sha: string }
  | { kind: "pull"; number: number }

export type DiffContent =
  | { kind: "patch"; patch: string }
  | { kind: "files"; files: CommitFile[]; truncated: boolean }

export type Paginated<T> = {
  items: T[]
  page: number
  hasMore: boolean
}
