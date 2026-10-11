export function ago(iso: string) {
  const elapsed = Math.max(0, Date.now() - new Date(iso).getTime())
  const days = Math.floor(elapsed / 86_400_000)
  if (days > 30) return `${Math.floor(days / 30)}mo ago`
  if (days > 0) return `${days}d ago`
  const hours = Math.floor(elapsed / 3_600_000)
  return hours > 0 ? `${hours}h ago` : "just now"
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function fitText(value: string, width: number) {
  if (width <= 0) return ""
  if (Bun.stringWidth(value) <= width) return value
  if (width <= 3) return ".".repeat(width)

  const target = width - 3
  let result = ""
  for (const { segment: character } of graphemes.segment(value)) {
    if (Bun.stringWidth(result + character) > target) break
    result += character
  }
  return `${result}...`
}

export function count(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(".0", "")}k`
  return String(value)
}
