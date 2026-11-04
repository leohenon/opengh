import { expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import { inlinePage } from "../src/inline"
import { issueDetailFixture, issueCommentsFixture, pullContextFixture } from "./fixtures/github-data"

const unusedClient = createGitHubClient({
  async json() { throw new Error("Unexpected API call") },
  async text() { throw new Error("Unexpected API call") },
})

test("inline prints the full body and every comment page without UI controls", async () => {
  const pages: number[] = []
  const body = "A long paragraph.\n".repeat(200)
  const output = await inlinePage("owner/repo", { initialDetail: { kind: "number", number: 412 } }, {
    ...unusedClient,
    issueKind: async () => "issue",
    issue: async () => ({ ...issueDetailFixture, body }),
    issueComments: async (_repository, _number, page = 1) => {
      pages.push(page)
      return { items: [issueCommentsFixture[page - 1]!], hasMore: page === 1 }
    },
  })
  expect(pages).toEqual([1, 2])
  expect(output).toContain(body.trim())
  expect(output).toContain(issueCommentsFixture[0]!.body)
  expect(output).toContain(issueCommentsFixture[1]!.body)
  expect(output).not.toContain("\x1b")
  expect(output).not.toContain("full app")
})

test("inline PR output includes its description, reviews, and review thread bodies", async () => {
  const output = await inlinePage("owner/repo", { initialDetail: { kind: "number", number: 412 } }, {
    ...unusedClient,
    issueKind: async () => "pull",
    pull: async () => ({ ...issueDetailFixture, merged: false, draft: false, baseBranch: "main", headBranch: "fix",
      additions: 1, deletions: 0, changedFiles: 1, commitCount: 1, reviewers: [], mergeable: true }),
    issueComments: async () => ({ items: [], hasMore: false }),
    issueTimeline: async () => ({ references: [], events: [{ kind: "review", event: "reviewed", id: "review-1",
      reviewId: 1, actor: "reviewer", createdAt: "2026-01-01", state: "approved", body: "Review body.", authorAssociation: "MEMBER", url: "https://github.com/owner/repo/pull/412" }] }),
    pullContext: async () => ({ ...pullContextFixture, threads: [{ kind: "review-thread", id: "thread-1", path: "src/file.ts",
      line: 12, isResolved: false, isOutdated: false, comments: [{ id: "comment-1", author: "reviewer", authorAssociation: "MEMBER",
        body: "Full thread body.", createdAt: "2026-01-01", updatedAt: "2026-01-01", url: "https://github.com/owner/repo/pull/412" }] }] }),
  })
  expect(output).toContain(issueDetailFixture.body)
  expect(output).toContain("Review body.")
  expect(output).toContain("src/file.ts:12")
  expect(output).toContain("Full thread body.")
})
