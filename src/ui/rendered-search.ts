import {
  CodeRenderable,
  RGBA,
  Renderable,
  ScrollBoxRenderable,
  TextAttributes,
  TextBufferRenderable,
  TextRenderable,
  TextTableRenderable,
  type LineInfo,
  type TextChunk,
  type TextTableContent,
} from "@opentui/core"
import { searchRanges, type SearchRange } from "./search"

export type RenderedSearchMatch = { id: string; position: number; reveal(): void }
export type RenderedSearchOptions = {
  /** Skip this node and its entire subtree (e.g. a list selection marker). */
  exclude?: (node: Renderable) => boolean
  matchBackground?: RGBA
  activeBackground?: RGBA
  matchForeground?: RGBA
  activeForeground?: RGBA
}

type Geometry = {
  x: number
  y: number
  width: number
  lineInfo: LineInfo
  measureTextOffset(text: string): number
  measurementKey: string
  firstLineOffset?: number
  align?: "left" | "center" | "right"
}
type Segment = {
  owner: TextBufferRenderable | TextTableRenderable
  key: string
  chunks: TextChunk[]
  geometry(): Geometry | undefined
}
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

type TableState = { base: TextTableContent; painted?: TextTableContent; signature?: string }

function visible(node: Renderable) {
  for (let current: Renderable | null = node; current; current = current.parent)
    if (!current.visible || current.isDestroyed) return false
  return true
}

function* walk(node: Renderable, exclude?: (node: Renderable) => boolean): Generator<Renderable> {
  if (!visible(node) || exclude?.(node)) return
  yield node
  for (const child of node.getChildren()) yield* walk(child, exclude)
}

function ranges(chunks: TextChunk[], query: string) {
  const hidden: SearchRange[] = []
  let offset = 0
  for (const chunk of chunks) {
    if ((chunk.attributes ?? 0) & TextAttributes.HIDDEN)
      hidden.push({ start: offset, end: offset + chunk.text.length })
    offset += chunk.text.length
  }
  let index = 0
  return searchRanges(chunks.map((chunk) => chunk.text).join(""), query).filter((range) => {
    while (hidden[index] && hidden[index]!.end <= range.start) index++
    return !hidden[index] || hidden[index]!.start >= range.end
  })
}

// Offsets are UTF-16; widths and wrapping come from the same native text engine
// that paints the text. In particular, Code.lineInfo maps to *source* lines and
// must not be used here after concealment/normalization.
function position(column: number, geometry: Geometry) {
  const info = geometry.lineInfo
  let low = 0, high = info.lineStartCols.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (info.lineStartCols[middle]! <= column) low = middle + 1
    else high = middle
  }
  const row = low - 1
  if (row < 0) return undefined
  const width = info.lineWidthCols[row]!
  const available = geometry.width - (row === 0 ? geometry.firstLineOffset ?? 0 : 0)
  const padding = geometry.align === "right" ? Math.max(0, available - width)
    : geometry.align === "center" ? Math.floor(Math.max(0, available - width) / 2) : 0
  return {
    x: geometry.x + column - info.lineStartCols[row]! + padding + (row === 0 ? geometry.firstLineOffset ?? 0 : 0),
    y: geometry.y + row,
  }
}

/**
 * Searches currently composed/settled renderables, not Markdown/source strings.
 * Requires patches/opentui-core@0.6.6.patch. Re-run search after native lifecycle
 * updates (including highlightingDone); repeated calls are safe and cheap when
 * content/query/active ID are unchanged. Result closures resolve current layout,
 * so resize/wrapping does not stale their coordinates. No raw-source fallback.
 *
 * Hunk's private rasterized diff cells are not TextRenderables and are excluded;
 * pass its posted-comment subtree separately, not a whole diff body as fallback.
 */
export function createRenderedSearch(root: Renderable, options: RenderedSearchOptions = {}) {
  const defaultMatchBg = RGBA.fromHex("#665500")
  const defaultActiveBg = RGBA.fromHex("#a85d00")
  const ids = new WeakMap<Renderable, number>()
  let nextId = 0
  let query = ""
  let activeId: string | undefined
  let disposed = false
  let generation = 0
  const texts = new Map<TextBufferRenderable, {
    previous: TextBufferRenderable["textDecorator"]
    installed: TextBufferRenderable["textDecorator"]
    signature: string
  }>()
  const tables = new Map<TextTableRenderable, TableState>()
  // Native offset measurements are cached independently of wrapping/scrolling.
  // The controller may reindex the same tree every 150ms without allocating probes.
  const offsets = new Map<string, {
    text: string
    starts: Uint32Array
    ends: Uint32Array
    cells: { index: number; segment: string }[]
    measurementKey?: string
    columns?: Float64Array
  }>()

  function mapping(segment: string, chunks: TextChunk[]) {
    const text = chunks.map((chunk) => chunk.text).join("")
    let cached = offsets.get(segment)
    if (cached?.text !== text) {
      const starts = new Uint32Array(text.length + 1)
      const ends = new Uint32Array(text.length + 1)
      const cells = []
      for (const { index, segment } of graphemes.segment(text)) {
        const end = index + segment.length
        starts.fill(index, index, end)
        ends.fill(end, index + 1, end + 1)
        cells.push({ index, segment })
      }
      starts[text.length] = text.length
      cached = { text, starts, ends, cells }
      offsets.set(segment, cached)
    }
    return cached
  }

  function columns(segment: Segment, geometry: Geometry) {
    const cached = mapping(segment.key, segment.chunks)
    if (!cached.columns || cached.measurementKey !== geometry.measurementKey) {
      // Native logical columns are additive (including fixed-width tabs and the
      // newline separator). Probe each distinct terminal grapheme just once;
      // never shape every growing prefix. Keep native widthMethod semantics.
      const widths = new Map<string, number>()
      const result = new Float64Array(cached.text.length + 1)
      let column = 0
      for (const cell of cached.cells) {
        let width = widths.get(cell.segment)
        if (width === undefined) {
          width = geometry.measureTextOffset(cell.segment)
          widths.set(cell.segment, width)
        }
        result.fill(column, cell.index, cell.index + cell.segment.length)
        column += width
      }
      result[cached.text.length] = column
      cached.columns = result
      cached.measurementKey = geometry.measurementKey
    }
    return cached
  }

  function key(node: Renderable) {
    if (!ids.has(node)) ids.set(node, nextId++)
    return String(ids.get(node))
  }
  const matchId = (segment: string, range: SearchRange) => `${segment}:${range.start}:${range.end}`

  function decorate(chunks: TextChunk[], segment: string) {
    const found = ranges(chunks, query)
    if (!found.length) return chunks
    const map = mapping(segment, chunks)
    // Search ranges are ordered and disjoint. Expanded ranges may share a
    // grapheme; active paint wins without changing the original match IDs.
    const matches: SearchRange[] = []
    let activePaint: SearchRange | undefined
    for (const match of found) {
      const start = map.starts[match.start]!
      const end = map.ends[match.end]!
      if (matchId(segment, match) === activeId) activePaint = { start, end }
      const previous = matches.at(-1)
      if (previous && previous.end > start) previous.end = Math.max(previous.end, end)
      else matches.push({ start, end })
    }
    let offset = 0, index = 0
    const result: TextChunk[] = []
    for (const chunk of chunks) {
      const start = offset, end = start + chunk.text.length
      while (offset < end) {
        while (matches[index] && matches[index]!.end <= offset) index++
        const range = matches[index]
        const inside = range && range.start <= offset
        const active = activePaint && activePaint.start <= offset && activePaint.end > offset
        let to = Math.min(end, inside ? range.end : range?.start ?? end)
        if (activePaint && activePaint.start > offset) to = Math.min(to, activePaint.start)
        if (active) to = Math.min(to, activePaint!.end)
        const part = { ...chunk, text: chunk.text.slice(offset - start, to - start) }
        if (inside) {
          part.bg = active ? options.activeBackground ?? defaultActiveBg : options.matchBackground ?? defaultMatchBg
          const fg = active ? options.activeForeground : options.matchForeground
          if (fg) part.fg = fg
          part.attributes = (chunk.attributes ?? 0) | (active ? TextAttributes.UNDERLINE : 0)
        }
        result.push(part)
        offset = to
      }
    }
    return result
  }

  function tableState(table: TextTableRenderable) {
    let state = tables.get(table)
    if (!state || (table.content !== state.painted && table.content !== state.base)) {
      state = { base: table.content }
      tables.set(table, state)
    }
    return state
  }

  function segments(): Segment[] {
    const result: Segment[] = []
    for (const node of walk(root, options.exclude)) {
      if (node instanceof TextRenderable || node instanceof CodeRenderable) {
        result.push({
          owner: node,
          key: key(node),
          chunks: node.renderedChunks,
          geometry: () => ({
            x: 0, y: 0, width: node.width,
            firstLineOffset: node.firstLineOffset,
            lineInfo: node.renderedLineInfo,
            measureTextOffset: (text) => node.measureTextOffset(text),
            measurementKey: node.textMeasurementKey,
            align: node.textAlign,
          }),
        })
      } else if (node instanceof TextTableRenderable) {
        tableState(node).base.forEach((row, r) => row.forEach((chunks, c) => {
          if (chunks) result.push({
            owner: node, key: `${key(node)}/${r}/${c}`, chunks,
            geometry: () => node.getCellGeometry(r, c),
          })
        }))
      }
    }
    return result
  }

  function paint(current: Segment[]) {
    const owners = new Set(current.map((segment) => segment.owner))
    for (const [node, state] of texts) {
      if (!owners.has(node) || !query) {
        if (!node.isDestroyed && node.textDecorator === state.installed) node.textDecorator = state.previous
        texts.delete(node)
      }
    }
    for (const [table, state] of tables) {
      if (!owners.has(table) || !query) {
        if (!table.isDestroyed && table.content === state.painted) table.content = state.base
        tables.delete(table)
      }
    }
    if (!query) return
    const signature = JSON.stringify([query, activeId, ...[
      options.matchBackground, options.activeBackground, options.matchForeground, options.activeForeground,
    ].map((color) => color ? Array.from(color.buffer) : null)])
    for (const node of owners) {
      if (node instanceof TextBufferRenderable) {
        const state = texts.get(node)
        if (state?.signature === signature && node.textDecorator === state.installed) continue
        const previous = state ? state.previous : node.textDecorator
        const installed = (chunks: TextChunk[]) => decorate(previous?.(chunks) ?? chunks, key(node))
        texts.set(node, { previous, installed, signature })
        node.textDecorator = installed
      } else {
        const state = tableState(node)
        if (state.signature === signature && node.content === state.painted) continue
        const content = state.base.map((row, r) => row.map((chunks, c) =>
          chunks ? decorate(chunks, `${key(node)}/${r}/${c}`) : chunks))
        state.painted = content
        state.signature = signature
        node.content = content
      }
    }
  }

  function primaryScroll() {
    for (let node: Renderable | null = root; node; node = node.parent)
      if (node instanceof ScrollBoxRenderable) return node
    for (const node of walk(root, options.exclude)) if (node instanceof ScrollBoxRenderable) return node
    return undefined
  }

  function row(segment: Segment, column: number, origin: number, geometry: Geometry | undefined) {
    const point = geometry && position(column, geometry)
    return segment.owner.y + (point?.y ?? 0) - origin
  }

  function reveal(segment: Segment, range: SearchRange, version: number) {
    if (disposed || version !== generation || !visible(segment.owner)) return
    const fresh = segments().find((candidate) => candidate.key === segment.key)
    if (!fresh || fresh.chunks.map((chunk) => chunk.text).join("") !== segment.chunks.map((chunk) => chunk.text).join("")) return
    const geometry = segment.geometry()
    if (!geometry) return
    const map = columns(segment, geometry)
    const startColumn = map.columns![range.start]!
    const point = position(startColumn, geometry)
    if (!point) return
    const endColumn = map.columns![map.ends[range.end]!]!
    const last = position(Math.max(startColumn, endColumn - 1), geometry) ?? { ...point }
    const owner = segment.owner
    const fit = (start: number, end: number, scroll: number, size: number) =>
      start < scroll || end - start >= size ? start : end >= scroll + size ? end - size + 1 : scroll
    if (owner instanceof TextBufferRenderable) {
      owner.scrollY = fit(point.y, last.y, owner.scrollY, owner.height)
      owner.scrollX = fit(point.x, last.y === point.y ? last.x : point.x, owner.scrollX, owner.width)
      point.x -= owner.scrollX
      point.y -= owner.scrollY
      last.x -= owner.scrollX
      last.y -= owner.scrollY
    }
    // Resolve the occurrence from native text geometry, then compare its actual
    // position with each ancestor viewport. Never reveal just the owning block.
    let x = owner.x + point.x
    let y = owner.y + point.y
    let endX = owner.x + last.x
    let endY = owner.y + last.y
    for (let parent = owner.parent; parent; parent = parent.parent) {
      if (parent instanceof ScrollBoxRenderable) {
        const dx = fit(x, endY === y ? endX : x, parent.viewport.x, parent.viewport.width) - parent.viewport.x
        const dy = fit(y, endY, parent.viewport.y, parent.viewport.height) - parent.viewport.y
        const beforeX = parent.scrollLeft
        const beforeY = parent.scrollTop
        parent.scrollBy({ x: dx, y: dy })
        const movedX = parent.scrollLeft - beforeX
        const movedY = parent.scrollTop - beforeY
        x -= movedX
        y -= movedY
        endX -= movedX
        endY -= movedY
      }
    }
  }

  function clear() {
    if (disposed) return
    generation++
    query = ""
    activeId = undefined
    paint([])
    offsets.clear()
  }

  return {
    /** Content-relative viewport row, in the same coordinate space as match.position. */
    position() {
      const primary = primaryScroll()
      const top = primary?.viewport.y ?? root.y
      const bottom = top + (primary?.viewport.height ?? root.height)
      for (const node of walk(root, options.exclude)) {
        if (node instanceof TextBufferRenderable && node.scrollY && node.y < bottom && node.y + node.height > top)
          return (primary?.scrollTop ?? 0) + node.scrollY
      }
      return primary?.scrollTop ?? 0
    },
    search(value: string): RenderedSearchMatch[] {
      if (disposed) return []
      if (query !== value) generation++
      query = value
      const current = segments()
      paint(current)
      const keys = new Set(current.map((segment) => segment.key))
      for (const key of offsets.keys()) if (!keys.has(key)) offsets.delete(key)
      const version = generation
      const origin = primaryScroll()?.content.y ?? root.y
      return current.flatMap((segment) => {
        const matches = ranges(segment.chunks, query)
        if (!matches.length) return []
        const geometry = segment.geometry()
        const map = geometry && columns(segment, geometry)
        return matches.map((range) => ({
          id: matchId(segment.key, range),
          position: row(segment, map?.columns?.[range.start] ?? 0, origin, geometry),
          reveal: () => reveal(segment, range, version),
        }))
      })
    },
    highlight(id?: string) {
      if (disposed) return
      activeId = id
      paint(segments())
    },
    clear,
    snapshot() {
      const nodes = new Set<Renderable>(walk(root, options.exclude))
      for (let parent = root.parent; parent; parent = parent.parent) nodes.add(parent)
      const restore = [...nodes].flatMap((node) => {
        if (node instanceof ScrollBoxRenderable) {
          const { scrollTop, scrollLeft } = node
          return [() => { if (!node.isDestroyed) node.scrollTo({ x: scrollLeft, y: scrollTop }) }]
        }
        if (node instanceof TextBufferRenderable) {
          const { scrollX, scrollY } = node
          return [() => { if (!node.isDestroyed) { node.scrollX = scrollX; node.scrollY = scrollY } }]
        }
        return []
      })
      return () => { if (!disposed && visible(root)) for (const reset of restore) reset() }
    },
    dispose() {
      if (disposed) return
      clear()
      disposed = true
    },
  }
}
