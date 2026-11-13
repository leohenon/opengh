import { iconPrefix } from "./icons"
import { BoxRenderable, TextAttributes, TextRenderable, type Renderable, type RenderContext, type TextOptions } from "@opentui/core"
import type { PullReviewThread, ReviewThreadComment } from "../models"
import type { ReviewAnchor } from "../review-types"
import { relativeTime } from "./format"
import { reviewSplitBoundary, type ReviewRow } from "./review-lines"

const prefix = "diff-comment-card:"
export type SavedDiffDraft = { id: string; anchor: ReviewAnchor }
export const isCommentCard = (node: Renderable) => node.id.startsWith(prefix)
export const isSavedDraftCard = (node: Renderable) => node.id.startsWith(`${prefix}draft:`)

// Review cards sit under their line, indented to its code. A wide split side holds the card for
// its own line; narrower sides would wrap comments heavily, so there cards span the diff.
const NOTE_INDENT = 4
const NOTE_MAX_WIDTH = 100
const DOCK_MIN_SIDE = 70
export function noteBox(width: number, layout: "split" | "unified", side?: "LEFT" | "RIGHT") {
  const boundary = reviewSplitBoundary(width)
  // The left side stops a column short of the right side's rail.
  const sideWidth = side === "RIGHT" ? width - boundary : boundary - 1
  const docked = layout === "split" && side !== undefined && sideWidth >= DOCK_MIN_SIDE
  const start = docked && side === "RIGHT" ? boundary : 0
  const available = docked ? sideWidth : width
  const boxWidth = Math.max(1, Math.min(NOTE_MAX_WIDTH, available - NOTE_INDENT))
  return { width: boxWidth, marginLeft: start + Math.max(0, Math.min(NOTE_INDENT, available - boxWidth)) }
}

/** Expanded review-row wrappers include cards; only their first, Hunk-owned child is source. */
export function isSourceRowY(row: Renderable, y: number) {
  const code = row.getChildren().find((child) => !isCommentCard(child))
  return !!code && y >= code.y && y < code.y + code.height
}

/** Own only the appended cards, never Hunk's rows or source renderables. Clear before React updates. */
export function createDiffCommentCards(renderer: RenderContext,
  renderBody: (container: BoxRenderable, comment: ReviewThreadComment) => () => void,
  renderDraft?: (container: BoxRenderable, draft: SavedDiffDraft) => () => void,
) {
  let owned: { card: BoxRenderable; disposeBodies: (() => void)[] }[] = []
  const clear = () => {
    for (const { card, disposeBodies } of owned) {
      for (const dispose of disposeBodies) dispose()
      if (card.isDestroyed) continue
      card.parent?.remove(card)
      card.destroyRecursively()
    }
    owned = []
  }
  return {
    clear,
    render(host: BoxRenderable, rows: readonly ReviewRow[], path: string | undefined,
      threads: readonly PullReviewThread[], colors: { text: TextOptions["fg"]; muted: TextOptions["fg"]; panel: TextOptions["fg"]; blue: TextOptions["fg"]; border: TextOptions["fg"] },
      layout: "split" | "unified", width: number, commentIcon: string, collapsed: boolean, savedDrafts: readonly SavedDiffDraft[] = []) {
      clear()
      if (host.isDestroyed) return
      for (const thread of threads) {
        if (thread.path !== path) continue
        const row = !thread.isOutdated && thread.diffSide && thread.line != null
          ? rows.find((row) => (thread.diffSide === "LEFT" ? row.left : row.right)?.path === thread.path && (thread.diffSide === "LEFT" ? row.left : row.right)?.line === thread.line) : undefined
        const anchor = row && host.findDescendantById(row.id)
        const line = thread.line ?? thread.originalLine
        // Cards away from their line say where they belong.
        const location = anchor ? "" : `${thread.isOutdated ? "Outdated" : "Unplaced"} · ${thread.path}${line ? `:${line}` : ""}`
        const count = `${thread.comments.length} ${thread.comments.length === 1 ? "comment" : "comments"}`
        const title = [location, collapsed ? count : "", thread.isResolved ? "resolved" : ""].filter(Boolean).join(" · ")
        const card = new BoxRenderable(renderer, {
          id: `${prefix}${thread.id}`, ...noteBox(width, layout, anchor ? thread.diffSide : undefined), flexDirection: "column", flexShrink: 0,
          border: true, borderStyle: "rounded", borderColor: colors.border, title: title ? ` ${title} ` : undefined, titleColor: colors.muted,
          paddingLeft: 1, paddingRight: 1,
        })
        const disposeBodies: (() => void)[] = []
        owned.push({ card, disposeBodies })
        const comments = collapsed ? thread.comments.slice(0, 1) : thread.comments
        for (const [index, comment] of comments.entries()) {
          if (index > 0) card.add(new BoxRenderable(renderer, {
            id: `${prefix}${thread.id}:divider:${index}`, width: "100%", height: 1, flexShrink: 0,
            border: ["top"], borderColor: colors.border,
          }))
          const header = new BoxRenderable(renderer, {
            id: `${prefix}${thread.id}:header:${index}`, width: "100%", height: 1, flexShrink: 0, flexDirection: "row", gap: 1,
          })
          header.add(new TextRenderable(renderer, {
            id: `${prefix}${thread.id}:author:${index}`,
            content: `${iconPrefix(commentIcon)}@${comment.author}`,
            fg: colors.blue, attributes: TextAttributes.BOLD, height: 1, minWidth: 0, flexShrink: 1, wrapMode: "none", truncate: true,
          }))
          if (!collapsed && Number.isFinite(Date.parse(comment.createdAt))) header.add(new TextRenderable(renderer, {
            id: `${prefix}${thread.id}:time:${index}`, content: `(${relativeTime(comment.createdAt)})`,
            fg: colors.muted, height: 1, flexShrink: 0, wrapMode: "none",
          }))
          card.add(header)
          if (collapsed) continue
          const body = new BoxRenderable(renderer, {
            id: `${prefix}${thread.id}:body:${index}`, width: "100%", minWidth: 0, flexShrink: 0, flexDirection: "column",
          })
          card.add(body)
          disposeBodies.push(renderBody(body, comment))
        }
        // Host children follow the file diff when no current source-side anchor exists.
        ;(anchor ?? host).add(card)
      }
      if (!renderDraft) return
      for (const draft of savedDrafts) {
        if (draft.anchor.path !== path) continue
        const row = rows.find((row) => (draft.anchor.side === "LEFT" ? row.left : row.right)?.path === draft.anchor.path && (draft.anchor.side === "LEFT" ? row.left : row.right)?.line === draft.anchor.line)
        const anchor = row && host.findDescendantById(row.id)
        if (!anchor) continue
        const card = new BoxRenderable(renderer, {
          id: `${prefix}draft:${draft.id}`, ...noteBox(width, layout, draft.anchor.side),
          height: 1, flexShrink: 0, flexDirection: "column",
        })
        owned.push({ card, disposeBodies: [renderDraft(card, draft)] })
        anchor.add(card)
      }
    },
  }
}
