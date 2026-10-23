import { expect, spyOn, test } from "bun:test"
import { RGBA, ScrollBoxRenderable, type BoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { defaultConfig } from "../src/config"
import { appColors, resolveTheme } from "../src/theme"
import { MouseSurface } from "../src/ui/components/mouse-surface"
import { SelectableList } from "../src/ui/components/selectable-list"
import { mouseClick, mouseHover } from "../src/ui/mouse"

const colors = appColors(resolveTheme(defaultConfig.theme))

test("list hover is motion-only, never changes selection/scroll, and yields immediately to keyboard", async () => {
  const [items, setItems] = createSignal(Array.from({ length: 30 }, (_, id) => ({ id })))
  const [enabled, setEnabled] = createSignal(true)
  const [visible, setVisible] = createSignal(true)
  let selected = -1
  let activated = 0
  let pages = 0
  const view = await testRender(() => <MouseSurface>
    <Show when={visible()}><SelectableList items={items()} itemKey={(item) => item.id} active={enabled()} empty="empty"
      onSelect={(item) => { selected = item.id }} onActivate={() => { activated++ }} onEndReached={() => { pages++ }}>
      {(item) => <text id={`hover-row-${item().id}`}>row {item().id}</text>}
    </SelectableList></Show>
    <box height={2} flexShrink={0}><text>Noninteractive space</text></box>
  </MouseSurface>, { width: 45, height: 14 })
  const pointer = spyOn(view.renderer, "setMousePointer")
  const row = (id: number) => view.renderer.root.findDescendantById(`hover-row-${id}`)!.parent as BoxRenderable
  try {
    await view.flush()
    const keyInput = view.renderer.keyInput
    const listeners = keyInput.listenerCount("keypress")
    const list = (() => {
      for (let node: BoxRenderable | null = row(0); node; node = node.parent as BoxRenderable | null)
        if (node instanceof ScrollBoxRenderable) return node
      throw new Error("Missing native list scrollbox")
    })()
    const initialScroll = list.scrollTop
    const x = row(2).x + 4
    const y = row(2).y
    await view.mockMouse.moveTo(x, y)
    await view.flush()
    expect(row(2).backgroundColor).toEqual(RGBA.fromHex(colors.panel))
    expect(row(0).backgroundColor).toEqual(RGBA.fromHex(colors.panelHover))
    expect(selected).toBe(0)
    expect(activated).toBe(0)
    expect(pages).toBe(0)
    expect(list.scrollTop).toBe(initialScroll)
    expect(pointer.mock.calls.at(-1)?.[0]).toBe("pointer")
    view.mockInput.pressArrow("down")
    await view.flush()
    expect(selected).toBe(1)
    expect(row(2).backgroundColor).toEqual(RGBA.fromHex(colors.canvas))
    expect(pointer.mock.calls.at(-1)?.[0]).toBe("default")
    await view.mockMouse.emitMouseEvent("move", x, y)
    await view.flush()
    expect(row(2).backgroundColor).toEqual(RGBA.fromHex(colors.canvas))
    setItems((current) => [...current, ...Array.from({ length: 100 }, (_, index) => ({ id: index + 30 }))])
    view.resize(46, 14)
    await view.flush()
    expect(keyInput.listenerCount("keypress")).toBe(listeners)
    expect(row(2).backgroundColor).toEqual(RGBA.fromHex(colors.canvas))
    await view.mockMouse.moveTo(x + 1, y)
    await view.flush()
    expect(row(2).backgroundColor).toEqual(RGBA.fromHex(colors.panel))
    setEnabled(false)
    await view.flush()
    expect(pointer.mock.calls.at(-1)?.[0]).toBe("default")
    setEnabled(true)
    await view.flush()
    await view.mockMouse.emitMouseEvent("move", x + 1, y)
    expect(row(2).backgroundColor).toEqual(RGBA.fromHex(colors.canvas))
    await view.mockMouse.moveTo(x + 2, y)
    await view.flush()
    await view.mockMouse.scroll(x + 2, y, "down")
    await view.flush()
    expect(selected).toBe(1)
    expect(pointer.mock.calls.at(-1)?.[0]).toBe("default")
    await view.mockMouse.emitMouseEvent("move", x + 2, y)
    await view.flush()
    expect(pointer.mock.calls.at(-1)?.[0]).toBe("default")
    setVisible(false)
    await view.flush()
    expect(keyInput.listenerCount("keypress")).toBe(listeners - 1) // The list's own keyboard handler left, not one handler per row.
  } finally { pointer.mockRestore(); view.renderer.destroy() }
})

test("nested cursor ownership, disabled/removed controls, noninteractive motion and renderer cleanup stay independent", async () => {
  const [disabled, setDisabled] = createSignal(false)
  const [childVisible, setChildVisible] = createSignal(true)
  let parent!: ReturnType<typeof mouseHover>
  let child!: ReturnType<typeof mouseHover>
  function Child() {
    child = mouseHover(() => !disabled())
    return <text id="child" {...mouseClick(() => {}, () => !disabled(), undefined, child)}>Child</text>
  }
  function Controls() {
    parent = mouseHover()
    return <box width={25} height={4} {...mouseClick(() => {}, () => true, undefined, parent)}>
      <Show when={childVisible()}><Child /></Show>
    </box>
  }
  const first = await testRender(() => <MouseSurface><Controls /><text>Plain text</text></MouseSurface>, { width: 40, height: 10 })
  const second = await testRender(() => <MouseSurface><text {...mouseClick(() => {})}>Other renderer</text></MouseSurface>, { width: 40, height: 10 })
  const pointerA = spyOn(first.renderer, "setMousePointer")
  const pointerB = spyOn(second.renderer, "setMousePointer")
  const keysA = first.renderer.keyInput
  const keysB = second.renderer.keyInput
  const limitA = keysA.getMaxListeners()
  const limitB = keysB.getMaxListeners()
  const listenersA = keysA.listenerCount("keypress")
  const listenersB = keysB.listenerCount("keypress")
  const pasteListenersA = keysA.listenerCount("paste")
  try {
    await first.flush(); await second.flush()
    await first.mockMouse.moveTo(1, 0)
    expect(child.hovered()).toBe(true)
    expect(parent.hovered()).toBe(false)
    expect(pointerA.mock.calls.at(-1)?.[0]).toBe("pointer")
    await second.mockMouse.moveTo(1, 0)
    expect(pointerB.mock.calls.at(-1)?.[0]).toBe("pointer")
    first.mockInput.pasteBracketedText("ignored without an input")
    expect(child.hovered()).toBe(false)
    first.mockInput.pressKey("k")
    expect(child.hovered()).toBe(false)
    expect(pointerA.mock.calls.at(-1)?.[0]).toBe("default")
    expect(pointerB.mock.calls.at(-1)?.[0]).toBe("pointer")
    await first.mockMouse.emitMouseEvent("move", 1, 0)
    expect(child.hovered()).toBe(false)
    // Moving through plain text and returning to the same cell is genuine movement, not a keyboard reset.
    await first.mockMouse.moveTo(30, 5)
    await first.mockMouse.moveTo(1, 0)
    expect(child.hovered()).toBe(true)
    setDisabled(true)
    await first.flush()
    expect(child.hovered()).toBe(false)
    expect(parent.hovered()).toBe(false)
    expect(pointerA.mock.calls.at(-1)?.[0]).toBe("default")
    await first.mockMouse.moveTo(2, 0)
    expect(parent.hovered()).toBe(false) // Disabled nested controls do not advertise their parent's action.
    await first.mockMouse.moveTo(20, 2)
    expect(parent.hovered()).toBe(true)
    setChildVisible(false)
    await first.flush()
    expect(pointerA.mock.calls.at(-1)?.[0]).toBe("pointer")
  } finally {
    first.renderer.destroy(); second.renderer.destroy()
    await Promise.all([first.renderer.closed, second.renderer.closed])
    pointerA.mockRestore(); pointerB.mockRestore()
  }
  expect(keysA.listenerCount("keypress")).toBe(listenersA - 1)
  expect(keysB.listenerCount("keypress")).toBe(listenersB - 1)
  expect(keysA.listenerCount("paste")).toBe(pasteListenersA - 1)
  expect(keysA.getMaxListeners()).toBe(limitA - 1)
  expect(keysB.getMaxListeners()).toBe(limitB - 1)
})
