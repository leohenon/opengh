export type SearchRange = { start: number; end: number }

// Regex escaping keeps the search literal. Unicode case folding never changes
// offsets into the original string (unlike lowercasing the complete haystack).
export function searchRanges(text: string, query: string, maxResults = Infinity): SearchRange[] {
  if (!query || maxResults <= 0) return []
  const flags = query === query.toLowerCase() ? "giu" : "gu"
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags)
  const ranges: SearchRange[] = []
  for (const match of text.matchAll(expression)) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
    if (ranges.length >= maxResults) break
  }
  return ranges
}

export function wrapSearchIndex(index: number, delta: number, count: number) {
  return count ? ((index + delta) % count + count) % count : -1
}
