import { expect, test } from "bun:test"
import type { CommitSummary, PullCommitEvent } from "../src/models"
import { buildActivity } from "../src/ui/activity"

const date = (hour: number, minute = 0, day = 5) => new Date(2026, 9, day, hour, minute).toISOString()
const sha = (letter: string) => letter.repeat(40)
const commit = (letter: string, hour: number, timelineIndex: number): PullCommitEvent => ({
  kind: "commit-added", event: "committed", id: `commit:${sha(letter)}`, sha: sha(letter),
  message: `Commit ${letter}`, author: "Git Author", createdAt: date(hour), timelineIndex,
  url: `https://github.com/owner/repo/commit/${sha(letter)}`,
})

test("activity deduplicates commit sources, groups only adjacent same-day commits, and keeps GitHub batch order", () => {
  const a = commit("a", 10, 0)
  const b = commit("b", 9, 1) // Rewritten commit dates do not reverse GitHub's sequence within a batch.
  const c = commit("c", 11, 2)
  const metadata: CommitSummary[] = [a, b, c].map((entry) => ({ sha: entry.sha, message: entry.message, author: "github-login",
    date: "2010-01-01T00:00:00Z", committedAt: entry.createdAt }))
  metadata.push({ sha: sha("d"), message: "Fallback", author: "alice", date: "2010-01-01T00:00:00Z", committedAt: date(12) })
  metadata.push({ sha: sha("e"), message: "Unknown commit time", author: "alice", date: "2010-01-01T00:00:00Z" })
  const result = buildActivity({
    comments: [{ id: 1, author: "reviewer", authorAssociation: "MEMBER", body: "Please update this.", createdAt: date(10, 30), updatedAt: date(10, 30) }],
    references: [], threads: [], commits: metadata, pullUrl: "https://github.com/owner/repo/pull/42",
    events: [a, b, c, { kind: "force-push", event: "head_ref_force_pushed", id: "force-push:1", actor: "alice", createdAt: date(11, 30) }],
  })
  expect(result.map((entry) => "kind" in entry ? entry.kind : "comment")).toEqual([
    "commit-group", "comment", "commit-group", "force-push", "commit-group", "commit-group",
  ])
  const groups = result.filter((entry) => "kind" in entry && entry.kind === "commit-group")
  expect(groups[0]?.commits.map((entry) => entry.sha)).toEqual([sha("a"), sha("b")])
  expect(groups[0]?.commits[0]?.author).toBe("github-login")
  expect(groups.flatMap((entry) => entry.commits)).toHaveLength(5)
  expect(groups[2]?.createdAt).toBe(date(12))
  expect(groups[3]?.createdAt).toBeUndefined() // Never use the old authored date as an addition timestamp.
  const days = buildActivity({ comments: [], references: [], threads: [], events: [a, { ...c, createdAt: date(0, 10, 6) }] })
  expect(days).toHaveLength(2)
})

test("inline threads replace only their empty comment-review timeline entries", () => {
  const review = (id: number, state: import("../src/models").PullReviewState = "commented", body = ""): import("../src/models").PullReviewEvent => ({
    kind: "review", event: "reviewed", id: `review:${id}`, reviewId: id, actor: "alice", createdAt: date(10),
    state, body, authorAssociation: "OWNER", url: `https://github.com/owner/repo/pull/1#pullrequestreview-${id}`,
  })
  const events = [review(1, "commented", "  "), review(2, "approved"), review(3, "changes_requested"), review(4, "commented", "Summary"), review(5), review(6, "dismissed")]
  const threads: import("../src/models").PullReviewThread[] = [{
    kind: "review-thread", id: "thread", path: "README.md", line: 4, isResolved: false, isOutdated: false, createdAt: date(10),
    comments: [1, 2, 3, 4, 6].map(id => ({ id: `comment:${id}`, reviewId: id, author: "alice", authorAssociation: "OWNER", body: "Inline feedback",
      createdAt: date(10), updatedAt: date(10), url: "https://github.com/owner/repo/pull/1" })),
  }]
  const result = buildActivity({ comments: [], references: [], events, threads })
  expect(result.filter(entry => "kind" in entry && entry.kind === "review").map(entry => entry.id)).toEqual(["review:2", "review:3", "review:4", "review:5", "review:6"])
  expect(result).toContain(threads[0]!)
  expect(buildActivity({ comments: [], references: [], events: [events[0]!], threads: [] })).toEqual([events[0]!])
})
