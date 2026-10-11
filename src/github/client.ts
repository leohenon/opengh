import type {
  CommitDetail,
  CommitSummary,
  IssueSummary,
  ListState,
  PullRequestSummary,
  Repo,
  WorkflowRunSummary,
} from "../models"
import { createGitHubDocuments } from "./documents"
import { githubTransport, type GitHubTransport } from "./transport"

const PAGE_SIZE = 30
const BRANCH_PAGE_SIZE = 100

type Page<T> = { items: T[]; hasMore: boolean }

type RepositoryResponse = {
  full_name: string
  html_url: string
  description: string | null
  visibility?: string | null
  default_branch: string
  stargazers_count: number
  forks_count: number
  subscribers_count: number
  open_issues_count: number
  language: string | null
  license: { spdx_id: string | null } | null
  updated_at: string
}

type UserResponse = { login: string } | null

type IssueResponse = {
  number: number
  state: string
  title: string
  user: UserResponse
  created_at: string
  pull_request?: unknown
}

type PullResponse = IssueResponse & {
  merged_at: string | null
}

type CommitResponse = {
  sha: string
  author: UserResponse
  commit: {
    message: string
    author: { name: string | null; date: string } | null
  }
}

type CommitDetailResponse = CommitResponse & {
  committer: UserResponse
  commit: {
    committer?: { name: string | null; date: string } | null
  }
  stats: { additions: number; deletions: number }
  files: {
    filename: string
    previous_filename?: string
    status: string
    additions: number
    deletions: number
  }[]
}

type BranchResponse = { name: string }

type WorkflowRunResponse = {
  id: number
  name: string
  display_title: string
  status: string
  conclusion: string | null
  created_at: string
}

type WorkflowRunsResponse = {
  total_count?: number
  workflow_runs?: WorkflowRunResponse[]
}

function firstLine(value: string | null | undefined, fallback: string) {
  return value?.split("\n")[0]?.trim() || fallback
}

function issueSummary(item: IssueResponse): IssueSummary {
  return {
    number: item.number,
    state: item.state === "closed" ? "closed" : "open",
    title: item.title,
    author: item.user?.login ?? "ghost",
    createdAt: item.created_at,
  }
}

function commitSummary(item: CommitResponse): CommitSummary {
  return {
    sha: item.sha,
    message: firstLine(item.commit.message, "No commit message."),
    author: item.author?.login ?? item.commit.author?.name ?? "ghost",
    date: item.commit.author?.date ?? "",
  }
}

// Map endpoints into domain models here; transport owns execution/errors, the session owns async state.
export function createGitHubClient(transport: GitHubTransport) {
  const { documents, document } = createGitHubDocuments(transport)
  const metadata = async (repository: string): Promise<Repo> => {
    const repo = await transport.json<RepositoryResponse>(`repos/${repository}`)
    return {
      nameWithOwner: repo.full_name,
      url: repo.html_url,
      description: repo.description ?? "No description provided.",
      visibility: repo.visibility?.toUpperCase() ?? "PUBLIC",
      defaultBranch: repo.default_branch,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      watchers: repo.subscribers_count,
      openIssues: repo.open_issues_count,
      language: repo.language ?? "Unknown",
      license: repo.license?.spdx_id ?? "None",
      updatedAt: repo.updated_at,
    }
  }

  const branches = async (repository: string, fallbackBranch: string, page = 1): Promise<Page<string>> => {
    const items = await transport.json<BranchResponse[]>(
      `repos/${repository}/branches?per_page=${BRANCH_PAGE_SIZE}&page=${page}`,
    )
    return {
      items: items.length || page > 1 ? items.map((branch) => branch.name) : [fallbackBranch],
      hasMore: items.length === BRANCH_PAGE_SIZE,
    }
  }

  const commits = async (repository: string, branch: string, page = 1): Promise<Page<CommitSummary>> => {
    const branchQuery = branch ? `&sha=${encodeURIComponent(branch)}` : ""
    const items = await transport.json<CommitResponse[]>(
      `repos/${repository}/commits?per_page=${PAGE_SIZE}&page=${page}${branchQuery}`,
    )
    return { items: items.map(commitSummary), hasMore: items.length === PAGE_SIZE }
  }

  const commit = async (repository: string, sha: string, page = 1): Promise<CommitDetail> => {
    const item = await transport.json<CommitDetailResponse>(
      `repos/${repository}/commits/${encodeURIComponent(sha)}?per_page=100&page=${page}`,
    )
    return {
      ...commitSummary(item),
      fullMessage: item.commit.message,
      ...(item.commit.committer ? {
        committer: {
          name: item.committer?.login ?? item.commit.committer.name ?? "ghost",
          date: item.commit.committer.date,
        },
      } : {}),
      additions: item.stats.additions,
      deletions: item.stats.deletions,
      files: {
        items: item.files.map((file) => ({
          path: file.filename,
          ...(file.previous_filename !== undefined ? { previousPath: file.previous_filename } : {}),
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
        })),
        page,
        hasMore: item.files.length === 100 && page * 100 < 3000,
      },
      filesTruncated: item.files.length === 100 && page * 100 >= 3000,
    }
  }

  const issues = async (repository: string, state: ListState, page = 1): Promise<Page<IssueSummary>> => {
    const items = await transport.json<IssueResponse[]>(
      `repos/${repository}/issues?state=${state}&per_page=${PAGE_SIZE}&page=${page}`,
    )
    return {
      items: items.filter((item) => !item.pull_request).map(issueSummary),
      hasMore: items.length === PAGE_SIZE,
    }
  }

  const pulls = async (repository: string, state: ListState, page = 1): Promise<Page<PullRequestSummary>> => {
    const items = await transport.json<PullResponse[]>(
      `repos/${repository}/pulls?state=${state}&per_page=${PAGE_SIZE}&page=${page}`,
    )
    return {
      items: items.map((item) => ({ ...issueSummary(item), merged: item.merged_at != null })),
      hasMore: items.length === PAGE_SIZE,
    }
  }

  const runs = async (repository: string, page = 1): Promise<Page<WorkflowRunSummary>> => {
    const response = await transport.json<WorkflowRunsResponse>(
      `repos/${repository}/actions/runs?per_page=${PAGE_SIZE}&page=${page}`,
    )
    const items = (response.workflow_runs ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      title: item.display_title,
      status: item.status,
      conclusion: item.conclusion ?? "",
      createdAt: item.created_at,
    }))
    return { items, hasMore: page * PAGE_SIZE < (response.total_count ?? items.length) }
  }

  return { metadata, documents, document, branches, commits, commit, issues, pulls, runs }
}

const client = createGitHubClient(githubTransport)

export const loadGitHubMetadata = client.metadata
export const loadGitHubDocuments = client.documents
export const loadGitHubDocument = client.document
export const loadGitHubBranches = client.branches
export const loadGitHubCommits = client.commits
export const loadGitHubCommit = client.commit
export const loadGitHubIssues = client.issues
export const loadGitHubPulls = client.pulls
export const loadGitHubRuns = client.runs
