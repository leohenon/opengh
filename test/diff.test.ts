import { expect, spyOn, test } from "bun:test"
import { createGitHubDiff, MAX_DIFF_BYTES } from "../src/github/diff"
import type { RequestBudget } from "../src/github/request-budget"
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
    expect(options?.budget).toBeDefined()
    expect(options?.signal).toBe(options?.budget?.signal)
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
  expect(signal.aborted).toBe(false)
  const cancelled = new AbortController()
  cancelled.abort()
  await expect(load("owner/repo", { kind: "commit", sha: "abc" }, cancelled.signal)).rejects.toThrow()
  expect(calls).toHaveLength(4)
})

test("degraded file listings paginate without pretending absent patches are unchanged", async () => {
  const paths: string[] = []
  let fullPages = false
  let budget: RequestBudget | undefined
  const load = createGitHubDiff(transport(async (path, _accept, options) => {
    expect(options?.jq).toBe(". | map({filename, previous_filename, status, additions, deletions})")
    expect(options?.budget).toBeDefined()
    if (budget) expect(options?.budget).toBe(budget)
    budget = options?.budget
    paths.push(path)
    const files = Array.from({ length: fullPages || path.endsWith("page=1") ? 100 : 1 }, (_, index) => ({
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
  expect(budget?.signal.aborted).toBe(true) // Successful loads dispose their budget too.

  fullPages = true
  paths.length = 0
  budget = undefined
  const capped = await load("owner/repo", { kind: "pull", number: 1 }, new AbortController().signal, true)
  if (capped.kind !== "files") throw new Error("Expected file list")
  expect(capped.files).toHaveLength(3000)
  expect(capped.truncated).toBe(true)
  expect(paths).toHaveLength(30)
  expect(paths.at(-1)).toEndWith("/files?per_page=100&page=30")
})

test("one diff deadline spans every page and caller cancellation still aborts in-flight reads", async () => {
  const originalSetTimeout = globalThis.setTimeout
  let expire: (() => void) | undefined
  let deadlines = 0
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((...parameters: Parameters<typeof globalThis.setTimeout>) => {
    const [handler, delay, ...args] = parameters
    const timer = originalSetTimeout(...parameters)
    if (delay === 60_000 && typeof handler === "function") {
      deadlines++
      expire = () => handler(...args)
    }
    return timer
  }) as typeof globalThis.setTimeout)
  try {
    for (const reason of ["deadline", "cancel"] as const) {
      const controller = new AbortController()
      const before = deadlines
      let requests = 0
      let shared: RequestBudget | undefined
      const load = createGitHubDiff(transport(async (_path, _accept, options) => {
        const budget = options?.budget
        if (!budget) throw new Error("Missing diff budget")
        expect(options?.signal).toBe(budget.signal)
        if (shared) expect(budget).toBe(shared)
        shared = budget
        budget.takeRequest()
        if (++requests < 3) return JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
          filename: `${requests}-${index}.txt`, status: "modified", additions: 1, deletions: 1,
        })))
        return new Promise<string>((_resolve, reject) => {
          budget.signal.addEventListener("abort", () => reject(budget.signal.reason), { once: true })
          if (reason === "deadline") {
            if (!expire) throw new Error("Missing 60-second deadline")
            expire() // Fire the real budget's deadline without waiting a minute.
          } else controller.abort(new Error("Cancelled by caller"))
        })
      }))
      await expect(load("owner/repo", { kind: "pull", number: 1 }, controller.signal, true))
        .rejects.toThrow(reason === "deadline" ? "60 second limit" : "Cancelled by caller")
      expect(requests).toBe(3)
      expect(deadlines - before).toBe(1)
      expect(controller.signal.aborted).toBe(reason === "cancel")
    }
  } finally { timers.mockRestore() }
})

test("object targets keep patches and degraded files on A after name reuse", async () => {
  const paths: string[] = []
  const load = createGitHubDiff(transport(async (path, accept) => {
    paths.push(path)
    return accept === "application/vnd.github.diff" ? "A patch"
      : !path.includes("?") ? JSON.stringify({ head: "a".repeat(40), base: "b".repeat(40) }) : "[]"
  }))
  const repository = { id: 71, nodeId: "R_A", nameWithOwner: "owner/repo" }
  const signal = new AbortController().signal
  expect(await load(repository, { kind: "pull", number: 42 }, signal)).toEqual({ kind: "patch", patch: "A patch", headSha: "a".repeat(40), baseSha: "b".repeat(40) })
  await load(repository, { kind: "pull", number: 42 }, signal, true)
  await load(repository, { kind: "commit", sha: "abc" }, signal, true)
  expect(paths).toEqual(["repositories/71/pulls/42", "repositories/71/pulls/42", "repositories/71/pulls/42", "repositories/71/pulls/42/files?per_page=100&page=1", "repositories/71/commits/abc?per_page=100&page=1"])
  await expect(load({ ...repository, id: 0 }, { kind: "pull", number: 42 }, signal)).rejects.toThrow("Repository ID")
  expect(paths).toHaveLength(5)
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
