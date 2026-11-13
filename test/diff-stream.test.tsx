import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import { RGBA, TextAttributes, type BoxRenderable, type ScrollBoxRenderable, type TextRenderable } from "@opentui/core"
import { initializeHunk } from "../src/ui/hunk-host"
import { DiffScreen } from "../src/ui/pages/diff"
import { parseDiff, streamWithinBudget } from "../src/ui/diff-model"
import { SearchProvider } from "../src/ui/search-context"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { appColors, resolveTheme } from "../src/theme"
import { defaultConfig } from "../src/config"
import { StatusPromptBar, StatusPromptProvider } from "../src/ui/status-prompt"

const patch = (name: string, text = name) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old-${text}\n+new-${text}\n`

test("stream budget counts all visible source lines and files", () => {
  const files = parseDiff({ kind: "patch", patch: patch("a.ts") + patch("b.ts") }).files
  expect(streamWithinBudget(files)).toBe(true)
  expect(streamWithinBudget(Array.from({ length: 51 }, () => files[0]!))).toBe(false)
  expect(streamWithinBudget(Array.from({ length: 1001 }, () => files[0]!))).toBe(false)
})

test("stacked file headers and source rows share one scrollbox; navigation crosses files", async () => {
  const setup = await createTestRenderer({ width: 100, height: 6 })
  initializeHunk(setup.renderer)
  const files = parseDiff({ kind: "patch", patch: patch("a.ts") + patch("b.ts") }).files
  await render(() => <box width="100%" height="100%"><DiffScreen target={{ kind: "commit", sha: "stream" }}
    resource={{ status: "ready", value: { kind: "patch", patch: patch("a.ts") + patch("b.ts") } }}
    interactive showScrollbar={false} onLoadFiles={() => {}} /></box>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  try {
    await settle()
    const first = setup.renderer.root.findDescendantById(`diff-hunk:${files[0]!.body!.id}:0`)
    const second = setup.renderer.root.findDescendantById(`diff-hunk:${files[1]!.body!.id}:0`)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(setup.renderer.root.findDescendantById("diff-file-header:a.ts")).toBeDefined()
    expect(setup.renderer.root.findDescendantById("diff-file-header:b.ts")).toBeDefined()
    expect(second!.y).toBeGreaterThan(first!.y)
    setup.mockInput.pressKey("j")
    await settle()
    const scroll = setup.renderer.root.findDescendantById("diff-body-scroll") as ScrollBoxRenderable
    expect(scroll.scrollTop).toBeGreaterThan(0)
    scroll.scrollTo(scroll.scrollHeight)
    await settle()
    expect(setup.captureCharFrame()).toMatch(/▌ b\.ts/)
    scroll.scrollTo(0)
    await settle()
    expect(setup.captureCharFrame()).toMatch(/▌ a\.ts/)
    setup.mockInput.pressKey("j")
    await settle()
    setup.mockInput.pressEnter()
    await settle()
    setup.mockInput.pressKey("[")
    await settle()
    setup.mockInput.pressKey("]")
    await settle()
    expect(setup.captureCharFrame()).toContain("new-b.ts")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("file headers separate only subsequent files and align styled per-file stats to the right", async () => {
  const setup = await createTestRenderer({ width: 100, height: 15 })
  initializeHunk(setup.renderer)
  const totals: { additions: number; deletions: number }[] = []
  const files = [
    { path: "src/long-directory/first.ts", additions: 2, deletions: 1, status: "modified" },
    { path: "src/new.ts", additions: 3, deletions: 0, status: "new" },
    { path: "src/gone.ts", additions: 0, deletions: 4, status: "deleted" },
  ]
  await render(() => <StatusPromptProvider><box width="100%" height="100%" flexDirection="column">
    <DiffScreen target={{ kind: "commit", sha: "headers" }} hideHeader onTotalsChange={(value) => { if (value) totals.push(value) }}
      resource={{ status: "ready", value: { kind: "files", files, truncated: false } }}
      interactive showScrollbar={false} onLoadFiles={() => {}} />
    <StatusPromptBar fallback={<text height={1}>status</text>} />
  </box></StatusPromptProvider>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const header = (path: string) => setup.renderer.root.findDescendantById(`diff-file-header:${path}`) as BoxRenderable
  const colors = appColors(resolveTheme(defaultConfig.theme))
  try {
    await settle()
    expect(setup.renderer.root.findDescendantById("diff-body-scroll")!.y).toBe(1) // File-list notice only; no duplicate filename row.
    expect(setup.captureCharFrame().split("\n")[1]).toContain("Files (3)")
    expect(setup.captureCharFrame().split("\n")[1]).not.toContain("headers")
    expect((header(files[0]!.path).parent as BoxRenderable).border).toEqual([])
    expect((header(files[1]!.path).parent as BoxRenderable).border).toEqual(["top"])
    const [title, status, plus, minus] = header(files[1]!.path).getChildren() as TextRenderable[]
    expect(setup.captureCharFrame()).toContain("src/new.ts")
    expect(title.attributes & TextAttributes.BOLD).toBeTruthy()
    expect(title.fg).toEqual(RGBA.fromHex(colors.text))
    expect(setup.captureCharFrame()).toMatch(/src\/new\.ts\s+new\s+\+3\s+−0/)
    expect(status.fg).toEqual(RGBA.fromHex(colors.muted))
    expect(plus.width).toBeGreaterThan(1)
    expect(plus.fg).toEqual(RGBA.fromHex(colors.green))
    expect(minus.fg).toEqual(RGBA.fromHex(colors.red))
    expect(minus.x + minus.width).toBe(header(files[1]!.path).x + header(files[1]!.path).width)
    expect(setup.captureCharFrame()).not.toContain("modified")
    expect(setup.captureCharFrame()).toContain("deleted")
    setup.mockInput.pressKey("F")
    await settle()
    await setup.mockInput.pasteBracketedText("new.ts")
    await settle()
    expect(header(files[0]!.path)).toBeUndefined()
    expect((header(files[1]!.path).parent as BoxRenderable).border).toEqual([])
    expect(setup.captureCharFrame()).toContain("Files (1/3)")
    expect(totals.at(-1)).toEqual({ additions: 5, deletions: 5 }) // Global totals ignore the sidebar filter.
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("second-file draft composer mounts under its own review row", async () => {
  const setup = await createTestRenderer({ width: 110, height: 25 })
  initializeHunk(setup.renderer)
  const files = parseDiff({ kind: "patch", patch: patch("a.ts") + patch("b.ts") }).files
  await render(() => <box width="100%" height="100%"><DiffScreen target={{ kind: "pull", number: 1 }}
    resource={{ status: "ready", value: { kind: "patch", patch: patch("a.ts") + patch("b.ts") } }}
    interactive showScrollbar={false} onLoadFiles={() => {}}
    draft={{ anchor: { path: "b.ts", side: "RIGHT", line: 1 }, body: "draft on b" }}
    review={{ headSha: "sha", comments: [], onComment: () => {}, onOpenReview: () => {} }} /></box>, setup.renderer)
  try {
    await setup.flush(); await setup.renderer.idle(); await setup.flush()
    const composer = setup.renderer.root.findDescendantById("diff-comment-composer")!
    expect(composer).toBeDefined()
    expect(composer.parent?.id).toContain(files[1]!.body!.id)
    expect(composer.parent?.id).not.toContain(files[0]!.body!.id)
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("search finds source in the second file and reveals its row", async () => {
  const setup = await createTestRenderer({ width: 100, height: 13 })
  initializeHunk(setup.renderer)
  await render(() => <KeybindingsProvider><box width="100%" height="100%"><SearchProvider identity="stream" enabled>
    <DiffScreen target={{ kind: "commit", sha: "search" }} resource={{ status: "ready", value: {
      kind: "patch", patch: patch("first.ts") + patch("second.ts", "uniqueTarget") } }}
      interactive showScrollbar={false} onLoadFiles={() => {}} />
  </SearchProvider></box></KeybindingsProvider>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  try {
    await settle()
    setup.mockInput.pressKey("/")
    await settle()
    await setup.mockInput.pasteBracketedText("uniqueTarget")
    await settle()
    expect(setup.captureCharFrame()).toContain("1/2")
    setup.mockInput.pressEnter()
    await settle()
    setup.mockInput.pressKey("n")
    await settle()
    expect(setup.captureCharFrame()).toContain("2/2")
    expect(setup.captureCharFrame()).toContain("new-uniqueTarget")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("an inactive stream retains its search scroll when it becomes active again", async () => {
  const setup = await createTestRenderer({ width: 100, height: 10 })
  initializeHunk(setup.renderer)
  const [active, setActive] = createSignal(true)
  const patchText = Array.from({ length: 8 }, (_, i) => patch(`file-${i}.ts`)).join("")
  await render(() => <KeybindingsProvider><box width="100%" height="100%"><SearchProvider identity="retained-stream" enabled={active()}>
    <DiffScreen target={{ kind: "commit", sha: "retained" }} resource={{ status: "ready", value: { kind: "patch", patch: patchText } }}
      active={active()} interactive showScrollbar={false} onLoadFiles={() => {}} />
  </SearchProvider></box></KeybindingsProvider>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  try {
    await settle()
    setup.mockInput.pressKey("/")
    await setup.mockInput.pasteBracketedText("new-file-7.ts")
    await settle()
    setup.mockInput.pressEnter()
    await settle()
    const scroll = setup.renderer.root.findDescendantById("diff-body-scroll") as ScrollBoxRenderable
    const top = scroll.scrollTop
    expect(top).toBeGreaterThan(0)
    setActive(false)
    await settle()
    setActive(true)
    await settle()
    expect(scroll.scrollTop).toBe(top)
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("large diff announces single-file fallback and still renders a selected file", async () => {
  const setup = await createTestRenderer({ width: 110, height: 20 })
  initializeHunk(setup.renderer)
  const patchText = Array.from({ length: 51 }, (_, i) => patch(`file-${i}.ts`)).join("")
  await render(() => <box width="100%" height="100%"><DiffScreen target={{ kind: "commit", sha: "large" }}
    resource={{ status: "ready", value: { kind: "patch", patch: patchText } }}
    interactive showScrollbar={false} onLoadFiles={() => {}} /></box>, setup.renderer)
  try {
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("Large diff — single-file view")
    expect(setup.renderer.root.findDescendantById("diff-file-header:file-0.ts")).toBeDefined()
    expect(setup.renderer.root.findDescendantById("diff-file-header:file-1.ts")).toBeUndefined()
    setup.mockInput.pressKey(".")
    await setup.flush(); await setup.renderer.idle(); await setup.flush()
    expect(setup.renderer.root.findDescendantById("diff-file-header:file-0.ts")).toBeUndefined()
    expect(setup.renderer.root.findDescendantById("diff-file-header:file-1.ts")).toBeDefined()
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})
