export type Repo = {
  nameWithOwner: string
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

export type Paginated<T> = {
  items: T[]
  page: number
  hasMore: boolean
}
