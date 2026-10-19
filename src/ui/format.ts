export function ago(iso: string) {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return "Unknown time"
  const elapsed = Math.max(0, Date.now() - time)
  const days = Math.floor(elapsed / 86_400_000)
  if (days > 30) return `${Math.floor(days / 30)}mo ago`
  if (days > 0) return `${days}d ago`
  const hours = Math.floor(elapsed / 3_600_000)
  if (hours > 0) return `${hours}h ago`
  const minutes = Math.floor(elapsed / 60_000)
  return minutes > 0 ? `${minutes}m ago` : "just now"
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

export function exactDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toISOString().replace("T", " ").replace(".000Z", " UTC")
}

export function calendarDay(iso?: string) {
  const date = new Date(iso ?? "")
  return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` : "unknown"
}

export function relativeTime(iso?: string) {
  const time = Date.parse(iso ?? "")
  if (!Number.isFinite(time)) return "Unknown time"
  const remaining = time - Date.now()
  if (remaining <= 0) return ago(iso!)
  if (remaining >= 86_400_000) return `in ${Math.ceil(remaining / 86_400_000)}d`
  if (remaining >= 3_600_000) return `in ${Math.ceil(remaining / 3_600_000)}h`
  return `in ${Math.max(1, Math.ceil(remaining / 60_000))}m`
}
