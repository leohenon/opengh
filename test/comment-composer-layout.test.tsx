import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA, type BoxRenderable, type TextareaRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { InlineCommentComposer } from "../src/ui/components/inline-comment-composer"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { clickControl } from "./fixtures/mouse"
import { waitForText } from "./fixtures/wait"

test("comment editors have a blank three-line field and labelled actions inside the border", async () => {
  const [width, setWidth] = createSignal(90)
  const [disabled, setDisabled] = createSignal(false)
  const [bindings, setBindings] = createSignal({ "dialog.togglePreview": ["ctrl+t"], "dialog.toggleExpanded": ["ctrl+e"] })
  let saves = 0, expands = 0, cancels = 0
  const view = await testRender(() => <KeybindingsProvider overrides={bindings()}>
    <InlineCommentComposer title="Comment" body="" width={width()} marginLeft={0} active disabled={disabled()}
      scroll={() => undefined} onInput={() => {}} onSave={() => saves++} onExpand={() => expands++} onCancel={() => cancels++} />
  </KeybindingsProvider>, { width: 100, height: 20 })
  const find = (id: string) => view.renderer.root.findDescendantById(`inline-comment-${id}`)!
  try {
    await view.flush()
    const editor = find("editor") as TextareaRenderable
    expect(editor.height).toBe(3)
    expect(find("toolbar").y).toBeGreaterThanOrEqual(editor.y + editor.height)
    expect(find("toolbar").y + find("toolbar").height).toBe(find("field").y + find("field").height - 1)
    expect(view.captureCharFrame()).not.toContain("Write a comment")
    expect(view.captureCharFrame()).not.toContain("ctrl+")
    expect(find("preview")).toBeUndefined()
    expect(find("expand")).toBeUndefined()
    await clickControl(view, "inline-comment-post")
    expect(saves).toBe(0)
    view.mockInput.pressKey("t", { ctrl: true })
    await view.flush()
    expect(view.captureCharFrame()).toContain("Comment (preview)")
    expect(view.captureCharFrame()).not.toContain("Nothing to preview")
    view.mockInput.pressKey("t", { ctrl: true })
    await view.flush()
    await view.mockInput.typeText("A comment")
    await view.flush()
    view.mockInput.pressKey("t", { ctrl: true })
    await view.flush()
    expect(view.captureCharFrame()).toContain("Comment (preview)")
    expect(find("editor")).toBe(editor)
    view.mockInput.pressKey("t", { ctrl: true })
    await view.flush()
    expect(editor.plainText).toBe("A comment")
    await clickControl(view, "inline-comment-post")
    expect(saves).toBe(1)
    view.mockInput.pressKey("e", { ctrl: true })
    await view.flush()
    expect(expands).toBe(1)
    setBindings({ "dialog.togglePreview": ["ctrl+p"], "dialog.toggleExpanded": ["ctrl+o"] })
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Preview · Expand")
    expect(view.captureCharFrame()).not.toContain("ctrl+")
    view.mockInput.pressKey("p", { ctrl: true })
    await view.flush()
    expect(view.captureCharFrame()).toContain("Comment (preview)")
    view.mockInput.pressKey("p", { ctrl: true })
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Preview · Expand")
    setWidth(28)
    await view.flush()
    expect(find("toolbar").height).toBe(1)
    expect(view.captureCharFrame()).not.toContain("ctrl+p")
    for (const id of ["post", "cancel"]) {
      const control = find(id)
      expect(control.x + control.width).toBeLessThanOrEqual(find("composer-card").x + width())
    }
    view.mockInput.pressKey("o", { ctrl: true })
    await view.flush()
    expect(expands).toBe(2)
    setDisabled(true)
    await view.flush()
    for (const id of ["post", "cancel"]) await clickControl(view, `inline-comment-${id}`)
    expect(saves).toBe(1)
    expect(expands).toBe(2)
    expect(cancels).toBe(0)
    expect(view.captureCharFrame()).not.toContain("Comment (preview)")
    setDisabled(false)
    await view.flush()
    await clickControl(view, "inline-comment-cancel")
    expect(cancels).toBe(1)
  } finally { view.renderer.destroy() }
})

test("comment boxes inherit their surrounding surface while editing, blurred and previewing", async () => {
  const [background, setBackground] = createSignal("#26384a")
  const [active, setActive] = createSignal(true)
  const body = "Blend with the page."
  const view = await testRender(() => <box width="100%" height="100%" backgroundColor={background()}>
    <InlineCommentComposer title="Comment" body={body} width={70} marginLeft={0} active={active()}
      scroll={() => undefined} onInput={() => {}} onSave={() => {}} onExpand={() => {}} onCancel={() => {}} />
  </box>, { width: 80, height: 16 })
  const find = (id: string) => view.renderer.root.findDescendantById(`inline-comment-${id}`)!
  const backgroundAt = (x: number, y: number) => {
    let column = 0
    for (const span of view.captureSpans().lines[y]!.spans) {
      if (x < column + span.width) return span.bg
      column += span.width
    }
    throw new Error(`No cell at ${x}, ${y}`)
  }
  try {
    await view.flush()
    const editor = find("editor") as TextareaRenderable
    const field = find("field") as BoxRenderable
    const focusedBorder = field.borderColor.toInts()
    const checkBackground = () => {
      const expected = RGBA.fromHex(background())
      expect(backgroundAt(field.x + 2, field.y + 1)!.equals(expected)).toBe(true)
      expect(backgroundAt(field.x + 2, field.y + 2)!.equals(expected)).toBe(true)
      expect(backgroundAt(field.x + 1, field.y)!.equals(expected)).toBe(true)
    }
    expect(editor.backgroundColor.a).toBe(0)
    checkBackground()
    setActive(false)
    setBackground("#392d43")
    await view.flush()
    expect(editor.backgroundColor.a).toBe(0)
    expect(field.borderColor.toInts()).not.toEqual(focusedBorder)
    checkBackground()
    setActive(true)
    await view.flush()
    expect(field.borderColor.toInts()).toEqual(focusedBorder)
    view.mockInput.pressKey("p", { ctrl: true })
    await view.flush()
    await waitForText(view, body)
    expect(view.captureCharFrame()).toContain("Comment (preview)")
    checkBackground()
    view.mockInput.pressKey("p", { ctrl: true })
    await view.flush()
    expect(editor.plainText).toBe(body)
    checkBackground()
  } finally { view.renderer.destroy() }
})
