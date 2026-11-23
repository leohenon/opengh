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

export type ThreadReplyEditor = {
  threadId: string
  path: string
  active: boolean
  title: string
  comment: ActivityComment
}
export const replyEditorId = (reply: ThreadReplyEditor) => (reply.active ? "reply-comment" : `reply-draft:${reply.threadId}`)

export function focusActivityComment(event: MouseEvent, idPrefix: string, comment?: ActivityComment) {
  if (!comment || event.button !== MouseButton.LEFT) return
  for (let node = event.target; node; node = node.parent) {
    if (node.id === `${idPrefix}-area`) {
      comment.onFocusChange(comment.open)
      return
    }
  }
  comment.onFocusChange(false)
}

/** The conversation's regular comment editor; draft persistence and posting stay in the session. */
export function ActivityCommentComposer(props: {
  comment: ActivityComment
  idPrefix: string
  title?: string
  interactive: boolean
  repositoryUrl: string
  sourceUrl?: string
  defaultBranch?: string
  revealFromId?: string
  scroll(): ScrollBoxRenderable | undefined
}) {
  const renderer = useRenderer()
  const { colors } = useTheme()
  const open = createMemo(() => props.comment.open)
  const saved = createMemo(() => props.comment.saved)
  const focused = createMemo(() => open() && props.comment.focused)
  const active = createMemo(() => focused() && props.interactive && props.comment.enabled)
  const [width, setWidth] = createSignal(1)
  let holder: BoxRenderable | undefined
  let pendingReveal: { scrollTop: number | undefined } | undefined
  const reveal = () => {
    if (!active()) return
    pendingReveal = { scrollTop: props.scroll()?.scrollTop }
    renderer.requestRender()
  }
  createEffect(() => {
    if (!active()) return
    let previous: { offset: number; scrollTop: number; visible: boolean } | undefined
    const anchor = () => {
      const scroll = props.scroll()
      if (!active() || !holder || holder.isDestroyed || !scroll) return
      const top = holder.y - scroll.viewport.y
      const scrollTop = scroll.scrollTop
      const offset = top + scrollTop
      const requested = pendingReveal
      pendingReveal = undefined
      const hidden = top + holder.height - scroll.viewport.height
      const fit = (delta: number, followingLayout = false) => {
        const from = props.revealFromId ? scroll.content.findDescendantById(props.revealFromId) : undefined
        if (followingLayout && !from) return delta
        const first = from ? Math.min(top, Math.max(from.y - scroll.viewport.y, hidden)) : top
        return Math.min(first, Math.max(hidden, delta))
      }
      if (requested && (requested.scrollTop === undefined || requested.scrollTop === scrollTop)) {
        const delta = fit(0)
        if (delta) scroll.scrollBy(delta)
      } else if (previous?.visible && previous.scrollTop === scrollTop) {
        // Follow layout shifts, not the user's scrolling.
        const delta = offset - previous.offset
        if (delta) scroll.scrollBy(fit(delta, true))
      }
      const y = top - (scroll.scrollTop - scrollTop)
      previous = { offset, scrollTop: scroll.scrollTop, visible: y < scroll.viewport.height && y + holder.height > 0 }
    }
    renderer.on("frame", anchor)
    onCleanup(() => {
      renderer.off("frame", anchor)
      pendingReveal = undefined
    })
  })
  // Closing an overlay is not a request to reveal the editor.
  createEffect(
    on(focused, (focused) => {
      if (focused) reveal()
    }),
  )
  // Follow a restored draft only from the bottom.
  createEffect(
    on(
      saved,
      (visible) => {
        if (!visible || !props.interactive || props.revealFromId) return
        const scroll = props.scroll()
        if (!scroll || scroll.scrollTop < scroll.scrollHeight - scroll.viewport.height) return
        const scrollTop = scroll.scrollTop
        const revealSaved = () => {
          if (!saved() || !props.interactive || scroll.isDestroyed || scroll.scrollTop !== scrollTop) return
          scroll.scrollChildIntoView(`${props.idPrefix}-area`)
        }
        renderer.once("frame", revealSaved)
        renderer.requestRender()
        onCleanup(() => renderer.off("frame", revealSaved))
      },
      { defer: true },
    ),
  )
  return (
    <Show when={open() || saved()}>
      <box
        id={`${props.idPrefix}-area`}
        ref={(value) => {
          holder = value
        }}
        width="100%"
        minWidth={0}
        flexShrink={0}
        flexDirection="column"
        marginTop={1}
        onSizeChange={() => {
          setWidth(Math.max(1, holder?.width ?? 1))
        }}
      >
        <Show
          when={open()}
          fallback={
            <box height={1} flexShrink={0} flexDirection="row" paddingX={1} backgroundColor={colors.panel}>
              <text fg={colors.muted}>Draft saved · </text>
              <Action
                id={`${props.idPrefix}-resume`}
                disabled={!props.interactive || !props.comment.enabled}
                onActivate={() => props.comment.onOpen()}
              >
                Resume
              </Action>
            </box>
          }
        >
          <InlineCommentComposer
            title={props.title ?? "Comment"}
            idPrefix={props.idPrefix}
            body={props.comment.body}
            width={width()}
            marginLeft={0}
            active={props.interactive && props.comment.enabled && props.comment.focused}
            disabled={!props.interactive || !props.comment.enabled}
            canPost={props.comment.canPost}
            repositoryUrl={props.repositoryUrl}
            sourceUrl={props.sourceUrl}
            headSha={props.defaultBranch}
            scroll={props.scroll}
            onGrow={reveal}
            onInput={(body) => props.comment.onInput(body)}
            onSave={(body) => props.comment.onPost(body)}
            onCancel={() => props.comment.onClose()}
            onExpand={() => props.comment.onExpand()}
            onHintChange={(hint) => props.comment.onHintChange(hint)}
          />
        </Show>
      </box>
    </Show>
  )
}
