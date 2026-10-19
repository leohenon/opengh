import type { IssueTimelineEvent, PullReviewEvent, PullReviewState } from "../models"
import type { AppColors } from "../theme"

// A comment-only review does not revoke a reviewer's existing decision.
export function currentPullReviews(events: readonly IssueTimelineEvent[]): PullReviewEvent[] {
  const latest = new Map<string, PullReviewEvent>()
  const reviews = events.filter((event): event is PullReviewEvent => event.kind === "review")
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.reviewId - b.reviewId)
  for (const review of reviews) {
    // Deleted authors are distinct unknown reviewers, not one shared "ghost" voter.
    const key = !review.actor || review.actor.toLowerCase() === "ghost"
      ? `review:${review.reviewId}` : `user:${review.actor.toLowerCase()}`
    const previous = latest.get(key)
    if (review.state !== "commented" || !previous || previous.state === "commented") latest.set(key, review)
  }
  return [...latest.values()]
}

export function reviewColor(colors: AppColors, state: PullReviewState): string {
  return state === "approved" ? colors.green : state === "changes_requested" ? colors.red : colors.muted
}
