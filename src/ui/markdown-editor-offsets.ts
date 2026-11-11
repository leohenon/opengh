const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

// EditBuffer measures fixed-width tabs and control notation with its own settings.
// Its highlight offsets exclude LF, unlike TextBuffer's logical columns. Measure
// whole graphemes, never growing prefixes or halves of a combining/ZWJ sequence.
export function markdownEditorOffsets(text: string, measure: (text: string) => number) {
  const starts = new Float64Array(text.length + 1)
  const ends = new Float64Array(text.length + 1)
  const widths = new Map<string, number>()
  let offset = 0
  // Segment lines separately so CRLF does not hide the CR's native control width.
  let lineStart = 0
  while (lineStart < text.length) {
    const newline = text.indexOf("\n", lineStart)
    const lineEnd = newline < 0 ? text.length : newline
    for (const { index, segment } of graphemes.segment(text.slice(lineStart, lineEnd))) {
      let width = widths.get(segment)
      if (width === undefined) { width = measure(segment); widths.set(segment, width) }
      const start = lineStart + index
      const end = start + segment.length
      starts.fill(offset, start, end)
      ends[start] = offset
      offset += width
      ends.fill(offset, start + 1, end + 1)
    }
    starts[lineEnd] = ends[lineEnd] = offset
    if (newline < 0) break
    starts[newline + 1] = ends[newline + 1] = offset
    lineStart = newline + 1
  }
  starts[text.length] = ends[text.length] = offset
  return { starts, ends }
}
