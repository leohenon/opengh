import type { GitHubData, Issue, ListState, PullRequest, Run } from "../models"

async function ghJson(path: string): Promise<any> {
  const process = Bun.spawn(["gh", "api", path], { stdout: "pipe", stderr: "pipe" })
  const [output, error, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (code !== 0) throw new Error(error.trim() || `gh api failed (${code})`)
  return JSON.parse(output)
}

async function ghText(path: string): Promise<string> {
  const process = Bun.spawn(["gh", "api", path, "-H", "Accept: application/vnd.github.raw+json"], { stdout: "pipe", stderr: "pipe" })
  const [output, error, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (code !== 0) throw new Error(error.trim() || `gh api failed (${code})`)
  return output
}

function firstLine(value: string | null | undefined) {
  return value?.split("\n")[0]?.trim() || "No description provided."
}

function issue(item: any): Issue {
  return {
    number: item.number,
    state: item.state === "closed" ? "closed" : "open",
    title: item.title,
    author: item.user?.login ?? "ghost",
    labels: (item.labels ?? []).map((label: any) => typeof label === "string" ? label : label.name),
    comments: item.comments ?? 0,
    createdAt: item.created_at,
    body: firstLine(item.body),
  }
}

const PAGE_SIZE = 30

function commits(items: any[]) {
  return items.map((item: any) => ({
    sha: item.sha.slice(0, 7),
    message: firstLine(item.commit?.message),
    author: item.author?.login ?? item.commit?.author?.name ?? "ghost",
    date: item.commit?.author?.date,
  }))
}

export async function loadGitHubReadme(nameWithOwner: string, branch: string) {
  return ghText(
    `repos/${nameWithOwner}/readme?ref=${encodeURIComponent(branch)}`,
  ).catch(() => "No README found.")
}

export async function loadGitHubCommits(nameWithOwner: string, branch: string, page = 1) {
  const branchQuery = branch ? `&sha=${encodeURIComponent(branch)}` : ""
  const items = await ghJson(
    `repos/${nameWithOwner}/commits?per_page=${PAGE_SIZE}&page=${page}${branchQuery}`,
  )
  return { items: commits(items), hasMore: items.length === PAGE_SIZE }
}

export async function loadGitHubIssues(nameWithOwner: string, state: ListState, page = 1) {
  const items = await ghJson(
    `repos/${nameWithOwner}/issues?state=${state}&per_page=${PAGE_SIZE}&page=${page}`,
  )
  return {
    items: items.filter((item: any) => !item.pull_request).map(issue),
    hasMore: items.length === PAGE_SIZE,
  }
}

export async function loadGitHubPulls(nameWithOwner: string, state: ListState, page = 1) {
  const items = await ghJson(
    `repos/${nameWithOwner}/pulls?state=${state}&per_page=${PAGE_SIZE}&page=${page}`,
  )
  return {
    items: items.map((item: any): PullRequest => ({
      ...issue(item),
      branch: item.head?.ref ?? "unknown",
      draft: item.draft ?? false,
    })),
    hasMore: items.length === PAGE_SIZE,
  }
}

export async function loadGitHubRuns(nameWithOwner: string, page = 1) {
  const response = await ghJson(
    `repos/${nameWithOwner}/actions/runs?per_page=${PAGE_SIZE}&page=${page}`,
  )
  const items: Run[] = (response.workflow_runs ?? []).map((item: any) => ({
    id: item.id,
    name: item.name,
    title: item.display_title,
    branch: item.head_branch,
    event: item.event,
    status: item.status,
    conclusion: item.conclusion ?? "",
    createdAt: item.created_at,
  }))
  return { items, hasMore: page * PAGE_SIZE < (response.total_count ?? items.length) }
}

export async function loadGitHubData(nameWithOwner: string): Promise<GitHubData> {
  const [repo, readme, openIssues, closedIssues, openPulls, closedPulls, runs, branches, commitPage] = await Promise.all([
    ghJson(`repos/${nameWithOwner}`),
    ghText(`repos/${nameWithOwner}/readme`).catch(() => "No README found."),
    loadGitHubIssues(nameWithOwner, "open"),
    loadGitHubIssues(nameWithOwner, "closed"),
    loadGitHubPulls(nameWithOwner, "open"),
    loadGitHubPulls(nameWithOwner, "closed"),
    loadGitHubRuns(nameWithOwner, 1),
    ghJson(`repos/${nameWithOwner}/branches?per_page=100`),
    loadGitHubCommits(nameWithOwner, "", 1),
  ])

  return {
    repo: {
      nameWithOwner: repo.full_name,
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
    },
    readme,
    issues: [...openIssues.items, ...closedIssues.items],
    pulls: [...openPulls.items, ...closedPulls.items],
    runs: runs.items,
    branches: branches.length
      ? branches.map((branch: any) => branch.name)
      : [repo.default_branch],
    currentBranch: repo.default_branch,
    commits: commitPage.items,
    commitsPage: { page: 1, hasMore: commitPage.hasMore },
    runsPage: { page: 1, hasMore: runs.hasMore },
    issuesPage: {
      open: { page: 1, hasMore: openIssues.hasMore },
      closed: { page: 1, hasMore: closedIssues.hasMore },
    },
    pullsPage: {
      open: { page: 1, hasMore: openPulls.hasMore },
      closed: { page: 1, hasMore: closedPulls.hasMore },
    },
  }
}
