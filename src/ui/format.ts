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

export function fitMiddle(value: string, width: number) {
  if (width <= 0) return ""
  if (Bun.stringWidth(value) <= width) return value
  if (width <= 3) return ".".repeat(width)
  const parts = [...graphemes.segment(value)].map((part) => part.segment)
  const room = width - 3
  const take = (source: string[], limit: number) => {
    const kept: string[] = []
    let used = 0
    for (const part of source) {
      const size = Bun.stringWidth(part)
      if (used + size > limit) break
      kept.push(part)
      used += size
    }
    return kept
  }
  let tail = take([...parts].reverse(), Math.ceil(room / 2)).reverse()
  let head = take(parts, room - Bun.stringWidth(tail.join("")))
  if (tail[0] === "." && head.length > 1) {
    head = head.slice(0, -1)
    tail = take([...parts].reverse(), room - Bun.stringWidth(head.join(""))).reverse()
  }
  return `${head.join("")}...${tail.join("")}`
}

export function wrappedRows(value: string, width: number) {
  if (width <= 0) return 0
  let rows = 0
  for (const line of value.split("\n")) {
    let used = 0
    rows++
    for (const word of line.split(/\s+/).filter(Boolean)) {
      let size = Bun.stringWidth(word)
      if (used && used + 1 + size <= width) {
        used += 1 + size
        continue
      }
      if (used) rows++
      while (size > width) {
        size -= width
        rows++
      }
      used = size
    }
  }
  return rows
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
