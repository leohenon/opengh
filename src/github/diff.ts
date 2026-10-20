import type { DiffContent, DiffTarget } from "../models"
import { githubTransport, type GitHubTransport } from "./transport"

// Keep parsing/row construction bounded before any native renderables are created.
export const MAX_DIFF_BYTES = 4 * 1024 * 1024

export function diffPath(repository: string, target: DiffTarget) {
  return `repos/${repository}/${target.kind === "pull" ? `pulls/${target.number}` : `commits/${encodeURIComponent(target.sha)}`}`
}

export function createGitHubDiff(transport: GitHubTransport) {
  return async (repository: string, target: DiffTarget, signal: AbortSignal, filesOnly = false): Promise<DiffContent> => {
    const path = diffPath(repository, target)
    const options = { signal, maxBytes: MAX_DIFF_BYTES }
    if (!filesOnly) {
      const patch = await transport.text(path, "application/vnd.github.diff", options)
      signal.throwIfAborted()
      if (Buffer.byteLength(patch) > MAX_DIFF_BYTES) throw new Error("Diff exceeds the 4 MiB viewing limit. Load the file list or open it on GitHub.")
      return { kind: "patch", patch }
    }

    // An explicit degraded mode: absent patches are never represented as unchanged files.
    const files: Extract<DiffContent, { kind: "files" }>["files"] = []
    const seen = new Set<string>()
    for (let page = 1; page <= 30; page++) {
      signal.throwIfAborted()
      const endpoint = `${path}${target.kind === "pull" ? "/files" : ""}?per_page=100&page=${page}`
      // Project in gh, not after buffering: a large patch must not also prevent
      // loading its small metadata-only fallback under the same stdout limit.
      const jq = `${target.kind === "pull" ? "." : ".files"} | map({filename, previous_filename, status, additions, deletions})`
      const entries = JSON.parse(await transport.text(endpoint, "application/vnd.github+json", { ...options, jq }))
      signal.throwIfAborted()
      if (!Array.isArray(entries)) throw new Error("GitHub returned an invalid changed-file list")
      for (const entry of entries) {
        if (seen.has(entry.filename)) continue
        seen.add(entry.filename)
        files.push({ path: entry.filename, previousPath: entry.previous_filename, status: entry.status,
          additions: entry.additions, deletions: entry.deletions })
      }
      if (entries.length < 100) return { kind: "files", files, truncated: false }
    }
    return { kind: "files", files, truncated: true }
  }
}

export const loadGitHubDiff = createGitHubDiff(githubTransport)
