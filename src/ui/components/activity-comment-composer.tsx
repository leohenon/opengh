import { MouseButton, type BoxRenderable, type MouseEvent, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { Action } from "./action"
import { InlineCommentComposer } from "./inline-comment-composer"
import { useTheme } from "../theme"

export type ActivityComment = {
  open: boolean
  body: string
  saved: boolean
  focused: boolean
  enabled: boolean
  canPost: boolean
  onOpen(): void
  onInput(body: string): void
  onPost(body: string): void
  onClose(): void
  onExpand(): void
  onFocusChange(focused: boolean): void
  onHintChange(hint: string | undefined): void
}

export function focusActivityComment(event: MouseEvent, idPrefix: string, comment?: ActivityComment) {
  if (!comment || event.button !== MouseButton.LEFT) return
  for (let node = event.target; node; node = node.parent) {
    if (node.id === `${idPrefix}-area`) { comment.onFocusChange(comment.open); return }
  }
  comment.onFocusChange(false)
}

/** The conversation's regular comment editor; draft persistence and posting stay in the session. */
export function ActivityCommentComposer(props: {
  comment: ActivityComment
  idPrefix: string
  interactive: boolean
  repositoryUrl: string
  sourceUrl?: string
  defaultBranch?: string
  scroll(): ScrollBoxRenderable | undefined
}) {
  const renderer = useRenderer()
  const { colors } = useTheme()
  const open = createMemo(() => props.comment.open)
  const [width, setWidth] = createSignal(1)
  let holder: BoxRenderable | undefined
  let disposed = false
  onCleanup(() => { disposed = true })
  const reveal = () => void renderer.idle().then(() => {
    const scroll = props.scroll()
    if (disposed || !open() || !props.interactive || !holder || holder.isDestroyed || !scroll) return
    const hidden = holder.y + holder.height - (scroll.viewport.y + scroll.viewport.height)
    if (hidden > 0) scroll.scrollBy(Math.min(hidden, holder.y - scroll.viewport.y))
  }).catch(() => {})
  createEffect(on(open, (visible) => { if (visible) reveal() }))
  return <Show when={open() || props.comment.saved}>
    <box id={`${props.idPrefix}-area`} ref={value => { holder = value }} width="100%" minWidth={0}
      flexShrink={0} flexDirection="column" marginTop={1} onSizeChange={() => { setWidth(Math.max(1, holder?.width ?? 1)) }}>
      <Show when={open()} fallback={
        <box height={1} flexShrink={0} flexDirection="row" paddingX={1} backgroundColor={colors.panel}>
          <text fg={colors.muted}>Draft saved · </text>
          <Action id={`${props.idPrefix}-resume`} disabled={!props.interactive || !props.comment.enabled} onActivate={() => props.comment.onOpen()}>Resume</Action>
        </box>
      }>
        <InlineCommentComposer title="Comment" idPrefix={props.idPrefix} body={props.comment.body} width={width()} marginLeft={0}
          active={props.interactive && props.comment.enabled && props.comment.focused} disabled={!props.interactive || !props.comment.enabled} canPost={props.comment.canPost}
          repositoryUrl={props.repositoryUrl} sourceUrl={props.sourceUrl} headSha={props.defaultBranch} scroll={props.scroll} onGrow={reveal}
          onInput={body => props.comment.onInput(body)} onSave={body => props.comment.onPost(body)}
          onCancel={() => props.comment.onClose()} onExpand={() => props.comment.onExpand()} onHintChange={hint => props.comment.onHintChange(hint)} />
      </Show>
    </box>
  </Show>
}
