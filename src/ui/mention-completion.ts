export type MentionToken = { start: number; end: number; query: string }
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** Convert a logical, display-cell cursor to a UTF-16 index without splitting a grapheme. */
export function mentionCursorIndex(text: string, row: number, column: number, measure: (text: string) => number) {
  const lines = text.split("\n")
  const line = lines[row]
  if (line === undefined || column < 0) return undefined
  const start = lines.slice(0, row).reduce((offset, line) => offset + line.length + 1, 0)
  if (column === 0) return start
  if (/^[\x20-\x7e]*$/.test(line)) return column <= line.length ? start + column : undefined
  let cells = 0
  for (const { index, segment } of graphemes.segment(line)) {
    cells += /^[\x20-\x7e]$/.test(segment) ? 1 : measure(segment)
    if (cells === column) return start + index + segment.length
    if (cells > column) return undefined
  }
  return undefined
}

/** Complete only prose @tokens, not email addresses, URLs, escaped mentions or code. */
export function detectMention(text: string, cursor: number): MentionToken | undefined {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) return
  const lineStart = text.lastIndexOf("\n", cursor - 1) + 1
  const prefix = text.slice(lineStart, cursor)
  const match = /(?:^|[^\p{L}\p{N}_@/\\])@([a-z\d-]{0,39})$/iu.exec(prefix.slice(-42))
  if (!match) return
  const start = cursor - match[1]!.length - 1
  if (/\S*:\/\/\S*$/.test(prefix) || /^(?: {4}|\t)/.test(prefix)) return
  let fence: { marker: string; length: number } | undefined
  let ticks = 0
  const preceding = text.slice(0, start).split("\n")
  for (const [index, line] of preceding.entries()) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (delimiter) {
      const marker = delimiter[1]![0]!
      if (!fence) fence = { marker, length: delimiter[1]!.length }
      else if (marker === fence.marker && delimiter[1]!.length >= fence.length && !delimiter[2]!.trim()) fence = undefined
      ticks = 0
      continue
    }
    if (fence) continue
    if (!line.trim() && index < preceding.length - 1) ticks = 0
    for (const run of line.matchAll(/\\.|`+/g)) {
      if (run[0][0] !== "`") continue
      if (!ticks) ticks = run[0].length
      else if (ticks === run[0].length) ticks = 0
    }
  }
  if (fence || ticks) return
  let end = cursor
  while (end < text.length && /[a-z\d-]/i.test(text[end]!)) end++
  if (end - start > 40) return
  if (text.slice(end, end + 5).toLowerCase() === "[bot]") end += 5
  return { start, end, query: match[1]! }
}

export function mergeMentionUsers(local: readonly string[], remote: readonly string[], query: string, limit = 30) {
  const seen = new Set<string>()
  const prefix = query.toLowerCase()
  return [...local.filter(login => login.toLowerCase().startsWith(prefix)), ...remote].filter(login => {
    const key = login.toLowerCase()
    if (!/^[a-z\d][a-z\d-]{0,38}(?:\[bot\])?$/i.test(login) || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, limit)
}
