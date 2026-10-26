import { expect, test } from "bun:test"
import { type TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { MarkdownTextarea } from "../src/ui/components/markdown-textarea"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { ThemeProvider } from "../src/ui/theme"

test("Markdown source is colored by the real parser without changing text, cursor, selection or history", async () => {
  const source = "é界😀\t**bold** [link](https://x) `code`\n# Heading\n```\nblock\n```\nend"
  const [theme, setTheme] = createSignal("opengh")
  let editor!: TextareaRenderable
  let changes = 0
  const view = await testRender(() => <ThemeProvider name={theme()} mode="dark">
    <KeybindingsProvider>
      <MarkdownTextarea ref={(value) => { editor = value }} initialValue={source}
        width={80} height={10} focused textColor="#ffffff" backgroundColor="#101010"
        onContentChange={() => { changes++ }} historyKey="draft" />
    </KeybindingsProvider>
  </ThemeProvider>, { width: 80, height: 10 })

  const isColored = (text: string, scope: string) => {
    const expected = editor.syntaxStyle!.getStyle(scope)!.fg!
    return view.captureSpans().lines.flatMap((line) => line.spans)
      .some((span) => span.text.includes(text) && span.fg.equals(expected))
  }
  const assertColored = (text: string, scope: string) => expect(isColored(text, scope)).toBe(true)
  const waitForHighlights = async (row: number, text?: string, scope?: string) => {
    await view.flush()
    for (let i = 0; i < 150; i++) {
      await view.renderOnce()
      if (editor.getLineHighlights(row).length && (!text || isColored(text, scope!))) break
      await Bun.sleep(20)
    }
    expect(editor.getLineHighlights(row).length).toBeGreaterThan(0)
    if (text) assertColored(text, scope!)
  }

  try {
    editor.setSelection(0, 1)
    const cursor = editor.cursorOffset
    const selection = editor.getSelection()
    const beforeChanges = changes
    const beforeHistory = editor.editBuffer.canUndo()
    await waitForHighlights(0)
    expect(editor.plainText).toBe(source)
    expect(editor.cursorOffset).toBe(cursor)
    expect(editor.getSelection()).toEqual(selection)
    expect(editor.editBuffer.canUndo()).toBe(beforeHistory)
    expect(changes).toBe(beforeChanges)
    for (const line of source.split("\n")) expect(view.captureCharFrame()).toContain(line.replace("\t", "  "))
    assertColored("bold", "markup.strong") // after multibyte text, emoji and a tab
    assertColored("link", "markup.link.label")
    assertColored("code", "markup.raw")
    assertColored("Heading", "markup.heading")
    assertColored("block", "markup.raw")
    assertColored("**", "conceal")

    const oldColor = editor.syntaxStyle!.getStyle("markup.heading")!.fg!
    setTheme("dracula")
    await view.renderOnce()
    expect(editor.syntaxStyle!.getStyle("markup.heading")!.fg!.equals(oldColor)).toBe(false)
    assertColored("Heading", "markup.heading")
    expect(editor.cursorOffset).toBe(cursor)
    expect(editor.getSelection()).toEqual(selection)
    expect(changes).toBe(beforeChanges)

    editor.clearSelection()
    editor.gotoLine(1)
    editor.gotoLineEnd()
    await view.mockInput.typeText(" more")
    // Render during the parser debounce: existing heading text must not flash
    // back to the plain text color while its replacement highlights are pending.
    await view.renderOnce()
    assertColored("Heading", "markup.heading")
    view.mockInput.pressKey("z", { ctrl: true })
    expect(editor.plainText).toBe(source)
    await waitForHighlights(1, "Heading", "markup.heading")
    editor.gotoBufferEnd()
    await view.mockInput.typeText(" **typed**")
    const typedCursor = editor.cursorOffset
    await waitForHighlights(5, "typed", "markup.strong")
    assertColored("typed", "markup.strong")
    expect(editor.plainText).toBe(source + " **typed**")
    expect(editor.cursorOffset).toBe(typedCursor)
    view.mockInput.pressKey("z", { ctrl: true })
    expect(editor.plainText).toBe(source)
    await waitForHighlights(0)
    assertColored("bold", "markup.strong")
  } finally {
    await view.dispose()
  }
}, 10000)
