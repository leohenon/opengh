import { Show } from "solid-js"
import { colors } from "../theme"
import { LoadingText } from "./loading-text"

export type StatusKind =
  | "refreshing"
  | "switching-branch"
  | "loading-resource"
  | "loading-more"
  | "refresh-error"
  | "resource-error"
  | "branch-error"
  | "load-more-error"

const loadingMessages: Partial<Record<StatusKind, string>> = {
  refreshing: "Refreshing…",
  "switching-branch": "Switching branch…",
  "loading-resource": "Loading…",
  "loading-more": "Loading more…",
}

const errorMessages: Partial<Record<StatusKind, string>> = {
  "refresh-error": "× Refresh failed",
  "resource-error": "× Could not load · press r to retry",
  "branch-error": "× Could not switch branch",
  "load-more-error": "× Could not load more · press r to retry",
}

export function StatusBar(props: { kind?: StatusKind }) {
  const loadingMessage = () => props.kind ? loadingMessages[props.kind] : undefined
  const errorMessage = () => props.kind ? errorMessages[props.kind] : undefined

  return (
    <box
      height={1}
      flexShrink={0}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={errorMessage() ? colors.panel : colors.canvas}
    >
      <Show when={loadingMessage()}>
        {(message) => <LoadingText text={message()} />}
      </Show>
      <Show when={errorMessage()}>
        {(message) => <text fg={colors.red}>{message()}</text>}
      </Show>
    </box>
  )
}
