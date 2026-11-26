import type { CliRenderer, ScrollBoxRenderable } from "@opentui/core"
import { createEffect, onCleanup } from "solid-js"

export type CommentReveal = { id: number; request: number }

const MAX_REVEAL_FRAMES = 120
const STABLE_FRAMES = 5

export function createCommentReveal(options: {
  renderer: CliRenderer
  target: () => CommentReveal | undefined
  ready: () => boolean
  elementId: (id: number) => string
  scroll: () => ScrollBoxRenderable | undefined
}) {
  let handled: number | undefined
  createEffect(() => {
    const target = options.target()
    if (!target || target.request === handled || !options.ready()) return
    handled = target.request
    let frames = 0
    let stable = 0
    let pinned: number | undefined
    const reveal = () => {
      const scroll = options.scroll()
      const comment = scroll?.content.findDescendantById(options.elementId(target.id))
      if (scroll && comment) {
        if (pinned !== undefined && scroll.scrollTop !== pinned) return
        const before = scroll.scrollTop
        const delta = comment.y - scroll.viewport.y
        if (delta) scroll.scrollBy(delta)
        pinned = scroll.scrollTop
        stable = pinned === before ? stable + 1 : 0
        if (stable >= STABLE_FRAMES) return
      }
      if (++frames >= MAX_REVEAL_FRAMES) return
      options.renderer.once("frame", reveal)
      options.renderer.requestRender()
    }
    options.renderer.once("frame", reveal)
    options.renderer.requestRender()
    onCleanup(() => options.renderer.off("frame", reveal))
  })
}
