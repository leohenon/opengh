import { createHunkDiffFilesFromPatch, type HunkDiffFile } from "hunkdiff/opentui"
import { getFiletypeFromFileName } from "@pierre/diffs"
import type { DiffContent } from "../models"

export type DiffFile = {
  path: string
  previousPath?: string
  additions: number
  deletions: number
  status: string
  body?: HunkDiffFile
  message?: string
}

const MAX_FILE_LINES = 8_000
const MAX_PATCH_LINES = 100_000

export function parseDiff(content: DiffContent): { files: DiffFile[]; notice?: string; error?: string } {
  if (content.kind === "files") return {
    files: content.files,
    notice: "File list only — patches unavailable. Press r to retry the full diff."
      + (content.truncated ? " GitHub's 3,000-file limit was reached; this list may be incomplete." : ""),
  }
  const { patch } = content
  if (!patch.trim()) return { files: [] }
  if (patch.split("\n").length > MAX_PATCH_LINES) return {
    files: [], error: "Diff exceeds the 100,000-line parsing limit. Press Enter to load the file list or o to open GitHub.",
  }
  try {
    const parsed = createHunkDiffFilesFromPatch(patch)
    if (!parsed.length) throw new Error("No supported file diffs were found")
    const files = parsed.map((body): DiffFile => {
      const metadata = body.metadata
      const isBinary = /^Binary files(?: .*)? differ\r?$/m.test(body.patch ?? "") || /^GIT binary patch\r?$/m.test(body.patch ?? "")
      const tooLarge = metadata.additionLines.length + metadata.deletionLines.length > MAX_FILE_LINES
      const message = isBinary ? "Binary file — no text diff is available."
        : tooLarge ? "File exceeds the 8,000-line rendering limit. Open it on GitHub with o."
        : metadata.hunks.length ? undefined
        : metadata.prevMode && metadata.mode && metadata.prevMode !== metadata.mode ? `Mode changed: ${metadata.prevMode} → ${metadata.mode}`
        : metadata.type === "rename-pure" ? "Renamed without text changes."
        : metadata.type === "new" ? "Added file — no text hunks were supplied."
        : metadata.type === "deleted" ? "Deleted file — no text hunks were supplied."
        : "No text hunks were supplied for this file."
      return { path: body.path ?? metadata.name, previousPath: body.previousPath,
        additions: body.stats.additions, deletions: body.stats.deletions, status: metadata.type,
        body: { ...body, isBinary, language: body.language ?? metadata.lang ?? getFiletypeFromFileName(body.path ?? metadata.name) }, message }
    })
    const notices: string[] = []
    if (/^diff --(?:cc|combined) /m.test(patch)) notices.push("Merge diff shown as a first-parent comparison, not a multi-parent view.")
    const sections = patch.match(/^diff --(?:git|cc|combined) /gm)?.length ?? parsed.length
    if (sections !== parsed.length) notices.push("Some diff sections could not be rendered; open GitHub for the complete changeset.")
    return { files, notice: notices.join(" ") || undefined }
  } catch (error) {
    return { files: [], error: `Cannot render this diff: ${error instanceof Error ? error.message : "Invalid patch"}. Press Enter for the file list or o for GitHub.` }
  }
}
