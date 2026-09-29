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

export type Issue = {
  number: number
  state: "open" | "closed"
  title: string
  author: string
  labels: string[]
  comments: number
  createdAt: string
  body: string
}

export type PullRequest = Issue & {
  branch: string
  draft: boolean
}

export type Run = {
  id: number
  name: string
  title: string
  branch: string
  event: string
  status: string
  conclusion: string
  createdAt: string
}

export type ListState = "open" | "closed"

export type PageInfo = {
  page: number
  hasMore: boolean
}

export type Commit = {
  sha: string
  message: string
  author: string
  date: string
}

export type GitHubData = {
  repo: Repo
  readme: string
  issues: Issue[]
  pulls: PullRequest[]
  runs: Run[]
  branches: string[]
  currentBranch: string
  commits: Commit[]
  commitsPage: PageInfo
  runsPage: PageInfo
  issuesPage: Record<ListState, PageInfo>
  pullsPage: Record<ListState, PageInfo>
}

export type RepositoryState =
  | { status: "loading"; repository: string }
  | {
      status: "ready"
      data: GitHubData
      refreshing: boolean
      refreshError?: string
    }
  | { status: "error"; repository: string; message: string }
