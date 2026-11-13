import { expect, test } from "bun:test"
import type { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import { getHunkDiffSearchCells } from "hunkdiff/opentui"
import { BoxRenderable } from "@opentui/core"
import { initializeHunk, mountHunk } from "../src/ui/hunk-host"
import { DiffScreen } from "../src/ui/pages/diff"
import { parseDiff } from "../src/ui/diff-model"
import { reviewRows } from "../src/ui/review-lines"
import type { PullReviewThread } from "../src/models"
import type { ReviewAnchor } from "../src/review-types"

const patch = `diff --git a/review.txt b/review.txt
--- a/review.txt
+++ b/review.txt
@@ -10,3 +20,2 @@
 same
-old one
-old two
+new one
`
const thread: PullReviewThread = { kind: "review-thread", id: "thread", path: "review.txt", line: 21, diffSide: "RIGHT",
  isResolved: false, isOutdated: false, comments: [{ id: "comment", author: "alice", authorAssociation: "", body: "Existing thread",
    createdAt: "", updatedAt: "", url: "" }] }

test("Hunk's [+] opens opengh's markdown editor as a full-width card that owns typing until posted, cancelled or blurred", async () => {
  const setup = await createTestRenderer({ width: 140, height: 30 })
  initializeHunk(setup.renderer)
  const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
  const comments: ReviewAnchor[] = []
  const inputs: string[] = [], saved: string[] = []
  let cancelled = 0, expanded = 0
  const [draft, setDraft] = createSignal<{ anchor: ReviewAnchor; body: string }>()
  const [interactive, setInteractive] = createSignal(true)
  await render(() => <DiffScreen target={{ kind: "pull", number: 1 }} threads={[thread]}
    resource={{ status: "ready", value: { kind: "patch", patch } }} interactive={interactive()} showScrollbar={false} onLoadFiles={() => {}}
    draft={draft()} onDraftInput={(body) => { inputs.push(body) }} review={{ headSha: "head", comments: [], onOpenReview: () => {},
      onComment: (anchor) => { comments.push(anchor); setDraft({ anchor, body: "" }) }, onDraftSave: (body) => { saved.push(body) },
      onDraftCancel: () => { cancelled++; setDraft() }, onDraftExpand: () => { expanded++ } }} />, setup.renderer)
  const settle = async () => { await Bun.sleep(20); await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const escape = async () => { setup.mockInput.pressEscape(); await Bun.sleep(30); await settle() }
  const row = (index: number, layout: "split" | "unified" = "split") => setup.renderer.root.findDescendantById(reviewRows(file, layout)[index]!.id)!
  const editor = () => setup.renderer.root.findDescendantById("inline-comment-editor") as TextareaRenderable | undefined
  const card = () => setup.renderer.root.findDescendantById("inline-comment-composer-card")!
  const frame = () => setup.captureCharFrame()
  const addButton = async (index: number) => {
    const target = row(index)
    await setup.mockMouse.moveTo(target.x + 5, target.y)
    await settle()
    expect(frame().split("\n")[target.y]).toEndWith("[+]")
    await setup.mockMouse.click(target.x + target.width - 2, target.y)
    await settle()
  }
  try {
    await settle()
    expect(frame()).not.toContain("[+]")
    // Only a left click adds a note: not a right-click, nor a drag ending on the [+].
    await setup.mockMouse.moveTo(row(1).x + 5, row(1).y)
    await settle()
    await setup.mockMouse.click(row(1).x + row(1).width - 2, row(1).y, 2)
    await setup.mockMouse.drag(row(1).x + 10, row(1).y, row(1).x + row(1).width - 2, row(1).y)
    await settle()
    expect(comments).toHaveLength(0)
    await addButton(1) // Split change rows target the new side, like Hunk.
    expect(comments.at(-1)).toEqual({ path: "review.txt", side: "RIGHT", line: 21 })
    expect(editor()?.focused).toBe(true)
    // A full-width card like posted threads, after them under the commented line.
    const anchor = row(1)
    const holder = card().parent!
    expect(holder.parent).toBe(anchor)
    expect(anchor.getChildren().at(-1)).toBe(holder)
    expect(holder.y).toBeGreaterThan(setup.renderer.root.findDescendantById("diff-comment-card:thread")!.y)
    expect(card().x).toBe(anchor.x + 4)
    expect(card().width).toBe(Math.min(100, anchor.width - 4))
    expect(frame()).toContain("╭─ Comment ─")
    expect(frame()).not.toContain("Write a comment…")
    expect(frame()).toContain("Post · Cancel")
    expect(frame()).not.toContain("ctrl+s Post")
    expect(frame()).not.toContain("esc Cancel")

    // Printable diff and application shortcuts are text while the composer is focused.
    await setup.mockInput.typeText("two words tvwzfo")
    setup.mockInput.pressEnter()
    await setup.mockInput.typeText("**second**")
    await settle()
    expect(editor()!.plainText).toBe("two words tvwzfo\n**second**")
    expect(inputs.at(-1)).toBe("two words tvwzfo\n**second**")
    expect(editor()!.height).toBe(3)
    expect(frame().split("\n")[row(0).y]).toContain("same") // Split layout was not toggled by "t".
    setup.mockInput.pressKey("p", { ctrl: true }) // Markdown preview, as in every opengh composer.
    for (let i = 0; i < 20 && !frame().includes("│ second"); i++) await settle()
    expect(frame()).toContain("Comment (preview)")
    expect(frame()).not.toContain("**second**")
    setup.mockInput.pressKey("p", { ctrl: true })
    await settle()
    setup.mockInput.pressKey("z", { ctrl: true })
    await settle()
    expect(editor()!.plainText).toBe("two words tvwzfo\n")
    setup.mockInput.pressKey("s", { ctrl: true })
    setup.mockInput.pressKey("o", { ctrl: true })
    await settle()
    expect(saved).toEqual(["two words tvwzfo\n"])
    expect(expanded).toBe(1)
    setup.mockInput.pressKey("d", { ctrl: true })
    await settle()
    expect(editor()!.plainText).toBe("")
    expect(inputs.at(-1)).toBe("")
    setup.mockInput.pressKey("s", { ctrl: true }) // Empty comments are never posted.
    await settle()
    expect(saved).toHaveLength(1)

    // Clicking source returns keys to the diff; clicking the card resumes typing.
    const instance = editor()
    await setup.mockMouse.click(row(0).x + 5, row(0).y)
    await settle()
    expect(editor()!.focused).toBe(false)
    setup.mockInput.pressKey("t") // Layout changes keep the same editor, text and cursor.
    await settle()
    const unified = reviewRows(file, "unified").find((row) => row.right?.line === 21)!
    expect(setup.renderer.root.findDescendantById(unified.id)!.getChildren().at(-1)).toBe(card().parent!)
    expect(editor()).toBe(instance)
    expect(editor()!.plainText).toBe("")
    await setup.mockMouse.click(card().x + card().width - 4, card().y + 1)
    await settle()
    expect(editor()!.focused).toBe(true)
    await setup.mockInput.typeText("kept")
    await settle()
    // Overlays blur the editor and hide a showing [+]; both return when they close.
    const source = setup.renderer.root.findDescendantById(unified.id)!
    await setup.mockMouse.moveTo(source.x + 5, source.y)
    await settle()
    expect(frame()).toContain("[+]")
    setInteractive(false)
    await settle()
    expect(editor()!.focused).toBe(false)
    expect(frame()).not.toContain("[+]")
    setup.mockInput.pressKey("x")
    setInteractive(true)
    await settle()
    expect(editor()!.focused).toBe(true)
    await setup.mockInput.typeText("!")
    await settle()
    expect(editor()!.plainText).toBe("kept!")
    const post = setup.renderer.root.findDescendantById("inline-comment-post")!
    await setup.mockMouse.click(post.x, post.y)
    await settle()
    expect(saved.at(-1)).toBe("kept!")
    await escape()
    expect(cancelled).toBe(1)
    expect(editor()).toBeUndefined()
    setup.mockInput.pressKey("t")
    await settle()

    // Deletion-only rows comment on the old side, and selected ranges are kept.
    await addButton(2)
    expect(comments.at(-1)).toEqual({ path: "review.txt", side: "LEFT", line: 12 })
    const cancel = setup.renderer.root.findDescendantById("inline-comment-cancel")!
    await setup.mockMouse.click(cancel.x, cancel.y)
    await settle()
    expect(cancelled).toBe(2)
    await setup.mockMouse.click(row(1).x + 5, row(1).y)
    await setup.mockMouse.click(row(2).x + 5, row(2).y, 0, { modifiers: { shift: true } })
    await addButton(2)
    expect(comments.at(-1)).toEqual({ path: "review.txt", side: "LEFT", line: 12, startLine: 11, startSide: "LEFT" })
    await escape()
    await addButton(2) // The [+] release must not reselect the single line under the button.
    expect(comments.at(-1)).toEqual({ path: "review.txt", side: "LEFT", line: 12, startLine: 11, startSide: "LEFT" })
  } finally { setup.renderer.destroy() }
})

test("the composer retains editor focus and stays mounted, without [+], while review is briefly withheld", async () => {
  const setup = await createTestRenderer({ width: 140, height: 30 })
  initializeHunk(setup.renderer)
  const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
  let text = "seed"
  const [available, setAvailable] = createSignal(true)
  await render(() => <DiffScreen target={{ kind: "pull", number: 1 }} commentable
    draft={{ anchor: { path: "review.txt", side: "RIGHT", line: 21 }, body: text }} onDraftInput={(body) => { text = body }}
    resource={{ status: "ready", value: { kind: "patch", patch } }} interactive showScrollbar={false} onLoadFiles={() => {}}
    review={available() ? { headSha: "head", comments: [], onComment: () => {}, onOpenReview: () => {} } : undefined} />, setup.renderer)
  const settle = async () => { await Bun.sleep(20); await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const editor = () => setup.renderer.root.findDescendantById("inline-comment-editor") as TextareaRenderable | undefined
  const row = (index: number) => setup.renderer.root.findDescendantById(reviewRows(file, "split")[index]!.id)!
  try {
    await settle()
    // The composer owns typing until a source click explicitly blurs it.
    expect(editor()!.focused).toBe(true)
    await setup.mockMouse.click(row(0).x + 5, row(0).y)
    setup.mockInput.pressKey("x")
    await settle()
    expect(editor()!.plainText).toBe("seed")
    const card = setup.renderer.root.findDescendantById("inline-comment-composer-card")!
    await setup.mockMouse.click(card.x + card.width - 4, card.y + 1)
    await setup.mockInput.typeText("!,.")
    await settle()
    expect(text).toBe("seed!,.")
    const instance = editor()
    setAvailable(false) // e.g. while this comment posts or reviews reload.
    await settle()
    expect(editor()).toBe(instance)
    expect(editor()!.focused).toBe(false)
    setup.mockInput.pressKey("y")
    await setup.mockMouse.moveTo(row(1).x + 5, row(1).y)
    await settle()
    expect(editor()!.plainText).toBe("seed!,.")
    expect(setup.captureCharFrame()).not.toContain("[+]")
    await setup.mockMouse.click(card.x + card.width - 4, card.y + 1) // Clicking while withheld edits nothing.
    setup.mockInput.pressKey("q")
    await settle()
    expect(editor()!.focused).toBe(false)
    expect(editor()!.plainText).toBe("seed!,.")
    setAvailable(true) // A failed post resumes the same editor, focus and undo history.
    await settle()
    expect(editor()).toBe(instance)
    expect(editor()!.focused).toBe(true)
    setup.mockInput.pressKey("z", { ctrl: true })
    await settle()
    expect(editor()!.plainText).toBe("seed")
    await setup.mockMouse.click(row(0).x + 5, row(0).y)
    setAvailable(false)
    await settle()
    setAvailable(true)
    await settle()
    expect(editor()!.focused).toBe(false) // A blurred draft stays blurred: j/k keep scrolling the diff.
    setup.mockInput.pressKey("w")
    await settle()
    expect(editor()!.plainText).toBe("seed")
  } finally { setup.renderer.destroy() }
})

test("the [+] column appears only when commenting is available, and wrapped search geometry matches rendering", async () => {
  const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
  const wide = `diff --git a/wrap.txt b/wrap.txt\n--- a/wrap.txt\n+++ b/wrap.txt\n@@ -1 +1 @@\n-short\n+${Array.from({ length: 12 }, (_, i) => `word${i}`).join(" ")}\n`
  const wrapped = parseDiff({ kind: "patch", patch: wide }).files[0]!.body!
  const visualLines = (onAddNote?: () => void) => getHunkDiffSearchCells({ file: wrapped, width: 60, canonicalLayout: "split", wrapLines: true, onAddNote })
    .find((cell) => cell.side === "right")!.visualLines
  expect(visualLines(() => {})).not.toEqual(visualLines()) // The reserved [+] column changes wrapping...
  const host = await createTestRenderer({ width: 60, height: 12 })
  initializeHunk(host.renderer)
  const box = new BoxRenderable(host.renderer, { width: 60, flexDirection: "column" })
  host.renderer.root.add(box)
  mountHunk(host.renderer, box, { file: wrapped, width: 60, canonicalLayout: "split", wrapLines: true, onAddNote: () => {} })
  try {
    await host.flush(); await host.renderer.idle(); await host.flush()
    const frame = host.captureCharFrame() // ...and search segments match what Hunk renders with it.
    for (const line of visualLines(() => {})) expect(frame).toContain(line.trimEnd())
  } finally { host.renderer.destroy() }

  const setup = await createTestRenderer({ width: 110, height: 20 })
  initializeHunk(setup.renderer)
  await render(() => <DiffScreen target={{ kind: "commit", sha: "abc" }}
    resource={{ status: "ready", value: { kind: "patch", patch } }} interactive showScrollbar={false} onLoadFiles={() => {}} />, setup.renderer)
  try {
    await setup.flush(); await setup.renderer.idle(); await setup.flush()
    const row = setup.renderer.root.findDescendantById(reviewRows(file, "split")[1]!.id)!
    await setup.mockMouse.moveTo(row.x + 5, row.y)
    await setup.flush(); await setup.renderer.idle(); await setup.flush()
    expect(setup.captureCharFrame()).not.toContain("[+]")
  } finally { setup.renderer.destroy() }
})

test("a growing composer keeps its end in view", async () => {
  const lines = Array.from({ length: 40 }, (_, index) => `+line ${index + 1}`).join("\n")
  const tall = `diff --git a/tall.txt b/tall.txt\n--- a/tall.txt\n+++ b/tall.txt\n@@ -0,0 +1,40 @@\n${lines}\n`
  const setup = await createTestRenderer({ width: 140, height: 20 })
  initializeHunk(setup.renderer)
  const file = parseDiff({ kind: "patch", patch: tall }).files[0]!.body!
  const [draft, setDraft] = createSignal<{ anchor: ReviewAnchor; body: string }>()
  await render(() => <DiffScreen target={{ kind: "pull", number: 1 }} draft={draft()}
    resource={{ status: "ready", value: { kind: "patch", patch: tall } }} interactive showScrollbar={false} onLoadFiles={() => {}}
    review={{ headSha: "head", comments: [], onOpenReview: () => {}, onComment: (anchor) => setDraft({ anchor, body: "" }) }} />, setup.renderer)
  const settle = async () => { await Bun.sleep(20); await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  try {
    await settle()
    const viewport = (setup.renderer.root.findDescendantById("diff-body-scroll") as import("@opentui/core").ScrollBoxRenderable).viewport
    const last = reviewRows(file, "split").map((row) => setup.renderer.root.findDescendantById(row.id)!)
      .filter((row) => row.y + row.height <= viewport.y + viewport.height).at(-1)!
    await setup.mockMouse.moveTo(last.x + 5, last.y)
    await settle()
    await setup.mockMouse.click(last.x + last.width - 2, last.y)
    await settle()
    for (let index = 0; index < 6; index++) { await setup.mockInput.typeText(`line ${index}`); setup.mockInput.pressEnter() }
    await settle()
    const card = setup.renderer.root.findDescendantById("inline-comment-composer-card")!
    expect(card.y + card.height).toBeLessThanOrEqual(viewport.y + viewport.height)
  } finally { setup.renderer.destroy() }
})
