import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { onMount, Show } from "solid-js"
import type { UpdateNotice } from "../../update-check"
import { useTheme } from "../theme"
import { LoadingText } from "./loading-text"
import { fitText } from "../format"

export type StatusKind =
  | "refreshing"
  | "switching-branch"
  | "loading-resource"
  | "loading-more"
  | "submitting-review"
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
  "submitting-review": "Submitting review…",
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

// Preserve priority and whole labels, but do not let one oversized shortcut
// consume the remaining width when a shorter useful hint can still fit.
export function fitStatusHints(hint: string | undefined, available: number) {
  const visible: string[] = []
  for (const part of (hint ?? "").split(" · ").filter(Boolean)) {
    if (Bun.stringWidth([...visible, part].join(" · ")) <= available) visible.push(part)
  }
  return visible.join(" · ")
}

function StatusTip(props: { label: string; onShown?: () => void }) {
  const { colors } = useTheme()
  onMount(() => props.onShown?.())
  return (
    <text id="status-tip" height={1} wrapMode="none" fg={colors.muted}>
      {props.label}
    </text>
  )
}

export function StatusBar(props: {
  kind?: StatusKind
  detail?: string
  error?: string
  context?: string
  hint?: string
  tip?: string
  onTipShown?: () => void
  zIndex?: number
  updateNotice?: UpdateNotice
}) {
  const { colors } = useTheme()
  const dimensions = useTerminalDimensions()
  const hint = () => {
    if (!props.error && loadingMessage()) return ""
    const message = props.error ? `× ${props.error}` : context()
    const available = dimensions().width - 4 - (message ? Bun.stringWidth(message) + (props.error ? 5 : 3) : 0)
    return fitStatusHints(props.hint, available)
  }
  const context = () => (props.error || loadingMessage() ? undefined : props.context)
  const loadingMessage = () => {
    if (!props.kind) return undefined
    if (props.kind === "loading-resource" && props.detail) return `Loading ${props.detail}…`
    return loadingMessages[props.kind]
  }

  const visibleTip = () => {
    const tip = props.tip
    if (tip && !props.error && !loadingMessage() && !context() && Bun.stringWidth(tip) <= dimensions().width - 4) return tip
    return undefined
  }
  const updateLabel = () => (props.updateNotice ? `↑ v${props.updateNotice.latestVersion} available` : "")
  const showUpdate = () => {
    if (!props.updateNotice || props.error || loadingMessage()) return false
    const used =
      Bun.stringWidth(visibleTip() ?? "") || Bun.stringWidth(context() ?? "") + Bun.stringWidth(hint()) + (context() && hint() ? 3 : 0)
    return used + (used ? 2 : 0) + Bun.stringWidth(updateLabel()) <= dimensions().width - 4
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
      <Show when={props.error}>
        {(message) => (
          <text height={1} flexShrink={1} minWidth={0} wrapMode="none" fg={colors.red}>
            {fitText(`× ${message()}`, Math.max(0, dimensions().width - 4))}
          </text>
        )}
      </Show>
      <Show when={!props.error && loadingMessage()}>
        {(message) => (
          <box
            width={Math.min(Bun.stringWidth(message()) + 2, Math.max(0, dimensions().width - 4))}
            height={1}
            flexShrink={0}
            overflow="hidden"
          >
            <LoadingText text={message()} />
          </box>
        )}
      </Show>
      <Show when={context()}>
        {(label) => (
          <text id="status-context" height={1} flexShrink={1} minWidth={0} wrapMode="none" fg={colors.blue}>
            {fitText(label(), Math.max(0, dimensions().width - 4))}
          </text>
        )}
      </Show>
      <Show
        when={visibleTip()}
        fallback={
          <Show when={hint()}>
            <text height={1} wrapMode="none" fg={colors.muted}>
              {props.error || loadingMessage() || context() ? " · " : ""}
              {hint()}
            </text>
          </Show>
        }
      >
        {(label) => <StatusTip label={label()} onShown={props.onTipShown} />}
      </Show>
      <Show when={showUpdate()}>
        <box flexGrow={1} minWidth={0} />
        <text
          id="status-update"
          height={1}
          flexShrink={0}
          wrapMode="none"
          fg={colors.blue}
          attributes={TextAttributes.DIM}
          selectable={false}
        >
          {updateLabel()}
        </text>
      </Show>
    </box>
  )
}
