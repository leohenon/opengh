import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { ReviewAnchor } from "../src/review-types"
import type { SavedDiffDraft } from "../src/ui/diff-comment-cards"
import { parseDiff } from "../src/ui/diff-model"
import { initializeHunk } from "../src/ui/hunk-host"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { DiffScreen } from "../src/ui/pages/diff"
import { reviewRows } from "../src/ui/review-lines"
import { SearchProvider } from "../src/ui/search-context"
import { clickControl } from "./fixtures/mouse"

const patch = `diff --git a/review.txt b/review.txt
--- a/review.txt
+++ b/review.txt
@@ -10,3 +20,2 @@
 same
-old one
-old two
+new one
diff --git a/other.txt b/other.txt
--- a/other.txt
+++ b/other.txt
@@ -1 +1 @@
-old
+new
`

test("saved draft markers follow their source lines and resume exact anchors without becoming search results", async () => {
  const setup = await createTestRenderer({ width: 160, height: 30 })
  initializeHunk(setup.renderer)
  const initial: SavedDiffDraft[] = [
    { id: "right", anchor: { path: "review.txt", side: "RIGHT", line: 21 } },
    { id: "range", anchor: { path: "review.txt", side: "LEFT", line: 12, startLine: 11, startSide: "LEFT" } },
    { id: "other", anchor: { path: "other.txt", side: "RIGHT", line: 1 } },
    { id: "missing", anchor: { path: "review.txt", side: "RIGHT", line: 999 } },
  ]
  const [drafts, setDrafts] = createSignal(initial)
  const [available, setAvailable] = createSignal(true)
  const [interactive, setInteractive] = createSignal(true)
  const resumed: ReviewAnchor[] = []
  const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
  await render(() => <KeybindingsProvider><box width="100%" height="100%" flexDirection="column">
    <SearchProvider identity="draft-markers" enabled>
      <DiffScreen target={{ kind: "pull", number: 1 }} savedDrafts={drafts()} commentable
        resource={{ status: "ready", value: { kind: "patch", patch } }} interactive={interactive()}
        showScrollbar={false} onLoadFiles={() => {}}
        review={available() ? { headSha: "head", comments: [], onComment: anchor => { resumed.push(anchor) }, onOpenReview: () => {} } : undefined} />
    </SearchProvider>
  </box></KeybindingsProvider>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const marker = (id: string) => setup.renderer.root.findDescendantById(`diff-comment-card:draft:${id}`)
  const expectedRow = (anchor: ReviewAnchor, layout: "split" | "unified") => {
    const row = reviewRows(file, layout).find(row => (anchor.side === "LEFT" ? row.left : row.right)?.line === anchor.line)!
    return setup.renderer.root.findDescendantById(row.id)!
  }
  try {
    await settle()
    expect(setup.captureCharFrame()).toContain("Draft saved · Resume")
    expect(marker("right")!.parent).toBe(expectedRow(initial[0]!.anchor, "split"))
    expect(marker("range")!.parent).toBe(expectedRow(initial[1]!.anchor, "split"))
    expect(marker("other")).toBeDefined() // Other visible files own their own draft markers.
    expect(marker("missing")).toBeUndefined()
    expect(marker("right")!.height).toBe(1)

    setAvailable(false)
    await settle()
    await clickControl(setup, "inline-draft-resume:right")
    expect(resumed).toHaveLength(0)
    setAvailable(true)
    setInteractive(false)
    await settle()
    await clickControl(setup, "inline-draft-resume:right")
    expect(resumed).toHaveLength(0)
    setInteractive(true)
    await settle()
    await clickControl(setup, "inline-draft-resume:range")
    expect(resumed).toEqual([initial[1]!.anchor])

    setup.mockInput.pressKey("t")
    await settle()
    for (const draft of initial.slice(0, 2)) expect(marker(draft.id)!.parent).toBe(expectedRow(draft.anchor, "unified"))
    setup.mockInput.pressKey("w")
    await settle()
    setup.resize(50, 30)
    await settle()
    expect(setup.captureCharFrame()).toContain("Draft saved · Resume")
    setup.resize(160, 30)
    await settle()
    await clickControl(setup, "inline-draft-resume:right")
    expect(resumed.at(-1)).toEqual(initial[0]!.anchor)

    setup.mockInput.pressKey("/")
    await setup.mockInput.pasteBracketedText("Draft saved")
    await settle()
    setup.mockInput.pressEnter()
    await settle()
    expect(setup.captureCharFrame()).toContain("No matches")
    setup.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()

    setup.mockInput.pressKey(".")
    await settle()
    expect(marker("right")).toBeDefined()
    expect(marker("range")).toBeDefined()
    expect(marker("other")).toBeDefined() // Markers for every visible file stay mounted.
    setup.mockInput.pressKey(",")
    await settle()
    expect(marker("right")).toBeDefined()
    expect(marker("range")).toBeDefined()
    setDrafts(current => current.filter(draft => draft.id !== "right"))
    await settle()
    expect(marker("right")).toBeUndefined()
    expect(marker("range")).toBeDefined()
  } finally {
    setup.renderer.destroy()
    await setup.renderer.closed
  }
})
