import type {
  CommitDetail,
  DiffContent,
  DiffTarget,
  CommitSummary,
  IssueSummary,
  IssueDetail,
  IssueComment,
  IssueReference,
  IssueActionKind,
  IssueCloseReason,
  IssueTimelineEvent,
  ListState,
  Paginated,
  PullRequestDetail,
  PullRequestSummary,
  PullContext,
  Repo,
  RepositoryDocument,
  WorkflowRunSummary,
  WorkflowRunDetail,
  WorkflowJob,
  ReactionKind,
} from "./models"

export type ResourcePhase = "load" | "pagination"

export type ResourceState<T> =
  | { status: "loading"; phase: ResourcePhase; value?: T }
  | { status: "ready"; value: T }
  | { status: "error"; phase: ResourcePhase; message: string; value?: T }

export type RepositoryDocumentState = RepositoryDocument & {
  resource: ResourceState<string>
}

export type DiffState = {
  target: DiffTarget
  resource: ResourceState<DiffContent>
}

export type RunDetailState = {
  id: number
  resource: ResourceState<WorkflowRunDetail>
  jobs: ResourceState<Paginated<WorkflowJob>>
}

export type CommitDetailState = {
  sha: string
  resource: ResourceState<CommitDetail>
}

export type PullDetailState = {
  number: number
  resource: ResourceState<PullRequestDetail>
  comments: ResourceState<Paginated<IssueComment>>
  references: ResourceState<IssueReference[]>
  events?: IssueTimelineEvent[]
  commits: ResourceState<CommitSummary[]>
  context: ResourceState<PullContext>
}

export type IssueDetailState = {
  number: number
  resource: ResourceState<IssueDetail>
  comments: ResourceState<Paginated<IssueComment>>
  references: ResourceState<IssueReference[]>
  events?: IssueTimelineEvent[]
}

export type OperationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }

export type ReactionActionState = { kind?: ReactionKind; operation: OperationState }

export type IssueActionState = {
  selectedAssignees?: string[]
  body: string
  reason: IssueCloseReason
  duplicateTarget?: string
  operation: OperationState
  // A comment already succeeded; the next submission must only retry the state change.
  retry?: Extract<IssueActionKind, "close" | "reopen">
}

export type RepositoryData = {
  repo: Repo
  currentBranch: string
  workCounts: ResourceState<{ issues: number; pulls: number }>
  documents: ResourceState<RepositoryDocumentState[]>
  branches: ResourceState<Paginated<string>>
  commits: ResourceState<Paginated<CommitSummary>>
  commitCount: ResourceState<number>
  issues: Record<ListState, ResourceState<Paginated<IssueSummary>>>
  pulls: Record<ListState, ResourceState<Paginated<PullRequestSummary>>>
  runs: ResourceState<Paginated<WorkflowRunSummary>>
}

export type RepositoryOperations = {
  refresh: OperationState
  branch: OperationState
}

export type RepositoryResource =
  | { kind: "documents" }
  | { kind: "document"; id: string }
  | { kind: "branches" }
  | { kind: "commits" }
  | { kind: "runs" }
  | { kind: "issues"; state: ListState }
  | { kind: "pulls"; state: ListState }

export type RepositoryState =
  | { status: "loading"; repository: string }
  | { status: "ready"; repository: string; data: RepositoryData; operations: RepositoryOperations }
  | { status: "error"; repository: string; message: string }
