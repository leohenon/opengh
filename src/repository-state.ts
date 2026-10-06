import type {
  CommitSummary,
  IssueSummary,
  ListState,
  Paginated,
  PullRequestSummary,
  Repo,
  WorkflowRunSummary,
} from "./models"

export type ResourcePhase = "load" | "pagination"

export type ResourceState<T> =
  | { status: "loading"; phase: ResourcePhase; value?: T }
  | { status: "ready"; value: T }
  | { status: "error"; phase: ResourcePhase; message: string; value?: T }

export type OperationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }

export type RepositoryData = {
  repo: Repo
  currentBranch: string
  readme: ResourceState<string>
  branches: ResourceState<string[]>
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
  | { kind: "readme" }
  | { kind: "branches" }
  | { kind: "commits" }
  | { kind: "runs" }
  | { kind: "issues"; state: ListState }
  | { kind: "pulls"; state: ListState }

export type RepositoryState =
  | { status: "loading"; repository: string }
  | { status: "ready"; repository: string; data: RepositoryData; operations: RepositoryOperations }
  | { status: "error"; repository: string; message: string }
