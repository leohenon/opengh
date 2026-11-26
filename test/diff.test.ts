import { expect, spyOn, test } from "bun:test"
import { createGitHubDiff, MAX_DIFF_BYTES } from "../src/github/diff"
import { createRequestBudget, type RequestBudget } from "../src/github/request-budget"
import type { GitHubTransport } from "../src/github/transport"
import { parseDiff } from "../src/ui/diff-model"
import { MAX_PATCH_LINES, parsePatchFiles } from "../src/patch-files"

import { patchFixture } from "./fixtures/diff"

function transport(text: GitHubTransport["text"]): GitHubTransport {
  return {
    json: async () => {
      throw new Error("Unexpected JSON request")
    },
    text,
  }
}

test("diff requests use authenticated API media types and preserve PR/commit identities", async () => {
  const calls: Array<[string, string | undefined]> = []
  const load = createGitHubDiff(
    transport(async (path, accept, options) => {
      calls.push([path, accept])
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      expect(options?.budget).toBeDefined()
      expect(options?.signal).toBe(options?.budget?.signal)
      expect(options?.signal?.aborted).toBe(false)
      expect(options?.maxBytes).toBe(MAX_DIFF_BYTES)
      return accept === "application/vnd.github+json" ? JSON.stringify({ head: "a".repeat(40), base: "b".repeat(40) }) : patchFixture
    }),
  )
  const signal = new AbortController().signal
  expect(await load("base/private", { kind: "pull", number: 42 }, signal)).toEqual({
    kind: "patch",
    patch: patchFixture,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
  })
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

test("comparison diffs load the patch, or a single file list, for encoded branch names", async () => {
  const calls: Array<[string, string | undefined, string | undefined]> = []
  let files: unknown[] = [{ filename: "a.ts", status: "modified", additions: 1, deletions: 2 }]
  const load = createGitHubDiff(
    transport(async (path, accept, options) => {
      calls.push([path, accept, options?.jq])
      return accept === "application/vnd.github.diff" ? patchFixture : JSON.stringify(files)
    }),
  )
  const signal = new AbortController().signal
  const target = { kind: "compare" as const, base: "main", head: "feature/x" }
  expect(await load("owner/repo", target, signal)).toEqual({ kind: "patch", patch: patchFixture })
  expect(await load("owner/repo", target, signal, true)).toEqual({
    kind: "files",
    files: [{ path: "a.ts", previousPath: undefined, status: "modified", additions: 1, deletions: 2 }],
    truncated: false,
  })
  files = Array.from({ length: 300 }, (_, index) => ({ filename: `${index}.ts`, status: "added", additions: 1, deletions: 0 }))
  expect(await load("owner/repo", target, signal, true)).toMatchObject({ kind: "files", truncated: true })
  expect(calls.map(([path, accept]) => [path, accept])).toEqual([
    ["repos/owner/repo/compare/main...feature%2Fx", "application/vnd.github.diff"],
    ["repos/owner/repo/compare/main...feature%2Fx", "application/vnd.github+json"],
    ["repos/owner/repo/compare/main...feature%2Fx", "application/vnd.github+json"],
  ])
  expect(calls[1]![2]).toContain(".files")
})

test("PR range diffs pin the URL's head instead of fetching the current PR patch", async () => {
  const base = "b".repeat(40)
  const head = "c".repeat(40)
  const calls: string[] = []
  const load = createGitHubDiff(
    transport(async (path, accept, options) => {
      calls.push(path)
      if (path.endsWith("/pulls/8")) {
        expect(options?.jq).toBe("{base: .base.sha}")
        return JSON.stringify({ base, head: "d".repeat(40) })
      }
      if (options?.jq?.includes("merge_base_commit")) return JSON.stringify({ mergeBase: "e".repeat(40) })
      if (accept === "application/vnd.github.diff") return patchFixture
      return JSON.stringify([{ filename: "example.ts", status: "modified", additions: 1, deletions: 1 }])
    }),
  )
  const signal = new AbortController().signal
  const target = { kind: "compare" as const, base: "BASE", head, pullNumber: 8 }
  expect(await load("owner/repo", target, signal)).toEqual({ kind: "patch", patch: patchFixture })
  expect(await load("owner/repo", target, signal, true)).toMatchObject({ kind: "files", files: [{ path: "example.ts" }] })
  await expect(load("owner/repo", { ...target, base }, signal)).rejects.toThrow("cannot show this exact commit range")
  const comparison = `repos/owner/repo/compare/${base}...${head}`
  expect(calls).toEqual(["repos/owner/repo/pulls/8", comparison, "repos/owner/repo/pulls/8", comparison, `${comparison}?per_page=1`])
})

test("degraded file listings paginate without pretending absent patches are unchanged", async () => {
  const paths: string[] = []
  let fullPages = false
  let budget: RequestBudget | undefined
  const load = createGitHubDiff(
    transport(async (path, _accept, options) => {
      expect(options?.jq).toBe(". | map({filename, previous_filename, status, additions, deletions})")
      expect(options?.budget).toBeDefined()
      if (budget) expect(options?.budget).toBe(budget)
      budget = options?.budget
      paths.push(path)
      const files = Array.from({ length: fullPages || path.endsWith("page=1") ? 100 : 1 }, (_, index) => ({
        filename: `${paths.length}-${index}.txt`,
        status: "modified",
        additions: 1,
        deletions: 1,
      }))
      return JSON.stringify(files)
    }),
  )
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
      const load = createGitHubDiff(
        transport(async (_path, _accept, options) => {
          const budget = options?.budget
          if (!budget) throw new Error("Missing diff budget")
          expect(options?.signal).toBe(budget.signal)
          if (shared) expect(budget).toBe(shared)
          shared = budget
          budget.takeRequest()
          if (++requests < 3)
            return JSON.stringify(
              Array.from({ length: 100 }, (_, index) => ({
                filename: `${requests}-${index}.txt`,
                status: "modified",
                additions: 1,
                deletions: 1,
              })),
            )
          return new Promise<string>((_resolve, reject) => {
            budget.signal.addEventListener("abort", () => reject(budget.signal.reason), { once: true })
            if (reason === "deadline") {
              if (!expire) throw new Error("Missing 60-second deadline")
              expire() // Fire the real budget's deadline without waiting a minute.
            } else controller.abort(new Error("Cancelled by caller"))
          })
        }),
      )
      await expect(load("owner/repo", { kind: "pull", number: 1 }, controller.signal, true)).rejects.toThrow(
        reason === "deadline" ? "60 second limit" : "Cancelled by caller",
      )
      expect(requests).toBe(3)
      expect(deadlines - before).toBe(1)
      expect(controller.signal.aborted).toBe(reason === "cancel")
    }
    const before = deadlines
    const budget = createRequestBudget()
    const seen: RequestBudget[] = []
    const load = createGitHubDiff(
      transport(async (_path, _accept, options) => {
        seen.push(options!.budget!)
        return JSON.stringify([{ filename: "a.txt", status: "modified", additions: 1, deletions: 1 }])
      }),
    )
    await load("owner/repo", { kind: "pull", number: 1 }, budget.signal, true, budget)
    expect(seen).toEqual([budget])
    expect(deadlines).toBe(before + 1)
    expect(budget.signal.aborted).toBe(false)
    budget.dispose()
  } finally {
    timers.mockRestore()
  }
})

test("object targets keep patches and degraded files on A after name reuse", async () => {
  const paths: string[] = []
  const load = createGitHubDiff(
    transport(async (path, accept) => {
      paths.push(path)
      return accept === "application/vnd.github.diff"
        ? "A patch"
        : !path.includes("?")
          ? JSON.stringify({ head: "a".repeat(40), base: "b".repeat(40) })
          : "[]"
    }),
  )
  const repository = { id: 71, nodeId: "R_A", nameWithOwner: "owner/repo" }
  const signal = new AbortController().signal
  expect(await load(repository, { kind: "pull", number: 42 }, signal)).toEqual({
    kind: "patch",
    patch: "A patch",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
  })
  await load(repository, { kind: "pull", number: 42 }, signal, true)
  await load(repository, { kind: "commit", sha: "abc" }, signal, true)
  expect(paths).toEqual([
    "repositories/71/pulls/42",
    "repositories/71/pulls/42",
    "repositories/71/pulls/42",
    "repositories/71/pulls/42/files?per_page=100&page=1",
    "repositories/71/commits/abc?per_page=100&page=1",
  ])
  await expect(load({ ...repository, id: 0 }, { kind: "pull", number: 42 }, signal)).rejects.toThrow("Repository ID")
  expect(paths).toHaveLength(5)
})

test("Hunk adapter preserves metadata-only changes and reports malformed hunks", () => {
  const patch =
    patchFixture +
    `diff --git a/old.txt b/new.txt
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
    const load = createGitHubDiff(
      transport(async (_path, accept) => {
        if (accept === "application/vnd.github.diff") return patchFixture
        const refs = { head: "a".repeat(40), base: "b".repeat(40) }
        if (++reads === 2) refs[changed as "head" | "base"] = "c".repeat(40)
        return JSON.stringify(refs)
      }),
    )
    await expect(load("owner/repo", { kind: "pull", number: 42 }, new AbortController().signal)).rejects.toThrow("changed while loading")
  }
})

test("agent patch files keep original sections with Hunk paths and hunk metadata", () => {
  const sections = [
    'diff --git "a/dir/sp ace \\303\\251.txt" "b/dir/sp ace \\303\\251.txt"\r\nindex 1111111..2222222 100644\r\n--- "a/dir/sp ace \\303\\251.txt"\r\n+++ "b/dir/sp ace \\303\\251.txt"\r\n@@ -1,2 +1,2 @@ ctx\r\n-\x1b[31mold\x9b\r\n+new  \r\n \r\n@@ -10,0 +11 @@\r\n+added\r\n',
    "diff --git a/old name.ts b/new name.ts\nsimilarity index 90%\nrename from old name.ts\nrename to new name.ts\nindex 3333333..4444444 100644\n--- a/old name.ts\n+++ b/new name.ts\n@@ -3 +3 @@\n-a\n+b\n",
    "diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\nindex 5555555..0000000\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n\\ No newline at end of file\n",
    "diff --git a/img.png b/img.png\nindex 6666666..7777777 100644\nBinary files a/img.png and b/img.png differ\n",
    "diff --git a/mode.sh b/mode.sh\nold mode 100644\nnew mode 100755\n",
    "diff --git a/a b/b\nsimilarity index 100%\ncopy from a\ncopy to b\n",
    "diff --git a/empty b/empty\nnew file mode 100644\nindex 0000000..e69de29\n",
  ]
  const files = parsePatchFiles(sections.join(""))
  expect(files.map((file) => file.patch)).toEqual(sections)
  expect(files.map(({ patch: _patch, hunks: _hunks, ...file }) => file)).toEqual([
    {
      path: "dir/sp ace é.txt",
      previousPath: null,
      status: "modified",
      additions: 2,
      deletions: 1,
      binary: false,
      mode: "100644",
      previousMode: null,
    },
    {
      path: "new name.ts",
      previousPath: "old name.ts",
      status: "renamed",
      additions: 1,
      deletions: 1,
      binary: false,
      mode: "100644",
      previousMode: null,
    },
    {
      path: "gone.ts",
      previousPath: null,
      status: "removed",
      additions: 0,
      deletions: 1,
      binary: false,
      mode: "100644",
      previousMode: null,
    },
    {
      path: "img.png",
      previousPath: null,
      status: "modified",
      additions: 0,
      deletions: 0,
      binary: true,
      mode: "100644",
      previousMode: null,
    },
    {
      path: "mode.sh",
      previousPath: null,
      status: "modified",
      additions: 0,
      deletions: 0,
      binary: false,
      mode: "100755",
      previousMode: "100644",
    },
    { path: "b", previousPath: "a", status: "copied", additions: 0, deletions: 0, binary: false, mode: null, previousMode: null },
    { path: "empty", previousPath: null, status: "added", additions: 0, deletions: 0, binary: false, mode: "100644", previousMode: null },
  ])
  expect(files[0]!.hunks).toEqual([
    { index: 0, header: "@@ -1,2 +1,2 @@ ctx", oldStart: 1, oldCount: 2, newStart: 1, newCount: 2, additions: 1, deletions: 1 },
    { index: 1, header: "@@ -10,0 +11 @@", oldStart: 10, oldCount: 0, newStart: 11, newCount: 1, additions: 1, deletions: 0 },
  ])
  expect(files[2]!.hunks[0]).toMatchObject({ oldStart: 1, oldCount: 1, newStart: 0, newCount: 0 })
})

test("agent patch parsing rejects unsupported or desynchronized sections", () => {
  const file = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n"
  for (const patch of [
    "diff --cc a\n",
    `preamble\n${file}`,
    "diff --git a/a b/a\n",
    "diff --git a/a b/a\nnot a diff\n",
    "diff --git a/a b/a\nindex 1111111..2222222 100644\n",
    "diff --git a/a b/a\n--- a/a\n+++ b/a\n",
    `${file}\\ invalid marker\n`,
    `${file}trailing\n`,
    `${file}\x1b[0m${file}`,
    "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,3 +1 @@\n-x\n+y\n",
    file + "\n".repeat(MAX_PATCH_LINES),
  ])
    expect(() => parsePatchFiles(patch)).toThrow()
  expect(parsePatchFiles("")).toEqual([])
})
