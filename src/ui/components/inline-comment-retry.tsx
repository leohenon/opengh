import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, onCleanup } from "solid-js"
import type { InlineCommentInput } from "../../review-types"
import { useKeyActions, useKeybindings } from "../keybindings"
import { useTheme } from "../theme"
import { Action } from "./action"
import { Popup } from "./popup"

export function InlineCommentRetryDialog(props: {
  input: InlineCommentInput
  onConfirm(): void
  onClose(): void
  onOpenGitHub(): void
  onHintChange(hint: string | undefined): void
}) {
  const { colors } = useTheme()
  const keys = useKeybindings()
  let scroll: ScrollBoxRenderable | undefined
  createEffect(() => props.onHintChange(keys.hints(["dialog.confirm", "retry"], ["item.open", "GitHub"], ["dialog.close", "cancel"])))
  onCleanup(() => props.onHintChange(undefined))
  useKeyActions({ "dialog.confirm": props.onConfirm, "dialog.close": props.onClose, "item.open": props.onOpenGitHub,
    "navigation.up": () => scroll?.scrollBy(-1), "navigation.down": () => scroll?.scrollBy(1),
    "navigation.pageUp": () => scroll?.scrollBy(-scroll.viewport.height), "navigation.pageDown": () => scroll?.scrollBy(scroll.viewport.height),
  }, { priority: 180, modal: true })
  return <Popup width={72} height={14} placement="center" zIndex={300} onClose={props.onClose}>
    <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
      <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Retry inline comment?</text>
      <text flexShrink={0} marginTop={1} wrapMode="word" fg={colors.yellow}>
        The earlier request may have succeeded. Check GitHub before retrying to avoid a duplicate. We will check again before sending.
      </text>
      <scrollbox id="inline-retry-body" ref={value => { scroll = value }} flexGrow={1} minHeight={0} marginTop={1} scrollY focusable={false}>
        <text flexShrink={0} wrapMode="word" fg={colors.text}>{`PR #${props.input.number} · ${props.input.anchor.path}:${props.input.anchor.line}\n\n${props.input.body}`}</text>
      </scrollbox>
      <box height={1} flexShrink={0} marginTop={1}>
        <Action id="inline-comment-retry-confirm" onActivate={props.onConfirm}>Retry posting</Action>
      </box>
    </box>
  </Popup>
}
