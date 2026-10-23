import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import type { ReactionKind, ReactionState, ReactionTarget } from "../../models"
import type { ReactionActionState } from "../../repository-state"
import { mouseClick, mouseHover } from "../mouse"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { scrollRowIntoView } from "../scroll-selection"
import { useKeyActions } from "../keybindings"
import { useTheme } from "../theme"
import { Popup } from "./popup"
import { reactionLabels } from "./reactions"

export type ReactionMessage = { target: ReactionTarget; state: Partial<ReactionState> }

export function ReactionPicker(props: {
  message: ReactionMessage
  action: (target: ReactionTarget) => ReactionActionState
  onAdd: (target: ReactionTarget, kind: ReactionKind) => void
  onClose: () => void
  showScrollbar: boolean
}) {
  const { colors } = useTheme()
  const [selected, setSelected] = createSignal(0)
  let list: ScrollBoxRenderable | undefined
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  const revealSelection = () => scrollRowIntoView(list, selected(), 1)
  createEffect(revealSelection)
  onCleanup(() => list?.viewport.off("resize", revealSelection))
  const operation = () => props.action(props.message.target).operation
  const error = () => { const current = operation(); return current.status === "error" ? current.message : undefined }
  const disabled = (kind: ReactionKind) => props.message.state.canReact === false
    || operation().status === "loading" || props.message.state.viewerReactions?.includes(kind) === true
  const activate = (index: number) => {
    const kind = reactionLabels[index]?.[0]
    if (!kind || disabled(kind)) return
    setSelected(index)
    props.onAdd(props.message.target, kind)
  }
  useKeyActions({
    "dialog.close": () => props.onClose(),
    "navigation.up": () => setSelected((index) => Math.max(0, index - 1)),
    "navigation.down": () => setSelected((index) => Math.min(reactionLabels.length - 1, index + 1)),
    "navigation.activate": () => activate(selected()),
  }, { priority: 100, modal: true })
  return (
    <Popup width={40} height={reactionLabels.length + 5 + (error() ? 2 : 0)} onClose={props.onClose}>
      <box id="reaction-picker" focusable focused
        onPaste={(event) => { event.preventDefault(); event.stopPropagation() }}
        flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>Reactions</text>
          <Show when={operation().status === "loading"}><text fg={colors.muted}>Adding…</text></Show>
        </box>
        <box height={1} flexShrink={0} />
        <scrollbox focusable={false} flexGrow={1} minHeight={0} scrollY scrollX={false}
          ref={(value) => { list = value; bindScrollbar(value); value.viewport.on("resize", revealSelection) }}>
          <For each={reactionLabels}>{([kind, emoji], index) => {
            const enabled = () => !disabled(kind)
            const hover = mouseHover(enabled, () => kind)
            return (
              <box id={`reaction-picker-row-${kind}`} height={1} flexShrink={0} paddingX={1} flexDirection="row"
                backgroundColor={selected() === index() || hover.hovered() ? colors.panelHover : colors.panel}
                {...mouseClick(() => activate(index()), enabled, () => kind, hover)}>
                <text width={2} selectable={false} fg={colors.blue}>{selected() === index() ? "›" : " "}</text>
                <text height={1} wrapMode="none" selectable={false} fg={disabled(kind) ? colors.muted : colors.text}>
                  {emoji} {kind} · {props.message.state.reactions?.[kind] ?? 0}
                  {props.message.state.viewerReactions?.includes(kind) ? " · ✓ added" : props.message.state.canReact === false ? " · unavailable" : ""}
                </text>
              </box>
            )
          }}</For>
        </scrollbox>
        <Show when={error()}>
          <scrollbox height={2} flexShrink={0} focusable={false} scrollY scrollX={false}>
            <text width="100%" fg={colors.red}>{error()}</text>
          </scrollbox>
        </Show>
      </box>
    </Popup>
  )
}
