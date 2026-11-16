import { parseSafeUrl } from "./link-target"
import type { RepositoryDocument } from "./models"

// Match known refs only; never guess where a slash ref ends.
export function overviewDocumentLink(
  value: string,
  current: RepositoryDocument | undefined,
  documents: readonly RepositoryDocument[],
): RepositoryDocument | undefined {
  const url = parseSafeUrl(value)
  if (!current || !url || url.origin !== "https://github.com" || value.split("#", 1)[0]!.includes("?")) return undefined
  const sources = documents.filter((source) => source.repository === current.repository && source.ref === current.ref)
  for (const source of sources) {
    const prefix = `/${source.repository}/blob/${encodeURIComponent(source.ref)}/`
    if (!url.pathname.startsWith(prefix)) continue
    try {
      const parts = url.pathname.slice(prefix.length).split("/").map(decodeURIComponent)
      if (parts.some((part) => !part || part === "." || part === ".." || /[/\\\x00-\x1f\x7f]/.test(part))) return undefined
      const path = parts.join("/")
      if (!/\.(?:md|markdown)$/i.test(path)) return undefined
      return { id: "", label: parts.at(-1)!, repository: source.repository, ref: source.ref, path }
    } catch {
      return undefined
    }
  }
  return undefined
}
