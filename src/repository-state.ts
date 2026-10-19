import type {
  CommitDetail,
  CommitSummary,
  IssueSummary,
  IssueDetail,
  IssueComment,
  IssueReference,
  IssueActionKind,
  IssueCloseReason,
  ListState,
  Paginated,
  PullRequestSummary,
  Repo,
  RepositoryDocument,
  WorkflowRunSummary,
} from "./models"

export type ResourcePhase = "load" | "pagination"

export type ResourceState<T> =
  | { status: "loading"; phase: ResourcePhase; value?: T }
  | { status: "ready"; value: T }
  | { status: "error"; phase: ResourcePhase; message: string; value?: T }

export type RepositoryDocumentState = RepositoryDocument & {
  resource: ResourceState<string>
}

export type CommitDetailState = {
  sha: string
  resource: ResourceState<CommitDetail>
}

export type IssueDetailState = {
  number: number
  resource: ResourceState<IssueDetail>
  comments: ResourceState<Paginated<IssueComment>>
  references: ResourceState<IssueReference[]>
}

export type OperationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }

export type IssueActionState = {
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
  documents: ResourceState<RepositoryDocumentState[]>
  branches: ResourceState<Paginated<string>>
  commits: ResourceState<Paginated<CommitSummary>>
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
