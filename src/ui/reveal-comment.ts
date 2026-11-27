import type { CliRenderer, Renderable, ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, onCleanup, useContext } from "solid-js"
import type { ResourceState } from "../repository-state"
import { PaneVisible } from "./components/retained-pane"

export type CommentReveal = { id: number; request: number }

const MAX_REVEAL_FRAMES = 120
const STABLE_FRAMES = 5

export function createCommentReveal(options: {
  renderer: CliRenderer
  target: () => CommentReveal | undefined
  ready: () => boolean
  sources: () => readonly ResourceState<unknown>[]
  elementId: (id: number) => string
  scroll: () => ScrollBoxRenderable | undefined
}) {
  const visible = useContext(PaneVisible)
  const [handled, setHandled] = createSignal<number>()
  const ready = createMemo(options.ready)
  createEffect(() => {
    const target = options.target()
    const scroll = options.scroll()
    if (!target || !scroll || target.request === handled() || !visible()) return
    const bar = scroll.verticalScrollBar
    let pinned = scroll.scrollTop
    const onScroll = () => {
      const expected = Math.max(0, Math.min(pinned, bar.scrollSize - bar.viewportSize))
      if (scroll.scrollTop !== expected) setHandled(target.request)
      pinned = scroll.scrollTop
    }
    bar.on("change", onScroll)
    onCleanup(() => bar.off("change", onScroll))
    if (!ready()) return

    const settling = options.sources().every((source) => source.status !== "loading")
    const id = options.elementId(target.id)
    let frames = 0
    let stable = 0
    let comment: Renderable | undefined
    const align = () => {
      if (!comment?.getComputedLayout().height) return
      let top = 0
      for (let node: Renderable | null = comment; node && node !== scroll.content; node = node.parent) {
        top += node.getComputedLayout().top
      }
      const offset = Math.max(0, Math.min(top, bar.scrollSize - bar.viewportSize))
      if (offset !== scroll.scrollTop) {
        stable = 0
        pinned = offset
        scroll.scrollTo(offset)
        pinned = scroll.scrollTop
      }
    }
    const reveal = () => {
      if (!comment || comment.isDestroyed) {
        comment = scroll.content.findDescendantById(id)
        comment?.on("resize", align)
      }
      align()
    }
    const afterLayout = () => {
      reveal()
      if (!settling) return options.renderer.off("frame", afterLayout)
      if (++frames >= MAX_REVEAL_FRAMES || (comment?.height && ++stable >= STABLE_FRAMES)) setHandled(target.request)
      else options.renderer.requestRender()
    }
    const frame = options.renderer.requestAnimationFrame(reveal)
    scroll.content.on("resize", reveal)
    options.renderer.on("frame", afterLayout)
    onCleanup(() => {
      options.renderer.cancelAnimationFrame(frame)
      scroll.content.off("resize", reveal)
      options.renderer.off("frame", afterLayout)
      comment?.off("resize", align)
    })
  })
}
