import { Show } from "solid-js"
import { colors } from "../theme"

export type StatusKind =
  | "refreshing"
  | "switching-branch"
  | "loading-resource"
  | "loading-more"
  | "refresh-error"
  | "resource-error"
  | "branch-error"
  | "load-more-error"

const messages: Record<StatusKind, { text: string; color: string }> = {
  refreshing: { text: "◌ Refreshing repository…", color: colors.muted },
  "switching-branch": { text: "◌ Switching branch…", color: colors.muted },
  "loading-resource": { text: "◌ Loading…", color: colors.muted },
  "loading-more": { text: "◌ Loading more…", color: colors.muted },
  "refresh-error": { text: "× Refresh failed", color: colors.red },
  "resource-error": { text: "× Could not load · press r to retry", color: colors.red },
  "branch-error": { text: "× Could not switch branch", color: colors.red },
  "load-more-error": { text: "× Could not load more · press r to retry", color: colors.red },
}

export function StatusBar(props: { kind?: StatusKind }) {
  const message = () => props.kind ? messages[props.kind] : undefined

  return (
    <box
      height={1}
      flexShrink={0}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={message() ? colors.panel : colors.canvas}
    >
      <Show when={message()}>
        {(current) => <text fg={current().color}>{current().text}</text>}
      </Show>
    </box>
  )
}
