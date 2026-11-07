import type { DiffContent, DiffTarget } from "../models"
import { repositoryPath, type RepositoryReference } from "./repository-target"
import { createRequestBudget } from "./request-budget"
import { githubTransport, type GitHubTransport } from "./transport"

// Keep parsing/row construction bounded before any native renderables are created.
export const MAX_DIFF_BYTES = 4 * 1024 * 1024

export function diffPath(repository: RepositoryReference, target: DiffTarget) {
  return `${repositoryPath(repository)}/${target.kind === "pull" ? `pulls/${target.number}` : `commits/${encodeURIComponent(target.sha)}`}`
}

export function createGitHubDiff(transport: GitHubTransport) {
  return async (repository: RepositoryReference, target: DiffTarget, signal: AbortSignal, filesOnly = false): Promise<DiffContent> => {
    const path = diffPath(repository, target)
    signal.throwIfAborted()
    const budget = createRequestBudget(signal)
    try {
      const options = { signal: budget.signal, budget, maxBytes: MAX_DIFF_BYTES, limitMessage: "Diff exceeds the 4 MiB viewing limit. Load the file list or open it on GitHub." }
      if (!filesOnly) {
        const revision = async () => {
          const value = JSON.parse(await transport.text(path, "application/vnd.github+json", {
            ...options, jq: "{head: .head.sha, base: .base.sha}",
          }))
          budget.signal.throwIfAborted()
          if (!/^[a-f\d]{40}$/i.test(value?.head ?? "") || !/^[a-f\d]{40}$/i.test(value?.base ?? ""))
            throw new Error("GitHub did not identify the PR diff commits. Refresh before reviewing.")
          budget.consumeItems(1)
          return { head: String(value.head).toLowerCase(), base: String(value.base).toLowerCase() }
        }
        const before = target.kind === "pull" ? await revision() : undefined
        const patch = await transport.text(path, "application/vnd.github.diff", options)
        budget.signal.throwIfAborted()
        if (Buffer.byteLength(patch) > MAX_DIFF_BYTES) throw new Error("Diff exceeds the 4 MiB viewing limit. Load the file list or open it on GitHub.")
        if (before) {
          const after = await revision()
          budget.signal.throwIfAborted()
          if (before.head !== after.head || before.base !== after.base)
            throw new Error("The PR changed while loading the diff. Refresh before reviewing.")
          return { kind: "patch", patch, headSha: before.head, baseSha: before.base }
        }
        return { kind: "patch", patch }
      }

      // An explicit degraded mode: absent patches are never represented as unchanged files.
      const files: Extract<DiffContent, { kind: "files" }>["files"] = []
      const seen = new Set<string>()
      for (let page = 1; page <= 30; page++) {
        budget.signal.throwIfAborted()
        const endpoint = `${path}${target.kind === "pull" ? "/files" : ""}?per_page=100&page=${page}`
        // Project in gh, not after buffering: a large patch must not also prevent
        // loading its small metadata-only fallback under the same stdout limit.
        const jq = `${target.kind === "pull" ? "." : ".files"} | map({filename, previous_filename, status, additions, deletions})`
        const entries = JSON.parse(await transport.text(endpoint, "application/vnd.github+json", { ...options, jq }))
        budget.signal.throwIfAborted()
        if (!Array.isArray(entries)) throw new Error("GitHub returned an invalid changed-file list")
        budget.consumeItems(entries.length)
        for (const entry of entries) {
          if (seen.has(entry.filename)) continue
          seen.add(entry.filename)
          files.push({ path: entry.filename, previousPath: entry.previous_filename, status: entry.status,
            additions: entry.additions, deletions: entry.deletions })
        }
        if (entries.length < 100) return { kind: "files", files, truncated: false }
      }
      return { kind: "files", files, truncated: true }
    } finally {
      budget.dispose()
    }
  }
}

export const loadGitHubDiff = createGitHubDiff(githubTransport)
