import { fitMiddle } from "./format"

/** Keep the filename intact when the sidebar has room; sacrifice directory context first. */
export function fitDiffPath(path: string, width: number) {
  if (width <= 0) return ""
  if (Bun.stringWidth(path) <= width) return path
  const slash = path.lastIndexOf("/")
  const filename = path.slice(slash + 1)
  if (Bun.stringWidth(filename) > width) return fitMiddle(filename, width)
  if (slash < 0) return filename
  let suffix = filename
  const directories = path.slice(0, slash).split("/")
  for (let index = directories.length - 1; index >= 0; index--) {
    const next = `${directories[index]}/${suffix}`
    if (Bun.stringWidth(`.../${next}`) > width) break
    suffix = next
  }
  return Bun.stringWidth(`.../${suffix}`) <= width ? `.../${suffix}` : filename
}

export function fitRename(from: string, to: string, width: number) {
  const full = `${from} → ${to}`
  if (Bun.stringWidth(full) <= width) return full
  const available = width - 3
  if (available < 16) return fitDiffPath(to, width)
  const fromWidth = Bun.stringWidth(from)
  const toWidth = Bun.stringWidth(to)
  let fromBudget = Math.min(fromWidth, Math.floor(available / 2))
  let toBudget = available - fromBudget
  if (toWidth < toBudget) {
    fromBudget = Math.min(fromWidth, fromBudget + toBudget - toWidth)
    toBudget = toWidth
  }
  const fitted = fitDiffPath(from, fromBudget)
  return `${fitted} → ${fitDiffPath(to, Math.max(toBudget, available - Bun.stringWidth(fitted)))}`
}
