export type Repo = {
  nameWithOwner: string
  url: string
  description: string
  visibility: string
  defaultBranch: string
  stars: number
  forks: number
  watchers: number
  openIssues: number
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

export type IssueDetail = IssueSummary & {
  url: string
  body: string
  updatedAt: string
  closedAt?: string
  stateReason?: string
  locked: boolean
  labels: string[]
  assignees: string[]
  milestone?: { title: string; dueAt?: string }
  commentCount: number
}

export type IssueComment = {
  id: number
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

export type PullRequestSummary = IssueSummary & {
  merged: boolean
}

export type WorkflowRunSummary = {
  id: number
  name: string
  title: string
  status: string
  conclusion: string
  createdAt: string
}

export type CommitSummary = {
  sha: string
  message: string
  author: string
  date: string
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

export type Paginated<T> = {
  items: T[]
  page: number
  hasMore: boolean
}
