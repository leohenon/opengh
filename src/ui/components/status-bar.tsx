import { useTerminalDimensions } from "@opentui/solid"
import { Show } from "solid-js"
import { useTheme } from "../theme"
import { LoadingText } from "./loading-text"

export type StatusKind =
  | "refreshing"
  | "switching-branch"
  | "loading-resource"
  | "loading-more"
  | "posting-comment"
  | "marking-draft"
  | "marking-ready"
  | "merging-pull"
  | "closing-pull"
  | "reopening-pull"
  | "closing-issue"
  | "reopening-issue"
  | "marking-duplicate"
  | "updating-issue"

const loadingMessages: Record<StatusKind, string> = {
  refreshing: "Refreshing…",
  "switching-branch": "Switching branch…",
  "loading-resource": "Loading…",
  "loading-more": "Loading more…",
  "posting-comment": "Posting comment…",
  "marking-draft": "Marking PR as draft…",
  "marking-ready": "Marking PR ready for review…",
  "merging-pull": "Merging PR…",
  "closing-pull": "Closing PR…",
  "reopening-pull": "Reopening PR…",
  "closing-issue": "Closing issue…",
  "reopening-issue": "Reopening issue…",
  "marking-duplicate": "Marking duplicate…",
  "updating-issue": "Saving assignees…",
}

export function StatusBar(props: { kind?: StatusKind; detail?: string; hint?: string; zIndex?: number }) {
  const { colors } = useTheme()
  const dimensions = useTerminalDimensions()
  const hint = () => {
    const parts = (props.hint ?? "").split(" · ")
    // Drop lower-priority shortcuts rather than clipping or renaming their labels.
    const message = loadingMessage()
    const available = dimensions().width - 4 - (message ? Bun.stringWidth(message) + 5 : 0)
    while (parts.length && Bun.stringWidth(parts.join(" · ")) > available) parts.pop()
    return parts.join(" · ")
  }
  const loadingMessage = () => {
    if (!props.kind) return undefined
    if (props.kind === "loading-resource" && props.detail) return `Loading ${props.detail}…`
    return loadingMessages[props.kind]
  }

  // Keep the footer row even with hints off, so loading feedback never resizes
  // the viewport (a single line can change a list's capacity by a whole item).
  return (
    <box
      height={1}
      flexShrink={0}
      flexDirection="row"
      overflow="hidden"
      zIndex={props.zIndex ?? 0}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={colors.canvas}
    >
      <Show when={loadingMessage()}>
        {(message) => (
          <box width={Math.min(Bun.stringWidth(message()) + 2, Math.max(0, dimensions().width - 4))} height={1} flexShrink={0} overflow="hidden">
            <LoadingText text={message()} />
          </box>
        )}
      </Show>
      <text height={1} wrapMode="none" fg={colors.muted}>{loadingMessage() && hint() ? " · " : ""}{hint()}</text>
    </box>
  )
}
