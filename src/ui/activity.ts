import type { CommitSummary, IssueComment, IssueReference, IssueTimelineEvent, PullCommitEvent, PullReviewThread } from "../models"
import { calendarDay } from "./format"

export type ActivityCommit = Omit<PullCommitEvent, "createdAt"> & { createdAt?: string }
export type CommitGroup = { kind: "commit-group"; id: string; createdAt?: string; commits: ActivityCommit[] }
type ActivityItem = IssueComment | IssueReference | Exclude<IssueTimelineEvent, PullCommitEvent> | PullReviewThread
export type ActivityEntry = ActivityItem | CommitGroup

function timestamp(iso?: string) {
  const value = Date.parse(iso ?? "")
  return Number.isFinite(value) ? value : Infinity
}

export function buildActivity(props: {
  comments: readonly IssueComment[]
  references: readonly IssueReference[]
  events: readonly IssueTimelineEvent[]
  threads: readonly PullReviewThread[]
  commits?: readonly CommitSummary[]
  pullUrl?: string
}): ActivityEntry[] {
  const metadata = new Map(props.commits?.map((commit) => [commit.sha.toLowerCase(), commit]))
  const seen = new Set<string>()
  const entries: Array<ActivityItem | ActivityCommit> = [...props.comments, ...props.references, ...props.threads]
  const hasTimelineCommits = props.events.some((event) => event.kind === "commit-added")
  const inlineReviews = new Set(props.threads.flatMap((thread) => thread.comments.flatMap((comment) =>
    comment.reviewId === undefined ? [] : [comment.reviewId])))
  for (const event of props.events) {
    // An inline-only COMMENTED review adds no information beyond its visible thread.
    if (event.kind === "review" && event.state === "commented" && !event.body.trim() && inlineReviews.has(event.reviewId)) continue
    if (event.kind !== "commit-added") { entries.push(event); continue }
    const sha = event.sha.toLowerCase()
    if (seen.has(sha)) continue
    seen.add(sha)
    const commit = metadata.get(sha)
    entries.push({ ...event, sha, author: commit?.author && commit.author !== "ghost" ? commit.author : event.author })
  }
  for (const [index, commit] of (props.commits ?? []).entries()) {
    const sha = commit.sha.toLowerCase()
    if (seen.has(sha)) continue
    seen.add(sha)
    entries.push({
      kind: "commit-added", event: "committed", id: `commit:${sha}`, sha,
      message: commit.message, author: commit.author,
      // An authored date does not establish when a commit entered the PR.
      createdAt: commit.committedAt,
      url: `${props.pullUrl ?? ""}/commits/${sha}`,
      timelineIndex: hasTimelineCommits ? undefined : index,
    })
  }
  entries.sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt))
  const result: ActivityEntry[] = []
  for (const entry of entries) {
    if (!("kind" in entry) || entry.kind !== "commit-added") { result.push(entry); continue }
    const previous = result.at(-1)
    if (previous && "kind" in previous && previous.kind === "commit-group"
      && calendarDay(previous.createdAt) === calendarDay(entry.createdAt)) previous.commits.push(entry)
    else result.push({ kind: "commit-group", id: `commits:${entry.sha}`, createdAt: entry.createdAt, commits: [entry] })
  }
  for (const entry of result) {
    if (!("kind" in entry) || entry.kind !== "commit-group") continue
    // Preserve GitHub's order within a contiguous batch, even after a rebase.
    if (entry.commits.every((commit) => commit.timelineIndex !== undefined))
      entry.commits.sort((a, b) => a.timelineIndex! - b.timelineIndex!)
  }
  return result
}
