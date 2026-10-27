import { expect, test } from "bun:test"
import { createHunkDiffFilesFromPatch } from "hunkdiff/opentui"
import { extendReviewRange, reviewHit, reviewRows } from "../src/ui/review-lines"

const file = createHunkDiffFilesFromPatch(`diff --git a/old.txt b/new.txt
similarity index 60%
rename from old.txt
rename to new.txt
--- a/old.txt
+++ b/new.txt
@@ -10,4 +20,3 @@
 context
-old one
-old two
+new one
 last
@@ -100 +200 @@
-old end
\\ No newline at end of file
+new end
\\ No newline at end of file
`)[0]!

test("Pierre indexes map split rows to source lines, not patch offsets, and reject blank sides", () => {
  const rows = reviewRows(file, "split")
  expect(rows.map((row) => [row.left?.line, row.right?.line])).toEqual([[10, 20], [11, 21], [12, undefined], [13, 22], [100, 200]])
  expect(rows[0]!.id).toBe(`review-row:diff-row:${file.id}:split:0:context:0:0`)
  expect(reviewHit(rows[0]!, "split", 81, 39, 0)?.anchor).toEqual({ path: "new.txt", side: "LEFT", line: 10 })
  expect(reviewHit(rows[0]!, "split", 81, 40, 0)?.anchor).toEqual({ path: "new.txt", side: "RIGHT", line: 20 })
  expect(reviewHit(rows[2]!, "split", 81, 60, 0)).toBeUndefined()
  expect(reviewHit(rows[0]!, "split", 81, 20, 1)).toBeUndefined() // ambiguous wrap padding
  expect(reviewHit(rows[0]!, "split", 81, 81, 0)).toBeUndefined()
})

test("unified context uses RIGHT, deletions LEFT, wraps retain source line and no-newline markers consume none", () => {
  const rows = reviewRows(file, "unified")
  expect(rows.map((row) => reviewHit(row, "unified", 80, 12, 0)?.anchor)).toEqual([
    { path: "new.txt", side: "RIGHT", line: 20 },
    { path: "new.txt", side: "LEFT", line: 11 },
    { path: "new.txt", side: "LEFT", line: 12 },
    { path: "new.txt", side: "RIGHT", line: 21 },
    { path: "new.txt", side: "RIGHT", line: 22 },
    { path: "new.txt", side: "LEFT", line: 100 },
    { path: "new.txt", side: "RIGHT", line: 200 },
  ])
  expect(reviewHit(rows[3]!, "unified", 80, 12, 3)?.anchor.line).toBe(21)
  expect(rows.at(-1)!.id).toBe(`review-row:diff-row:${file.id}:unified:1:addition:3`)
})

test("ranges normalize reverse clicks and never cross side, file, or hunk", () => {
  const rows = reviewRows(file, "split")
  const first = reviewHit(rows[0]!, "split", 80, 10, 0)!
  const last = reviewHit(rows[3]!, "split", 80, 10, 0)!
  expect(extendReviewRange(last, first).anchor).toEqual({ path: "new.txt", side: "LEFT", line: 13, startLine: 10, startSide: "LEFT" })
  for (const end of [reviewHit(rows[0]!, "split", 80, 60, 0)!, reviewHit(rows[4]!, "split", 80, 10, 0)!, { ...first, anchor: { ...first.anchor, path: "other" } }])
    expect(extendReviewRange(first, end)).toBe(end)
})
