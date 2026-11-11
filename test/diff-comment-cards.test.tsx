import { expect, test } from "bun:test"
import { createTestRenderer, KeyCodes } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { PullReviewThread } from "../src/models"
import { initializeHunk } from "../src/ui/hunk-host"
import { MarkdownProvider } from "../src/ui/markdown-preferences"
import { IconProvider } from "../src/ui/icon-style"
import { nerdIcons, unicodeIcons } from "../src/ui/icons"
import { DiffScreen } from "../src/ui/pages/diff"
import { parseDiff } from "../src/ui/diff-model"
import { reviewRows, reviewSplitBoundary } from "../src/ui/review-lines"
import { isSourceRowY } from "../src/ui/diff-comment-cards"
import type { ContextMenuItem } from "../src/ui/components/context-menu"
import { App } from "../src/ui/app"
import { defaultConfig } from "../src/config"
import { githubDataFixture, pullContextFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const patch = `diff --git a/message.ts b/message.ts
--- a/message.ts
+++ b/message.ts
@@ -1,3 +1,3 @@
 const before = 1
-const old = "old"
+const changed = "new"
 const after = 3
`
const thread: PullReviewThread = {
  kind: "review-thread", id: "thread", path: "message.ts", line: 2, diffSide: "RIGHT",
  isResolved: true, isOutdated: false,
  comments: [{ id: "comment", author: "alice", authorAssociation: "MEMBER", body: "Posted discussion body", createdAt: new Date(Date.now() - 240_000).toISOString(), updatedAt: "", url: "" },
    { id: "reply", author: "bob", authorAssociation: "MEMBER", body: "A reply in the same thread", createdAt: "", updatedAt: "", url: "" }],
}

test("posted threads expand real Hunk rows, survive highlighting/layout changes, and never become source anchors", async () => {
  const setup = await createTestRenderer({ width: 110, height: 32 })
  initializeHunk(setup.renderer)
  const [threads, setThreads] = createSignal<readonly PullReviewThread[]>([thread,
    { ...thread, id: "unknown", diffSide: undefined, comments: [{ ...thread.comments[0]!, body: "Unknown side discussion" }] },
    { ...thread, id: "outdated", isOutdated: true, comments: [{ ...thread.comments[0]!, body: "Old discussion" }] },
  ])
  const [writable, setWritable] = createSignal(false)
  const [iconStyle, setIconStyle] = createSignal<"unicode" | "nerd">("unicode")
  const [markdownStyle, setMarkdownStyle] = createSignal<"rich" | "minimal">("rich")
  const [content, setContent] = createSignal(patch)
  let menu: ContextMenuItem[] = []
  await render(() => <IconProvider style={iconStyle()}><MarkdownProvider style={markdownStyle()}><DiffScreen target={{ kind: "pull", number: 1 }}
    resource={{ status: "ready", value: { kind: "patch", patch: content() } }} interactive showScrollbar={false} onLoadFiles={() => {}}
    threads={threads()} onContextMenu={(_, items) => { menu = items }}
    review={writable() ? { headSha: "head", comments: [], onComment: () => {}, onOpenReview: () => {} } : undefined} /></MarkdownProvider></IconProvider>, setup.renderer)
  const settle = async () => { await Bun.sleep(40); await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
  const assertPlacement = (layout: "split" | "unified") => {
    const rows = reviewRows(file, layout)
    const row = setup.renderer.root.findDescendantById(rows.find((row) => row.right?.line === 2)!.id)!
    const next = setup.renderer.root.findDescendantById(rows.find((row) => row.right?.line === 3)!.id)!
    const card = setup.renderer.root.findDescendantById("diff-comment-card:thread")!
    expect(card.parent).toBe(row)
    expect(card.height).toBe(7) // Two author/body pairs, a subtle reply divider and the rounded border.
    // Full width in either layout: inserted rows leave the other split side blank anyway.
    expect(card.x).toBe(row.x + 4)
    expect(card.width).toBe(Math.min(100, row.width - 4))
    expect(card.y).toBeGreaterThan(row.y)
    expect(next.y).toBeGreaterThanOrEqual(card.y + card.height)
    expect(isSourceRowY(row, row.y)).toBe(true)
    expect(isSourceRowY(row, card.y)).toBe(false)
    const frame = setup.captureCharFrame()

    expect(frame.match(/Posted discussion body/g)).toHaveLength(1)
    expect(frame.indexOf("Posted discussion body")).toBeGreaterThan(frame.indexOf('const changed'))
    expect(frame.indexOf("Posted discussion body")).toBeLessThan(frame.indexOf('const after'))
    expect(frame).toContain("╭─ resolved ─")
    expect(frame).toContain(iconStyle() === "unicode" ? unicodeIcons.comment : nerdIcons.comment)
    expect(frame).toContain("(4m ago)")
    expect(frame).toContain("@bob")
    expect(frame).toContain("╭─ Unplaced · message.ts:2 · resolved ─")
    expect(frame).toContain("╭─ Outdated · message.ts:2 · resolved ─")
    expect(setup.renderer.root.findDescendantById("diff-comment-card:unknown")!.y).toBeGreaterThan(next.y)
    return { row, card }
  }
  try {
    await settle()
    const bodyDeadline = Date.now() + 5000
    while (!setup.captureCharFrame().includes("Posted discussion body") && Date.now() < bodyDeadline) {
      await Bun.sleep(20); await settle()
    }
    assertPlacement("split") // No writable review prop is needed to read comments.
    setIconStyle("nerd")
    await settle()
    assertPlacement("split")
    // Wait for real asynchronous syntax highlighting, then verify appended children stayed in order.
    const highlighted = () => {
      const line = setup.captureSpans().lines.find((line) => line.spans.map((span) => span.text).join("").includes("const changed"))
      const keyword = line?.spans.find((span) => span.text.includes("const"))?.fg
      const literal = line?.spans.find((span) => span.text.includes('"'))?.fg
      return !!keyword && !!literal && !keyword.equals(literal)
    }
    const deadline = Date.now() + 5000
    while (!highlighted() && Date.now() < deadline) { await Bun.sleep(20); await settle() }
    expect(highlighted()).toBe(true)
    assertPlacement("split")
    setWritable(true)
    await settle()
    for (const layout of ["split", "unified", "split"] as const) {
      const { row, card } = assertPlacement(layout)
      await setup.mockMouse.click(card.x + 4, card.y + 1, 2)
      await settle()
      expect(menu.some((item) => item.label === "Add review comment…")).toBe(false)
      // Padding has no text target; it must not fall back to the expanded source wrapper.
      await setup.mockMouse.click(card.x, card.y + 1, 2)
      await settle()
      expect(menu.some((item) => item.label === "Add review comment…")).toBe(false)
      await setup.mockMouse.click(row.x + row.width - 5, row.y, 2)
      await settle()
      expect(menu.some((item) => item.label === "Add review comment…")).toBe(true)
      menu.find((item) => item.label === "Change layout")!.run()
      await settle()
    }
    setup.mockInput.pressKey("w")
    setup.resize(100, 32)
    await settle()
    assertPlacement("unified")
    const oldCard = setup.renderer.root.findDescendantById("diff-comment-card:thread")!
    setContent(patch.replaceAll("message.ts", "other.ts"))
    await settle()
    expect(oldCard.isDestroyed).toBe(true)
    expect(setup.captureCharFrame()).not.toContain("Posted discussion body")
    setContent(patch)
    await settle()
    assertPlacement("unified")
    setThreads([])
    await settle()
    expect(setup.renderer.root.findDescendantById("diff-comment-card:thread")).toBeUndefined()
    expect(setup.captureCharFrame()).not.toContain("Posted discussion body")
    setThreads([thread])
    await settle()
    expect(setup.captureCharFrame().match(/Posted discussion body/g)).toHaveLength(1)
    expect(setup.renderer.root.findDescendantById("diff-comment-card:thread:divider:1")).toBeDefined()
    setThreads([{ ...thread, comments: [{ ...thread.comments[0]!, body: "**Formatted feedback**\n\n```suggestion\nreturn true\n```" }] }])
    const markdownDeadline = Date.now() + 5000
    while ((!setup.captureCharFrame().includes("Formatted feedback") || setup.captureCharFrame().includes("```")) && Date.now() < markdownDeadline) {
      await Bun.sleep(20); await settle()
    }
    expect(setup.captureCharFrame()).toContain("Formatted feedback")
    expect(setup.captureCharFrame()).toContain("return true")
    expect(setup.captureCharFrame()).not.toContain("**Formatted feedback**")
    expect(setup.captureCharFrame()).not.toContain("```")
    setMarkdownStyle("minimal")
    await settle()
    expect(setup.captureCharFrame()).toContain("Formatted feedback")
    expect(setup.captureCharFrame()).not.toContain("```")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
}, 10000)

test("z collapses diff threads from either pane, retains summaries across files/layouts, and respects overlays/remapping", async () => {
  const setup = await createTestRenderer({ width: 160, height: 40 })
  initializeHunk(setup.renderer)
  const target = { kind: "pull", number: 1 } as const
  const loading = { status: "loading", phase: "load" } as const
  const [config, setConfig] = createSignal({ ...defaultConfig, showStatusBarHints: true })
  const other = { ...thread, id: "other", path: "other.ts", isResolved: false,
    comments: [{ ...thread.comments[0]!, body: "Other file discussion" }] }
  const threads = [thread, other,
    { ...thread, id: "unknown", diffSide: undefined },
    { ...thread, id: "outdated", isOutdated: true },
  ]
  await render(() => <App config={config()} data={githubDataFixture} operations={repositoryOperationsFixture}
    initialNavigation={{ page: "pulls", diff: target }}
    diffs={{ pull: { target, resource: { status: "ready", value: {
      kind: "patch", patch: patch + patch.replaceAll("message.ts", "other.ts"), headSha: pullContextFixture.readiness.headSha,
    } } } }}
    pullDetail={{ number: 1, resource: loading, comments: loading, references: loading, commits: loading,
      context: { status: "ready", value: { ...pullContextFixture, threads } } }} />, setup.renderer)
  const settle = async () => { await Bun.sleep(40); await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const key = async (value: string) => { setup.mockInput.pressKey(value); await settle() }
  const card = (id: string) => setup.renderer.root.findDescendantById(`diff-comment-card:${id}`)!
  const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
  const rowId = (layout: "split" | "unified") => reviewRows(file, layout).find((row) => row.right?.line === 2)!.id
  try {
    await settle()
    const deadline = Date.now() + 5000
    while (!setup.captureCharFrame().includes("Posted discussion body") && Date.now() < deadline) await settle()
    expect(setup.captureCharFrame()).toContain("Posted discussion body")
    expect(setup.captureCharFrame()).toContain("files · z collapse")
    const expanded = card("thread")
    const body = setup.renderer.root.findDescendantById("diff-comment-card:thread:body:0")!
    await key("z")
    expect(expanded.isDestroyed).toBe(true)
    expect(body.isDestroyed).toBe(true)
    for (const id of ["thread", "unknown", "outdated"]) {
      expect(setup.renderer.root.findDescendantById(`diff-comment-card:${id}:body:0`)).toBeUndefined()
      expect(setup.renderer.root.findDescendantById(`diff-comment-card:${id}:header:1`)).toBeUndefined()
    }
    expect(card("thread").height).toBe(3)
    expect(card("thread").parent?.id).toBe(rowId("split"))
    let frame = setup.captureCharFrame()
    expect(frame).toContain("╭─ 2 comments · resolved ─")
    expect(frame).toContain("@alice")
    expect(frame).toContain("Unplaced · message.ts:2 · 2 comments · resolved")
    expect(frame).toContain("Outdated · message.ts:2 · 2 comments · resolved")
    expect(frame).toContain("const changed")
    expect(frame).not.toContain("Posted discussion body")
    expect(frame).not.toContain("@bob")
    expect(frame).toContain("z expand")
    await key("?")
    expect(setup.captureCharFrame()).toContain("collapse / expand review comments")
    await key("z")
    setup.mockInput.pressEscape()
    await settle()
    expect(setup.captureCharFrame()).toContain("z expand")
    await key("j")
    expect(card("other").height).toBe(3)
    expect(setup.captureCharFrame()).toContain("╭─ 1 comment ─")
    expect(setup.captureCharFrame()).not.toContain("Other file discussion")
    setup.mockInput.pressTab()
    await key("t")
    expect(card("other").height).toBe(3)
    await key("z")
    expect(setup.captureCharFrame()).toContain("Other file discussion")
    expect(setup.captureCharFrame()).toContain("z collapse")
    setup.mockInput.pressTab()
    await key("k")
    expect(card("thread").parent?.id).toBe(rowId("unified"))
    expect(setup.captureCharFrame()).toContain("Posted discussion body")
    expect(setup.captureCharFrame()).toContain("A reply in the same thread")
    await key("z")
    setConfig({ ...config(), keybindings: { "diff.toggleComments": ["f2"] } })
    await key("z")
    expect(setup.captureCharFrame()).toContain("f2 expand")
    expect(card("thread").height).toBe(3)
    await key(KeyCodes.F2)
    frame = setup.captureCharFrame()
    expect(frame).toContain("Posted discussion body")
    expect(frame).toContain("A reply in the same thread")
    expect(frame).toContain("f2 collapse")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
}, 10000)

test("wide split sides hold their own cards and composer, aligned like full-width cards elsewhere", async () => {
  const setup = await createTestRenderer({ width: 200, height: 36 })
  initializeHunk(setup.renderer)
  await render(() => <DiffScreen target={{ kind: "pull", number: 1 }} threads={[thread, { ...thread, id: "left", diffSide: "LEFT" }]}
    resource={{ status: "ready", value: { kind: "patch", patch } }} interactive showScrollbar={false} onLoadFiles={() => {}}
    draft={{ anchor: { path: "message.ts", side: "RIGHT", line: 3 }, body: "" }}
    review={{ headSha: "head", comments: [], onComment: () => {}, onOpenReview: () => {} }} />, setup.renderer)
  const settle = async () => { await Bun.sleep(40); await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
  const card = (id: string) => setup.renderer.root.findDescendantById(id)!
  const assertBoxes = (layout: "split" | "unified", docked: boolean) => {
    const row = setup.renderer.root.findDescendantById(reviewRows(file, layout)[0]!.id)!
    const boundary = reviewSplitBoundary(row.width)
    const full = { x: row.x + 4, width: Math.min(100, row.width - 4) }
    const right = docked ? { x: row.x + boundary + 4, width: Math.min(100, row.width - boundary - 4) } : full
    const left = docked ? { x: row.x + 4, width: Math.min(100, boundary - 5) } : full
    for (const [id, expected] of [["diff-comment-card:thread", right], ["diff-comment-card:left", left], ["inline-comment-composer-card", right]] as const)
      expect({ id, x: card(id).x, width: card(id).width }).toEqual({ id, ...expected })
  }
  try {
    await settle()
    assertBoxes("split", true)
    const row = setup.renderer.root.findDescendantById(reviewRows(file, "split")[0]!.id)!
    await setup.mockMouse.click(row.x + 5, row.y) // Return keys from the composer to the diff.
    setup.mockInput.pressKey("t")
    await settle()
    assertBoxes("unified", false)
    setup.mockInput.pressKey("t")
    setup.resize(140, 36)
    await settle()
    assertBoxes("split", false) // Narrower sides would wrap comments heavily.
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})
