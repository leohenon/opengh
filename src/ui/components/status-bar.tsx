import { Show } from "solid-js"
import { useTheme } from "../theme"
import { LoadingText } from "./loading-text"

export type StatusKind =
  | "refreshing"
  | "switching-branch"
  | "loading-resource"
  | "loading-more"
  | "posting-comment"
  | "closing-issue"
  | "reopening-issue"
  | "marking-duplicate"

const loadingMessages: Record<StatusKind, string> = {
  refreshing: "Refreshing…",
  "switching-branch": "Switching branch…",
  "loading-resource": "Loading…",
  "loading-more": "Loading more…",
  "posting-comment": "Posting comment…",
  "closing-issue": "Closing issue…",
  "reopening-issue": "Reopening issue…",
  "marking-duplicate": "Marking duplicate…",
}

export function StatusBar(props: { kind?: StatusKind; detail?: string; hint?: string; zIndex?: number }) {
  const { colors } = useTheme()
  const loadingMessage = () => {
    if (!props.kind) return undefined
    if (props.kind === "loading-resource" && props.detail) return `Loading ${props.detail}…`
    return loadingMessages[props.kind]
  }

  return (
    <box
      height={1}
      flexShrink={0}
      zIndex={props.zIndex ?? 0}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={colors.canvas}
    >
      <Show when={loadingMessage()} fallback={<text height={1} wrapMode="none" fg={colors.muted}>{props.hint ?? ""}</text>}>
        {(message) => <LoadingText text={message()} />}
      </Show>
    </box>
  )
}
