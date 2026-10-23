import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { createSignal, Show } from "solid-js"
import { Popup } from "../src/ui/components/popup"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

describe("Popup", () => {
  test("contains the whole outside click and wheel, dismisses only the top popup, and restores input focus", async () => {
    const [open, setOpen] = createSignal(true)
    const [confirming, setConfirming] = createSignal(true)
    const [query, setQuery] = createSignal("")
    let backgroundEvents = 0
    let scroll!: ScrollBoxRenderable
    const view = await testRender(() => (
      <scrollbox ref={(value) => { scroll = value }} width="100%" height="100%" focusable={false}>
        <box height={40} flexShrink={0} onMouse={(event) => {
          if (event.type === "down" || event.type === "up" || event.type === "scroll") backgroundEvents++
        }}><text selectable={false}>Background</text></box>
        <Show when={open()}>
          <Popup width={40} height={10} onClose={() => setOpen(false)}>
            <input focused={!confirming()} value={query()} onInput={setQuery} />
          </Popup>
        </Show>
        <Show when={confirming()}>
          <Popup width={24} height={6} zIndex={200} onClose={() => setConfirming(false)}>
            <text>Confirmation</text>
          </Popup>
        </Show>
      </scrollbox>
    ), { width: 60, height: 20 })
    active.push(view)
    await view.flush()

    await view.mockMouse.scroll(2, 2, "down")
    await view.flush()
    expect(scroll.scrollTop).toBe(0)
    await view.mockMouse.pressDown(2, 2)
    await view.flush()
    expect(confirming()).toBe(true)
    await view.mockMouse.release(2, 2)
    await view.flush()
    expect(confirming()).toBe(false)
    expect(open()).toBe(true)
    await view.mockInput.typeText("retained")
    await view.flush()
    expect(query()).toBe("retained")

    await view.mockMouse.pressDown(2, 2)
    await view.flush()
    expect(open()).toBe(true)
    await view.mockMouse.release(2, 2)
    await view.flush()
    expect(open()).toBe(false)
    expect(backgroundEvents).toBe(0)
    await view.mockMouse.scroll(2, 2, "down")
    await view.flush()
    expect(scroll.scrollTop).toBeGreaterThan(0)
    expect(backgroundEvents).toBe(1)
  })

  test("closes only when the left mouse button clicks the backdrop", async () => {
    let closes = 0
    const view = await testRender(
      () => (
        <Popup width={30} height={8} onClose={() => closes++}>
          <text>Panel content</text>
        </Popup>
      ),
      { width: 60, height: 20 },
    )
    active.push(view)
    await view.flush()

    await view.mockMouse.click(30, 6)
    await view.flush()
    expect(closes).toBe(0)

    await view.mockMouse.drag(2, 2, 5, 2)
    await view.mockMouse.drag(30, 6, 2, 2)
    await view.flush()
    expect(closes).toBe(0)

    await view.mockMouse.click(2, 2)
    await view.flush()
    expect(closes).toBe(1)

    await view.mockMouse.click(2, 2, 2)
    await view.flush()
    expect(closes).toBe(1)
  })
})
