import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { RGBA, type BoxRenderable, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { DiffContent, DiffTarget } from "../src/models"
import type { CommitDetailState, DiffState, PullDetailState, ResourceState } from "../src/repository-state"
import { App } from "../src/ui/app"
import { defaultConfig } from "../src/config"
import { appColors, resolveTheme } from "../src/theme"
import { SelectionClipboard } from "../src/ui/components/selection-clipboard"
import { initializeHunk } from "../src/ui/hunk-host"
import { DiffScreen } from "../src/ui/pages/diff"
import { StatusPromptBar, StatusPromptProvider } from "../src/ui/status-prompt"
import { commitDetailFixture, githubDataFixture, pullContextFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { patchFixture } from "./fixtures/diff"
import { parseDiff } from "../src/ui/diff-model"
import { clickControl } from "./fixtures/mouse"

test("F filters complete current and previous paths live, accepts, clears and cancels without toggling files", async () => {
  const setup = await createTestRenderer({ width: 100, height: 20 })
  initializeHunk(setup.renderer)
  const files = [
    { path: "src/very-long-directory/alpha.ts", additions: 0, deletions: 0, status: "modified" as const },
    { path: "src/beta.ts", previousPath: "legacy/OLD-name.ts", additions: 0, deletions: 0, status: "renamed" as const },
  ]
  await render(() => <StatusPromptProvider><box width="100%" height="100%" flexDirection="column">
    <DiffScreen target={{ kind: "commit", sha: "abc" }}
      resource={{ status: "ready", value: { kind: "files", files, truncated: false } }} interactive showScrollbar={false} onLoadFiles={() => {}} />
    <StatusPromptBar fallback={<text id="status-bar" height={1}>status</text>} />
  </box></StatusPromptProvider>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const pane = () => setup.renderer.root.findDescendantById("diff-files-pane")!
  const input = () => setup.renderer.root.findDescendantById("diff-file-filter") as InputRenderable | undefined
  const escape = async () => { setup.mockInput.pressEscape(); await Bun.sleep(30); await settle() }
  try {
    await settle()
    expect(setup.captureCharFrame()).toContain("status")
    setup.mockInput.pressKey("F")
    await settle()
    expect(pane().visible).toBe(true) // F must not hide an already visible sidebar.
    expect(input()?.focused).toBe(true)
    // Like `/` search, the prompt replaces the status bar row instead of living in the sidebar.
    expect(input()!.y).toBe(19)
    expect(setup.renderer.root.findDescendantById("status-bar")).toBeUndefined()
    expect(setup.captureCharFrame()).toContain("filter:")
    expect(setup.captureCharFrame()).not.toMatch(/accept|cancel/)
    await setup.mockInput.typeText(",.")
    await settle()
    expect(input()?.plainText).toBe(",.") // Punctuation belongs to the focused input, not file navigation.
    setup.mockInput.pressKey("a", { ctrl: true })
    setup.mockInput.pressKey("k", { ctrl: true })
    await setup.mockInput.typeText("ALPHA.ts") // The basename stays visible even when the directory is shortened.
    await settle()
    expect(setup.captureCharFrame()).toContain("Files (1/2)")
    expect(setup.captureCharFrame()).toContain("alpha.ts")
    const basenameHighlight = appColors(resolveTheme(defaultConfig.theme)).searchMatchBg
    expect(setup.captureSpans().lines.slice(pane().y, pane().y + pane().height).flatMap((line) => line.spans)
      .filter((span) => span.bg.equals(RGBA.fromHex(basenameHighlight))).map((span) => span.text)).toContain("alpha.ts")
    expect(setup.captureCharFrame()).not.toContain("src/beta.ts")
    setup.mockInput.pressEnter()
    await settle()
    expect(input()).toBeUndefined()
    expect(setup.renderer.root.findDescendantById("status-bar")).toBeDefined() // Accepting returns the status bar.
    expect(setup.captureCharFrame()).toContain("Files (1/2)")
    setup.mockInput.pressKey("s")
    expect(pane().visible).toBe(false)
    setup.mockInput.pressKey("F")
    await settle()
    expect(pane().visible).toBe(true)
    expect(input()?.focused).toBe(true)
    expect(setup.captureCharFrame()).toContain("filter: ALPHA.ts") // Reopening edits the retained filter.
    expect(setup.captureCharFrame()).toContain("Files (1/2)")
    await escape() // Escape while editing clears the filter and closes the prompt.
    expect(input()).toBeUndefined()
    expect(pane().visible).toBe(true)
    expect(setup.captureCharFrame()).toContain("Files (2)")
    // Matches are painted with the search colors, like `/` search; matching stays case-insensitive.
    setup.mockInput.pressKey("F")
    await settle()
    await setup.mockInput.typeText("BETA")
    await settle()
    const match = appColors(resolveTheme(defaultConfig.theme)).searchMatchBg
    const painted = () => setup.captureSpans().lines.slice(pane().y, pane().y + pane().height).flatMap((line) => line.spans)
      .filter((span) => span.bg.equals(RGBA.fromHex(match))).map((span) => span.text)
    expect(painted()).toEqual(["beta"])
    setup.mockInput.pressEnter() // Enter keeps the filter and its highlights, like a retained search.
    await settle()
    expect(input()).toBeUndefined()
    expect(setup.captureCharFrame()).toContain("Files (1/2)")
    expect(painted()).toEqual(["beta"])
    setup.mockInput.pressKey(",") // Filtered navigation stays on its sole match.
    setup.mockInput.pressKey(".")
    await settle()
    expect(setup.captureCharFrame()).toContain("src/beta.ts")
    await escape() // Escape on a retained filter clears it instead of leaving the diff.
    expect(pane().visible).toBe(true)
    expect(setup.captureCharFrame()).toContain("Files (2)")
    expect(painted()).toEqual([])
    setup.mockInput.pressKey("F")
    await settle()
    await setup.mockInput.typeText("  OLD-name  ")
    await settle()
    expect(setup.captureCharFrame()).toContain("Files (1/2)")
    expect(setup.captureCharFrame()).toContain("src/beta.ts")
    setup.mockInput.pressTab() // Tab also accepts to navigation, retaining the query.
    await settle()
    expect(input()).toBeUndefined()
    expect(setup.captureCharFrame()).toContain("Files (1/2)")
    await escape()
    setup.mockInput.pressKey("F")
    await settle()
    await setup.mockInput.typeText("no-such-file")
    await settle()
    expect(setup.captureCharFrame()).toContain("No matching files.")
    expect(setup.captureCharFrame()).toContain("Files (0/2)")
    await escape()
    expect(input()).toBeUndefined()
    expect(setup.captureCharFrame()).toContain("Files (2)")
    setup.resize(48, 20)
    setup.mockInput.pressKey("s")
    setup.mockInput.pressKey("F")
    await settle()
    expect(pane().visible).toBe(true)
    expect(input()?.focused).toBe(true)
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("configured diff layout and wrapping defaults match toggling t and w, and remain per-view overrides", async () => {
  const patch = `diff --git a/wide.txt b/wide.txt\n--- a/wide.txt\n+++ b/wide.txt\n@@ -1 +1 @@\n-${"old ".repeat(40)}\n+${"new ".repeat(40)}\n`
  const frames: Record<string, string> = {}
  for (const variant of ["toggled", "configured", "auto"] as const) {
    const setup = await createTestRenderer({ width: 120, height: 16 })
    initializeHunk(setup.renderer)
    const [defaults, setDefaults] = createSignal<{ defaultLayout?: "split" | "unified"; defaultWrap?: boolean }>(
      variant === "configured" ? { defaultLayout: "unified", defaultWrap: true } : {})
    await render(() => <box width="100%" height="100%"><DiffScreen target={{ kind: "commit", sha: "defaults" }}
      resource={{ status: "ready", value: { kind: "patch", patch } }} interactive showScrollbar={false} onLoadFiles={() => {}}
      defaultLayout={defaults().defaultLayout} defaultWrap={defaults().defaultWrap} /></box>, setup.renderer)
    const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
    try {
      await settle()
      if (variant === "toggled") { setup.mockInput.pressKey("t"); setup.mockInput.pressKey("w"); await settle() }
      frames[variant] = setup.captureCharFrame()
      if (variant === "configured") {
        setup.mockInput.pressKey("w") // The per-view toggle still wins over the configured default…
        await settle()
        const unwrapped = setup.captureCharFrame()
        expect(unwrapped).not.toBe(frames.configured)
        setDefaults({ defaultLayout: "unified", defaultWrap: false }) // …and config changes don't undo an explicit toggle:
        await settle()
        expect(setup.captureCharFrame()).toBe(unwrapped)
        setDefaults({ defaultLayout: "unified", defaultWrap: true }) // re-enabling wrap in config must not re-wrap this view.
        await settle()
        expect(setup.captureCharFrame()).toBe(unwrapped)
      }
    } finally { setup.renderer.destroy(); await setup.renderer.closed }
  }
  expect(frames.configured).toBe(frames.toggled) // Unified + wrapped by config renders exactly like pressing t and w.
  expect(frames.auto).not.toBe(frames.configured) // The width-based default is split and unwrapped at 120 columns.
})

test("mouse diff gestures select hunks in place, isolate pane wheels, pan, wrap, and reach both narrow panes", async () => {
  const setup = await createTestRenderer({ width: 110, height: 26 })
  initializeHunk(setup.renderer)
  const copied: string[] = []
  const [interactive, setInteractive] = createSignal(true)
  const lines = (prefix: string, count: number, marker: string) => Array.from({ length: count }, (_, index) => `${marker}${prefix}-${index}-${"x".repeat(90)}\n`).join("")
  const patch = `diff --git a/mouse.txt b/mouse.txt\n--- a/mouse.txt\n+++ b/mouse.txt\n@@ -1,2 +1,2 @@\n`
    + lines("first-old", 2, "-") + lines("first-new", 2, "+")
    + `@@ -100,30 +100,30 @@\n` + lines("second-old", 30, "-") + lines("second-new", 30, "+")
    + `@@ -500 +500 @@\n-last-old\n+last-new\n`
    + Array.from({ length: 25 }, (_, index) => `diff --git a/file-${index}.txt b/file-${index}.txt\n--- a/file-${index}.txt\n+++ b/file-${index}.txt\n@@ -1 +1 @@\n-old\n+new\n`).join("")
  const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
  await render(() => <box width="100%" height="100%">
    <SelectionClipboard onCopy={async (value) => { copied.push(value); return true }} />
    <DiffScreen target={{ kind: "commit", sha: "mouse" }}
    resource={{ status: "ready", value: { kind: "patch", patch } }} interactive={interactive()} showScrollbar={false} onLoadFiles={() => {}} /></box>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const files = () => setup.renderer.root.findDescendantById("diff-files-pane") as BoxRenderable
  const body = () => setup.renderer.root.findDescendantById("diff-body-scroll") as ScrollBoxRenderable
  const codeRow = (text: string) => setup.captureCharFrame().split("\n").findIndex((line) => line.includes(text))
  const rail = (index: number) => {
    const header = setup.renderer.root.findDescendantById(`diff-hunk:${file.id}:${index}`)!
    let column = 0
    const span = setup.captureSpans().lines[header.y + 1]?.spans.find((span) => {
      const start = column
      column += Bun.stringWidth(span.text)
      return start <= body().viewport.x && column > body().viewport.x
    })
    expect(span).toBeDefined()
    return span!.fg
  }
  const expectSelected = (index: number) => {
    expect(rail(index)).toEqual(selectedRail)
    expect(rail(index === 0 ? 1 : 0)).toEqual(unselectedRail)
  }
  let selectedRail: ReturnType<typeof rail>
  let unselectedRail: ReturnType<typeof rail>
  try {
    await settle()
    expect(setup.renderer.root.findDescendantById("diff-controls")).toBeUndefined()
    selectedRail = rail(0)
    unselectedRail = rail(1)
    expect(selectedRail).not.toEqual(unselectedRail)
    const x = body().viewport.x + 10
    const second = codeRow("second-old-0")
    expect(second).toBeGreaterThan(-1)
    const sourceColumn = setup.captureCharFrame().split("\n")[second]!.indexOf("second-old-0")
    await setup.mockMouse.click(x, second)
    await settle()
    expectSelected(1)
    expect(body().scrollTop).toBe(0) // Selecting visible code must not jump to its header.
    const first = codeRow("first-old-0")
    for (const button of [1, 2] as const) await setup.mockMouse.click(x, first, button)
    await setup.mockMouse.drag(x, first, x + 4, first)
    await settle()
    expectSelected(1)
    expect(setup.renderer.getSelection()).toBeNull()
    expect(copied.at(-1)).toBeTruthy()
    await setup.mockMouse.pressDown(x, first)
    await setup.mockMouse.scroll(x, first, "right")
    await setup.mockMouse.release(x, first)
    await settle()
    expectSelected(1) // A wheel gesture cancels a held click, not just its reveal.
    await setup.mockMouse.scroll(x, first, "left")
    await settle()
    const list = files().getChildren().flatMap((node) => node.getChildren()).find((node) => "viewport" in node) as ScrollBoxRenderable
    await setup.mockMouse.scroll(list.viewport.x + 4, list.viewport.y + 2, "down")
    await settle()
    expect(list.scrollTop).toBeGreaterThan(0)
    expect(body().scrollTop).toBe(0)
    setup.mockInput.pressKey("j")
    await settle()
    expect(body().scrollTop).toBeGreaterThan(0) // Sidebar wheel never takes keyboard scrolling.
    body().scrollTo(0)
    await settle()
    await setup.mockMouse.scroll(x, second, "right")
    await settle()
    expect(setup.captureCharFrame().split("\n")[second]!.slice(sourceColumn, sourceColumn + 16)).toBe(`nd-old-0-${"x".repeat(7)}`)
    expect(setup.captureCharFrame().split("\n")[second]).not.toContain("second-old-0")
    await setup.mockMouse.scroll(x, second, "down", { modifiers: { shift: true } })
    await setup.mockMouse.scroll(x, second, "right", { modifiers: { shift: true } })
    await settle()
    const pannedRow = setup.captureCharFrame().split("\n")[second]!
    expect(pannedRow.slice(sourceColumn, sourceColumn + 16)).toBe(`-${"x".repeat(15)}`)
    expect(pannedRow).not.toContain("old-0")
    expect(body().scrollTop).toBe(0)
    expect(body().scrollLeft).toBe(0)
    setup.mockInput.pressKey("w")
    await settle()
    await setup.mockMouse.click(x, codeRow("first-old-0"))
    await settle()
    expectSelected(0)
    const wrapped = setup.captureCharFrame()
    await setup.mockMouse.scroll(x, second, "right")
    await settle()
    expect(setup.captureCharFrame()).toBe(wrapped)
    setup.mockInput.pressKey("w")
    await settle()
    expect(setup.captureCharFrame().split("\n")[second]).toBe(pannedRow)
    for (let index = 0; index < 40; index++) await setup.mockMouse.scroll(x, second, "right", { delayMs: 0 })
    await settle()
    const endFrame = setup.captureCharFrame()
    expect(endFrame).not.toContain("xx") // At the bound, at most the last source column remains.
    expect(endFrame.split("\n")[second + 10]!.slice(body().viewport.x).match(/x/g)).toHaveLength(2)
    await setup.mockMouse.scroll(x, second, "right")
    await settle()
    expect(setup.captureCharFrame()).toBe(endFrame)
    setup.mockInput.pressKey("t")
    await settle()
    const secondHeader = setup.renderer.root.findDescendantById(`diff-hunk:${file.id}:1`)!
    await setup.mockMouse.click(x, secondHeader.y + 1)
    await settle()
    expectSelected(1)
    expect(body().scrollTop).toBe(0)
    const header = setup.renderer.root.findDescendantById(`diff-hunk:${file.id}:0`)!
    await setup.mockMouse.click(header.x + 2, header.y)
    await settle()
    expectSelected(0)
    expect(body().scrollTop).toBe(0)
    setup.mockInput.pressKey("]")
    await settle()
    expect(rail(1)).toEqual(selectedRail)
    expect(secondHeader.y).toBe(body().viewport.y)
    expect(body().scrollTop).toBeGreaterThan(0)
    const jumpedTop = body().scrollTop
    await setup.mockMouse.scroll(x, body().viewport.y + 3, "down")
    await settle()
    const top = body().scrollTop
    expect(top).toBeGreaterThan(jumpedTop)
    setInteractive(false)
    setup.mockInput.pressKey("t")
    await setup.mockMouse.scroll(x, body().viewport.y + 3, "down")
    await settle()
    expect(body().scrollTop).toBe(top)
    setInteractive(true)
    setup.mockInput.pressKey("s")
    expect(files().visible).toBe(false)
    setup.resize(48, 26)
    await settle()
    expect(files().visible).toBe(false) // Narrow layout starts with the diff, not a file-only pane.
    setup.mockInput.pressKey("s")
    await settle()
    expect(files().visible).toBe(true)
    expect(body().viewport.width).toBeGreaterThan(15)
    expect(setup.renderer.root.findDescendantById("diff-content-pane")!.visible).toBe(true)
    setup.mockInput.pressKey("s")
    expect(files().visible).toBe(false)
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("commit diffs render when the response arrives after the loading frame", async () => {
  const setup = await createTestRenderer({ width: 120, height: 32 })
  initializeHunk(setup.renderer)
  const [resource, setResource] = createSignal<ResourceState<DiffContent>>({ status: "loading", phase: "load" })
  await render(() => <box width="100%" height="100%"><DiffScreen target={{ kind: "commit", sha: "abc" }}
    resource={resource()} interactive showScrollbar onLoadFiles={() => {}} /></box>, setup.renderer)
  try {
    await setup.flush()
    const filePane = setup.renderer.root.findDescendantById("diff-files-pane")!
    const loadingRows = setup.captureCharFrame().split("\n").slice(filePane.y + 1, filePane.y + filePane.height)
    expect(loadingRows.map((row) => row.slice(filePane.x + 1, filePane.x + filePane.width)).join("").trim()).toBe("")
    expect(setup.captureCharFrame()).not.toContain("No file selected")
    expect(setup.captureCharFrame()).not.toContain("Files (0)")
    expect(setup.captureCharFrame()).not.toContain("No changed files")
    expect(setup.captureCharFrame()).not.toContain("+0")
    setResource({ status: "ready", value: { kind: "patch", patch: patchFixture } })
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("example.ts")
    expect(setup.captureCharFrame()).toContain("newValue")
    expect(setup.captureCharFrame()).toContain("oldValue")
    setResource({ status: "loading", phase: "load" })
    await setup.flush()
    expect(setup.captureCharFrame()).not.toContain("Files (0)")
    expect(setup.captureCharFrame()).not.toContain("No changed files")
    setResource({ status: "ready", value: { kind: "patch", patch: patchFixture } })
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("newValue")
    setResource({ status: "error", phase: "load", message: "Diff unavailable" })
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("Diff unavailable")
    expect(setup.captureCharFrame()).not.toContain("r retry")
    expect(setup.captureCharFrame()).not.toContain("GitHub")
    expect(setup.captureCharFrame()).not.toContain("Files (0)")
    expect(setup.captureCharFrame()).not.toContain("No changed files")
    setResource({ status: "ready", value: { kind: "files", files: [], truncated: false } })
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("File list only — patches unavailable.")
    expect(setup.captureCharFrame()).not.toContain("retry full diff")
    setResource({ status: "ready", value: { kind: "patch", patch: "" } })
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("Files (0)")
    expect(setup.captureCharFrame()).toContain("No changed files")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("hunk navigation follows native layout and metadata-only selection removes the old body", async () => {
  const setup = await createTestRenderer({ width: 100, height: 18 })
  initializeHunk(setup.renderer)
  const patch = `diff --git a/long.ts b/long.ts\n--- a/long.ts\n+++ b/long.ts\n@@ -1,40 +1,40 @@\n`
    + Array.from({ length: 40 }, (_, i) => `-old-row-${i}\n`).join("")
    + Array.from({ length: 40 }, (_, i) => `+new-row-${i}\n`).join("")
    + `@@ -100 +100 @@\n-last-old\n+last-new\ndiff --git a/image.png b/image.png\nindex 1111111..2222222 100644\nBinary files a/image.png and b/image.png differ\n`
  await render(() => <box width="100%" height="100%"><DiffScreen target={{ kind: "commit", sha: "abc" }}
    resource={{ status: "ready", value: { kind: "patch", patch } }} interactive showScrollbar onLoadFiles={() => {}} /></box>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const pane = (kind: "files" | "diff") => setup.renderer.root.findDescendantById(kind === "files" ? "diff-files-pane" : "diff-content-pane") as BoxRenderable
  try {
    await settle()
    expect(setup.captureCharFrame()).toContain("new-row-0")
    expect(setup.captureCharFrame()).not.toContain("Diff ·")
    const bodyWidth = () => setup.renderer.root.findDescendantById("embedded-diff-host")!.width
    const withSidebar = bodyWidth()
    setup.mockInput.pressKey("s")
    await settle()
    expect(setup.captureCharFrame()).not.toContain("Files (2)")
    expect(bodyWidth()).toBeGreaterThan(withSidebar)
    setup.mockInput.pressKey("F")
    await settle()
    expect(bodyWidth()).toBe(withSidebar)
    setup.mockInput.pressEscape() // Leave the file filter before toggling the sidebar.
    await Bun.sleep(30)
    await settle()
    setup.mockInput.pressKey("s")
    await settle()
    setup.mockInput.pressKey("]") // Hunk navigation also works with the sidebar shown.
    await settle()
    expect(setup.captureCharFrame()).toContain("last-new")
    expect(setup.captureCharFrame()).not.toContain("new-row-0")
    setup.mockInput.pressKey("[")
    await settle()
    expect(setup.captureCharFrame()).toContain("new-row-0")
    setup.mockInput.pressKey("w")
    setup.mockInput.pressKey("t")
    await settle()
    setup.mockInput.pressKey("]")
    await settle()
    expect(setup.captureCharFrame()).toContain("last-new")
    setup.mockInput.pressKey(".")
    await settle()
    expect(setup.captureCharFrame()).toContain("Binary file")
    expect(setup.captureCharFrame()).not.toContain("r retry")
    expect(setup.captureCharFrame()).not.toContain("open GitHub")
    expect(setup.captureCharFrame()).toContain("last-new") // Earlier file remains in the continuous stream.
    expect(setup.captureCharFrame()).not.toContain("No file selected")
    setup.mockInput.pressKey("s")
    await settle()
    await setup.mockMouse.click(pane("files").x + 4, pane("files").y + 1)
    await settle()
    expect(setup.captureCharFrame()).toContain("old-row-0")
    expect(setup.renderer.root.findDescendantById("diff-file-header:image.png")).toBeDefined() // Both files remain mounted.
    setup.resize(48, 18)
    await settle()
    expect(pane("files").visible).toBe(false)
    setup.mockInput.pressKey("s")
    await settle()
    expect(pane("files").visible).toBe(true)
    const binaryRow = setup.captureCharFrame().split("\n").findIndex((line) => line.includes("image.png"))
    expect(binaryRow).toBeGreaterThan(-1)
    await setup.mockMouse.click(pane("files").x + 4, binaryRow)
    await settle()
    expect(setup.captureCharFrame()).toContain("Binary file")
    expect(pane("diff").visible).toBe(true)
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test.each([120, 35])("review header replaces tabs at width %i; Escape restores detail and respects modal/input ownership", async (width) => {
  const setup = await createTestRenderer({ width, height: 26 })
  initializeHunk(setup.renderer)
  const target = { kind: "commit" as const, sha: commitDetailFixture.sha }
  const original = { page: "commits" as const, details: { commits: target } }
  const states: unknown[] = []
  let origin: unknown
  let closed = 0
  await render(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    initialState={original} onNavigationChange={(state) => states.push(state)}
    commitDetail={{ sha: target.sha, resource: { status: "ready", value: commitDetailFixture } }}
    diffs={{ commit: { target, resource: { status: "ready", value: { kind: "patch", patch: patchFixture } } } }}
    onCloseDiff={() => { closed++ }}
  />, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const frame = () => setup.captureCharFrame()
  try {
    await settle()
    expect(frame()).toContain("2 Commits")
    origin = states.at(-1)
    setup.mockInput.pressKey("D")
    await settle()
    expect(frame()).toContain(githubDataFixture.repo.nameWithOwner.split("/").at(-1)!)
    expect(frame()).toContain(`${width < 45 ? "" : "Commit "}${target.sha.slice(0, 7)}`)
    expect(setup.renderer.root.findDescendantById("review-back")).toBeUndefined()
    expect(setup.renderer.root.findDescendantById("review-totals")).toBeDefined()
    expect(frame().split("\n")[0]).toContain("+1 −1")
    const totals = setup.renderer.root.findDescendantById("review-totals")!
    expect(Math.abs(totals.x + totals.width / 2 - width / 2)).toBeLessThanOrEqual(1)
    expect(frame()).not.toContain("2 Commits")
    expect(setup.renderer.root.findDescendantById("diff-body-scroll")!.y).toBe(1)
    setup.mockInput.pressKey("F")
    await settle()
    setup.mockInput.pressEscape()
    await Bun.sleep(30); await settle()
    expect(closed).toBe(0)
    expect(setup.renderer.root.findDescendantById("review-back")).toBeUndefined()
    setup.mockInput.pressKey("?")
    await settle()
    setup.mockInput.pressEscape()
    await Bun.sleep(30); await settle()
    expect(closed).toBe(0)
    setup.mockInput.pressEscape()
    await Bun.sleep(30); await settle()
    expect(closed).toBe(1)
    expect(states.at(-1)).toEqual(origin)
    expect(frame()).toContain("2 Commits")
    expect(frame()).not.toContain("Back")
    setup.mockInput.pressKey("D")
    await settle()
    setup.mockInput.pressEscape()
    await Bun.sleep(30); await settle()
    expect(closed).toBe(2)
    expect(states.at(-1)).toEqual(origin)
    expect(frame()).toContain("2 Commits")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test.each([[false, false], [true, false], [false, true]])("diffFullscreen changes headers without remounting the stream (compact: %s, standalone: %s)", async (compactHeader, standalone) => {
  const setup = await createTestRenderer({ width: 120, height: 20 })
  initializeHunk(setup.renderer)
  const target = { kind: "commit" as const, sha: commitDetailFixture.sha }
  const [config, setConfig] = createSignal({ ...defaultConfig, compactHeader, diffFullscreen: false })
  const patch = patchFixture + `diff --git a/second.ts b/second.ts\n--- a/second.ts\n+++ b/second.ts\n@@ -1,40 +1,40 @@\n`
    + Array.from({ length: 40 }, (_, i) => `-old-${i}\n+new-${i}\n`).join("")
  await render(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    config={config()} standalone={standalone} initialState={{ page: "commits", diffs: { commits: target } }}
    diffs={{ commit: { target, resource: { status: "ready", value: { kind: "patch", patch } } } }} />,
  setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const frame = () => setup.captureCharFrame()
  const totals = () => setup.renderer.root.findDescendantById("review-totals")
  try {
    await settle()
    expect(totals()).toBeUndefined()
    expect(frame().includes("2 Commits")).toBe(!standalone)
    const body = setup.renderer.root.findDescendantById("diff-body-scroll") as ScrollBoxRenderable
    const header = setup.renderer.root.findDescendantById("diff-file-header:second.ts")!
    expect(header).toBeDefined()
    expect(setup.renderer.root.findDescendantById("diff-file-header:example.ts")).toBeDefined()
    setup.mockInput.pressKey(".")
    await settle()
    const top = body.scrollTop
    expect(top).toBeGreaterThan(0)
    for (const diffFullscreen of [true, false]) {
      setConfig(current => ({ ...current, diffFullscreen }))
      await settle()
      expect(frame().includes("2 Commits")).toBe(!standalone && !diffFullscreen)
      expect(!!totals()).toBe(diffFullscreen)
      expect(setup.renderer.root.findDescendantById("diff-body-scroll")).toBe(body)
      expect(setup.renderer.root.findDescendantById("diff-file-header:second.ts")).toBe(header)
      expect(body.scrollTop).toBe(top)
    }
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("numbered tabs retain independent diff viewers, geometry and scroll until Escape closes them", async () => {
  const setup = await createTestRenderer({ width: 110, height: 28 })
  initializeHunk(setup.renderer)
  const [diffs, setDiffs] = createSignal<Partial<Record<DiffTarget["kind"], DiffState>>>({})
  const requests: DiffTarget[] = []
  const longPatch = patchFixture + `diff --git a/long.ts b/long.ts\n--- a/long.ts\n+++ b/long.ts\n@@ -1,40 +1,40 @@\n`
    + Array.from({ length: 40 }, (_, i) => `-old-row-${i}\n`).join("")
    + Array.from({ length: 40 }, (_, i) => `+new-row-${i}\n`).join("")
    + `@@ -100 +100 @@\n-last-old\n+last-new\n`
  await render(() => <App data={githubDataFixture} operations={repositoryOperationsFixture} config={{ ...defaultConfig, showStatusBarHints: true }} diffs={diffs()} onSwitchRepository={() => {}}
    onLoadDiff={async (target) => {
      requests.push(target)
      setDiffs((current) => ({ ...current, [target.kind]: { target, resource: { status: "ready", value: {
        kind: "patch", patch: target.kind === "commit" ? longPatch : patchFixture.replaceAll("example.ts", "pull.ts"),
      } } } }))
    }}
    onCloseDiff={(target) => setDiffs((current) => {
      if (!target) return {}
      const next = { ...current }; delete next[target.kind]; return next
    })}
  />, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const scroll = (owner: string) => setup.renderer.root.findDescendantById(`diff-view-${owner}`)!
    .findDescendantById("diff-body-scroll") as ScrollBoxRenderable
  try {
    setup.mockInput.pressKey("2")
    setup.mockInput.pressKey("D")
    await settle()
    setup.mockInput.pressKey("F")
    await settle()
    setup.mockInput.pressKey("S")
    await settle()
    expect(setup.captureCharFrame()).not.toContain("Switch repository")
    expect(setup.captureCharFrame()).toContain("Files (2/2)") // S is filter input, not a global shortcut.
    setup.mockInput.pressEscape() // One Escape clears the filter and closes the prompt; the diff stays open.
    await Bun.sleep(30)
    await settle()
    expect(setup.captureCharFrame()).toContain("Files (2)")
    setup.mockInput.pressKey("S")
    await settle()
    expect(setup.captureCharFrame()).toContain("Switch repository")
    setup.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()
    expect(setup.captureCharFrame()).toContain("Files (2)")
    setup.mockInput.pressArrow("right")
    setup.mockInput.pressKey("h")
    await settle()
    expect(setup.captureCharFrame()).toContain("Files (2)") // Pan never changes tabs or files.
    setup.mockInput.pressKey(".") // Select the next changed file.
    await settle()
    const sharedRow = () => setup.captureCharFrame().split("\n").some((row) => row.includes("old-row-0") && row.includes("new-row-0"))
    expect(sharedRow()).toBe(true) // The wide-screen default is split.
    const diffMenu = async () => {
      await settle()
      const body = scroll("commits")
      await setup.mockMouse.click(body.viewport.x + 10, body.viewport.y + 2, 2)
      await settle()
      expect(setup.captureCharFrame()).toContain("Change layout")
      expect(setup.captureCharFrame()).toContain("Toggle files")
    }
    await diffMenu()
    expect(setup.captureCharFrame()).toContain("Settings")
    await clickControl(setup, "context-menu-row-2") // Change layout follows the two external actions.
    await settle()
    expect(sharedRow()).toBe(false)
    expect(setup.renderer.root.findDescendantById("context-menu")).toBeUndefined()
    setup.mockInput.pressKey("w")
    await diffMenu()
    await clickControl(setup, "context-menu-row-3") // Toggle files uses the same transition as b.
    await settle()
    expect(setup.renderer.root.findDescendantById("diff-files-pane")!.visible).toBe(false)
    await diffMenu()
    await clickControl(setup, "context-menu-row-3")
    await settle()
    expect(setup.renderer.root.findDescendantById("diff-files-pane")!.visible).toBe(true)
    setup.mockInput.pressKey(",")
    await settle()
    expect(setup.captureCharFrame()).toContain("example.ts")
    expect(setup.captureCharFrame()).not.toContain("Appearance") // Comma navigates, never opens Settings.
    const filesPane = setup.renderer.root.findDescendantById("diff-files-pane")!
    await setup.mockMouse.click(filesPane.x + 4, filesPane.y + 1, 2)
    await settle()
    expect(setup.captureCharFrame()).toContain("Settings")
    await clickControl(setup, "context-menu-row-4")
    await settle()
    expect(setup.captureCharFrame()).toContain("Appearance")
    setup.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()
    expect(setup.captureCharFrame()).toContain("Files (2)")
    setup.mockInput.pressKey(".") // Return to the long second file after the sidebar menu selected the first.
    await settle()
    await diffMenu()
    await clickControl(setup, "context-menu-row-3")
    await settle()
    expect(setup.renderer.root.findDescendantById("diff-files-pane")!.visible).toBe(false)
    setup.mockInput.pressKey("]")
    setup.mockInput.pressKey("G")
    await settle()
    const commitScroll = scroll("commits")
    const position = commitScroll.scrollTop
    const width = commitScroll.viewport.width
    const frame = setup.captureCharFrame()
    expect(position).toBeGreaterThan(0)
    expect(frame).toContain("new-row-39")
    expect(frame).toContain("last-old")
    expect(frame).toContain("last-new")
    expect(frame).not.toContain("Files (2)")
    setup.mockInput.pressKey("3")
    await settle()
    expect(setup.captureCharFrame()).not.toContain("new-row-39")
    setup.mockInput.pressKey("t")
    setup.mockInput.pressKey("w")
    setup.mockInput.pressKey("j") // Hidden diff controls must not run here.
    setup.mockInput.pressKey("4")
    setup.mockInput.pressKey("D")
    await settle()
    expect(setup.captureCharFrame()).toContain("pull.ts")
    const pullView = setup.renderer.root.findDescendantById("diff-view-pulls")
    setup.mockInput.pressKey("2")
    await settle()
    expect(scroll("commits")).toBe(commitScroll)
    expect(commitScroll.scrollTop).toBe(position)
    expect(commitScroll.viewport.width).toBe(width)
    expect(setup.captureCharFrame()).toBe(frame)
    expect(requests).toHaveLength(2)
    setup.mockInput.pressKey("4")
    await settle()
    expect(setup.renderer.root.findDescendantById("diff-view-pulls")).toBe(pullView)
    expect(setup.captureCharFrame()).toContain("pull.ts")
    setup.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()
    expect(diffs().pull).toBeUndefined()
    expect(diffs().commit).toBeDefined()
    setup.mockInput.pressKey("2")
    await settle()
    expect(scroll("commits").scrollTop).toBe(position)
    expect(setup.captureCharFrame()).toBe(frame)
    setup.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()
    expect(diffs()).toEqual({})
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("D embeds diffs from commit and PR lists/details without losing their origin or keyboard ownership", async () => {
  const setup = await createTestRenderer({ width: 120, height: 40 })
  const { renderer, mockInput: input } = setup
  initializeHunk(renderer)
  const [diffs, setDiffs] = createSignal<Partial<Record<DiffTarget["kind"], DiffState>>>({})
  let latestDiff: DiffTarget["kind"] = "commit"
  const diff = () => diffs()[latestDiff]
  const [commit, setCommit] = createSignal<CommitDetailState>()
  const [pull, setPull] = createSignal<PullDetailState>()
  const requested: DiffTarget[] = []
  const opened: Array<{ target?: string | number; view?: "diff" }> = []
  const secondCommit = githubDataFixture.commits.value!.items[1]!
  const secondPull = githubDataFixture.pulls.open.value!.items[1]!
  let fail = false
  await render(() => <App data={githubDataFixture} operations={repositoryOperationsFixture} config={{ ...defaultConfig, showStatusBarHints: true }}
    diffs={diffs()} commitDetail={commit()} pullDetail={pull()}
    onLoadDiff={async (target, filesOnly) => {
      requested.push(target)
      latestDiff = target.kind
      setDiffs((current) => ({ ...current, [target.kind]: { target, resource: fail && !filesOnly ? { status: "error", phase: "load", message: "Diff unavailable" }
        : { status: "ready", value: filesOnly ? { kind: "files", files: [], truncated: false } : { kind: "patch", patch: patchFixture } } } }))
    }}
    onCloseDiff={(target) => setDiffs((current) => {
      if (!target) return {}
      const next = { ...current }
      delete next[target.kind]
      return next
    })}
    onLoadCommit={async (sha) => { setCommit({ sha, resource: { status: "ready", value: { ...commitDetailFixture, sha } } }) }}
    onCloseCommit={() => setCommit(undefined)}
    onLoadPull={async (number) => { setPull({ number,
      resource: { status: "ready", value: { ...secondPull, number, url: `https://github.com/anomalyco/opentui/pull/${number}`,
        body: "PR description", updatedAt: secondPull.createdAt, baseBranch: "main", headBranch: "feature",
        additions: 1, deletions: 1, changedFiles: 1, commitCount: 0, commentCount: 0,
        labels: [], assignees: [], reviewers: [], mergeable: true } },
      comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
      references: { status: "ready", value: [] }, commits: { status: "ready", value: [] },
      context: { status: "ready", value: pullContextFixture },
    }) }}
    onClosePull={() => setPull(undefined)}
    onOpenInBrowser={async (target, _repository, view) => { opened.push({ target, view }) }}
  />, renderer)
  const settle = () => setup.flush()
  const escape = async () => { input.pressEscape(); await Bun.sleep(30); await settle() }
  const menuDiff = async (id: string) => {
    await settle()
    const detail = renderer.root.findDescendantById(id)!
    await setup.mockMouse.click(detail.x + 3, detail.y + 1, 2)
    await settle()
    expect(setup.captureCharFrame()).toContain("View diff")
    expect(setup.renderer.root.findDescendantById("review-back")).toBeUndefined()
    await clickControl(setup, "context-menu-row-0")
    await settle()
  }
  try {
    input.pressKey("2")
    input.pressKey("j")
    input.pressKey("D")
    await settle()
    expect(requested.at(-1)).toEqual({ kind: "commit", sha: secondCommit.sha })
    expect(setup.captureCharFrame()).toContain("newValue")
    expect(setup.captureCharFrame()).toContain("example.ts")
    expect(setup.captureCharFrame()).toContain("Files (1)")
    const unpanned = setup.captureCharFrame()
    input.pressArrow("right")
    await settle()
    expect(setup.captureCharFrame()).not.toBe(unpanned)
    expect(diff()?.target.kind).toBe("commit")
    input.pressKey("h") // Undo the pan without switching app tabs.
    await settle()
    expect(setup.captureCharFrame()).toBe(unpanned)
    input.pressKey("l")
    input.pressArrow("left")
    await settle()
    expect(setup.captureCharFrame()).toBe(unpanned)
    input.pressKey("t")
    input.pressKey("w")
    await settle()
    expect(diff()?.target.kind).toBe("commit")
    expect(setup.captureCharFrame()).toContain("newValue")
    input.pressKey("?")
    await settle()
    expect(setup.captureCharFrame()).toContain("previous / next hunk")
    expect(setup.captureCharFrame()).toContain("previous / next file")
    expect(setup.captureCharFrame()).toContain("scroll diff")
    await escape()
    await escape()
    await settle()
    expect(diff()).toBeUndefined()
    expect(setup.captureCharFrame()).toContain(secondCommit.message)
    input.pressEnter()
    await settle()
    expect(commit()?.sha).toBe(secondCommit.sha)
    await menuDiff("commit-detail-scroll")
    expect(requested.at(-1)).toEqual({ kind: "commit", sha: secondCommit.sha })
    expect(setup.captureCharFrame()).toContain("newValue")
    await escape()
    await settle()
    expect(commit()?.sha).toBe(secondCommit.sha) // Closing diff does not close detail.
    expect(setup.captureCharFrame()).toContain("Keep one owner")

    input.pressKey("4")
    input.pressKey("j")
    input.pressKey("D")
    await settle()
    expect(requested.at(-1)).toEqual({ kind: "pull", number: secondPull.number })
    input.pressKey("o")
    await settle()
    expect(opened.at(-1)).toEqual({ target: secondPull.number, view: "diff" })
    await escape()
    input.pressEnter()
    await settle()
    expect(pull()?.number).toBe(secondPull.number)
    await menuDiff("pull-detail-scroll")
    expect(requested.at(-1)).toEqual({ kind: "pull", number: secondPull.number })
    // The earlier GitHub toast overlays the end of this source line briefly.
    expect(setup.captureCharFrame()).toContain("const oldValue")
    expect(setup.captureCharFrame()).toContain("const newVa")
    setup.resize(48, 28)
    await settle()
    expect(setup.captureCharFrame()).toContain("example.ts")
    await escape()
    await settle()
    expect(pull()?.number).toBe(secondPull.number)
    expect(setup.captureCharFrame()).toContain("PR description")
    input.pressKey("D")
    await settle()
    fail = true
    input.pressKey("r")
    await settle()
    expect(setup.captureCharFrame()).toContain("Diff unavailable")
    input.pressEnter()
    await settle()
    expect(diff()?.resource.value?.kind).toBe("files")
    expect(setup.captureCharFrame()).toContain("File list only")
    await escape()
    await settle()
  } finally {
    renderer.destroy()
    await renderer.closed
  }
})

test.each([false, true])("diff loading shows Files dots without footer loading (detail origin: %s)", async (detail) => {
  const setup = await createTestRenderer({ width: 100, height: 24 })
  initializeHunk(setup.renderer)
  const target: DiffTarget = { kind: "commit", sha: commitDetailFixture.sha }
  const [resource, setResource] = createSignal<ResourceState<DiffContent>>({ status: "loading", phase: "load" })
  await render(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: false, reducedMotion: true }}
    initialState={{ page: "commits", diffs: { commits: target }, ...(detail ? { details: { commits: target } } : {}) }}
    commitDetail={{ sha: target.sha, resource: { status: "ready", value: commitDetailFixture } }}
    diffs={{ commit: { target, resource: resource() } }} />, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const footer = () => setup.captureCharFrame().split("\n").filter(Boolean).at(-1)!.trim()
  const value: DiffContent = { kind: "patch", patch: patchFixture }
  try {
    await settle()
    expect(setup.captureCharFrame()).toContain("Files...")
    await Bun.sleep(230); await settle()
    expect(footer()).toBe("")
    expect(setup.captureCharFrame()).not.toContain("Loading diff")
    setResource({ status: "ready", value }); await settle()
    expect(setup.captureCharFrame()).toContain("Files (1)")
    expect(setup.captureCharFrame()).not.toContain("Loading...")
    setResource({ status: "loading", phase: "load", value }); await settle()
    expect(setup.captureCharFrame()).toContain("Files... (1)")
    expect(setup.captureCharFrame()).toContain("newValue")
    await Bun.sleep(230); await settle()
    expect(footer()).toBe("")
    setResource({ status: "error", phase: "load", message: "Diff request failed", value }); await settle()
    expect(setup.captureCharFrame()).not.toContain("Files...")
    expect(footer()).not.toContain("Refreshing")
    expect(setup.captureCharFrame()).toContain("Diff request failed")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})
