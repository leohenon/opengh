import type {
  CommitDetail,
  CommitSummary,
  IssueComment,
  IssueDetail,
  IssueCommitReference,
  IssueIssueReference,
  IssueReference,
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
  parent?: { full_name: string } | null
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

type IssueDetailResponse = IssueResponse & {
  html_url: string
  body: string | null
  updated_at: string
  closed_at: string | null
  state_reason: string | null
  locked: boolean
  labels: (string | { name: string })[]
  assignees: { login: string }[]
  milestone: { title: string; due_on: string | null } | null
  comments: number
}

type IssueCommentResponse = {
  id: number
  user: UserResponse
  author_association?: string
  body: string | null
  created_at: string
  updated_at: string
}

type IssueTimelineResponse = {
  event?: string
  actor?: UserResponse
  created_at?: string
  commit_id?: string | null
  commit_url?: string | null
  source?: {
    issue?: {
      number?: number
      title?: string
      html_url?: string
      state?: string
      draft?: boolean
      repository?: { full_name?: string } | null
      pull_request?: { merged_at?: string | null } | null
    } | null
  } | null
} | null

type PullResponse = IssueResponse & {
  merged_at: string | null
  draft?: boolean
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
      parentRepository: repo.parent?.full_name,
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

  const hasIssues = async (repository: string, state: ListState): Promise<boolean> => {
    if (!transport.graphql) throw new Error("Issue availability could not be verified.")
    const [owner, name, ...extra] = repository.split("/")
    if (!owner || !name || extra.length) throw new Error("Invalid repository for issue availability.")
    const response = await transport.graphql<{
      data?: { repository?: { issues?: { totalCount?: number } } | null }
      errors?: { message?: string }[]
    }>(
      "query($owner: String!, $name: String!, $state: IssueState!) { repository(owner: $owner, name: $name) { issues(states: [$state]) { totalCount } } }",
      { owner, name, state: state.toUpperCase() },
    )
    if (response.errors?.length) throw new Error(response.errors.map((error) => error.message).filter(Boolean).join(" · ") || "Issue availability could not be verified.")
    const count = response.data?.repository?.issues?.totalCount
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new Error("Issue availability could not be verified.")
    return count > 0
  }

  const issue = async (repository: string, number: number): Promise<IssueDetail> => {
    const item = await transport.json<IssueDetailResponse>(`repos/${repository}/issues/${number}`)
    if ("pull_request" in item) throw new Error(`Issue #${number} is a pull request.`)
    return {
      ...issueSummary(item),
      url: item.html_url,
      body: item.body ?? "",
      updatedAt: item.updated_at,
      ...(item.closed_at != null ? { closedAt: item.closed_at } : {}),
      ...(item.state_reason != null ? { stateReason: item.state_reason } : {}),
      locked: item.locked,
      labels: item.labels.map((label) => typeof label === "string" ? label : label.name),
      assignees: item.assignees.map((assignee) => assignee.login),
      ...(item.milestone ? {
        milestone: {
          title: item.milestone.title,
          ...(item.milestone.due_on != null ? { dueAt: item.milestone.due_on } : {}),
        },
      } : {}),
      commentCount: item.comments,
    }
  }

  const issueComments = async (repository: string, number: number, page = 1): Promise<Page<IssueComment>> => {
    const items = await transport.json<IssueCommentResponse[]>(
      `repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`,
    )
    return {
      items: items.map((item) => ({
        id: item.id,
        author: item.user?.login ?? "ghost",
        authorAssociation: item.author_association ?? "NONE",
        body: item.body ?? "",
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
      hasMore: items.length === 100,
    }
  }

  const issueReferences = async (repository: string, number: number): Promise<IssueReference[]> => {
    const references = new Map<string, IssueReference>()
    for (let page = 1; ; page++) {
      const items = await transport.json<IssueTimelineResponse[]>(
        `repos/${repository}/issues/${number}/timeline?per_page=100&page=${page}`,
      )
      for (const item of items) {
        if (!item || typeof item.created_at !== "string" || !Number.isFinite(Date.parse(item.created_at))) continue
        const actor = item.actor?.login ?? "ghost"
        if (item.event === "referenced") {
          if (typeof item.commit_id !== "string" || !/^[a-f\d]{40}$/i.test(item.commit_id)
            || typeof item.commit_url !== "string") continue
          let url: URL
          try { url = new URL(item.commit_url) } catch { continue }
          const match = url.pathname.match(/^\/repos\/([a-z\d_.-]+)\/([a-z\d_.-]+)\/commits\/([a-f\d]{40})$/i)
          if (url.protocol !== "https:" || url.hostname !== "api.github.com" || url.port
            || url.username || url.password || url.search || url.hash || !match
            || match[1] === "." || match[1] === ".." || match[2] === "." || match[2] === ".."
            || match[3]!.toLowerCase() !== item.commit_id.toLowerCase()) continue
          const sourceRepository = `${match[1]}/${match[2]}`
          const sha = item.commit_id.toLowerCase()
          const id = `referenced:${sourceRepository}:${sha}:${item.created_at}:${actor}`
          references.set(id, {
            kind: "commit", id, repository: sourceRepository, sha,
            title: `Commit ${sha.slice(0, 7)}`, url: `https://github.com/${sourceRepository}/commit/${sha}`,
            actor, createdAt: item.created_at,
          })
          continue
        }
        const source = item.source?.issue
        const sourceRepository = source?.repository?.full_name
        if (item.event !== "cross-referenced"
          || typeof source?.number !== "number" || !Number.isSafeInteger(source.number) || source.number <= 0
          || typeof source.title !== "string" || !source.title
          || typeof source.html_url !== "string" || !source.html_url
          || (source.state !== "open" && source.state !== "closed")
          || typeof sourceRepository !== "string" || !sourceRepository) continue
        const id = `cross-referenced:${sourceRepository}:${source.number}:${item.created_at}:${actor}`
        const shared: Omit<IssueIssueReference, "kind"> = {
          id, repository: sourceRepository, number: source.number, title: source.title, url: source.html_url,
          state: source.state, actor, createdAt: item.created_at,
        }
        if (source.pull_request != null) {
          if (typeof source.pull_request !== "object" || Array.isArray(source.pull_request)) continue
          references.set(id, {
            ...shared, kind: "pull", merged: source.pull_request.merged_at != null, draft: source.draft === true,
          })
        } else references.set(id, { ...shared, kind: "issue" })
      }
      if (items.length < 100) break
    }
    const commits = [...references.values()].filter((reference): reference is IssueCommitReference => reference.kind === "commit")
    const titles = new Map<string, Promise<string>>()
    const loadTitle = (reference: IssueCommitReference) => {
      const path = `repos/${reference.repository}/commits/${reference.sha}`
      let pending = titles.get(path)
      if (!pending) {
        pending = transport.json<CommitResponse>(path).then((commit) =>
          commit.sha.toLowerCase() === reference.sha ? firstLine(commit.commit?.message, reference.title) : reference.title,
        ).catch(() => reference.title)
        titles.set(path, pending)
      }
      return pending
    }
    // Keep event deduplication separate from shared commit metadata, and bound concurrent API requests.
    for (let offset = 0; offset < commits.length; offset += 4) {
      await Promise.all(commits.slice(offset, offset + 4).map(async (reference) => {
        reference.title = await loadTitle(reference)
      }))
    }
    return [...references.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  }

  const pulls = async (repository: string, state: ListState, page = 1): Promise<Page<PullRequestSummary>> => {
    const items = await transport.json<PullResponse[]>(
      `repos/${repository}/pulls?state=${state}&per_page=${PAGE_SIZE}&page=${page}`,
    )
    return {
      items: items.map((item) => ({ ...issueSummary(item), merged: item.merged_at != null, draft: item.draft === true })),
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

  return { metadata, documents, document, branches, commits, commit, issues, hasIssues, issue, issueComments, issueReferences, pulls, runs }
}

const client = createGitHubClient(githubTransport)

export const loadGitHubMetadata = client.metadata
export const loadGitHubDocuments = client.documents
export const loadGitHubDocument = client.document
export const loadGitHubBranches = client.branches
export const loadGitHubCommits = client.commits
export const loadGitHubCommit = client.commit
export const loadGitHubIssues = client.issues
export const loadGitHubHasIssues = client.hasIssues
export const loadGitHubIssue = client.issue
export const loadGitHubIssueComments = client.issueComments
export const loadGitHubIssueReferences = client.issueReferences
export const loadGitHubPulls = client.pulls
export const loadGitHubRuns = client.runs
