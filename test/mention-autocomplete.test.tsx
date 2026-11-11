import { expect, test } from "bun:test"
import type { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { KeybindingOverrides } from "../src/keybindings"
import { MarkdownTextarea } from "../src/ui/components/markdown-textarea"
import { KeybindingsProvider, replaceEditorText, useKeyActions } from "../src/ui/keybindings"
import { MentionProvider, type MentionSearch } from "../src/ui/mentions"
import { clickControl } from "./fixtures/mouse"

async function setupEditor(search?: MentionSearch, overrides?: KeybindingOverrides) {
  let editor!: TextareaRenderable
  let closes = 0, submissions = 0
  const [focused, setFocused] = createSignal(true)
  const [identity, setIdentity] = createSignal("repo-one")
  const [users, setUsers] = createSignal(["alice", "alex", "bob"])
  function Editor() {
    useKeyActions({ "dialog.close": () => { closes++ }, "dialog.submit": () => { submissions++ } }, { priority: 50, modal: true })
    return <box width="100%" height="100%" flexDirection="column">
      <text>Conversation</text>
      <box id="clipping-editor-container" width="100%" height={3} overflow="hidden">
        <MarkdownTextarea id="mention-editor" ref={value => { editor = value }} focused={focused()} width="100%" height={2} />
      </box>
    </box>
  }
  const view = await testRender(() => <KeybindingsProvider overrides={overrides}><MentionProvider identity={identity()} users={users()} search={search}>
    <Editor />
  </MentionProvider></KeybindingsProvider>, { width: 50, height: 14 })
  const settle = async () => { await view.flush(); await view.renderer.idle(); await view.flush() }
  const menu = () => view.renderer.root.findDescendantById("mention-completions")
  return { view, editor, settle, menu, setFocused, setIdentity, setUsers, closes: () => closes, submissions: () => submissions }
}

test("mention picking is caret-aware, undoable, mouse/keyboard accessible and not clipped by the editor", async () => {
  const setup = await setupEditor()
  const { view, editor, settle, menu } = setup
  try {
    await settle()
    await view.mockInput.typeText("@al")
    await settle()
    expect(view.captureCharFrame()).toContain("@alice")
    expect(view.captureCharFrame()).toContain("@alex")
    const container = view.renderer.root.findDescendantById("clipping-editor-container")!
    expect(menu()!.y + menu()!.height).toBeGreaterThan(container.y + container.height)
    view.mockInput.pressArrow("down")
    view.mockInput.pressEnter()
    await settle()
    expect(editor.plainText).toBe("@alex ")
    expect(menu()).toBeUndefined()
    expect(setup.closes()).toBe(0)
    expect(setup.submissions()).toBe(0)
    view.mockInput.pressKey("z", { ctrl: true })
    await settle()
    expect(editor.plainText).toBe("@al")
    expect(editor.logicalCursor.col).toBe(3)
    expect(menu()).toBeUndefined()
    view.mockInput.pressKey(".", { ctrl: true })
    await settle()
    expect(editor.plainText).toBe("@alex ")

    replaceEditorText(editor, "Hi @ace!")
    editor.setCursor(0, 5)
    await view.mockInput.typeText("l")
    await settle()
    expect(editor.plainText).toBe("Hi @alce!")
    await clickControl(view, "mention-option:alice")
    await settle()
    expect(editor.plainText).toBe("Hi @alice!")
    expect(editor.focused).toBe(true)
    expect(menu()).toBeUndefined()

    replaceEditorText(editor, "界\t🙂 before\nPing @al rest")
    editor.setCursor(1, 8)
    await settle()
    await clickControl(view, "mention-option:alice")
    await settle()
    expect(editor.plainText).toBe("界\t🙂 before\nPing @alice rest")
    expect(editor.logicalCursor).toMatchObject({ row: 1, col: 11 })

    replaceEditorText(editor, "")
    await view.mockInput.pasteBracketedText("@al")
    await settle()
    expect(menu()).toBeUndefined()
    await view.mockInput.typeText("i")
    await settle()
    expect(menu()).toBeDefined()
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()
    expect(menu()).toBeUndefined()
    expect(setup.closes()).toBe(0)
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()
    expect(setup.closes()).toBe(1)
    replaceEditorText(editor, "@al")
    editor.gotoBufferEnd()
    await settle()
    expect(menu()).toBeDefined()
    editor.setSelection(0, 3) // Native selection-only changes need not emit a cursor/content event.
    await settle()
    expect(menu()).toBeUndefined()
    view.mockInput.pressEnter()
    await settle()
    expect(editor.plainText).toEndWith("\n") // Enter reaches the editor rather than being swallowed by the picker.
    editor.clearSelection()
    replaceEditorText(editor, "")
    await view.mockInput.typeText("@b")
    await settle()
    view.mockInput.pressTab()
    await settle()
    expect(editor.plainText).toBe("@bob ")
    expect(setup.submissions()).toBe(0)
  } finally { view.renderer.destroy() }
})

test("lookup is debounced, cancels stale queries, and drops results on blur/repository changes", async () => {
  const requests: Array<{ query: string; signal: AbortSignal; result: ReturnType<typeof Promise.withResolvers<readonly string[]>> }> = []
  const setup = await setupEditor((query, signal) => {
    const result = Promise.withResolvers<readonly string[]>()
    requests.push({ query, signal, result })
    return result.promise
  })
  const { view, editor, settle, menu } = setup
  try {
    await settle()
    await view.mockInput.typeText("@z")
    await settle()
    expect(requests).toHaveLength(0)
    await Bun.sleep(210)
    await settle()
    expect(requests.map(request => request.query)).toEqual(["z"])
    await view.mockInput.typeText("o")
    await settle()
    expect(requests[0]!.signal.aborted).toBe(true)
    await Bun.sleep(210)
    await settle()
    expect(requests.map(request => request.query)).toEqual(["z", "zo"])
    requests[0]!.result.resolve(["stale-user"])
    requests[1]!.result.resolve(["zoe"])
    await settle()
    expect(view.captureCharFrame()).toContain("@zoe")
    expect(view.captureCharFrame()).not.toContain("stale-user")
    setup.setFocused(false)
    await settle()
    expect(menu()).toBeUndefined()
    expect(requests[1]!.signal.aborted).toBe(true)
    setup.setIdentity("repo-two")
    setup.setUsers(["other-user"])
    requests[1]!.result.resolve(["zoe"])
    await settle()
    expect(menu()).toBeUndefined()
    expect(editor.plainText).toBe("@zo")
  } finally { view.renderer.destroy() }
})

test("failed user lookup does not block typing or explicit posting, and disposal cancels requests", async () => {
  const setup = await setupEditor(async () => { throw new Error("Offline") })
  const { view, editor, settle, menu } = setup
  try {
    await settle()
    await view.mockInput.typeText("@a")
    await Bun.sleep(210)
    await settle()
    expect(view.captureCharFrame()).toContain("@alice")
    view.mockInput.pressKey("s", { ctrl: true })
    await settle()
    expect(setup.submissions()).toBe(1)
    expect(editor.plainText).toBe("@a")
    replaceEditorText(editor, "@z")
    editor.gotoBufferEnd()
    await Bun.sleep(210)
    await settle()
    expect(view.captureCharFrame()).toContain("Could not load users")
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()
    expect(menu()).toBeUndefined()
    expect(setup.closes()).toBe(0)
  } finally { view.renderer.destroy() }

  const result = Promise.withResolvers<readonly string[]>()
  let signal: AbortSignal | undefined
  const pending = await setupEditor((_query, current) => { signal = current; return result.promise })
  await pending.settle()
  await pending.view.mockInput.typeText("@a")
  await Bun.sleep(210)
  await pending.settle()
  pending.view.renderer.destroy()
  expect(signal?.aborted).toBe(true)
  result.resolve(["alice"])
  await Promise.resolve()
})

test("mention navigation and acceptance honor configured shortcuts", async () => {
  const setup = await setupEditor(undefined, { "mention.down": ["f3"], "mention.accept": ["f8"] })
  try {
    await setup.settle()
    await setup.view.mockInput.typeText("@al")
    await setup.settle()
    setup.view.mockInput.pressKey("F3")
    setup.view.mockInput.pressKey("F8")
    await setup.settle()
    expect(setup.editor.plainText).toBe("@alex ")
    expect(setup.menu()).toBeUndefined()
    expect(setup.submissions()).toBe(0)
  } finally { setup.view.renderer.destroy() }
})

test("empty suggestions leave Enter, Tab and caret navigation to the editor", async () => {
  const setup = await setupEditor()
  const { view, editor, settle, menu } = setup
  try {
    await settle()
    await view.mockInput.typeText("@nobody")
    await settle()
    expect(view.captureCharFrame()).toContain("No matching users")
    view.mockInput.pressEnter()
    await settle()
    expect(editor.plainText).toBe("@nobody\n")
    expect(menu()).toBeUndefined()
    await view.mockInput.typeText("@nobody")
    await settle()
    view.mockInput.pressTab()
    await settle()
    expect(editor.plainText).toBe("@nobody\n@nobody  ")
    await view.mockInput.typeText("@nobody")
    await settle()
    const before = editor.logicalCursor.col
    view.mockInput.pressArrow("up")
    await settle()
    expect(editor.logicalCursor.row).toBe(0)
    expect(editor.logicalCursor.col).toBeLessThanOrEqual(before)
    expect(menu()).toBeUndefined()
    expect(setup.closes()).toBe(0)
    expect(setup.submissions()).toBe(0)
  } finally { view.renderer.destroy() }
})

test("completing an existing bot mention replaces its suffix exactly once", async () => {
  const setup = await setupEditor()
  const { view, editor, settle } = setup
  try {
    setup.setUsers(["dependabot[bot]"])
    await settle()
    replaceEditorText(editor, "Ping @depndabot[bot]!")
    editor.setCursor(0, 9)
    await view.mockInput.typeText("e")
    await settle()
    expect(editor.plainText).toBe("Ping @dependabot[bot]!")
    expect(view.renderer.root.findDescendantById("mention-option:dependabot[bot]")).toBeDefined()
    await clickControl(view, "mention-option:dependabot[bot]")
    await settle()
    expect(editor.plainText).toBe("Ping @dependabot[bot]!")
    expect(editor.logicalCursor.col).toBe(21)
    expect(setup.menu()).toBeUndefined()
    expect(setup.submissions()).toBe(0)
  } finally { view.renderer.destroy() }
})
