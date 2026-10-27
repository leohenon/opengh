import { expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import { parseTextReferences } from "../src/github/text-references"
import type { GitHubTransport } from "../src/github/transport"

const repository = "owner/repo"
const date = "2026-01-01T00:00:00Z"
const sha = "a1".repeat(20)

function transport(responses: Record<string, unknown>, paths: string[] = []): GitHubTransport {
  return {
    async json<T>(path: string) {
      paths.push(path)
      const value = responses[path]
      if (value === undefined || value instanceof Error) throw value ?? new Error(`Unexpected path: ${path}`)
      return value as T
    },
    async text() { return "" },
  }
}

const issue = (number: number) => ({ number, title: `Issue ${number}`, state: "closed", user: { login: "target" }, created_at: date })
const commit = (message: string) => ({
  sha, author: { login: "source" }, committer: null,
  commit: { message, author: { name: "Source", date } },
  stats: { additions: 1, deletions: 0 }, files: [],
})

test("parses qualified/local references, rejects ordinary words, and deduplicates case-insensitively", () => {
  expect(parseTextReferences(`Fix #12 OWNER/REPO#12 Other/Repo#13
https://github.com/other/repo/pull/13 https://github.com/owner/repo/issues/14
https://github.com/other/repo/commit/ABC1234 Other/Repo@abc1234
abc1234 deadbee 1234567 ${"f".repeat(40)} ${"a1".repeat(21)} wordabc1234`, repository)).toEqual([
    { kind: "issue", repository, number: 12 },
    { kind: "issue", repository: "other/repo", number: 13 },
    { kind: "issue", repository, number: 14 },
    { kind: "commit", repository: "other/repo", sha: "abc1234" },
    { kind: "commit", repository, sha: "abc1234" },
    { kind: "commit", repository, sha: "f".repeat(40) },
  ])
})

test("Markdown excludes code and comments but includes link destinations; commit text retains them", () => {
  const text = "#1 `#2` <!-- #3 -->\n```txt\n#4\n```\n~~~\n#5\n~~~\n[linked](https://github.com/other/repo/issues/6)"
  expect(parseTextReferences(text, repository, true).map(ref => ref.kind === "issue" && ref.number)).toEqual([1, 6])
  expect(parseTextReferences(text, repository).map(ref => ref.kind === "issue" && ref.number)).toEqual([1, 2, 3, 4, 5, 6])
})

test("pull descriptions resolve actual kinds and metadata, skip self, and tolerate failed targets", async () => {
  const paths: string[] = []
  const client = createGitHubClient(transport({
    "repos/owner/repo/pulls/1": {
      ...issue(1), user: { login: "source" }, body: "#1 #2 #3 #4 #5 `#6` abc1234", merged_at: null,
      html_url: "https://github.com/owner/repo/pull/1", updated_at: date,
      base: { ref: "main" }, head: { ref: "feature", repo: null }, labels: [], assignees: [], requested_reviewers: [], requested_teams: [],
    },
    "repos/owner/repo/issues/2": issue(2),
    "repos/owner/repo/issues/3": { ...issue(3), pull_request: { merged_at: date }, draft: false },
    "repos/owner/repo/issues/4": { ...issue(4), state: "open", pull_request: {}, draft: true },
    "repos/owner/repo/issues/5": new Error("private target"),
    "repos/owner/repo/commits/abc1234": { ...commit("Target title\n\n#999"), sha: `abc1234${"f".repeat(33)}` },
  }, paths))
  const detail = await client.pull(repository, 1)
  expect(detail.references).toMatchObject([
    { kind: "issue", number: 2, title: "Issue 2", state: "closed", actor: "source", createdAt: date },
    { kind: "pull", number: 3, merged: true, draft: false },
    { kind: "pull", number: 4, merged: false, draft: true },
    { kind: "commit", title: "Target title", sha: `abc1234${"f".repeat(33)}` },
  ])
  expect(paths).not.toContain("repos/owner/repo/issues/1")
  expect(paths).not.toContain("repos/owner/repo/issues/6")
  expect(paths).not.toContain("repos/owner/repo/issues/999")
})

test("commit full messages resolve all targets with bounded concurrency, skip self and subsequent pages", async () => {
  let active = 0
  let maximum = 0
  const paths: string[] = []
  const targetSha = `b2${"f".repeat(38)}`
  const client = createGitHubClient({
    async json<T>(path: string) {
      paths.push(path)
      if (path.includes("?per_page")) return commit(`Title\n\n${Array.from({ length: 15 }, (_, i) => `#${i + 1}`).join(" ")}\n\`#16\` ${sha.slice(0, 7)} ${sha} b2fffff ${targetSha}`) as T
      active++
      maximum = Math.max(maximum, active)
      await Promise.resolve()
      active--
      if (path.includes("/commits/")) return { ...commit("Referenced commit\n\n#999"), sha: targetSha } as T
      return issue(Number(path.split("/").at(-1))) as T
    },
    async text() { return "" },
  })
  const detail = await client.commit(repository, sha)
  expect(detail.references).toHaveLength(17)
  expect(detail.references?.[15]).toMatchObject({ kind: "issue", number: 16, actor: "source", createdAt: date })
  expect(detail.references?.[16]).toMatchObject({ kind: "commit", sha: targetSha })
  expect(maximum).toBeLessThanOrEqual(4)
  expect(paths).not.toContain(`repos/owner/repo/commits/${sha}`)
  expect(paths).not.toContain(`repos/owner/repo/commits/${sha.slice(0, 7)}`)
  const count = paths.length
  expect((await client.commit(repository, sha, 2)).references).toBeUndefined()
  expect(paths).toHaveLength(count + 1)
})
