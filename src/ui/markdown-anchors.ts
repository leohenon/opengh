import type { LineInfo, Renderable, TextTableRenderable } from "@opentui/core"

// Concealed markers carry anchor IDs through HTML/markdown conversion.
export const anchorMarker = (id: string) => `\uE000${encodeURIComponent(id)}\uE001`
export function anchorMarkers(text: string) {
  return [...text.matchAll(/\uE000([^\uE001]*)\uE001/g)].flatMap((match) => {
    try { return [{ id: decodeURIComponent(match[1]!), start: match.index!, end: match.index! + match[0].length }] }
    catch { return [] }
  })
}
export const stripAnchorMarkers = (text: string) => text.replace(/\uE000[^\uE001]*\uE001/g, "")

export type MarkdownAnchorRequest = { document: string; fragment: string; request: number }
export type MarkdownAnchorPosition = { line: number; column: number }
export type MarkdownAnchorTarget = { node: Renderable; row: number }
export type MarkdownAnchorResolver = (fragment: string) => Promise<MarkdownAnchorTarget | undefined>


export type MarkdownRenderedAnchor = {
  node: Renderable
  position?: MarkdownAnchorPosition
  cell?: { row: number; column: number }
}

export function anchorVisualRow(info: LineInfo, { line, column }: MarkdownAnchorPosition) {
  const first = info.lineSources.findIndex((source) => source >= line)
  let row = first < 0 ? Math.max(0, info.lineSources.length - 1) : first
  for (let index = row; index < info.lineSources.length && info.lineSources[index] === line; index++) {
    if ((info.lineStartCols[index] ?? 0) <= column) row = index
  }
  return row
}

// Pinned Core 0.6.6 has no public table-cell geometry API.
export function tableAnchorRow(table: TextTableRenderable, cell: { row: number; column: number }, position: MarkdownAnchorPosition) {
  const state = table as unknown as {
    ensureLayoutReady?: () => void
    _layout?: { rowOffsets?: number[] }
    _cells?: Array<Array<{ textBufferView?: { lineInfo: LineInfo } }>>
  }
  if (typeof state.ensureLayoutReady !== "function") return
  state.ensureLayoutReady.call(table)
  const offset = state._layout?.rowOffsets?.[cell.row]
  const view = state._cells?.[cell.row]?.[cell.column]?.textBufferView
  if (offset === undefined || !Number.isFinite(offset) || !view) return
  return offset + 1 + table.cellPaddingY + anchorVisualRow(view.lineInfo, position)
}


export const sourceLineAnchor = (line: number) => `opengh-source-L${line}`
export type MarkdownCodeSource = { content: string; start: number; end: number; bodyStart: number; anchors: string[] }
export type MarkdownSourceMap = { lineCount: number; code: MarkdownCodeSource[] }
