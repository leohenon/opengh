import { fitText } from "./format"

/** Keep the filename intact when the sidebar has room; sacrifice directory context first. */
export function fitDiffPath(path: string, width: number) {
  if (width <= 0) return ""
  if (Bun.stringWidth(path) <= width) return path
  const slash = path.lastIndexOf("/")
  const filename = path.slice(slash + 1)
  if (Bun.stringWidth(filename) > width) return fitText(filename, width)
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
