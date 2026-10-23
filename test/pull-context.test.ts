import { expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"

test("PR context paginates threads, replies and checks without hiding data on project permission failures", async () => {
  const head = "a".repeat(40)
  const done = { hasNextPage: false, endCursor: null }
  const calls: string[] = []
  const comment = (id: string, replyTo?: string) => ({
    id, author: { login: "alice" }, authorAssociation: "MEMBER", body: `Comment ${id}`,
    createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-01T12:00:00Z",
    url: `https://github.com/owner/repo/pull/42#discussion_${id}`, pullRequestReview: { databaseId: 7 },
    replyTo: replyTo ? { id: replyTo } : null,
    viewerCanReact: true,
    reactionGroups: [{ content: "THUMBS_UP", users: { totalCount: 2 }, viewerHasReacted: true }],
  })
  const check = { __typename: "CheckRun", id: "check1", name: "build", status: "IN_PROGRESS", conclusion: null,
    detailsUrl: "https://github.com/owner/repo/actions/runs/1", isRequired: true }
  const client = createGitHubClient({
    async json<T>(): Promise<T> { throw new Error("Unexpected REST request") },
    async text() { return "" },
    async graphql<T>(query: string, variables: Record<string, string>) {
      const name = query.match(/query\s+(\w+)/)?.[1] ?? ""
      calls.push(name)
      const cursor = variables.cursor ?? variables.after
      const response = (pullRequest: unknown) => ({ data: { repository: { pullRequest } } }) as T
      if (name === "PullContext") return response({ headRefOid: head, isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED",
        milestone: { title: "Release", url: "https://github.com/owner/repo/milestone/1", dueOn: "2026-02-01T00:00:00Z" } })
      if (name === "PullThreads") return response({ headRefOid: head, reviewThreads: cursor ? {
        nodes: [{ id: "thread2", path: "old.ts", line: null, originalLine: 9, isResolved: true, isOutdated: true, resolvedBy: { login: "bob" },
          comments: { nodes: [comment("old")], pageInfo: done } }], pageInfo: done,
      } : {
        nodes: [{ id: "thread1", path: "src/index.ts", line: 12, originalLine: 12, isResolved: false, isOutdated: false, resolvedBy: null,
          comments: { nodes: [comment("root")], pageInfo: { hasNextPage: true, endCursor: "comments1" } } }],
        pageInfo: { hasNextPage: true, endCursor: "threads1" },
      } })
      if (name === "PullThreadComments") return { data: { node: { id: "thread1", comments: { nodes: [comment("root"), comment("reply", "root")], pageInfo: done } } } } as T
      if (name === "PullChecks") return response({ headRefOid: head, commits: { nodes: [{ commit: { oid: head, statusCheckRollup: { state: "PENDING", contexts: cursor ? {
        nodes: [check, { __typename: "StatusContext", id: "check2", context: "preview", state: "SUCCESS", targetUrl: "https://example.invalid/preview", isRequired: false }], pageInfo: done,
      } : { nodes: [check], pageInfo: { hasNextPage: true, endCursor: "checks1" } } } } }] } })
      if (name === "PullProjects") throw new Error("Projects require read:project scope")
      if (name === "PullClosingIssues") return response({ closingIssuesReferences: { nodes: [{ number: 9, title: "The linked bug", state: "OPEN",
        url: "https://github.com/other/repo/issues/9", repository: { nameWithOwner: "other/repo" } }], pageInfo: done } })
      throw new Error(`Unknown GraphQL query ${name}`)
    },
  })
  const context = await client.pullContext("owner/repo", 42)
  expect(context.threads).toHaveLength(2)
  expect(context.threads[0]?.comments.map((entry) => entry.id)).toEqual(["root", "reply"])
  expect(context.threads[0]?.comments[1]).toMatchObject({ replyToId: "root", reviewId: 7, reactions: { "+1": 2 }, viewerReactions: ["+1"], canReact: true })
  expect(context.threads[1]).toMatchObject({ isResolved: true, isOutdated: true, resolvedBy: "bob", originalLine: 9 })
  expect(context.projects).toBeUndefined()
  expect(context.warnings.some((warning) => warning.toLowerCase().includes("project"))).toBe(true)
  expect(context.closingIssues?.[0]).toMatchObject({ number: 9, repository: "other/repo", state: "open" })
  expect(context.milestone?.title).toBe("Release")
  expect(context.readiness).toMatchObject({ headSha: head, reviewDecision: "REVIEW_REQUIRED", checksComplete: true })
  expect(context.readiness.checks).toHaveLength(2)
  expect(context.readiness.checks[0]).toMatchObject({ name: "build", state: "pending", required: true })
  expect(calls.filter((name) => name === "PullThreads")).toHaveLength(2)
  expect(calls.filter((name) => name === "PullChecks")).toHaveLength(2)
  expect(calls.filter((name) => name === "PullThreadComments")).toHaveLength(1)
})
