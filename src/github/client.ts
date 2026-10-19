import type {
  CommitDetail,
  CommitSummary,
  ForcePushCommit,
  IssueComment,
  IssueCloser,
  IssueDetail,
  IssueCommitReference,
  IssueIssueReference,
  IssueReference,
  IssueStateEvent,
  IssueTimeline,
  IssueTimelineEvent,
  IssueSummary,
  PullForcePushEvent,
  PullReviewEvent,
  PullReviewState,
  PullReviewDismissedEvent,
  ReviewTarget,
  ListState,
  PullRequestDetail,
  PullRequestSummary,
  Repo,
  WorkflowRunSummary,
} from "../models"
import { createGitHubDocuments } from "./documents"
import { createGitHubPullContext } from "./pull-context"
import { parseReactions } from "./reactions"
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
  id?: number
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
  reactions?: unknown
  id: number
  user: UserResponse
  author_association?: string
  body: string | null
  created_at: string
  updated_at: string
}

type IssueTimelineResponse = {
  id?: number
  node_id?: string
  event?: string
  actor?: UserResponse
  created_at?: string
  submitted_at?: string | null
  user?: UserResponse
  state?: string
  body?: string | null
  author_association?: string
  html_url?: string
  dismissed_review?: { review_id?: number | string; state?: string; dismissal_message?: string | null } | null
  requested_reviewer?: UserResponse
  requested_team?: unknown
  review_requester?: UserResponse
  commit_id?: string | null
  commit_url?: string | null
  sha?: string
  message?: string
  author?: unknown
  committer?: unknown
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

type PullDetailResponse = PullResponse & {
  html_url: string
  body: string | null
  updated_at: string
  closed_at: string | null
  base: { ref: string }
  head: { ref: string; sha?: string; repo: { full_name: string } | null }
  reactions?: unknown
  additions: number
  deletions: number
  changed_files: number
  commits: number
  comments: number
  review_comments: number
  labels: (string | { name: string })[]
  assignees: { login: string }[]
  requested_reviewers: { login: string }[]
  requested_teams: { name: string }[]
  mergeable: boolean | null
  mergeable_state: string
}

type CommitResponse = {
  sha: string
  author: UserResponse
  commit: {
    message: string
    author: { name: string | null; date: string } | null
    committer?: { name?: string | null; date: string } | null
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

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function reviewState(value: unknown): PullReviewState | undefined {
  if (typeof value !== "string") return
  const state = value.toLowerCase()
  if (state === "approved" || state === "changes_requested" || state === "commented" || state === "dismissed") return state
}

function reviewTarget(item: NonNullable<IssueTimelineResponse>): ReviewTarget | undefined {
  if (typeof item.requested_reviewer?.login === "string" && item.requested_reviewer.login.trim()) {
    return { kind: "user", login: item.requested_reviewer.login }
  }
  const team = record(item.requested_team)
  if (typeof team?.name !== "string" || !team.name.trim()) return
  const organization = typeof team.organization === "string" ? team.organization : record(team.organization)?.login
  return {
    kind: "team", name: team.name,
    ...(typeof team.slug === "string" && team.slug.trim() ? { slug: team.slug } : {}),
    ...(typeof organization === "string" && organization.trim() ? { organization } : {}),
  }
}

function issueCloser(value: unknown): IssueCloser | undefined {
  const closer = record(value)
  if (!closer) return
  const repository = record(closer.repository)?.nameWithOwner
  const title = closer.__typename === "PullRequest" ? closer.title : closer.messageHeadline
  if (typeof repository !== "string" || !/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository)
    || repository.split("/").some((part) => part === "." || part === "..")
    || typeof title !== "string" || !title.trim() || typeof closer.url !== "string") return
  let result: IssueCloser
  if (closer.__typename === "PullRequest") {
    if (typeof closer.number !== "number" || !Number.isSafeInteger(closer.number) || closer.number <= 0) return
    result = { kind: "pull", number: closer.number, title, url: closer.url, repository }
  } else if (closer.__typename === "Commit") {
    if (typeof closer.oid !== "string" || !/^[a-f\d]{40}$/i.test(closer.oid)) return
    result = { kind: "commit", sha: closer.oid.toLowerCase(), title, url: closer.url, repository }
  } else return
  let url: URL
  try { url = new URL(result.url) } catch { return }
  const path = result.kind === "pull" ? `pull/${result.number}` : `commit/${result.sha}`
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port
    || url.username || url.password || url.search || url.hash
    || url.pathname.toLowerCase() !== `/${repository}/${path}`.toLowerCase()) return
  return result
}

function forcePushCommit(value: unknown): ForcePushCommit | undefined {
  const commit = record(value)
  if (typeof commit?.oid !== "string" || !/^[a-f\d]{40}$/i.test(commit.oid)
    || typeof commit.url !== "string") return
  let url: URL
  try { url = new URL(commit.url) } catch { return }
  const match = url.pathname.match(/^\/([a-z\d_.-]+)\/([a-z\d_.-]+)\/commit\/([a-f\d]{40})$/i)
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port
    || url.username || url.password || url.search || url.hash || !match
    || match[1] === "." || match[1] === ".." || match[2] === "." || match[2] === ".."
    || match[3]!.toLowerCase() !== commit.oid.toLowerCase()) return
  return { sha: commit.oid.toLowerCase(), url: commit.url }
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

function issueDetail(item: IssueDetailResponse): IssueDetail {
  if ("pull_request" in item) throw new Error(`Issue #${item.number} is a pull request.`)
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

function issueComment(item: IssueCommentResponse): IssueComment {
  return {
    id: item.id,
    author: item.user?.login ?? "ghost",
    authorAssociation: item.author_association ?? "NONE",
    body: item.body ?? "",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    reactions: parseReactions(item.reactions),
  }
}

function commitSummary(item: CommitResponse): CommitSummary {
  return {
    sha: item.sha,
    message: firstLine(item.commit.message, "No commit message."),
    author: item.author?.login ?? item.commit.author?.name ?? "ghost",
    date: item.commit.author?.date ?? "",
    ...(typeof item.commit.committer?.date === "string" && Number.isFinite(Date.parse(item.commit.committer.date))
      ? { committedAt: item.commit.committer.date } : {}),
  }
}

// Map endpoints into domain models here; transport owns execution/errors, the session owns async state.
export function createGitHubClient(transport: GitHubTransport) {
  const { documents, document } = createGitHubDocuments(transport)
  const { pullContext } = createGitHubPullContext(transport)
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

  const commitCount = async (repository: string, branch: string): Promise<number> => {
    if (!/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository)
      || repository.split("/").some((part) => part === "." || part === "..")) {
      throw new Error("Invalid repository for commit count.")
    }
    if (!branch.trim()) throw new Error("Branch for commit count must not be blank.")
    const failure = `Commit count for ${repository} branch ${branch} could not be verified.`
    if (!transport.graphql) throw new Error(failure)
    const [owner, name] = repository.split("/") as [string, string]
    const response = record(await transport.graphql<unknown>(
      "query($owner: String!, $name: String!, $ref: String!) { repository(owner: $owner, name: $name) { ref(qualifiedName: $ref) { target { __typename ... on Commit { history { totalCount } } } } } }",
      { owner, name, ref: `refs/heads/${branch}` },
    ))
    if (response?.errors != null && (!Array.isArray(response.errors) || response.errors.length)) {
      const messages = Array.isArray(response.errors)
        ? response.errors.map((error) => record(error)?.message).filter((message): message is string => typeof message === "string" && !!message.trim())
        : []
      throw new Error(messages.join(" · ") || failure)
    }
    const target = record(record(record(record(response?.data)?.repository)?.ref)?.target)
    const count = record(target?.history)?.totalCount
    if (target?.__typename !== "Commit" || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(failure)
    }
    return count
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

  const workCounts = async (repository: string): Promise<{ issues: number; pulls: number }> => {
    if (!/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository)
      || repository.split("/").some((part) => part === "." || part === "..")) {
      throw new Error("Invalid repository for open issue and pull request counts.")
    }
    const failure = "Open issue and pull request counts could not be verified."
    if (!transport.graphql) throw new Error(failure)
    const [owner, name] = repository.split("/") as [string, string]
    const response = record(await transport.graphql<unknown>(
      "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { issues(states: OPEN) { totalCount } pullRequests(states: OPEN) { totalCount } } }",
      { owner, name },
    ))
    if (response?.errors != null && (!Array.isArray(response.errors) || response.errors.length)) {
      const messages = Array.isArray(response.errors)
        ? response.errors.map((error) => record(error)?.message).filter((message): message is string => typeof message === "string" && !!message.trim())
        : []
      throw new Error(messages.join(" · ") || failure)
    }
    const repo = record(record(response?.data)?.repository)
    const issues = record(repo?.issues)?.totalCount
    const pulls = record(repo?.pullRequests)?.totalCount
    if (typeof issues !== "number" || !Number.isSafeInteger(issues) || issues < 0
      || typeof pulls !== "number" || !Number.isSafeInteger(pulls) || pulls < 0) throw new Error(failure)
    return { issues, pulls }
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
    return issueDetail(item)
  }

  const issueComments = async (repository: string, number: number, page = 1): Promise<Page<IssueComment>> => {
    const items = await transport.json<IssueCommentResponse[]>(
      `repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`,
    )
    return {
      items: items.map(issueComment),
      hasMore: items.length === 100,
    }
  }

  const createIssueComment = async (repository: string, number: number, body: string): Promise<IssueComment> => {
    if (!body.trim()) throw new Error("Issue comment body must not be blank.")
    if (!transport.mutate) throw new Error("GitHub transport does not support mutations.")
    const item = await transport.mutate<IssueCommentResponse>(
      `repos/${repository}/issues/${number}/comments`, "POST", { body },
    )
    return issueComment(item)
  }

  const updateIssueState = async (
    repository: string,
    number: number,
    state: ListState,
    reason?: "completed" | "not_planned",
  ): Promise<IssueDetail> => {
    if (!transport.mutate) throw new Error("GitHub transport does not support mutations.")
    const item = await transport.mutate<IssueDetailResponse>(
      `repos/${repository}/issues/${number}`, "PATCH",
      { state, ...(state === "closed" ? { state_reason: reason ?? "completed" } : {}) },
    )
    return issueDetail(item)
  }

  const markIssueDuplicate = async (
    repository: string,
    number: number,
    canonicalNumber: number,
  ): Promise<IssueDetail> => {
    if (!Number.isSafeInteger(number) || number <= 0
      || !Number.isSafeInteger(canonicalNumber) || canonicalNumber <= 0) {
      throw new Error("Issue numbers must be positive safe integers.")
    }
    if (number === canonicalNumber) throw new Error("An issue cannot be a duplicate of itself.")
    if (!transport.mutate) throw new Error("GitHub transport does not support mutations.")
    const source = await issue(repository, number)
    if (source.state !== "open") throw new Error("Only open issues can be marked as duplicate. Reopen the issue first.")
    const canonical = await transport.json<IssueDetailResponse>(`repos/${repository}/issues/${canonicalNumber}`)
    if ("pull_request" in canonical) throw new Error(`Issue #${canonicalNumber} is a pull request.`)
    if (typeof canonical.id !== "number" || !Number.isSafeInteger(canonical.id) || canonical.id <= 0) {
      throw new Error(`Canonical issue #${canonicalNumber} has no valid global issue ID.`)
    }
    const item = await transport.mutate<IssueDetailResponse>(
      `repos/${repository}/issues/${number}`, "PATCH",
      { state: "closed", state_reason: "duplicate", duplicate_issue_id: canonical.id },
    )
    const detail = issueDetail(item)
    if (detail.number !== number || detail.state !== "closed" || detail.stateReason !== "duplicate") {
      throw new Error(`GitHub did not confirm closing issue #${number} as duplicate; the requested update may have been ignored.`)
    }
    return detail
  }

  const issueTimeline = async (repository: string, number: number): Promise<IssueTimeline> => {
    const references = new Map<string, IssueReference>()
    const events = new Map<string, IssueTimelineEvent>()
    const eventNodes = new Map<string, IssueTimelineEvent>()
    const dismissalStates = new Map<string, PullReviewState>()
    let timelineIndex = 0
    for (let page = 1; ; page++) {
      const items = await transport.json<IssueTimelineResponse[]>(
        `repos/${repository}/issues/${number}/timeline?per_page=100&page=${page}`,
      )
      for (const item of items) {
        const index = timelineIndex++
        if (!item) continue
        if (item.event === "committed") {
          if (typeof item.sha !== "string" || !/^[a-f\d]{40}$/i.test(item.sha)) continue
          const sha = item.sha.toLowerCase()
          const committer = record(item.committer)
          const createdAt = typeof item.created_at === "string" && Number.isFinite(Date.parse(item.created_at))
            ? item.created_at : committer?.date
          if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) continue
          const author = record(item.author)
          const authorName = [author?.login, author?.name].find((value): value is string =>
            typeof value === "string" && !!value.trim()) ?? "ghost"
          let url = `https://github.com/${repository}/commit/${sha}`
          if (typeof item.html_url === "string") {
            try {
              const candidate = new URL(item.html_url)
              const match = candidate.pathname.match(/^\/([a-z\d_.-]+)\/([a-z\d_.-]+)\/commit\/([a-f\d]{40})$/i)
              if (candidate.protocol === "https:" && candidate.hostname === "github.com" && !candidate.port
                && !candidate.username && !candidate.password && !candidate.search && !candidate.hash && match
                && match[1] !== "." && match[1] !== ".." && match[2] !== "." && match[2] !== ".."
                && match[3]!.toLowerCase() === sha) url = item.html_url
            } catch {
              // Fall back to the canonical commit URL for malformed URLs.
            }
          }
          const id = `commit:${sha}`
          if (events.has(id)) continue
          events.set(id, {
            kind: "commit-added", event: "committed", id, sha,
            message: firstLine(typeof item.message === "string" ? item.message : undefined, "No commit message."),
            author: authorName, createdAt, url, timelineIndex: index,
          })
          continue
        }
        // Reviews use submission time and reviewer, not the issue-event timestamp/actor.
        if (item.event === "reviewed") {
          const state = reviewState(item.state)
          if (!state || typeof item.id !== "number" || !Number.isSafeInteger(item.id) || item.id <= 0
            || typeof item.submitted_at !== "string" || !Number.isFinite(Date.parse(item.submitted_at))) continue
          const id = `review:${item.id}`
          const event: PullReviewEvent = {
            kind: "review", event: "reviewed", id, reviewId: item.id,
            actor: item.user?.login ?? "ghost", createdAt: item.submitted_at, state,
            body: item.body ?? "", authorAssociation: item.author_association ?? "NONE",
            url: item.html_url || `https://github.com/${repository}/pull/${number}#pullrequestreview-${item.id}`,
            ...(typeof item.commit_id === "string" && /^[a-f\d]{40}$/i.test(item.commit_id)
              ? { commitSha: item.commit_id.toLowerCase() } : {}),
          }
          events.set(id, event)
          continue
        }
        if (typeof item.created_at !== "string" || !Number.isFinite(Date.parse(item.created_at))) continue
        const actor = item.actor?.login
          ?? ((item.event === "review_requested" || item.event === "review_request_removed") ? item.review_requester?.login : undefined)
          ?? "ghost"
        if (item.event === "review_dismissed") {
          const dismissed = item.dismissed_review
          const reviewId = typeof dismissed?.review_id === "string" && /^\d+$/.test(dismissed.review_id)
            ? Number(dismissed.review_id) : dismissed?.review_id
          const validReviewId = typeof reviewId === "number" && Number.isSafeInteger(reviewId) && reviewId > 0
            ? reviewId : undefined
          const id = typeof item.id === "number" && Number.isSafeInteger(item.id) && item.id > 0
            ? `review-dismissed:${item.id}` : `review-dismissed:${validReviewId ?? "unknown"}:${Date.parse(item.created_at)}:${actor}`
          const event: PullReviewDismissedEvent = {
            kind: "review-dismissed", event: "review_dismissed", id, actor, createdAt: item.created_at,
            ...(validReviewId !== undefined ? { reviewId: validReviewId } : {}),
            body: dismissed?.dismissal_message ?? "",
          }
          events.set(id, event)
          const state = reviewState(dismissed?.state)
          if (state) dismissalStates.set(id, state)
          continue
        }
        if (item.event === "convert_to_draft" || item.event === "ready_for_review") {
          const id = typeof item.id === "number" && Number.isSafeInteger(item.id) && item.id > 0
            ? `draft:${item.id}` : `draft:${item.event}:${Date.parse(item.created_at)}:${actor}`
          events.set(id, { kind: "draft", event: item.event, id, actor, createdAt: item.created_at })
          continue
        }
        if (item.event === "review_requested" || item.event === "review_request_removed") {
          const target = reviewTarget(item)
          if (!target) continue
          const targetKey = target.kind === "user" ? `user:${target.login.toLowerCase()}`
            : `team:${target.organization?.toLowerCase() ?? ""}/${(target.slug ?? target.name).toLowerCase()}`
          const id = typeof item.id === "number" && Number.isSafeInteger(item.id) && item.id > 0
            ? `review-request:${item.id}` : `review-request:${item.event}:${targetKey}:${Date.parse(item.created_at)}:${actor}`
          events.set(id, {
            kind: "review-request", event: item.event, id, actor, createdAt: item.created_at,
            target, reRequested: false,
          })
          continue
        }
        if (item.event === "closed" || item.event === "reopened" || item.event === "merged") {
          const id = typeof item.id === "number" && Number.isSafeInteger(item.id) && item.id > 0
            ? `state:${item.id}` : `state:${item.event}:${Date.parse(item.created_at)}:${actor}`
          const event: IssueStateEvent = { kind: "state", id, event: item.event, actor, createdAt: item.created_at }
          events.set(id, event)
          if (item.event === "closed" && typeof item.node_id === "string" && item.node_id.trim()) {
            eventNodes.set(item.node_id, event)
          }
          continue
        }
        if (item.event === "head_ref_force_pushed") {
          const nodeId = typeof item.node_id === "string" && item.node_id.trim() ? item.node_id : undefined
          const id = typeof item.id === "number" && Number.isSafeInteger(item.id) && item.id > 0
            ? `force-push:${item.id}` : `force-push:${nodeId ?? `${Date.parse(item.created_at)}:${actor}`}`
          const event: PullForcePushEvent = {
            kind: "force-push", event: item.event, id, actor, createdAt: item.created_at,
          }
          events.set(id, event)
          if (nodeId) eventNodes.set(nodeId, event)
          continue
        }
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
    // Link after all pages so dismissal records can precede their reviewed entry.
    const sortedEvents = [...events.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const requested = new Set<string>()
    for (const event of sortedEvents) {
      if (event.kind === "review-dismissed" && event.reviewId !== undefined) {
        const review = events.get(`review:${event.reviewId}`)
        if (review?.kind !== "review") continue
        event.reviewer = review.actor
        const dismissedState = dismissalStates.get(event.id)
        const originalState = dismissedState && dismissedState !== "dismissed"
          ? dismissedState : review.originalState ?? review.state
        if (originalState !== "dismissed") review.originalState = originalState
        review.state = "dismissed"
      } else if (event.kind === "review-request" && event.event === "review_requested") {
        const target = event.target
        const key = target.kind === "user" ? `user:${target.login.toLowerCase()}`
          : `team:${target.organization?.toLowerCase() ?? ""}/${(target.slug ?? target.name).toLowerCase()}`
        event.reRequested = requested.has(key)
        requested.add(key)
      }
    }
    if (transport.graphql && eventNodes.size) {
      const nodeIds = [...eventNodes.keys()]
      for (let offset = 0; offset < nodeIds.length; offset += 100) {
        const batch = nodeIds.slice(offset, offset + 100)
        try {
          const response = record(await transport.graphql<unknown>(
            `query { nodes(ids: ${JSON.stringify(batch)}) { ... on ClosedEvent { id closer { __typename ... on PullRequest { number title url repository { nameWithOwner } } ... on Commit { oid messageHeadline url repository { nameWithOwner } } } } ... on HeadRefForcePushedEvent { id beforeCommit { oid url } afterCommit { oid url } } } }`,
            {},
          ))
          const nodes = record(response?.data)?.nodes
          if ((response?.errors != null && (!Array.isArray(response.errors) || response.errors.length))
            || !Array.isArray(nodes)) continue
          for (const value of nodes) {
            const node = record(value)
            if (typeof node?.id !== "string" || !batch.includes(node.id)) continue
            const event = eventNodes.get(node.id)
            if (event?.event === "closed") {
              const closer = issueCloser(node.closer)
              if (closer) event.closer = closer
            } else if (event?.event === "head_ref_force_pushed") {
              const beforeCommit = forcePushCommit(node.beforeCommit)
              const afterCommit = forcePushCommit(node.afterCommit)
              if (beforeCommit) event.beforeCommit = beforeCommit
              if (afterCommit) event.afterCommit = afterCommit
            }
          }
        } catch {
          // Event details are optional; keep the REST timeline when enrichment fails.
        }
      }
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
    const mergedTimes = new Set([...events.values()]
      .filter((event) => event.event === "merged").map((event) => Date.parse(event.createdAt)))
    return {
      references: [...references.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
      events: [...events.values()]
        .filter((event) => event.event !== "closed" || !mergedTimes.has(Date.parse(event.createdAt)))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    }
  }

  const issueReferences = async (repository: string, number: number): Promise<IssueReference[]> =>
    (await issueTimeline(repository, number)).references

  const pulls = async (repository: string, state: ListState, page = 1): Promise<Page<PullRequestSummary>> => {
    const items = await transport.json<PullResponse[]>(
      `repos/${repository}/pulls?state=${state}&per_page=${PAGE_SIZE}&page=${page}`,
    )
    return {
      items: items.map((item) => ({ ...issueSummary(item), merged: item.merged_at != null, draft: item.draft === true })),
      hasMore: items.length === PAGE_SIZE,
    }
  }

  const pull = async (repository: string, number: number): Promise<PullRequestDetail> => {
    const item = await transport.json<PullDetailResponse>(`repos/${repository}/pulls/${number}`)
    return {
      ...issueSummary(item),
      merged: item.merged_at != null,
      draft: item.draft === true,
      url: item.html_url,
      body: item.body ?? "",
      updatedAt: item.updated_at,
      ...(item.merged_at != null ? { mergedAt: item.merged_at } : {}),
      ...(item.closed_at != null ? { closedAt: item.closed_at } : {}),
      baseBranch: item.base.ref,
      headBranch: item.head.ref,
      ...(typeof item.head.sha === "string" && /^[a-f\d]{40}$/i.test(item.head.sha) ? { headSha: item.head.sha } : {}),
      reactions: parseReactions(item.reactions),
      ...(item.head.repo ? { headRepository: item.head.repo.full_name } : {}),
      additions: item.additions,
      deletions: item.deletions,
      changedFiles: item.changed_files,
      commitCount: item.commits,
      commentCount: item.comments,
      reviewCommentCount: item.review_comments,
      labels: item.labels.map((label) => typeof label === "string" ? label : label.name),
      assignees: item.assignees.map((assignee) => assignee.login),
      reviewers: [
        ...item.requested_reviewers.map((reviewer) => reviewer.login),
        ...item.requested_teams.map((team) => team.name),
      ],
      mergeable: item.mergeable,
      mergeableState: item.mergeable_state,
    }
  }

  const pullCommits = async (repository: string, number: number): Promise<CommitSummary[]> => {
    const commits: CommitSummary[] = []
    const seen = new Set<string>()
    for (let page = 1; page <= 3; page++) {
      const items = await transport.json<CommitResponse[]>(
        `repos/${repository}/pulls/${number}/commits?per_page=100&page=${page}`,
      )
      for (const item of items) {
        if (seen.has(item.sha)) continue
        seen.add(item.sha)
        commits.push(commitSummary(item))
        if (commits.length === 250) return commits
      }
      if (items.length < 100) break
    }
    return commits
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

  return { metadata, documents, document, branches, commits, commitCount, commit, issues, workCounts, hasIssues, issue, issueComments, createIssueComment, updateIssueState, markIssueDuplicate, issueReferences, issueTimeline, pulls, pull, pullCommits, pullContext, runs }
}

const client = createGitHubClient(githubTransport)

export const loadGitHubMetadata = client.metadata
export const loadGitHubDocuments = client.documents
export const loadGitHubDocument = client.document
export const loadGitHubBranches = client.branches
export const loadGitHubCommits = client.commits
export const loadGitHubCommitCount = client.commitCount
export const loadGitHubCommit = client.commit
export const loadGitHubIssues = client.issues
export const loadGitHubWorkCounts = client.workCounts
export const loadGitHubHasIssues = client.hasIssues
export const loadGitHubIssue = client.issue
export const loadGitHubIssueComments = client.issueComments
export const createGitHubIssueComment = client.createIssueComment
export const updateGitHubIssueState = client.updateIssueState
export const markGitHubIssueDuplicate = client.markIssueDuplicate
export const loadGitHubIssueReferences = client.issueReferences
export const loadGitHubIssueTimeline = client.issueTimeline
export const loadGitHubPull = client.pull
export const loadGitHubPullCommits = client.pullCommits
export const loadGitHubPullContext = client.pullContext
export const loadGitHubPulls = client.pulls
export const loadGitHubRuns = client.runs
