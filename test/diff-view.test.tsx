import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { DiffContent, DiffTarget } from "../src/models"
import type { CommitDetailState, DiffState, PullDetailState, ResourceState } from "../src/repository-state"
import { App } from "../src/ui/app"
import { defaultConfig } from "../src/config"
import { SelectionClipboard } from "../src/ui/components/selection-clipboard"
import { initializeHunk } from "../src/ui/hunk-host"
import { DiffScreen } from "../src/ui/pages/diff"
import { commitDetailFixture, githubDataFixture, pullContextFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { patchFixture } from "./fixtures/diff"
import { parseDiff } from "../src/ui/diff-model"
import { clickControl } from "./fixtures/mouse"

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
    const focused = files().borderColor
    const x = body().viewport.x + 10
    const second = codeRow("second-old-0")
    expect(second).toBeGreaterThan(-1)
    const sourceColumn = setup.captureCharFrame().split("\n")[second]!.indexOf("second-old-0")
    await setup.mockMouse.click(x, second)
    await settle()
    expectSelected(1)
    expect(body().scrollTop).toBe(0) // Selecting visible code must not jump to its header.
    expect((setup.renderer.root.findDescendantById("diff-content-pane") as BoxRenderable).borderColor).toEqual(focused)
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
    const list = files().getChildren()[1]!.getChildren()[0] as ScrollBoxRenderable
    await setup.mockMouse.scroll(list.viewport.x + 4, list.viewport.y + 2, "down")
    await settle()
    expect(files().borderColor).toEqual(focused)
    expect(list.scrollTop).toBeGreaterThan(0)
    expect(body().scrollTop).toBe(0)
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
    setup.mockInput.pressKey("b")
    expect(files().visible).toBe(false)
    setup.resize(48, 26)
    await settle()
    setup.mockInput.pressTab()
    expect(files().visible).toBe(true)
    setup.mockInput.pressTab()
    expect(files().visible).toBe(false)
    expect(setup.renderer.root.findDescendantById("diff-content-pane")!.visible).toBe(true)
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
    expect(setup.captureCharFrame()).not.toContain("Files (0)")
    expect(setup.captureCharFrame()).not.toContain("No changed files")
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
  const focusColor = pane("files").borderColor
  const expectFocus = (kind: "files" | "diff") => expect(pane(kind).borderColor).toEqual(focusColor)
  try {
    await settle()
    expect(setup.captureCharFrame()).toContain("new-row-0")
    expect(setup.captureCharFrame()).not.toContain("Diff ·")
    expectFocus("files")
    const bodyWidth = () => setup.renderer.root.findDescendantById("embedded-diff-host")!.width
    const withSidebar = bodyWidth()
    setup.mockInput.pressKey("b")
    await settle()
    expect(setup.captureCharFrame()).not.toContain("Files (2)")
    expectFocus("diff")
    expect(bodyWidth()).toBeGreaterThan(withSidebar)
    setup.mockInput.pressKey("b")
    await settle()
    expectFocus("files")
    expect(bodyWidth()).toBe(withSidebar)
    setup.mockInput.pressKey("b")
    setup.mockInput.pressTab() // Tab restores the hidden list as well.
    await settle()
    expectFocus("files")
    setup.mockInput.pressKey("]") // Hunk navigation also works from the file list.
    await settle()
    expect(setup.captureCharFrame()).toContain("last-new")
    expectFocus("diff")
    expect(setup.captureCharFrame()).not.toContain("new-row-0")
    setup.mockInput.pressKey("[")
    await settle()
    expect(setup.captureCharFrame()).toContain("new-row-0")
    setup.mockInput.pressTab()
    await settle()
    expectFocus("files")
    setup.mockInput.pressTab()
    await settle()
    expectFocus("diff")
    setup.mockInput.pressKey("w")
    setup.mockInput.pressKey("t")
    await settle()
    setup.mockInput.pressKey("]")
    await settle()
    expect(setup.captureCharFrame()).toContain("last-new")
    setup.mockInput.pressTab()
    setup.mockInput.pressKey("j")
    await settle()
    expect(setup.captureCharFrame()).toContain("Binary file")
    expect(setup.captureCharFrame()).not.toContain("last-new")
    expect(setup.captureCharFrame()).not.toContain("No file selected")
    setup.mockInput.pressTab()
    await settle()
    expectFocus("diff")
    const longRow = setup.captureCharFrame().split("\n").findIndex((line) => line.includes("long.ts"))
    expect(longRow).toBeGreaterThan(-1)
    await setup.mockMouse.click(pane("files").x + pane("files").width - 2, longRow)
    await settle()
    expectFocus("diff")
    expect(setup.captureCharFrame()).toContain("old-row-0")
    expect(setup.captureCharFrame()).not.toContain("Binary file")
    setup.resize(48, 18)
    await settle()
    setup.mockInput.pressTab()
    await settle()
    expectFocus("files")
    const binaryRow = setup.captureCharFrame().split("\n").findIndex((line) => line.includes("image.png"))
    expect(binaryRow).toBeGreaterThan(-1)
    await setup.mockMouse.click(pane("files").x + 4, binaryRow)
    await settle()
    expectFocus("diff")
    expect(setup.captureCharFrame()).toContain("Binary file")
    expect(setup.captureCharFrame()).not.toContain("Files (2)")
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
  await render(() => <App data={githubDataFixture} operations={repositoryOperationsFixture} config={{ ...defaultConfig, showStatusBarHints: true }} diffs={diffs()}
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
    expect(setup.captureCharFrame()).toContain("←/→ tabs")
    setup.mockInput.pressArrow("right")
    await settle()
    expect(setup.captureCharFrame()).toContain("Open (4)")
    expect(setup.captureCharFrame()).not.toContain("Files (2)")
    setup.mockInput.pressArrow("left") // Returning must not dispatch this arrow to the restored diff again.
    await settle()
    expect(setup.captureCharFrame()).toContain("Files (2)")
    setup.mockInput.pressKey("h")
    await settle()
    expect(setup.captureCharFrame()).not.toContain("Files (2)")
    setup.mockInput.pressArrow("right")
    await settle()
    expect(setup.captureCharFrame()).toContain("Files (2)")
    expect(setup.captureCharFrame()).toContain("←/→ tabs")
    setup.mockInput.pressKey("j") // Select the second changed file.
    setup.mockInput.pressEnter()
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
    await clickControl(setup, "context-menu-row-0") // Change layout uses the same transition as t.
    await settle()
    expect(sharedRow()).toBe(false)
    expect(setup.renderer.root.findDescendantById("context-menu")).toBeUndefined()
    setup.mockInput.pressKey("w")
    await diffMenu()
    await clickControl(setup, "context-menu-row-1") // Toggle files uses the same transition as b.
    await settle()
    expect(setup.renderer.root.findDescendantById("diff-files-pane")!.visible).toBe(false)
    await diffMenu()
    await clickControl(setup, "context-menu-row-1")
    await settle()
    expect(setup.renderer.root.findDescendantById("diff-files-pane")!.visible).toBe(true)
    await diffMenu()
    await clickControl(setup, "context-menu-row-1")
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
    expect(setup.captureCharFrame()).toContain("Back")
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
    expect(setup.captureCharFrame()).toContain("←/→ tabs")
    input.pressTab() // Focus code while keeping the sidebar open.
    await settle()
    expect(setup.captureCharFrame()).toContain("Files (1)")
    expect(setup.captureCharFrame()).toContain("←/→ pan")
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
    expect(setup.captureCharFrame()).toContain("files: switch tabs")
    expect(setup.captureCharFrame()).toContain("move / scroll")
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
    expect(setup.captureCharFrame()).toContain("newValue")
    setup.resize(48, 28)
    await settle()
    input.pressTab()
    input.pressTab()
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
