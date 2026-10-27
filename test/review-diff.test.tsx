import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import { initializeHunk } from "../src/ui/hunk-host"
import { DiffScreen } from "../src/ui/pages/diff"
import { parseDiff } from "../src/ui/diff-model"
import { reviewRows, reviewSplitBoundary } from "../src/ui/review-lines"
import type { ReviewAnchor } from "../src/review-types"
import type { ContextMenuItem } from "../src/ui/components/context-menu"

const patch = `diff --git a/review.txt b/review.txt
--- a/review.txt
+++ b/review.txt
@@ -10,3 +20,2 @@
 same
-old one
-old two
+new one
`

test("rendered Hunk row IDs support side-aware clicks, ranges, context actions, markers and jump", async () => {
  const setup = await createTestRenderer({ width: 110, height: 20 })
  initializeHunk(setup.renderer)
  const comments: ReviewAnchor[] = []
  let menu: ContextMenuItem[] = []
  const [jump, setJump] = createSignal<ReviewAnchor & { id: number }>()
  const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
  const rows = reviewRows(file, "split")
  await render(() => <DiffScreen target={{ kind: "pull", number: 1 }}
    resource={{ status: "ready", value: { kind: "patch", patch } }} interactive showScrollbar={false} onLoadFiles={() => {}}
    onContextMenu={(_, items) => { menu = items }}
    review={{ headSha: "head", comments: [{ id: "draft", body: "note", path: "review.txt", side: "RIGHT", line: 21 }],
      onComment: (anchor) => comments.push(anchor), onOpenReview: () => {}, jump: jump() }} />, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  try {
    await settle()
    const context = setup.renderer.root.findDescendantById(rows[0]!.id)!
    const change = setup.renderer.root.findDescendantById(rows[1]!.id)!
    const padding = setup.renderer.root.findDescendantById(rows[2]!.id)!
    expect(context).toBeDefined()
    await setup.mockMouse.click(change.x + 5, change.y)
    setup.mockInput.pressKey("c")
    await settle()
    expect(comments).toHaveLength(0)
    await setup.mockMouse.click(change.x + 5, change.y, 2)
    await settle()
    menu.find((item) => item.label === "Add review comment…")!.run()
    expect(comments.at(-1)).toEqual({ path: "review.txt", side: "LEFT", line: 11 })
    await setup.mockMouse.click(context.x + 5, context.y, 0, { modifiers: { shift: true } })
    setup.mockInput.pressKey("c")
    await settle()
    expect(comments).toHaveLength(1)
    await setup.mockMouse.click(context.x + 5, context.y, 2)
    await settle()
    menu.find((item) => item.label === "Add review comment…")!.run()
    expect(comments.at(-1)).toEqual({ path: "review.txt", side: "LEFT", line: 11, startLine: 10, startSide: "LEFT" })
    await setup.mockMouse.click(change.x + reviewSplitBoundary(change.width) + 5, change.y, 2)
    await settle()
    menu.find((item) => item.label === "Add review comment…")!.run()
    expect(comments.at(-1)).toEqual({ path: "review.txt", side: "RIGHT", line: 21 })
    await setup.mockMouse.click(padding.x + reviewSplitBoundary(padding.width) + 5, padding.y, 2)
    await settle()
    expect(menu.some((item) => item.label === "Add review comment…")).toBe(false)
    expect(setup.captureCharFrame()).not.toContain("Add comment")
    expect(setup.captureCharFrame()).not.toContain("Pending review")
    expect(setup.captureCharFrame().split("\n")[change.y]).toContain("*")
    setJump({ id: 1, path: "review.txt", side: "LEFT", line: 12 })
    await settle()
    expect(setup.captureCharFrame()).not.toContain("LEFT 12")
    const before = comments.length
    setup.mockInput.pressArrow("up", { meta: true })
    setup.mockInput.pressKey("c")
    await settle()
    expect(comments).toHaveLength(before)
  } finally { setup.renderer.destroy() }
})
