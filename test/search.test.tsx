import { expect, spyOn, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA, type TextRenderable } from "@opentui/core"
import { appColors, resolveTheme } from "../src/theme"
import { createSignal } from "solid-js"
import { searchRanges, wrapSearchIndex } from "../src/ui/search"
import { SearchProvider } from "../src/ui/search-context"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { SelectableList } from "../src/ui/components/selectable-list"
import { SearchBar } from "../src/ui/components/search-bar"
import { App } from "../src/ui/app"
import { defaultConfig } from "../src/config"
import type { RepositoryData } from "../src/repository-state"
import { githubDataFixture, repositoryOperationsFixture, commitDetailFixture } from "./fixtures/github-data"

test("literal smart-case search retains original Unicode offsets and wraps", () => {
  expect(searchRanges("foo Foo FOO", "foo")).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 }])
  expect(searchRanges("foo Foo FOO", "Foo")).toEqual([{ start: 4, end: 7 }])
  expect(searchRanges("foo Foo FOO", "FOO")).toEqual([{ start: 8, end: 11 }])
  expect(searchRanges("é É", "é")).toEqual([{ start: 0, end: 1 }, { start: 2, end: 3 }])
  expect(searchRanges("é É", "É")).toEqual([{ start: 2, end: 3 }])
  expect(searchRanges("a.b A.B", ".")).toEqual([{ start: 1, end: 2 }, { start: 5, end: 6 }])
  expect(searchRanges("🙂中é İ foo FOO", "foo")).toEqual([{ start: 8, end: 11 }, { start: 12, end: 15 }])
  expect(searchRanges("aaaa", "aa")).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }])
  expect(searchRanges("abc", "")).toEqual([])
  const exec = spyOn(RegExp.prototype, "exec")
  try {
    const capped = searchRanges("x".repeat(100_000), "x", 10_000)
    const calls = exec.mock.calls.length
    expect(capped).toHaveLength(10_000)
    expect(calls).toBeLessThan(10_010) // Stop near the cap, rather than scanning every match before slicing.
  } finally { exec.mockRestore() }
  expect(searchRanges("🙂中é İ foo FOO", "foo", 1)).toEqual([{ start: 8, end: 11 }])
  expect(searchRanges("abc", "a", 0)).toEqual([])
  expect(wrapSearchIndex(0, -1, 3)).toBe(2)
  expect(wrapSearchIndex(2, 1, 3)).toBe(0)
  expect(wrapSearchIndex(0, 1, 0)).toBe(-1)
})

test("incremental list search selects without filtering or fetching; cancel restores and retained views isolate", async () => {
  const [page, setPage] = createSignal("a")
  const items = Array.from({ length: 20 }, (_, id) => ({ id, label: id === 5 || id === 19 ? `needle ${id}` : `row ${id}` }))
  let selected = -1
  let loads = 0
  const view = await testRender(() => <KeybindingsProvider><box height="100%" flexDirection="column">
    <SearchProvider identity={page()} enabled>
      <SelectableList items={items} itemKey={(item) => item.id} active empty="empty"
        onSelect={(item) => { selected = item.id }} onEndReached={() => { loads++ }}>
        {(item) => <text>{item().label}</text>}
      </SelectableList>
    </SearchProvider>
  </box></KeybindingsProvider>, { width: 60, height: 15 })
  const key = async (key: string) => {
    if (key === "enter") view.mockInput.pressEnter()
    else if (key === "escape") { view.mockInput.pressEscape(); await Bun.sleep(30) }
    else view.mockInput.pressKey(key)
    await view.flush()
  }
  try {
    await view.flush()
    expect(selected).toBe(0)
    await key("/")
    await view.mockInput.typeText("needle")
    await view.flush()
    expect(selected).toBe(5)
    expect(view.captureCharFrame()).toContain("1/2")
    await key("enter")
    expect(view.captureCharFrame(), "accepted frame").toContain("1/2")
    await key("k")
    expect(selected).toBe(4)
    await key("n")
    expect(selected, "next starts from the manually selected row").toBe(5)
    await key("j")
    expect(selected).toBe(6)
    await key("N")
    expect(selected, "previous starts from the manually selected row").toBe(5)
    await key("n")
    expect(view.captureCharFrame(), "next frame").toContain("2/2")
    expect(selected, "next match").toBe(19)
    expect(loads).toBe(0)
    await key("n")
    expect(selected).toBe(5)
    await key("N")
    expect(selected, "previous match").toBe(19)
    await key("/")
    await view.mockInput.typeText("missing")
    await view.flush()
    expect(view.captureCharFrame()).toContain("No matches")
    await key("escape")
    expect(selected, "cancel draft").toBe(19)
    expect(view.captureCharFrame()).toContain("2/2")
    setPage("b")
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("/needle")
    setPage("a")
    await view.flush()
    expect(view.captureCharFrame()).toContain("/needle")
    await key("escape")
    expect(view.captureCharFrame()).not.toContain("/needle")
    expect(loads).toBe(0)
  } finally { view.renderer.destroy() }
})

test("App searches displayed list/detail content, clears before back, and leaves picker input alone", async () => {
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    initialPage="commits" onBranchChange={() => {}} config={{ ...defaultConfig, showStatusBarHints: true }}
    commitDetail={{ sha: commitDetailFixture.sha, resource: { status: "ready", value: commitDetailFixture } }}
  />, { width: 100, height: 30 })
  const settle = async () => { await Bun.sleep(35); await view.flush() }
  const escape = async () => { view.mockInput.pressEscape(); await settle() }
  try {
    await settle()
    const beforeSearch = view.captureCharFrame().split("\n")
    view.mockInput.pressKey("/")
    await settle()
    const searching = view.captureCharFrame().split("\n")
    expect(searching.slice(0, 29)).toEqual(beforeSearch.slice(0, 29))
    expect(beforeSearch[29]).toContain("search")
    expect(searching[29]!.trim()).toBe("/")
    expect(view.captureCharFrame()).not.toContain(beforeSearch[29]!.trim())
    await view.mockInput.typeText("duplicate")
    await settle()
    expect(view.captureCharFrame()).toContain("1/1")
    view.mockInput.pressEnter()
    await settle()
    view.mockInput.pressEnter()
    await settle()
    expect(view.captureCharFrame()).not.toContain("/duplicate")
    view.mockInput.pressKey("/")
    await view.mockInput.typeText("keyboard")
    await settle()
    expect(view.captureCharFrame()).toContain("1/1")
    view.mockInput.pressEnter()
    await settle()
    await escape()
    expect(view.captureCharFrame()).not.toContain("/keyboard")
    expect(view.captureCharFrame()).toContain("one owner for keyboard")
    await escape()
    expect(view.captureCharFrame()).toContain("/duplicate")
    await escape()
    view.mockInput.pressTab()
    await settle()
    await view.mockInput.typeText("/nN")
    await settle()
    expect(view.captureCharFrame()).toContain("/nN")
    expect(view.captureCharFrame()).not.toContain("No matches")
  } finally { view.renderer.destroy() }
})

test.each((["overview", "commits", "issues", "pulls", "actions"] as const).flatMap((page) =>
  [false, true].map((accepted) => [page, accepted] as const),
))("%s search survives initial loading (accepted: %s)", async (page, accepted) => {
  const query = { overview: "TypeScript", commits: "duplicate", issues: "resize", pulls: "retain", actions: "retain" }[page]
  const [data, setData] = createSignal<RepositoryData>({ ...githubDataFixture,
    documents: { status: "loading", phase: "load" }, commits: { status: "loading", phase: "load" }, runs: { status: "loading", phase: "load" },
    issues: { open: { status: "loading", phase: "load" }, closed: { status: "loading", phase: "load" } },
    pulls: { open: { status: "loading", phase: "load" }, closed: { status: "loading", phase: "load" } },
  })
  const view = await testRender(() => <App data={data()} operations={repositoryOperationsFixture} initialNavigation={{ page }} />,
    { width: 100, height: 30 })
  try {
    await view.flush()
    view.mockInput.pressKey("/")
    await view.mockInput.typeText(query)
    await view.flush()
    if (accepted) {
      view.mockInput.pressEnter()
      await view.flush()
    }
    expect(view.captureCharFrame()).toContain(`/${query}`)
    setData(githubDataFixture)
    await Bun.sleep(180)
    await view.flush()
    expect(view.captureCharFrame()).toContain(`/${query}`)
    expect(view.captureCharFrame()).not.toContain("No matches")
    if (!accepted) {
      await view.mockInput.typeText("more")
      await view.flush()
      expect(view.captureCharFrame()).toContain(`/${query}more`)
    }
  } finally { view.renderer.destroy() }
})

test("long queries keep the prompt and result count visible without wrapping the footer", async () => {
  const [editing, setEditing] = createSignal(true)
  const [total, setTotal] = createSignal(12)
  const view = await testRender(() => <KeybindingsProvider>
    <box height="100%" flexDirection="column">
      <box flexGrow={1}><text>Page content</text></box>
      <SearchBar query={"abcdefghijklmnopqrstuvwxyz".repeat(4)} editing={editing()} current={3} total={total()} onInput={() => {}} />
    </box>
  </KeybindingsProvider>, { width: 35, height: 5 })
  try {
    for (const width of [35, 18]) {
      view.resize(width, 5)
      for (const editing of [true, false]) {
        setEditing(editing)
        for (const total of [12, 0]) {
          setTotal(total)
          await view.flush()
          const lines = view.captureCharFrame().split("\n")
          expect(lines[0]).toContain("Page content")
          expect(lines[3]!.trim()).toBe("")
          expect(lines[4]).toStartWith(" /")
          expect(lines[4]!.trimEnd()).toEndWith(total ? "3/12" : "No matches")
        }
      }
    }
  } finally { view.renderer.destroy() }
})

test("Settings search selects and highlights rows without changing values or searching the page underneath", async () => {
  const [config, setConfig] = createSignal({ ...defaultConfig, showStatusBarHints: true })
  let writes = 0
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    initialPage="commits" config={config()} onConfigChange={async (next) => { writes++; setConfig(next) }} />,
  { width: 100, height: 22 })
  const settle = async () => { await Bun.sleep(35); await view.flush() }
  const key = async (value: string) => {
    if (value === "enter") view.mockInput.pressEnter()
    else if (value === "escape") view.mockInput.pressEscape()
    else view.mockInput.pressKey(value)
    await settle()
  }
  const search = async (query: string) => {
    await key("/")
    await view.mockInput.pasteBracketedText(query)
    await settle()
    await key("enter")
  }
  const selected = (setting: string) => (view.renderer.root.findDescendantById(`setting-${setting}`)!.getChildren()[0] as TextRenderable).plainText
  const footer = () => view.captureCharFrame().split("\n")[21]!
  try {
    await settle()
    await search("duplicate")
    expect(view.captureCharFrame()).toContain("2 Commits")
    await key(",")
    expect(view.captureCharFrame()).not.toContain("2 Commits")
    expect(footer()).not.toContain("duplicate")
    await search("style")
    expect(footer()).toContain("/style")
    expect(footer()).toContain("1/2")
    expect(footer()).not.toContain("select")
    expect(selected("markdown-style")).toBe("›")
    const bg = RGBA.fromHex(appColors(resolveTheme(defaultConfig.theme)).searchCurrentMatchBg)
    expect(view.captureSpans().lines.flatMap(line => line.spans).filter(span => span.bg.equals(bg))
      .map(span => span.text).join("")).toContain("style")
    await key("n")
    expect(selected("icon-style")).toBe("›")
    expect(view.captureCharFrame()).toContain("Icon style")
    expect(footer()).toContain("2/2")
    await key("N")
    expect(selected("markdown-style")).toBe("›")
    expect(writes).toBe(0)
    await key("enter")
    expect(writes).toBe(1)
    expect(config().markdownStyle).not.toBe(defaultConfig.markdownStyle)
    await key("escape") // Clear before closing Settings.
    expect(footer()).not.toContain("/style")
    expect(view.captureCharFrame()).toContain("Settings")
    await key("escape")
    expect(footer()).toContain("/duplicate")
    await key(",")
    await search("theme")
    await key("enter")
    expect(view.captureCharFrame()).toContain("Themes")
    expect(footer()).not.toContain("/theme")
    await view.mockInput.pasteBracketedText("/nN")
    await settle()
    expect(view.captureCharFrame()).toContain("/nN")
    expect(footer()).not.toContain("No matches")
  } finally { view.renderer.destroy() }
})
