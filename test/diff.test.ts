import { expect, spyOn, test } from "bun:test"
import { createGitHubDiff, MAX_DIFF_BYTES } from "../src/github/diff"
import type { GitHubTransport } from "../src/github/transport"
import { parseDiff } from "../src/ui/diff-model"

import { patchFixture } from "./fixtures/diff"

function transport(text: GitHubTransport["text"]): GitHubTransport {
  return { json: async () => { throw new Error("Unexpected JSON request") }, text }
}

test("diff requests use authenticated API media types and preserve PR/commit identities", async () => {
  const calls: Array<[string, string | undefined]> = []
  const load = createGitHubDiff(transport(async (path, accept, options) => {
    calls.push([path, accept])
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    expect(options?.signal?.aborted).toBe(false)
    expect(options?.maxBytes).toBe(MAX_DIFF_BYTES)
    return accept === "application/vnd.github+json" ? JSON.stringify({ head: "a".repeat(40), base: "b".repeat(40) }) : patchFixture
  }))
  const signal = new AbortController().signal
  expect(await load("base/private", { kind: "pull", number: 42 }, signal)).toEqual({ kind: "patch", patch: patchFixture, headSha: "a".repeat(40), baseSha: "b".repeat(40) })
  await load("owner/repo", { kind: "commit", sha: "abc123" }, signal)
  expect(calls).toEqual([
    ["repos/base/private/pulls/42", "application/vnd.github+json"],
    ["repos/base/private/pulls/42", "application/vnd.github.diff"],
    ["repos/base/private/pulls/42", "application/vnd.github+json"],
    ["repos/owner/repo/commits/abc123", "application/vnd.github.diff"],
  ])
  const cancelled = new AbortController()
  cancelled.abort()
  await expect(load("owner/repo", { kind: "commit", sha: "abc" }, cancelled.signal)).rejects.toThrow()
})

test("degraded file listings paginate without pretending absent patches are unchanged", async () => {
  const paths: string[] = []
  const load = createGitHubDiff(transport(async (path, _accept, options) => {
    expect(options?.jq).toBe(". | map({filename, previous_filename, status, additions, deletions})")
    paths.push(path)
    const files = Array.from({ length: path.endsWith("page=1") ? 100 : 1 }, (_, index) => ({
      filename: `${paths.length}-${index}.txt`, status: "modified", additions: 1, deletions: 1,
    }))
    return JSON.stringify(files)
  }))
  const result = await load("owner/repo", { kind: "pull", number: 1 }, new AbortController().signal, true)
  expect(result.kind).toBe("files")
  if (result.kind !== "files") throw new Error("Expected file list")
  expect(result.files).toHaveLength(101)
  expect(result.truncated).toBe(false)
  expect(paths[1]).toEndWith("/files?per_page=100&page=2")
  expect(parseDiff(result).notice).toContain("patches unavailable")
})

test("file-list pages share a deadline and preserve caller cancellation", async () => {
  for (const cancel of ["deadline", "caller"]) {
    const deadline = new AbortController()
    const caller = new AbortController()
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal)
    const reason = new DOMException("Diff load timed out", "TimeoutError")
    const signals: AbortSignal[] = []
    try {
      const load = createGitHubDiff(transport(async (_path, _accept, options) => {
        const signal = options!.signal!
        signals.push(signal)
        if (signals.length === 1)
          return JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ filename: `${index}.txt` })))
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
          const controller = cancel === "deadline" ? deadline : caller
          controller.abort(reason)
        })
      }))
      await expect(load("owner/repo", { kind: "pull", number: 1 }, caller.signal, true)).rejects.toBe(reason)
      expect(timeout).toHaveBeenCalledTimes(1)
      expect(timeout).toHaveBeenCalledWith(60_000)
      expect(signals).toHaveLength(2)
      expect(signals[1]).toBe(signals[0])
      expect(signals[1]?.aborted).toBe(true)
    } finally {
      timeout.mockRestore()
    }
  }
})

test("Hunk adapter preserves metadata-only changes and reports malformed hunks", () => {
  const patch = patchFixture + `diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
diff --git a/image.png b/image.png
index 1111111..2222222 100644
Binary files a/image.png and b/image.png differ
`
  const parsed = parseDiff({ kind: "patch", patch })
  expect(parsed.error).toBeUndefined()
  expect(parsed.files).toHaveLength(4)
  expect(parsed.files[0]?.body?.metadata.hunks).toHaveLength(1)
  expect(parsed.files[0]?.body?.language).toBe("typescript")
  expect(parsed.files[1]?.previousPath).toBe("old.txt")
  expect(parsed.files[1]?.message).toContain("Renamed")
  expect(parsed.files[2]?.message).toContain("100644 → 100755")
  expect(parsed.files[3]?.message).toContain("Binary")
  expect(parseDiff({ kind: "patch", patch: patchFixture.replace("@@ -1 +1 @@", "@@ -1,8 +1,8 @@") }).error).toContain("Cannot render")
  expect(parseDiff({ kind: "patch", patch: "" }).files).toEqual([])
})

 test("PR diffs reject a changing head or base rather than attaching review comments to stale lines", async () => {
  for (const changed of ["head", "base"]) {
    let reads = 0
    const load = createGitHubDiff(transport(async (_path, accept) => {
      if (accept === "application/vnd.github.diff") return patchFixture
      const refs = { head: "a".repeat(40), base: "b".repeat(40) }
      if (++reads === 2) refs[changed as "head" | "base"] = "c".repeat(40)
      return JSON.stringify(refs)
    }))
    await expect(load("owner/repo", { kind: "pull", number: 42 }, new AbortController().signal)).rejects.toThrow("changed while loading")
  }
})
