const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

// Image destinations may be relative to a repository document. Ignore query
// strings/fragments and decode names without allowing line breaks in captions.
export function imageFilename(source: string): string {
  try {
    const path = new URL(source, "https://github.com/").pathname
    const name = path.slice(path.lastIndexOf("/") + 1)
    let decoded = name
    try {
      decoded = decodeURIComponent(name)
    } catch {
      /* Keep malformed escapes readable. */
    }
    return decoded.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim()
  } catch {
    return ""
  }
}

export function fitImageFilename(name: string, width: number, measure: (text: string) => number = Bun.stringWidth): string {
  width = Math.max(0, Math.floor(width))
  if (!width) return ""
  if (measure(name) <= width) return name
  const available = width - 1 // Reserve one column for the ellipsis.
  const dot = name.lastIndexOf(".")
  const extensionWidth = dot > 0 ? measure(name.slice(dot)) : 0
  const suffixBudget = Math.min(available, Math.max(Math.ceil(available / 2), extensionWidth))
  const segments = [...graphemes.segment(name)].map(({ segment }) => ({ text: segment, width: measure(segment) }))
  let suffix = ""
  let suffixWidth = 0
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]!
    if (suffixWidth + segment.width > suffixBudget) break
    suffix = segment.text + suffix
    suffixWidth += segment.width
  }
  let prefix = ""
  let prefixWidth = 0
  for (const segment of segments) {
    if (prefixWidth + segment.width > available - suffixWidth) break
    prefix += segment.text
    prefixWidth += segment.width
  }
  return `${prefix}…${suffix}`
}
