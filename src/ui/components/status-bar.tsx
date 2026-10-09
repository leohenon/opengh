import { Show } from "solid-js"
import { colors } from "../theme"
import { LoadingText } from "./loading-text"

export type StatusKind =
  | "refreshing"
  | "switching-branch"
  | "loading-resource"
  | "loading-more"

const loadingMessages: Record<StatusKind, string> = {
  refreshing: "Refreshing…",
  "switching-branch": "Switching branch…",
  "loading-resource": "Loading…",
  "loading-more": "Loading more…",
}

export function StatusBar(props: { kind?: StatusKind; detail?: string }) {
  const loadingMessage = () => {
    if (!props.kind) return undefined
    if (props.kind === "loading-resource" && props.detail) return `Loading ${props.detail}…`
    return loadingMessages[props.kind]
  }

  return (
    <box
      height={1}
      flexShrink={0}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={colors.canvas}
    >
      <Show when={loadingMessage()}>
        {(message) => <LoadingText text={message()} />}
      </Show>
    </box>
  )
}
