import { afterEach, expect, spyOn, test } from "bun:test"
import { type TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { defaultConfig, type Config } from "../src/config"
import type { KeybindingOverrides } from "../src/keybindings"
import { App } from "../src/ui/app"
import { IssueActionDialog } from "../src/ui/components/issue-actions"
import type { IssueActionState } from "../src/repository-state"
import { ContextMenu } from "../src/ui/components/context-menu"
import { ReactionPicker } from "../src/ui/components/reaction-picker"
import { SearchablePicker } from "../src/ui/components/searchable-picker"
import { KeybindingsProvider, KeyInput, KeyTextarea, useKeyActions } from "../src/ui/keybindings"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

test("live bindings update help, header, footer and behavior; disabled actions disappear", async () => {
  const [config, setConfig] = createSignal<Config>({ ...defaultConfig, showStatusBarHints: true })
  let opened = 0
  let commits = 0
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    config={config()} onOpenInBrowser={async () => { opened++ }} onLoadCommit={async () => { commits++ }} />,
  { width: 140, height: 40 })
  active.push(view)
  await view.flush()
  view.mockInput.pressKey("?")
  await view.flush()
  expect(view.captureCharFrame()).toContain("copy repo URL")
  view.resize(50, 12)
  await view.flush()
  view.mockInput.pressKey("G")
  await view.flush()
  expect(view.captureCharFrame()).toContain("q / ctrl+c")
  view.resize(140, 40)
  view.mockInput.pressKey("g")
  await view.flush()
  setConfig((current) => ({ ...current, keybindings: {
    "global.help": ["f1"], "item.open": ["f2"], "navigation.tab2": ["f3"],
    "navigation.activate": ["f4"], "item.copy": [],
  } }))
  await view.flush()
  let frame = view.captureCharFrame()
  expect(frame).toContain("f3 Commits")
  expect(frame).toContain("f2")
  expect(frame).not.toContain("copy repo URL")
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  await view.flush()
  frame = view.captureCharFrame()
  expect(frame).toContain("f2 GitHub")
  expect(frame).toContain("f1 help")
  expect(frame).not.toContain("copy URL")
  view.mockInput.pressKey("?")
  view.mockInput.pressKey("o")
  expect(opened).toBe(0)
  view.mockInput.pressKey("F2")
  expect(opened).toBe(1)
  view.mockInput.pressKey("F3")
  await view.flush()
  view.mockInput.pressEnter()
  expect(commits).toBe(0)
  view.mockInput.pressKey("F4")
  expect(commits).toBe(1)
})

test("search scopes protect typing, use remapped controls and do not retain native editing shortcuts", async () => {
  let query = ""
  let selected = ""
  let closed = 0
  let leaked = 0
  function Ambient() {
    useKeyActions({ "global.quit": () => leaked++, "global.help": () => leaked++, "global.settings": () => leaked++ })
    return null
  }
  const overrides: KeybindingOverrides = {
    "picker.down": ["ctrl+n"], "picker.accept": ["f6"], "dialog.close": ["f7"], "editor.backspace": ["f8"],
  }
  const view = await testRender(() => <KeybindingsProvider overrides={overrides}>
    <Ambient />
    <SearchablePicker title="Picker" placeholder="Search" height={12} items={["alpha", "beta"]}
      itemKey={(item) => item} match={(_item, value) => value ? undefined : 0}
      onQueryChange={(value) => { query = value }} onSelect={(item) => { selected = item }} onClose={() => closed++}>
      {(item, current) => <text>{current() ? `active ${item}` : item}</text>}
    </SearchablePicker>
  </KeybindingsProvider>, { width: 80, height: 20 })
  active.push(view)
  await view.flush()
  await view.mockInput.typeText("qs?,")
  expect(query).toBe("qs?,")
  expect(leaked).toBe(0)
  view.mockInput.pressBackspace()
  expect(query).toBe("qs?,")
  view.mockInput.pressKey("F8")
  expect(query).toBe("qs?")
  view.mockInput.pressKey("u", { ctrl: true })
  expect(query).toBe("")
  view.mockInput.pressArrow("down")
  await view.flush()
  expect(view.captureCharFrame()).toContain("active alpha")
  view.mockInput.pressKey("n", { ctrl: true })
  await view.flush()
  expect(view.captureCharFrame()).toContain("active beta")
  view.mockInput.pressEnter()
  expect(selected).toBe("")
  view.mockInput.pressKey("F6")
  expect(selected).toBe("beta")
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  expect(closed).toBe(0)
  view.mockInput.pressKey("F7")
  expect(closed).toBe(1)
})

test("multiline editing remaps movement, newline, deletion and submit without breaking paste", async () => {
  let editor!: TextareaRenderable
  let submitted = 0
  const view = await testRender(() => <KeybindingsProvider overrides={{
    "editor.move-left": ["f3"], "editor.backspace": ["f2"], "editor.newline": ["ctrl+enter"], "editor.submit": ["f4"],
  }}><KeyTextarea focused width={30} height={6} ref={(value) => { editor = value }} onSubmit={() => submitted++} /></KeybindingsProvider>,
  { width: 40, height: 10, kittyKeyboard: true })
  active.push(view)
  await view.flush()
  await view.mockInput.typeText("ab")
  view.mockInput.pressArrow("left")
  expect(editor.cursorOffset).toBe(2)
  view.mockInput.pressKey("F3")
  expect(editor.cursorOffset).toBe(1)
  view.mockInput.pressEnter()
  expect(editor.plainText).toBe("ab")
  view.mockInput.pressEnter({ ctrl: true })
  expect(editor.plainText).toBe("a\nb")
  view.mockInput.pressBackspace()
  expect(editor.plainText).toBe("a\nb")
  view.mockInput.pressKey("F2")
  expect(editor.plainText).toBe("ab")
  await view.mockInput.pasteBracketedText("Z\né")
  expect(editor.plainText).toBe("aZ\néb")
  view.mockInput.pressKey("F4")
  expect(submitted).toBe(1)
})

for (const Editor of [KeyInput, KeyTextarea]) {
  test(`${Editor.name} supports Ctrl/Cmd+Z undo and shifted redo`, async () => {
    let editor!: TextareaRenderable
    const view = await testRender(() => <KeybindingsProvider>
      <Editor focused width={30} height={6} ref={(value) => { editor = value }} />
    </KeybindingsProvider>, { width: 40, height: 10, kittyKeyboard: true })
    active.push(view)
    await view.flush()
    await view.mockInput.pasteBracketedText("draft text")
    for (const modifier of [{ ctrl: true }, { super: true }]) {
      view.mockInput.pressKey("u", { ctrl: true })
      expect(editor.plainText).toBe("")
      view.mockInput.pressKey("z", modifier)
      expect(editor.plainText).toBe("draft text")
      view.mockInput.pressKey("z", { ...modifier, shift: true })
      expect(editor.plainText).toBe("")
      view.mockInput.pressKey("z", modifier)
      expect(editor.plainText).toBe("draft text")
    }
  })
}

for (const Editor of [KeyInput, KeyTextarea]) {
  test(`${Editor.name} groups typing, separates pauses/navigation, and restores atomic selection edits`, async () => {
    let editor!: TextareaRenderable
    let input = ""
    const view = await testRender(() => <KeybindingsProvider>
      <Editor focused width={30} height={6} ref={(value) => { editor = value }} onInput={(value: string) => { input = value }} />
    </KeybindingsProvider>, { width: 40, height: 10, kittyKeyboard: true })
    active.push(view)
    await view.flush()
    const clock = spyOn(Date, "now").mockReturnValue(1000)
    const undo = () => view.mockInput.pressKey("z", { ctrl: true })
    const redo = () => view.mockInput.pressKey("z", { ctrl: true, shift: true })
    try {
      await view.mockInput.typeText("abc")
      clock.mockReturnValue(2000)
      await view.mockInput.typeText("de")
      undo()
      expect(editor.plainText).toBe("abc")
      expect(editor.cursorOffset).toBe(3)
      undo()
      expect(editor.plainText).toBe("")
      redo()
      redo()
      expect(editor.plainText).toBe("abcde")
      view.mockInput.pressArrow("left")
      await view.mockInput.typeText("XY")
      undo()
      expect(editor.plainText).toBe("abcde")
      expect(editor.cursorOffset).toBe(4)
      redo()
      expect(editor.plainText).toBe("abcdXYe")

      // Replacing selected text is one edit, even though OpenTUI records two.
      editor.cursorOffset = 4
      editor.setSelection(1, 4)
      await view.mockInput.pasteBracketedText("界é")
      expect(editor.plainText).toBe("a界éXYe")
      undo()
      expect(editor.plainText).toBe("abcdXYe")
      expect(editor.cursorOffset).toBe(4)
      expect(editor.getSelectedText()).toBe("bcd")
      redo()
      expect(editor.plainText).toBe("a界éXYe")
      expect(editor.cursorOffset).toBe(4)
      expect(editor.hasSelection()).toBe(false)
      if (Editor === KeyInput) expect(input).toBe("a界éXYe")
      undo()
      await view.mockInput.typeText("new")
      expect(editor.plainText).toBe("anewXYe")
      redo()
      expect(editor.plainText).toBe("anewXYe")

      editor.setText("another draft")
      undo()
      expect(editor.plainText).toBe("another draft")
    } finally {
      clock.mockRestore()
    }
  })
}

for (const Editor of [KeyInput, KeyTextarea]) {
  test(`${Editor.name} groups repeated deletion by direction and breaks groups on mouse clicks`, async () => {
    let editor!: TextareaRenderable
    let clicks = 0
    const view = await testRender(() => <KeybindingsProvider>
      <Editor focused width={30} height={6} ref={(value) => { editor = value }} onMouseDown={() => { clicks++ }} />
    </KeybindingsProvider>, { width: 40, height: 10, kittyKeyboard: true })
    active.push(view)
    await view.flush()
    const clock = spyOn(Date, "now").mockReturnValue(1000)
    const undo = () => view.mockInput.pressKey("z", { ctrl: true })
    const redo = () => view.mockInput.pressKey("z", { ctrl: true, shift: true })
    try {
      await view.mockInput.typeText("abcdef")
      view.mockInput.pressBackspace()
      view.mockInput.pressBackspace()
      expect(editor.plainText).toBe("abcd")
      undo()
      expect(editor.plainText).toBe("abcdef")
      expect(editor.cursorOffset).toBe(6)
      redo()
      expect(editor.plainText).toBe("abcd")
      expect(editor.cursorOffset).toBe(4)
      undo()
      undo()
      expect(editor.plainText).toBe("")

      editor.setText("abcdef")
      editor.cursorOffset = 0
      view.mockInput.pressKey("DELETE")
      view.mockInput.pressKey("DELETE")
      expect(editor.plainText).toBe("cdef")
      clock.mockReturnValue(2000)
      view.mockInput.pressKey("DELETE")
      undo()
      expect(editor.plainText).toBe("cdef")
      undo()
      expect(editor.plainText).toBe("abcdef")
      expect(editor.cursorOffset).toBe(0)
      redo()
      redo()
      expect(editor.plainText).toBe("def")

      editor.setText("abcdef")
      editor.cursorOffset = 3
      view.mockInput.pressBackspace()
      view.mockInput.pressKey("DELETE")
      undo()
      expect(editor.plainText).toBe("abdef")
      undo()
      expect(editor.plainText).toBe("abcdef")

      editor.setText("")
      await view.mockInput.typeText("abc")
      await view.flush()
      await view.mockMouse.click(editor.x + 3, editor.y)
      expect(clicks).toBe(1)
      expect(editor.cursorOffset).toBe(3)
      await view.mockInput.typeText("de")
      undo()
      expect(editor.plainText).toBe("abc")
      undo()
      expect(editor.plainText).toBe("")
    } finally {
      clock.mockRestore()
    }
  })
}

test("opening a modal never confirms with the same event, and cleanup restores lower layers", async () => {
  const [modal, setModal] = createSignal(false)
  let confirmations = 0
  let ambient = 0
  function Dialog() {
    useKeyActions({ "dialog.confirm": () => confirmations++, "dialog.close": () => setModal(false) }, { priority: 100, modal: true })
    return <text>Dialog</text>
  }
  function Harness() {
    useKeyActions({ "navigation.activate": () => setModal(true), "global.help": () => ambient++ })
    return <Show when={modal()} fallback={<text>Page</text>}><Dialog /></Show>
  }
  const view = await testRender(() => <KeybindingsProvider><Harness /></KeybindingsProvider>, { width: 30, height: 8 })
  active.push(view)
  await view.flush()
  view.mockInput.pressEnter()
  expect(modal()).toBe(true)
  expect(confirmations).toBe(0)
  view.mockInput.pressKey("?")
  expect(ambient).toBe(0)
  view.mockInput.pressEnter()
  expect(confirmations).toBe(1)
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  view.mockInput.pressKey("?")
  expect(ambient).toBe(1)
})


test("issue draft controls and confirmation hints follow remaps without leaking into typing", async () => {
  const [state, setState] = createSignal<IssueActionState>({ body: "", reason: "completed", operation: { status: "idle" } })
  let hint = ""
  let submitted = 0
  let closed = 0
  let discarded = 0
  const view = await testRender(() => <KeybindingsProvider overrides={{
    "dialog.submit": ["f2"], "dialog.confirm": ["f3"], "dialog.close": ["f4"],
    "dialog.togglePreview": ["f5"], "dialog.discard": ["f6"],
  }}><IssueActionDialog number={42} kind="comment" state={state()} showScrollbar={false}
    repositoryUrl="https://github.com/owner/repo" onBodyChange={(body) => setState((value) => ({ ...value, body }))}
    onReasonChange={() => {}} onDuplicateTargetChange={() => {}} onSubmit={() => submitted++}
    onDiscard={() => {
      discarded++
      setState((value) => ({ ...value, body: "" }))
    }} onClose={() => closed++} onHintChange={(value) => { hint = value ?? "" }}
  /></KeybindingsProvider>, { width: 100, height: 32 })
  active.push(view)
  await view.flush()
  await view.mockInput.typeText("qrs?,")
  expect(state().body).toBe("qrs?,")
  view.mockInput.pressKey("s", { ctrl: true })
  expect(submitted).toBe(0)
  expect(hint).toContain("f2 submit")
  view.mockInput.pressKey("F5")
  await Bun.sleep(30)
  await view.flush()
  expect(view.renderer.root.findDescendantById("issue-comment-preview-scroll")).toBeDefined()
  view.mockInput.pressKey("F5")
  expect(view.renderer.root.findDescendantById("issue-comment-preview-scroll")).toBeUndefined()
  await view.flush()
  view.mockInput.pressKey("z", { ctrl: true })
  await view.flush()
  expect(state().body).toBe("")
  view.mockInput.pressKey(".", { ctrl: true })
  await view.flush()
  expect(state().body).toBe("qrs?,")
  view.mockInput.pressKey("F2")
  await view.flush()
  expect(submitted).toBe(0)
  expect(hint).toBe("f3 confirm · f4 back")
  expect(view.captureCharFrame()).not.toContain("f3 confirm · f4 back")
  view.mockInput.pressEnter()
  expect(submitted).toBe(0)
  view.mockInput.pressKey("F3")
  expect(submitted).toBe(1)
  await view.flush()
  view.mockInput.pressKey("u", { ctrl: true })
  await view.flush()
  expect(state().body).toBe("")
  view.mockInput.pressKey("F6")
  await view.flush()
  expect(discarded).toBe(1)
  view.mockInput.pressKey("z", { ctrl: true })
  await view.flush()
  expect(state().body).toBe("")
  view.mockInput.pressKey("F4")
  expect(closed).toBe(1)
})


test("mouse menus and reaction picker respect remapped dialog and navigation actions", async () => {
  const [screen, setScreen] = createSignal("context")
  const reactions: string[] = []
  let menuActions = 0
  const view = await testRender(() => <KeybindingsProvider overrides={{
    "dialog.close": ["f4"], "navigation.down": ["f2"], "navigation.activate": ["f9"],
  }}>
    <Show when={screen() === "context"} fallback={
      <Show when={screen() === "reactions"} fallback={<text>Done</text>}>
        <ReactionPicker message={{ target: { kind: "issue", number: 42 }, state: {} }}
          action={() => ({ operation: { status: "idle" } })} showScrollbar={false}
          onAdd={(_target, kind) => reactions.push(kind)} onClose={() => setScreen("done")} />
      </Show>
    }>
      <ContextMenu position={{ x: 2, y: 2 }} items={[{ label: "Action", run: () => {} }]}
        onSelect={() => menuActions++} onClose={() => setScreen("reactions")} />
    </Show>
  </KeybindingsProvider>, { width: 80, height: 24 })
  active.push(view)
  await view.flush()
  view.mockInput.pressEnter()
  view.mockInput.pressKey("F9")
  expect(menuActions).toBe(0) // Context menus remain mouse-only.
  view.mockInput.pressKey("F4")
  await view.flush()
  expect(screen()).toBe("reactions")
  view.mockInput.pressKey("F2")
  view.mockInput.pressKey("F9")
  expect(reactions).toEqual(["-1"])
  view.mockInput.pressKey("F4")
  await view.flush()
  expect(screen()).toBe("done")
})


test("multiline indentation preserves selected Unicode lines and is one undoable edit", async () => {
  let editor!: TextareaRenderable
  const initial = "one\n\t界\nlast"
  const view = await testRender(() => <KeybindingsProvider>
    <KeyTextarea ref={(value) => { editor = value }} initialValue={initial}
      focused width={50} height={6} selectionOccupancy="boundary" />
  </KeybindingsProvider>, { width: 60, height: 10 })
  active.push(view)
  await view.flush()
  editor.gotoBufferHome()
  view.mockInput.pressTab()
  expect(editor.plainText).toBe("  one\n\t界\nlast")
  view.mockInput.pressTab({ shift: true })
  expect(editor.plainText).toBe(initial)

  const end = editor.editBuffer.getLineStartOffset(2)
  editor.setSelection(0, end)
  view.mockInput.pressTab()
  expect(editor.plainText).toBe("  one\n  \t界\nlast")
  expect(editor.getSelectedText()).toContain("界")
  view.mockInput.pressKey("z", { ctrl: true })
  expect(editor.plainText).toBe(initial)
  expect(editor.getSelection()).toEqual({ start: 0, end })
  view.mockInput.pressKey(".", { ctrl: true })
  expect(editor.plainText).toBe("  one\n  \t界\nlast")
  view.mockInput.pressTab({ shift: true })
  expect(editor.plainText).toBe(initial)
  view.mockInput.pressTab({ shift: true })
  expect(editor.plainText).toBe("one\n界\nlast")
  view.mockInput.pressKey("z", { ctrl: true })
  expect(editor.plainText).toBe(initial)
})
