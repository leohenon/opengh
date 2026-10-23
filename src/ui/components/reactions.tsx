import { createEffect, createMemo, For, Show } from "solid-js"
import type { ReactionCounts, ReactionKind, ReactionState, ReactionTarget } from "../../models"
import type { ReactionActionState } from "../../repository-state"
import { reactionKey } from "../../reactions"
import { useTheme } from "../theme"
import { mouseClick, mouseContextMenu, mouseDoubleClick, mouseHover, type MousePosition } from "../mouse"

export const reactionLabels: readonly [ReactionKind, string][] = [
  ["+1", "👍"], ["-1", "👎"], ["laugh", "😄"], ["hooray", "🎉"],
  ["confused", "😕"], ["heart", "❤️"], ["rocket", "🚀"], ["eyes", "👀"],
]

export type ReactionControls = {
  action: (target: ReactionTarget) => ReactionActionState
  add: (target: ReactionTarget, kind: ReactionKind) => void
  open: (target: ReactionTarget) => void
  context: (target: ReactionTarget, body: string, position: MousePosition) => void
}

export function Reactions(props: {
  counts?: ReactionCounts
  viewerReactions?: ReactionState["viewerReactions"]
  canReact?: boolean
  target?: ReactionTarget
  controls?: ReactionControls
  interactive?: boolean
}) {
  const { colors } = useTheme()
  const kinds = createMemo(() => reactionLabels.filter(([kind]) => (props.counts?.[kind] ?? 0) > 0))
  const supported = () => !!props.controls && !!props.target
  const action = () => props.target && props.controls?.action(props.target)
  const error = () => { const operation = action()?.operation; return operation?.status === "error" ? operation.message : undefined }
  const pending = () => action()?.operation.status === "loading"
  const disabled = () => !props.interactive || props.canReact === false || pending()
  const selected = (kind: ReactionKind) => props.viewerReactions?.includes(kind) === true
  const id = () => props.target ? `reaction-${reactionKey(props.target)}` : "reaction-readonly"
  const identity = () => `${id()}:${props.target?.nodeId ?? ""}`
  return (
    <Show when={kinds().length || pending() || error()}>
      <box width="100%" minWidth={0} flexShrink={0} marginTop={1} flexDirection="column">
        <box flexDirection="row" flexWrap="wrap" flexShrink={0} gap={1}>
          <For each={kinds()}>{([kind, emoji]) => (
            <Show when={supported()} fallback={<text fg={colors.muted}>{emoji} {props.counts?.[kind]}</text>}>
              <text id={`${id()}-${kind}`} height={1} flexShrink={0} selectable={false} wrapMode="none" fg={selected(kind) ? colors.text : colors.muted}
                {...mouseClick(() => props.controls?.add(props.target!, kind), () => !disabled() && !selected(kind), identity)}>
                {selected(kind) ? "✓ " : ""}{emoji} {props.counts?.[kind]}
              </text>
            </Show>
          )}</For>
          <Show when={pending()}><text fg={colors.muted}>Adding {action()?.kind}…</text></Show>
          <Show when={supported() && props.canReact === false}><text fg={colors.muted}>Reactions unavailable</text></Show>
        </box>
        <Show when={error()}>
          <text width="100%" fg={colors.red}>× {error()} · Double-click message to retry</text>
        </Show>
      </box>
    </Show>
  )
}

// Message gestures are separate from chip clicks, so ordinary text drags keep native selection.
export function messageReactionMouse(
  target: () => ReactionTarget | undefined,
  state: () => Partial<ReactionState> | undefined,
  body: () => string,
  controls: () => ReactionControls | undefined,
  interactive: () => boolean,
) {
  const identity = () => { const current = target(); return current ? `${reactionKey(current)}:${current.nodeId ?? ""}` : undefined }
  const enabled = () => interactive() && !!controls() && !!target()
  const canReact = () => enabled() && state()?.canReact !== false && controls()?.action(target()!).operation.status !== "loading"
  const hover = mouseHover(canReact, identity)
  const double = mouseDoubleClick(() => controls()?.open(target()!), canReact, identity)
  const context = mouseContextMenu((position) => controls()?.context(target()!, body(), position), enabled, identity)
  createEffect(() => { identity(); interactive(); double.onMouseDrag(); context.onMouseDrag() })
  return {
    ...hover.handlers,
    onMouseDown(event: Parameters<typeof double.onMouseDown>[0]) { double.onMouseDown(event); context.onMouseDown(event) },
    onMouseUp(event: Parameters<typeof double.onMouseUp>[0]) { double.onMouseUp(event); context.onMouseUp(event) },
    onMouseDrag() { double.onMouseDrag(); context.onMouseDrag(); hover.handlers.onMouseDrag() },
    onMouseScroll() { double.onMouseScroll(); context.onMouseScroll(); hover.handlers.onMouseScroll() },
  }
}
