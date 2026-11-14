import { expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import { inlineDiffPage } from "../src/inline"
import { truncationWarning, type DiffLoader } from "../src/review"
import { commitDetailFixture, issueDetailFixture, issueCommentsFixture, pullContextFixture } from "./fixtures/github-data"

const unusedClient = createGitHubClient({
  async json() { throw new Error("Unexpected API call") },
  async text() { throw new Error("Unexpected API call") },
})

const head = commitDetailFixture.sha
const base = "b".repeat(40)
const pullFixture = { ...issueDetailFixture, body: "PR body \x9b.", merged: false, draft: false, baseBranch: "main", headBranch: "fix",
  headSha: head, baseSha: base, additions: 3, deletions: 2, changedFiles: 2, commitCount: 1, reviewers: [], mergeable: true }
const thread = (id: string, path: string) => ({ kind: "review-thread" as const, id, path, line: 12, isResolved: false, isOutdated: false,
  comments: [{ id: `${id}-comment`, author: "reviewer", authorAssociation: "MEMBER", body: `${id} body.`, createdAt: "2026-01-01",
    updatedAt: "2026-01-01", url: "https://github.com/owner/repo/pull/412", reviewId: 1 }] })
const pullPatch = "diff --git a/src/file.ts b/src/file.ts\nindex 1111111..2222222 100644\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1 +1,2 @@\n-```\n+```\n+\x1b[31mtext\n"
  + "diff --git a/old name.ts b/new name.ts\nsimilarity index 90%\nrename from old name.ts\nrename to new name.ts\n--- a/old name.ts\n+++ b/new name.ts\n@@ -3 +3 @@\n-a\n+b\n"

function pullReview(overrides: Partial<typeof unusedClient> = {}) {
  const calls = { diffs: [] as (boolean | undefined)[] }
  const client: typeof unusedClient = {
    ...unusedClient,
    issueKind: async () => "pull",
    pull: async () => pullFixture,
    issueComments: async () => ({ items: [issueCommentsFixture[0]!], hasMore: false }),
    issueTimeline: async () => ({ references: [], events: [{ kind: "review", event: "reviewed", id: "review:1",
      reviewId: 1, actor: "reviewer", createdAt: "2026-01-01", state: "approved", body: "Review body.", authorAssociation: "MEMBER",
      url: "https://github.com/owner/repo/pull/412", commitSha: head }] }),
    pullContext: async () => ({ ...pullContextFixture, threads: [thread("thread-1", "src/file.ts"), thread("thread-2", "old name.ts"),
      { ...thread("thread-3", "other.ts"), line: undefined, originalLine: 7, isResolved: true, isOutdated: true }] }),
    ...overrides,
  }
  const loadDiff: DiffLoader = async (repository, target, signal, filesOnly) => {
    calls.diffs.push(filesOnly)
    expect(repository).toBe("owner/repo")
    expect(target).toEqual({ kind: "pull", number: 412 })
    expect(signal.aborted).toBe(false)
    return { kind: "patch", patch: pullPatch, headSha: head, baseSha: base }
  }
  return { client, loadDiff, calls }
}

const launch = { initialDetail: { kind: "number" as const, number: 412 } }

test("inline diffs keep PR context, mark outdated threads, and append validated, file-filtered patches", async () => {
  const { client, loadDiff, calls } = pullReview()
  const output = await inlineDiffPage("owner/repo", { ...launch, inline: true, diff: true }, client, loadDiff)
  expect(calls.diffs).toEqual([false])
  for (const text of ["PR body .", "## Review: approved", "## src/file.ts:12\n", "thread-1 body.", "## other.ts:7 (resolved, outdated)\n"])
    expect(output).toContain(text)
  expect(output).toEndWith(`## Diff\n\nhead ${head} · base ${base}\n\n\`\`\`\`diff\n${pullPatch.replace("\x1b", "")}\`\`\`\`\n`)

  const filtered = await inlineDiffPage("owner/repo", { ...launch, diff: true, file: "new name.ts" }, client, loadDiff)
  for (const text of [issueCommentsFixture[0]!.body, "Review body.", "thread-2 body.", "rename to new name.ts"]) expect(filtered).toContain(text)
  for (const text of ["thread-1 body.", "thread-3 body.", "src/file.ts"]) expect(filtered).not.toContain(text)

  await expect(inlineDiffPage("owner/repo", { ...launch, diff: true, file: "old name.ts" }, client, loadDiff)).rejects.toThrow("No changed file matches")
  await expect(inlineDiffPage("owner/repo", { ...launch, diff: true }, client, async () => ({ kind: "patch", patch: pullPatch, headSha: "c".repeat(40), baseSha: base })))
    .rejects.toThrow("The PR changed")
  await expect(inlineDiffPage("owner/repo", { ...launch, diff: true }, { ...client, pullContext: async () => ({ ...pullContextFixture,
    readiness: { ...pullContextFixture.readiness, headSha: "c".repeat(40) } }) }, loadDiff)).rejects.toThrow("The PR changed")
  await expect(inlineDiffPage("owner/repo", { ...launch, diff: true }, { ...client, pull: async () => ({ ...pullFixture, changedFiles: 3 }) }, loadDiff))
    .rejects.toThrow("covers 2 files, but GitHub reports 3")
  const shortPatch = pullPatch.replace("@@ -1 +1,2 @@\n-```\n+```\n+\x1b[31mtext\n", "@@ -1 +1 @@\n-```\n+```\n")
  await expect(inlineDiffPage("owner/repo", { ...launch, diff: true }, client, async () => ({ kind: "patch", patch: shortPatch, headSha: head, baseSha: base })))
    .rejects.toThrow("+2 −2, but GitHub reports +3 −2")
  await expect(inlineDiffPage("owner/repo", { ...launch, diff: true }, { ...client, issueComments: async () => ({ items: [], hasMore: true }) }, loadDiff))
    .rejects.toThrow("page limit")
})

const commitPatch = "diff --git a/src/input.ts b/src/input.ts\nindex 1111111..2222222 100644\n--- a/src/input.ts\n+++ b/src/input.ts\n@@ -1 +1 @@\n-a\n+b\n"
  + "diff --git a/test/keys.test.ts b/test/input.test.ts\nsimilarity index 100%\nrename from test/keys.test.ts\nrename to test/input.test.ts\n"

test("commit diffs use the resolved SHA and reject unavailable or incomplete patches", async () => {
  const requests: [string, number | undefined][] = []
  const [first, second] = commitDetailFixture.files.items
  const client: typeof unusedClient = { ...unusedClient, commit: async (_repository, sha, page) => {
    requests.push([sha, page])
    return { ...commitDetailFixture, additions: 1, deletions: 1, files: page === 2 ? { items: [second!], page: 2, hasMore: false } : { items: [first!], page: 1, hasMore: true } }
  } }
  const commitLaunch = { diff: true, initialDetail: { kind: "commit" as const, sha: "abc1234" } }
  const loadDiff: DiffLoader = async (_repository, target) => {
    expect(target).toEqual({ kind: "commit", sha: commitDetailFixture.sha })
    return { kind: "patch", patch: commitPatch }
  }
  const output = await inlineDiffPage("owner/repo", commitLaunch, client, loadDiff)
  expect(requests).toEqual([["abc1234", undefined], [commitDetailFixture.sha, 2]])
  expect(output).toContain(commitDetailFixture.fullMessage)
  expect(output).toContain("renamed test/input.test.ts")
  expect(output).toEndWith(`## Diff\n\n\`\`\`diff\n${commitPatch}\`\`\`\n`)

  const truncated: typeof unusedClient = { ...unusedClient, commit: async () => ({ ...commitDetailFixture, additions: 1, deletions: 1, filesTruncated: true,
    files: { items: [first!], page: 1, hasMore: false } }) }
  const beyond = await inlineDiffPage("owner/repo", { ...commitLaunch, file: "test/input.test.ts" }, truncated, loadDiff)
  expect(beyond).toContain(`## Files\n\nrenamed test/input.test.ts (+0 −0)\n\nWarning: ${truncationWarning}`)

  const onePatch = async () => ({ kind: "patch" as const, patch: commitPatch.slice(0, commitPatch.indexOf("diff --git a/test")) })
  await expect(inlineDiffPage("owner/repo", commitLaunch, client, onePatch)).rejects.toThrow("covers 1 files, but GitHub reports 2")
  await expect(inlineDiffPage("owner/repo", commitLaunch, client, async () => ({ kind: "files", files: [], truncated: false })))
    .rejects.toThrow("patch is unavailable")
})

test("diffs reject numbers that resolve to issues", async () => {
  const client = { ...unusedClient, issueKind: async () => "issue" as const }
  await expect(inlineDiffPage("owner/repo", { diff: true, ...launch }, client)).rejects.toThrow("--diff requires a PR or commit target")
})

test("TTY output keeps the screen renderer by default but prints diffs as text", async () => {
  const script = `
    import { mock } from "bun:test"
    mock.module(${JSON.stringify(new URL("../src/github/repository.ts", import.meta.url).pathname)}, () => ({ resolveRepository: async () => "owner/repo" }))
    mock.module(${JSON.stringify(new URL("../src/github/client.ts", import.meta.url).pathname)}, () => ({ createGitHubClient: () => ({ commit: async () => (${JSON.stringify({ ...commitDetailFixture, additions: 1, deletions: 1 })}) }) }))
    mock.module(${JSON.stringify(new URL("../src/github/diff.ts", import.meta.url).pathname)}, () => ({ loadGitHubDiff: async () => ({ kind: "patch", patch: ${JSON.stringify(commitPatch)} }) }))
    mock.module(${JSON.stringify(new URL("../src/inline-screen.tsx", import.meta.url).pathname)}, () => ({ renderInlineScreen: async () => "SCREEN\\n" }))
    Object.defineProperty(process.stdout, "isTTY", { value: true })
    const { printInline } = await import(${JSON.stringify(new URL("../src/inline.ts", import.meta.url).pathname)})
    const initialDetail = { kind: "commit", sha: "abc1234" }
    await printInline({ inline: true, initialDetail }, process.cwd())
    await printInline({ inline: true, diff: true, initialDetail }, process.cwd())
  `
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(error).toBe("")
  expect(code).toBe(0)
  expect(output).toStartWith("SCREEN\n# owner/repo")
  expect(output).toEndWith(`## Diff\n\n\`\`\`diff\n${commitPatch}\`\`\`\n`)
  expect(output.match(/SCREEN/g)).toHaveLength(1)
})
