import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ScrollBoxRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { SelectableList } from "../src/ui/components/selectable-list"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

function visibleRows(frame: string) {
  return frame.split("\n").filter((row) => /row \d/.test(row))
}

describe("SelectableList", () => {
  test("full-row clicks activate once on release while drags, nested controls, and stale presses do not", async () => {
    const [items, setItems] = createSignal(Array.from({ length: 3 }, (_, id) => ({ id, label: `row ${id}` })))
    const [interactive, setInteractive] = createSignal(true)
    const activated: number[] = []
    let selected = -1
    let nested = 0
    const view = await testRender(() => (
      <SelectableList items={items()} itemKey={(item) => item.id} active={interactive()} empty="empty"
        onSelect={(item) => { selected = item.id }} onActivate={(item) => { activated.push(item.id) }}>
        {(item) => (
          <box flexGrow={1} flexDirection="column">
            <text>{item().label}</text>
            <text onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (event.button === 0) nested++
            }}>Nested action</text>
          </box>
        )}
      </SelectableList>
    ), { width: 50, height: 11 })
    active.push(view)
    await view.flush()

    await view.mockMouse.pressDown(49, 5) // The second row's trailing blank line and padding.
    await view.flush()
    expect(activated).toEqual([])
    await view.mockMouse.release(49, 5)
    await view.flush()
    expect(activated).toEqual([1])
    expect(selected).toBe(1)
    expect(view.renderer.currentFocusedRenderable).toBeNull()
    for (const button of [1, 2] as const) await view.mockMouse.click(4, 0, button)
    await view.mockMouse.drag(4, 0, 9, 0) // Selecting text must not open the row.
    await view.mockMouse.drag(49, 8, 48, 6)
    await view.mockMouse.click(4, 1)
    await view.flush()
    expect(nested).toBe(1)
    expect(activated).toEqual([1])
    expect(selected).toBe(1)

    await view.mockMouse.pressDown(4, 6)
    setItems((current) => [...current.slice(0, 2), { id: 9, label: "row 9" }])
    await view.flush()
    await view.mockMouse.release(4, 6)
    expect(activated).toEqual([1]) // Index re-use during refresh must not activate a different key.
    await view.mockMouse.pressDown(49, 2)
    setInteractive(false)
    await view.flush()
    setInteractive(true)
    await view.flush()
    await view.mockMouse.release(49, 2)
    expect(activated).toEqual([1])
    setInteractive(false)
    await view.mockMouse.click(4, 3)
    expect(activated).toEqual([1])
    setInteractive(true)
    view.mockInput.pressArrow("down")
    await view.flush()
    expect(selected).toBe(9)
    await view.mockMouse.pressDown(4, 0)
    await view.flush() // Hover-out from the previous row must not cancel this new press.
    await view.mockMouse.release(4, 0)
    await view.flush()
    expect(activated).toEqual([1, 0])
    expect(selected).toBe(0)
  })

  test("wheel browsing paginates without changing selection or jumping when a page appends", async () => {
    const rows = Array.from({ length: 60 }, (_, id) => ({ id, label: `row ${id}` }))
    const [items, setItems] = createSignal(rows.slice(0, 30))
    const [interactive, setInteractive] = createSignal(true)
    let selected = -1
    let endCalls = 0
    const view = await testRender(() => (
      <SelectableList
        items={items()}
        itemKey={(item) => item.id}
        active={interactive()}
        showScrollbar={false}
        empty="empty"
        onSelect={(item) => { selected = item.id }}
        onEndReached={() => { endCalls++ }}
      >
        {(item) => <text>{item().label}</text>}
      </SelectableList>
    ), { width: 50, height: 17 })
    active.push(view)
    await view.flush()
    const list = view.renderer.root.getChildren()[0]!.getChildren()[0] as ScrollBoxRenderable
    expect(list).toBeInstanceOf(ScrollBoxRenderable)
    expect(endCalls).toBe(0)

    for (let step = 0; step < 80 && endCalls === 0; step++) {
      await view.mockMouse.scroll(10, 7, "down", { delayMs: 0 })
      await view.flush()
    }
    expect(endCalls).toBeGreaterThan(0)
    expect(selected).toBe(0)
    const scrollTop = list.scrollTop
    expect(scrollTop).toBeGreaterThan(0)
    const visible = visibleRows(view.captureCharFrame())
    setInteractive(false)
    await view.flush()
    setInteractive(true)
    await view.flush()
    expect(list.scrollTop).toBe(scrollTop)
    setItems(rows)
    await view.flush()
    expect(list.scrollTop).toBe(scrollTop)
    expect(visibleRows(view.captureCharFrame())).toEqual(visible)

    await view.mockMouse.scroll(10, 7, "up")
    await view.flush()
    expect(list.scrollTop).toBeLessThan(scrollTop)
    const clicked = Math.floor((list.scrollTop + 7 - list.viewport.y) / 3)
    await view.mockMouse.click(10, 7)
    expect(selected).toBe(clicked)
    expect(view.renderer.currentFocusedRenderable).toBeNull()
    view.mockInput.pressArrow("down")
    await view.flush()
    expect(selected).toBe(clicked + 1)
    expect(view.captureCharFrame().split("\n").find((row) => row.includes(`row ${clicked + 1}`))).toContain("▌")

    setInteractive(false)
    const calls = endCalls
    list.scrollTo(list.scrollHeight)
    await view.mockMouse.scroll(10, 7, "down")
    await view.flush()
    expect(endCalls).toBe(calls)

    setItems(rows.slice(0, 5))
    setInteractive(true)
    await view.flush()
    expect(list.scrollTop).toBe(0)
    const beforeUnderfilledWheel = endCalls
    await view.mockMouse.scroll(10, 7, "down")
    await view.flush()
    expect(endCalls).toBeGreaterThan(beforeUnderfilledWheel)
  })

  test("renders only complete rows for its measured viewport", async () => {
    const items = Array.from({ length: 8 }, (_, id) => ({ id, label: `row ${id}` }))
    const view = await testRender(() => (
      <box width="100%" height="100%">
        <SelectableList
          items={items}
          itemKey={(item) => item.id}
          active
          empty="empty"
        >
          {(item) => <text>{item().label}</text>}
        </SelectableList>
      </box>
    ), { width: 50, height: 17 })
    active.push(view)
    await view.flush()

    expect(visibleRows(view.captureCharFrame())).toHaveLength(5)

    for (let index = 0; index < 4; index++) {
      view.mockInput.pressKey("j")
      await view.flush()
    }

    const frame = view.captureCharFrame()
    expect(visibleRows(frame)).toHaveLength(5)
    expect(frame).toContain("row 4")
    expect(frame.split("▌").length - 1).toBe(1)

    view.mockInput.pressKey("g", { shift: true })
    await view.flush()
    expect(view.captureCharFrame()).toContain("row 7")

    view.renderer.resize(50, 8)
    await view.flush()
    expect(view.captureCharFrame().split("\n").find((row) => row.includes("row 7"))).toContain("▌")

    view.renderer.resize(50, 17)
    await view.flush()
    view.mockInput.pressKey("g")
    await view.flush()
    expect(view.captureCharFrame()).toContain("row 0")

    view.mockInput.pressKey("d")
    await view.flush()
    expect(view.captureCharFrame().split("\n").find((row) => row.includes("row 2"))).toContain("▌")

    view.mockInput.pressKey("u")
    await view.flush()
    expect(view.captureCharFrame().split("\n").find((row) => row.includes("row 0"))).toContain("▌")
  })
})
