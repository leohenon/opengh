export type SearchRange = { start: number; end: number }

// Regex escaping keeps the search literal. Unicode case folding never changes
// offsets into the original string (unlike lowercasing the complete haystack).
export function searchRanges(text: string, query: string): SearchRange[] {
  if (!query) return []
  const flags = query === query.toLowerCase() ? "giu" : "gu"
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags)
  return Array.from(text.matchAll(expression), (match) => ({ start: match.index, end: match.index + match[0].length }))
}

export function wrapSearchIndex(index: number, delta: number, count: number) {
  return count ? ((index + delta) % count + count) % count : -1
}
