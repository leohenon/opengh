import type { PullReviewThread } from "../models"

type SnippetLine = {
  oldLine?: number
  newLine?: number
  prefix: string
  text: string
  highlighted: boolean
  hunk: number
}

/** GitHub's stored hunk is historical: use original anchors, never today's file. */
export function reviewSnippet(thread: PullReviewThread): SnippetLine[] {
  const patch = thread.comments.find(comment => !comment.replyToId)?.diffHunk
  if (!patch || patch.length > 1_000_000) return []
  const target = thread.originalLine ?? thread.line
  const start = thread.originalStartLine ?? thread.startLine ?? target
  const lines: SnippetLine[] = []
  let oldLine = 0, newLine = 0, hunk = 0
  for (const raw of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); hunk++; continue }
    if (!hunk || ![" ", "+", "-"].includes(raw[0] ?? "")) continue
    const prefix = raw[0]!
    const left = prefix === "+" ? undefined : oldLine++
    const right = prefix === "-" ? undefined : newLine++
    const source = thread.diffSide === "LEFT" ? left : thread.diffSide === "RIGHT" ? right : undefined
    lines.push({ oldLine: left, newLine: right, prefix, text: raw.slice(1).replace(/\r$/, "").replace(/\t/g, "    "), hunk,
      highlighted: source !== undefined && start !== undefined && target !== undefined && source >= start && source <= target })
  }
  if (!lines.length) return []
  const index = lines.findIndex(line => (thread.diffSide === "LEFT" ? line.oldLine : thread.diffSide === "RIGHT" ? line.newLine : undefined) === target && target !== undefined)
  const anchor = index < 0 ? lines.length - 1 : index
  const current = lines.filter(line => line.hunk === lines[anchor]!.hunk)
  const end = current.indexOf(lines[anchor]!)
  const selectedStart = current.findIndex(line => line.highlighted)
  const first = Math.max(0, end - 11, Math.min(end - 3, selectedStart < 0 ? end : selectedStart))
  return current.slice(first, end + 1)
}
