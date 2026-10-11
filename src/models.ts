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

export type PullRequestSummary = IssueSummary

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
