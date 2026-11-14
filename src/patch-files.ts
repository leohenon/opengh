import { createHunkDiffFilesFromPatch } from "hunkdiff/opentui"

export const MAX_PATCH_LINES = 100_000

const statuses = ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"] as const
const parsedStatuses: Record<string, typeof statuses[number]> = {
  new: "added", deleted: "removed", change: "modified", "rename-pure": "renamed", "rename-changed": "renamed",
}

export type FileStatus = typeof statuses[number] | "unknown"

export function fileStatus(value: string): FileStatus {
  const status = parsedStatuses[value] ?? value
  return (statuses as readonly string[]).includes(status) ? status as FileStatus : "unknown"
}

export type PatchHunk = {
  index: number
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  additions: number
  deletions: number
}

export type PatchFile = {
  path: string
  previousPath: string | null
  status: FileStatus
  additions: number
  deletions: number
  binary: boolean
  mode: string | null
  previousMode: string | null
  hunks: PatchHunk[]
  patch: string
}

const extendedHeader = /^(?:(?:old|new|deleted file|new file) mode|copy (?:from|to)|rename (?:from|to)|(?:dis)?similarity index|index|---|\+\+\+) /
const changeHeader = /^(?:(?:old|new|deleted file|new file) mode|copy (?:from|to)|rename (?:from|to)) /

function malformed(reason: string): never {
  throw new Error(`Cannot parse this diff: ${reason}.`)
}

export function parsePatchFiles(patch: string): PatchFile[] {
  if (!patch.trim()) return []
  if (patch.split("\n").length > MAX_PATCH_LINES) throw new Error("Diff exceeds the 100,000-line parsing limit.")
  const starts: number[] = []
  for (const match of patch.matchAll(/(^|\n)diff --(git|cc|combined) /g)) {
    if (match[2] !== "git") malformed("combined merge diffs are not supported")
    starts.push(match.index + match[1]!.length)
  }
  if (!starts.length || patch.slice(0, starts[0]).trim()) malformed("unsupported content outside Git file sections")
  const sections = starts.map((start, index) => patch.slice(start, starts[index + 1]))
  let parsed: ReturnType<typeof createHunkDiffFilesFromPatch>
  try { parsed = createHunkDiffFilesFromPatch(patch) }
  catch (error) { malformed(error instanceof Error ? error.message : "invalid patch") }
  if (parsed.length !== sections.length) malformed(`${sections.length} file sections but ${parsed.length} parsed files`)
  return parsed.map((file, fileIndex): PatchFile => {
    const section = sections[fileIndex]!
    const lines = section.split("\n").map(line => line.replace(/\r$/, ""))
    const headers = lines.filter(line => line.startsWith("@@ "))
    const metadata = file.metadata
    const path = file.path ?? metadata.name
    if (headers.length !== metadata.hunks.length) malformed(`hunks in ${path} do not match the patch text`)
    let binary = false
    let data = false
    let hunk = false
    let copied = false
    let changed = headers.length > 0
    for (const [index, line] of lines.slice(1, lines.at(-1) === "" ? -1 : undefined).entries()) {
      if (data) continue
      if (line.startsWith("@@ ")) hunk = true
      else if (hunk ? /^[ +-]/.test(line) || line === "\\ No newline at end of file" : extendedHeader.test(line)) {
        if (!hunk && changeHeader.test(line)) {
          changed = true
          copied ||= line.startsWith("copy ")
        }
      } else if (!hunk && (line === "GIT binary patch" || /^Binary files .* differ$/.test(line))) {
        binary = changed = true
        data = line === "GIT binary patch"
      } else malformed(`unsupported line ${index + 2} in ${path}`)
    }
    if (!changed) malformed(`${path} has no file changes`)
    const hunks = metadata.hunks.map((hunk, index): PatchHunk => {
      const header = headers[index]!
      const range = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      const numbers = range?.slice(1).map(value => value === undefined ? 1 : Number(value))
      if (!numbers || numbers[0] !== hunk.deletionStart || numbers[1] !== hunk.deletionCount
        || numbers[2] !== hunk.additionStart || numbers[3] !== hunk.additionCount)
        malformed(`hunk ${index} in ${path} does not match the patch text`)
      return { index, header, oldStart: hunk.deletionStart, oldCount: hunk.deletionCount,
        newStart: hunk.additionStart, newCount: hunk.additionCount, additions: hunk.additionLines, deletions: hunk.deletionLines }
    })
    return {
      path, previousPath: file.previousPath ?? null, status: copied ? "copied" : fileStatus(metadata.type),
      additions: file.stats.additions, deletions: file.stats.deletions, binary,
      mode: metadata.mode ?? null, previousMode: metadata.prevMode ?? null, hunks, patch: section,
    }
  })
}
