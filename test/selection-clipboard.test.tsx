import { afterEach, expect, spyOn, test } from "bun:test"
import { CliRenderEvents, type CliRenderer } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { copyText } from "../src/ui/clipboard"
import { SelectionClipboard } from "../src/ui/components/selection-clipboard"

const active: CliRenderer[] = []
afterEach(() => { for (const renderer of active.splice(0)) if (!renderer.isDestroyed) renderer.destroy() })

async function setup(copy: (value: string) => Promise<boolean> = async () => true) {
  const [visible, setVisible] = createSignal(true)
  const values: string[] = []
  const view = await testRender(() => <box width="100%" height="100%">
    <Show when={visible()}><SelectionClipboard onCopy={async (value) => { values.push(value); return copy(value) }} /></Show>
    <text id="selection-text">{"hello world\n  indented text"}</text>
  </box>, { width: 80, height: 20 })
  active.push(view.renderer)
  await view.flush()
  const text = view.renderer.root.findDescendantById("selection-text")!
  return { ...view, values, setVisible, text }
}

test("copies only on release, preserves multiline whitespace and clears the highlight", async () => {
  const view = await setup()
  const { x, y } = view.text
  await view.mockMouse.pressDown(x, y)
  await view.mockMouse.emitMouseEvent("drag", x + 7, y + 1)
  expect(view.values).toEqual([])
  const selected = view.renderer.getSelection()!.getSelectedText()
  expect(selected).toContain("\n  ")
  await view.mockMouse.release(x + 7, y + 1)
  await view.flush()
  expect(view.values).toEqual([selected])
  expect(view.renderer.getSelection()).toBeNull()
  expect(view.captureCharFrame()).toContain("Text copied to clipboard")
})

test("ignores ordinary clicks, empty and right-click gestures; copies double-clicked words", async () => {
  const view = await setup()
  const { x, y } = view.text
  await view.mockMouse.click(x + 1, y)
  expect(view.values).toEqual([])
  await view.mockMouse.click(x + 1, y, 2)
  await view.mockMouse.drag(60, 15, 65, 15)
  expect(view.values).toEqual([])
  view.renderer.clearSelection()
  await view.mockMouse.doubleClick(x + 1, y)
  await view.flush()
  expect(view.values).toEqual(["hello"])
  expect(view.renderer.getSelection()).toBeNull()
})

test("cleanup removes the selection listener", async () => {
  const view = await setup()
  await view.mockMouse.drag(6, 0, 10, 0)
  await view.flush()
  expect(view.values).toHaveLength(1)
  const count = view.renderer.listenerCount(CliRenderEvents.SELECTION)
  view.setVisible(false)
  await view.flush()
  expect(view.renderer.listenerCount(CliRenderEvents.SELECTION)).toBe(count - 1)
  await view.mockMouse.drag(0, 0, 3, 0)
  expect(view.values).toHaveLength(1)
})

test("serializes rapid selections and resets the toast for repeated copies", async () => {
  let release!: (copied: boolean) => void
  const view = await setup(() => new Promise<boolean>((resolve) => { release = resolve }))
  await view.mockMouse.drag(0, 0, 4, 0)
  expect(view.renderer.getSelection()).toBeNull() // Clear on release, not after the native tool finishes.
  await view.mockMouse.drag(6, 0, 10, 0)
  expect(view.values).toHaveLength(1)
  release(true)
  await view.flush()
  expect(view.values).toHaveLength(2)
  expect(view.captureCharFrame()).not.toContain("Text copied to clipboard")
  release(true)
  await view.flush()
  const firstToast = view.renderer.root.findDescendantById("toast")!
  view.renderer.clearSelection()
  await view.mockMouse.drag(6, 0, 10, 0)
  release(true)
  await view.flush()
  expect(view.renderer.root.findDescendantById("toast")).not.toBe(firstToast)
})

test("falls back to OSC 52, including native errors, and reports failure", async () => {
  const view = await setup(async () => { throw new Error("native clipboard failed") })
  const terminal = spyOn(view.renderer, "copyToClipboardOSC52").mockReturnValue(true)
  try {
    await view.mockMouse.drag(0, 0, 4, 0)
    await view.flush()
    expect(terminal).toHaveBeenCalledWith(view.values[0])
    expect(view.captureCharFrame()).toContain("Text sent to terminal")
    terminal.mockReturnValue(false)
    await view.mockMouse.drag(6, 0, 10, 0)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Could not copy Text")
    expect(view.captureCharFrame().replace(/\s+/g, " ")).toContain("native clipboard failed")
  } finally { terminal.mockRestore() }
})

test("does not publish or start queued copies after unmount", async () => {
  let release!: (copied: boolean) => void
  const view = await setup(() => new Promise<boolean>((resolve) => { release = resolve }))
  const terminal = spyOn(view.renderer, "copyToClipboardOSC52").mockReturnValue(true)
  try {
    await view.mockMouse.drag(0, 0, 4, 0)
    await view.mockMouse.drag(6, 0, 10, 0)
    view.setVisible(false)
    await view.flush()
    release(false)
    await view.flush()
    expect(view.values).toHaveLength(1)
    expect(terminal).not.toHaveBeenCalled()
    expect(view.captureCharFrame()).not.toContain("Text copied to clipboard")
  } finally { terminal.mockRestore() }
})

test("copies mouse selections in an editable textarea without changing its value", async () => {
  const values: string[] = []
  const view = await testRender(() => <box width="100%" height="100%">
    <SelectionClipboard onCopy={async (value) => { values.push(value); return true }} />
    <textarea id="editor" width={40} height={5} initialValue="editable text" />
  </box>, { width: 80, height: 20 })
  active.push(view.renderer)
  await view.flush()
  await view.mockMouse.drag(0, 0, 8, 0)
  await view.flush()
  expect(values).toHaveLength(1)
  expect(view.renderer.getSelection()).toBeNull()
  expect(values[0]).toContain("editable")
  expect(view.captureCharFrame()).toContain("editable text")
})

test("uses terminal fallback when the native clipboard is unavailable", async () => {
  const view = await setup(async () => false)
  const terminal = spyOn(view.renderer, "copyToClipboardOSC52").mockReturnValue(true)
  try {
    await view.mockMouse.drag(0, 0, 4, 0)
    await view.flush()
    expect(terminal).toHaveBeenCalledWith(view.values[0])
    expect(view.captureCharFrame()).toContain("Text sent to terminal")
  } finally { terminal.mockRestore() }
})

test("manual clipboard actions share ordering with pending selection copies", async () => {
  let release!: (copied: boolean) => void
  const calls: string[] = []
  const view = await setup((value) => {
    calls.push(value)
    return new Promise<boolean>((resolve) => { release = resolve })
  })
  await view.mockMouse.drag(0, 0, 4, 0)
  const manual = copyText(view.renderer, async (value) => { calls.push(value); return true }, "latest-sha", "SHA")
  await view.flush()
  expect(calls).toEqual([view.values[0]!])
  release(true)
  expect((await manual)?.title).toBe("SHA copied to clipboard")
  expect(calls).toEqual([view.values[0]!, "latest-sha"])
})

test("successful selection-copy toast dismisses after one second", async () => {
  const view = await setup()
  await view.mockMouse.drag(0, 0, 4, 0)
  await view.flush()
  expect(view.captureCharFrame()).toContain("Text copied to clipboard")
  await Bun.sleep(1100)
  await view.flush()
  expect(view.renderer.root.findDescendantById("toast")).toBeUndefined()
})
