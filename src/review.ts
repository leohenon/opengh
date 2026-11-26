import type { createGitHubClient } from "./github/client"
import { createRequestBudget, MAX_AUTOMATIC_PAGES, RequestBudgetLimitError, type RequestBudget } from "./github/request-budget"
import type { RequestOptions } from "./github/transport"
import type {
  CommitDetail,
  CommitFile,
  DiffContent,
  DiffTarget,
  IssueComment,
  PullContext,
  PullRequestDetail,
  PullReviewEvent,
  PullReviewThread,
} from "./models"
import { parsePatchFiles, type PatchFile } from "./patch-files"

export type ReviewClient = ReturnType<typeof createGitHubClient>
export type DiffLoader = (
  repository: string,
  target: DiffTarget,
  signal: AbortSignal,
  filesOnly?: boolean,
  budget?: RequestBudget,
) => Promise<DiffContent>
type ChangeTotals = { files: number; additions: number; deletions: number }

async function pages<T>(load: (page: number) => Promise<{ items: T[]; hasMore: boolean }>, limit: number): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; ; page++) {
    if (page > limit) throw new RequestBudgetLimitError("Listing exceeded the page limit")
    const result = await load(page)
    items.push(...result.items)
    if (!result.hasMore) return items
  }
}

const moved = () => new Error("The PR changed while loading review context. Refresh before reviewing.")
const fullSha = /^[a-f\d]{40}$/i

function revision(value: string | undefined) {
  if (value === undefined) return null
  if (!fullSha.test(value)) throw new Error("GitHub returned an invalid PR head commit. Refresh before reviewing.")
  return value.toLowerCase()
}
const sameSha = (left?: string | null, right?: string | null) => !left || !right || left.toLowerCase() === right.toLowerCase()

async function loadPatch(repository: string, target: DiffTarget, loadDiff: DiffLoader, budget: RequestBudget) {
  const content = await loadDiff(repository, target, budget.signal, false, budget)
  if (content.kind !== "patch") throw new Error("The requested patch is unavailable; GitHub returned only a file list.")
  return content
}

function changedPatchFiles(patch: string, expected: ChangeTotals, complete: boolean) {
  const files = parsePatchFiles(patch)
  if (files.length < expected.files || (complete && files.length !== expected.files))
    throw new Error(
      `The patch covers ${files.length} files, but GitHub reports ${expected.files}${complete ? "" : " or more"} changed files.`,
    )
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
  if (additions !== expected.additions || deletions !== expected.deletions)
    throw new Error(`The patch has +${additions} −${deletions}, but GitHub reports +${expected.additions} −${expected.deletions}.`)
  return files
}

function selectFile(files: PatchFile[], path?: string) {
  if (path === undefined) return { files }
  const selected = files.find((file) => file.path === path)
  if (!selected) throw new Error(`No changed file matches --file “${path}”.`)
  return { files: [selected], selected }
}

function threadMatches(thread: PullReviewThread, selected?: PatchFile) {
  return !selected || thread.path === selected.path || (selected.previousPath !== null && thread.path === selected.previousPath)
}

export const truncationWarning = "GitHub truncated the changed-file list; it may be incomplete."

export type PullReview = {
  detail: PullRequestDetail
  comments: IssueComment[]
  reviews: PullReviewEvent[]
  context: PullContext
  threads: PullReviewThread[]
  revisions: { head: string; base: string }
  patch: string
}

export async function loadPullReview(
  repository: string,
  number: number,
  client: ReviewClient,
  loadDiff: DiffLoader,
  file?: string,
): Promise<PullReview> {
  const budget = createRequestBudget()
  const request: RequestOptions = { budget, signal: budget.signal }
  try {
    const [detail, comments, timeline, context] = await Promise.all([
      client.pull(repository, number, request),
      pages((page) => client.issueComments(repository, number, page, request), MAX_AUTOMATIC_PAGES),
      client.issueTimeline(repository, number, request),
      client.pullContext(repository, number, request, "threads"),
    ])
    const head = context.readiness.headSha
    if (!sameSha(revision(detail.headSha), head)) throw moved()
    const content = await loadPatch(repository, { kind: "pull", number }, loadDiff, budget)
    if (!content.headSha || !content.baseSha) throw new Error("GitHub did not identify the PR diff commits. Refresh before reviewing.")
    if (!sameSha(head, content.headSha) || !sameSha(detail.headSha, content.headSha) || !sameSha(detail.baseSha, content.baseSha))
      throw moved()
    const parsed = changedPatchFiles(
      content.patch,
      { files: detail.changedFiles, additions: detail.additions, deletions: detail.deletions },
      true,
    )
    const { files, selected } = selectFile(parsed, file)
    return {
      detail,
      comments,
      context,
      reviews: timeline.events.filter((event): event is PullReviewEvent => event.kind === "review"),
      threads: context.threads.filter((thread) => threadMatches(thread, selected)),
      revisions: { head: content.headSha.toLowerCase(), base: content.baseSha.toLowerCase() },
      patch: files.map((file) => file.patch).join(""),
    }
  } finally {
    budget.dispose()
  }
}

export type CommitReview = {
  commit: CommitDetail
  files: CommitFile[]
  truncated: boolean
  patch: string
}

export async function loadCommitReview(
  repository: string,
  sha: string,
  client: ReviewClient,
  loadDiff: DiffLoader,
  file?: string,
): Promise<CommitReview> {
  const budget = createRequestBudget()
  const request: RequestOptions = { budget, signal: budget.signal }
  try {
    const commit = await client.commit(repository, sha, undefined, request)
    if (!fullSha.test(commit.sha)) throw new Error("GitHub did not identify the commit. Try again.")
    let files = [...commit.files.items]
    let current = commit
    while (current.files.hasMore) {
      current = await client.commit(repository, commit.sha, current.files.page + 1, request)
      files.push(...current.files.items)
    }
    const content = await loadPatch(repository, { kind: "commit", sha: commit.sha }, loadDiff, budget)
    const parsed = changedPatchFiles(
      content.patch,
      { files: files.length, additions: commit.additions, deletions: commit.deletions },
      !current.filesTruncated,
    )
    const { files: patchFiles, selected } = selectFile(parsed, file)
    if (selected)
      files = [
        files.find((file) => file.path === selected.path) ?? {
          path: selected.path,
          ...(selected.previousPath === null ? {} : { previousPath: selected.previousPath }),
          status: selected.status,
          additions: selected.additions,
          deletions: selected.deletions,
        },
      ]
    return { commit, files, truncated: current.filesTruncated, patch: patchFiles.map((file) => file.patch).join("") }
  } finally {
    budget.dispose()
  }
}
