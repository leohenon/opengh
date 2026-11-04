import { createMemo, For, Show } from "solid-js"
import type { IssueTimelineEvent, PullReviewState } from "../../models"
import { currentPullReviews, reviewColor } from "../pull-reviews"
import { useTheme } from "../theme"
import { MetadataField } from "./detail-metadata"

const labels: Record<PullReviewState, string> = {
  approved: "Approved", changes_requested: "Changes requested", dismissed: "Dismissed", commented: "Commented",
}

export function PullReviewSummary(props: { events: readonly IssueTimelineEvent[]; compact: boolean }) {
  const { colors } = useTheme()
  const reviews = createMemo(() => currentPullReviews(props.events))
  return (
    <MetadataField label="Reviews" compact={props.compact} muted={!reviews().length}>
      <Show when={reviews().length} fallback="No reviews">
        <For each={reviews()}>
          {(review, index) => (
            <>
              <Show when={index() > 0}>
                <Show when={props.compact} fallback={<br />}>{" · "}</Show>
              </Show>
              <Show when={review.actor} fallback="ghost">{(login) => <a href={`https://github.com/${login()}`}>{login()}</a>}</Show>{" "}
              <span style={{ fg: reviewColor(colors, review.state) }}>
                <a href={review.url}>{labels[review.state]}</a>
              </span>
            </>
          )}
        </For>
      </Show>
    </MetadataField>
  )
}
