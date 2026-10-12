import { RenderableEvents, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createSignal, onCleanup } from "solid-js"

// Let OpenTUI track overflow as content and viewport sizes change; the preference only disables bars.
export function createScrollbarVisibility(enabled: () => boolean) {
  const [scrollbox, setScrollbox] = createSignal<ScrollBoxRenderable>()
  let current: ScrollBoxRenderable | undefined
  const destroyed = () => {
    current = undefined
    setScrollbox(undefined)
  }
  createEffect(() => {
    const bar = scrollbox()?.verticalScrollBar
    if (!bar) return
    if (enabled()) bar.resetVisibilityControl()
    else bar.visible = false
  })
  onCleanup(() => current?.off(RenderableEvents.DESTROYED, destroyed))
  return (value: ScrollBoxRenderable) => {
    current?.off(RenderableEvents.DESTROYED, destroyed)
    current = value
    current.once(RenderableEvents.DESTROYED, destroyed)
    setScrollbox(value)
  }
}
