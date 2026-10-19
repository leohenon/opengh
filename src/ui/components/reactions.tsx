import { createMemo, Show } from "solid-js"
import type { ReactionCounts, ReactionKind } from "../../models"
import { useTheme } from "../theme"

const reactions: readonly [ReactionKind, string][] = [
  ["+1", "👍"], ["-1", "👎"], ["laugh", "😄"], ["hooray", "🎉"],
  ["confused", "😕"], ["heart", "❤️"], ["rocket", "🚀"], ["eyes", "👀"],
]

export function Reactions(props: { counts?: ReactionCounts }) {
  const { colors } = useTheme()
  const content = createMemo(() => reactions
    .filter(([kind]) => (props.counts?.[kind] ?? 0) > 0)
    .map(([kind, emoji]) => `${emoji} ${props.counts![kind]}`)
    .join("  "))
  return (
    <Show when={content()}>
      <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>{content()}</text>
    </Show>
  )
}
