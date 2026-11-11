import type { HunkDiffFile } from "hunkdiff/opentui"
import type { ReviewAnchor } from "../review-types"

export type ReviewRow = { id: string; hunk: number; left?: ReviewAnchor; right?: ReviewAnchor }
export type ReviewLocation = { anchor: ReviewAnchor; hunk: number }

/** Hunk 0.24's diffRows/reviewRenderPlan IDs use Pierre source-array indexes, NOT
 * patch positions or terminal rows. Match complete IDs so headers/gaps never anchor.
 * No-newline markers are absent from Pierre hunkContent and consume no source line.
 */
export function reviewRows(file: HunkDiffFile, layout: "split" | "unified"): ReviewRow[] {
  const rows: ReviewRow[] = []
  const path = file.path ?? file.metadata.name
  for (const [hunk, part] of file.metadata.hunks.entries()) {
    let oldIndex = part.deletionLineIndex
    let newIndex = part.additionLineIndex
    let oldLine = part.deletionStart
    let newLine = part.additionStart
    const add = (key: string, left?: number, right?: number) => rows.push({
      id: `review-row:diff-row:${file.id}:${layout}:${hunk}:${key}`, hunk,
      left: left === undefined ? undefined : { path, side: "LEFT", line: left },
      right: right === undefined ? undefined : { path, side: "RIGHT", line: right },
    })
    for (const block of part.hunkContent) {
      if (block.type === "context") {
        for (let i = 0; i < block.lines; i++) add(`context:${oldIndex + i}:${newIndex + i}`, oldLine + i, newLine + i)
        oldIndex += block.lines; newIndex += block.lines
        oldLine += block.lines; newLine += block.lines
      } else {
        if (layout === "split") {
          for (let i = 0; i < Math.max(block.deletions, block.additions); i++)
            add(`change:${oldIndex + i}:${newIndex + i}`, i < block.deletions ? oldLine + i : undefined, i < block.additions ? newLine + i : undefined)
        } else {
          for (let i = 0; i < block.deletions; i++) add(`deletion:${oldIndex + i}`, oldLine + i)
          for (let i = 0; i < block.additions; i++) add(`addition:${newIndex + i}`, undefined, newLine + i)
        }
        oldIndex += block.deletions; newIndex += block.additions
        oldLine += block.deletions; newLine += block.additions
      }
    }
  }
  return rows
}

// Hunk 0.24 resolveSplitPaneWidths: one-cell outer rail and one-cell separator.
export const reviewSplitBoundary = (width: number) => 1 + Math.floor(Math.max(0, width - 2) / 2)

export function reviewHit(row: ReviewRow, layout: "split" | "unified", width: number, x: number, visualLine: number): ReviewLocation | undefined {
  if (x < 0 || x >= width || visualLine < 0) return
  // Wrapped split rows pad the shorter side. Hunk exports no per-side wrap map;
  // decline continuation rows rather than accidentally anchoring padding.
  if (layout === "split" && visualLine !== 0) return
  const anchor = layout === "split" ? (x < reviewSplitBoundary(width) ? row.left : row.right) : row.right ?? row.left
  return anchor && { anchor, hunk: row.hunk }
}

export function extendReviewRange(start: ReviewLocation | undefined, end: ReviewLocation): ReviewLocation {
  if (!start || start.hunk !== end.hunk || start.anchor.path !== end.anchor.path || start.anchor.side !== end.anchor.side) return end
  const low = Math.min(start.anchor.startLine ?? start.anchor.line, end.anchor.line)
  const high = Math.max(start.anchor.line, end.anchor.line)
  return { hunk: end.hunk, anchor: { path: end.anchor.path, side: end.anchor.side, line: high,
    ...(low < high ? { startLine: low, startSide: end.anchor.side } : {}) } }
}

export const reviewAnchorLabel = (anchor: ReviewAnchor) =>
  `${anchor.path}:${anchor.startLine ? `${anchor.startLine}–` : ""}${anchor.line} (${anchor.side})`
