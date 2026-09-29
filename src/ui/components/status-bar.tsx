import { Show } from "solid-js"
import { colors } from "../theme"

export type StatusKind = "refreshing" | "loading-more" | "refresh-error" | "load-more-error"

const messages: Record<StatusKind, { text: string; color: string }> = {
  refreshing: { text: "◌ Refreshing repository…", color: colors.muted },
  "loading-more": { text: "◌ Loading more…", color: colors.muted },
  "refresh-error": { text: "× Refresh failed", color: colors.red },
  "load-more-error": { text: "× Could not load more · press r to retry", color: colors.red },
}

export function StatusBar(props: { kind?: StatusKind }) {
  const message = () => props.kind ? messages[props.kind] : undefined

  return (
    <Show when={message()}>
      {(current) => (
        <box height={1} flexShrink={0} paddingLeft={2} paddingRight={2} backgroundColor={colors.panel}>
          <text fg={current().color}>{current().text}</text>
        </box>
      )}
    </Show>
  )
}
