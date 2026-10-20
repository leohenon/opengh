import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { createScrollbarVisibility } from "../src/ui/scrollbar-visibility"

test("scrollbars follow overflow, resizing, and the global preference", async () => {
  const [rows, setRows] = createSignal(4)
  const [enabled, setEnabled] = createSignal(true)
  let scroll!: ScrollBoxRenderable
  const view = await testRender(() => {
    const bindScrollbar = createScrollbarVisibility(enabled)
    return (
      <scrollbox ref={(value) => { scroll = value; bindScrollbar(value) }} width="100%" height="100%" scrollY scrollX={false}>
        <text>{Array.from({ length: rows() }, (_, index) => `Row ${index}`).join("\n")}</text>
      </scrollbox>
    )
  }, { width: 24, height: 8 })
  try {
    await view.flush()
    expect(scroll.verticalScrollBar.visible).toBe(false)
    setRows(12)
    await view.flush()
    expect(scroll.verticalScrollBar.visible).toBe(true)
    setEnabled(false)
    await view.flush()
    expect(scroll.verticalScrollBar.visible).toBe(false)
    setEnabled(true)
    await view.flush()
    expect(scroll.verticalScrollBar.visible).toBe(true)
    setRows(8)
    await view.flush()
    expect(scroll.verticalScrollBar.visible).toBe(false)
    view.resize(24, 5)
    await view.flush()
    expect(scroll.verticalScrollBar.visible).toBe(true)
    view.resize(24, 12)
    await view.flush()
    expect(scroll.verticalScrollBar.visible).toBe(false)
  } finally {
    view.renderer.destroy()
  }
})
