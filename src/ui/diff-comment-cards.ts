import { BoxRenderable, TextAttributes, TextRenderable, type Renderable, type RenderContext, type TextOptions } from "@opentui/core"
import type { PullReviewThread, ReviewThreadComment } from "../models"
import { relativeTime } from "./format"
import { reviewSplitBoundary, type ReviewRow } from "./review-lines"

const prefix = "diff-comment-card:"
export const isCommentCard = (node: Renderable) => node.id.startsWith(prefix)

/** Expanded review-row wrappers include cards; only their first, Hunk-owned child is source. */
export function isSourceRowY(row: Renderable, y: number) {
  const code = row.getChildren().find((child) => !isCommentCard(child))
  return !!code && y >= code.y && y < code.y + code.height
}

/** Own only the appended cards, never Hunk's rows or source renderables. Clear before React updates. */
export function createDiffCommentCards(renderer: RenderContext, renderBody: (container: BoxRenderable, comment: ReviewThreadComment) => () => void) {
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
      layout: "split" | "unified", width: number, commentIcon: string) {
      clear()
      if (host.isDestroyed) return
      for (const thread of threads) {
        if (thread.path !== path) continue
        const row = !thread.isOutdated && thread.diffSide && thread.line != null
          ? rows.find((row) => (thread.diffSide === "LEFT" ? row.left : row.right)?.line === thread.line) : undefined
        const anchor = row && host.findDescendantById(row.id)
        const split = !!anchor && layout === "split"
        const boundary = reviewSplitBoundary(width)
        const start = split ? thread.diffSide === "RIGHT" ? boundary + 1 : 1 : 0
        const paneWidth = split && thread.diffSide === "LEFT" ? boundary - 1 : width - start
        const card = new BoxRenderable(renderer, {
          id: `${prefix}${thread.id}`, width: Math.max(1, Math.min(80, paneWidth - 2)),
          marginLeft: start + 1, marginTop: 1, marginBottom: 1, flexDirection: "column", flexShrink: 0,
          paddingLeft: 2, paddingRight: 2,
          backgroundColor: colors.panel,
        })
        const disposeBodies: (() => void)[] = []
        owned.push({ card, disposeBodies })
        const text = (id: string, content: string, fg: TextOptions["fg"], attributes = TextAttributes.NONE) => card.add(new TextRenderable(renderer, {
          id: `${prefix}${thread.id}:${id}`, content, fg, attributes, width: "100%", flexShrink: 0, wrapMode: "word",
        }))
        const line = thread.line ?? thread.originalLine
        const status = [thread.isResolved ? "resolved" : "", thread.isOutdated ? "outdated" : ""].filter(Boolean)
        if (!anchor) text("unplaced", `${thread.isOutdated ? "Outdated" : "Unplaced"} review comments · ${thread.path}${line ? `:${line}` : ""}`, colors.muted)
        for (const [index, comment] of thread.comments.entries()) {
          if (index > 0) card.add(new BoxRenderable(renderer, {
            id: `${prefix}${thread.id}:divider:${index}`, width: "100%", height: 1, flexShrink: 0,
            border: ["top"], borderColor: colors.border,
          }))
          const header = new BoxRenderable(renderer, {
            id: `${prefix}${thread.id}:header:${index}`, width: "100%", height: 1, flexShrink: 0, flexDirection: "row", gap: 1,
          })
          header.add(new TextRenderable(renderer, {
            id: `${prefix}${thread.id}:author:${index}`,
            content: `${commentIcon} @${comment.author}`,
            fg: colors.blue, attributes: TextAttributes.BOLD, height: 1, minWidth: 0, flexShrink: 1, wrapMode: "none", truncate: true,
          }))
          if (index === 0 && status.length) header.add(new TextRenderable(renderer, {
            id: `${prefix}${thread.id}:status`, content: `· ${status.join(" · ")}`,
            fg: colors.muted, height: 1, flexShrink: 0, wrapMode: "none",
          }))
          if (Number.isFinite(Date.parse(comment.createdAt))) header.add(new TextRenderable(renderer, {
            id: `${prefix}${thread.id}:time:${index}`, content: `(${relativeTime(comment.createdAt)})`,
            fg: colors.muted, height: 1, flexShrink: 0, wrapMode: "none",
          }))
          card.add(header)
          const body = new BoxRenderable(renderer, {
            id: `${prefix}${thread.id}:body:${index}`, width: "100%", minWidth: 0, flexShrink: 0, flexDirection: "column",
          })
          card.add(body)
          disposeBodies.push(renderBody(body, comment))
        }
        // Host children follow the file diff when no current source-side anchor exists.
        ;(anchor ?? host).add(card)
      }
    },
  }
}
