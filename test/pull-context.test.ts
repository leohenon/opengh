import { expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import { createRequestBudget } from "../src/github/request-budget"
import type { GitHubTransport, RequestOptions } from "../src/github/transport"

test("PR context paginates threads, replies and checks without hiding data on project permission failures", async () => {
  const head = "a".repeat(40)
  const done = { hasNextPage: false, endCursor: null }
  const calls: string[] = []
  const budget = createRequestBudget()
  const comment = (id: string, replyTo?: string) => ({
    diffHunk: "@@ -10,1 +12,1 @@\n-before\n+after",
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
    async graphql<T>(query: string, variables: Record<string, string>, options?: RequestOptions) {
      expect(options?.budget).toBe(budget)
      expect(options?.signal?.aborted).toBe(false)
      const name = query.match(/query\s+(\w+)/)?.[1] ?? ""
      calls.push(name)
      if (name !== "PullThreadComments") {
        expect(variables.repositoryId).toBe("R_A")
        expect(variables.owner).toBeUndefined()
        expect(variables.name).toBeUndefined()
        expect(query).toContain("repository: node(id: $repositoryId)")
        expect(query).not.toContain("$owner")
        expect(query).not.toContain("$name")
      } else {
        expect(query).toContain("node(id: $id)")
        expect(variables.id).toBe("thread1")
      }
      const cursor = variables.cursor ?? variables.after
      const response = (pullRequest: unknown) => ({ data: { repository: { pullRequest } } }) as T
      if (name === "PullContext") return response({ headRefOid: head, isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED",
        milestone: { title: "Release", url: "https://github.com/owner/repo/milestone/1", dueOn: "2026-02-01T00:00:00Z" } })
      if (name === "PullThreads") return response({ headRefOid: head, reviewThreads: cursor ? {
        nodes: [{ id: "thread2", path: "old.ts", line: null, originalLine: 9, isResolved: true, isOutdated: true, resolvedBy: { login: "bob" },
          comments: { nodes: [comment("old")], pageInfo: done } }], pageInfo: done,
      } : {
        nodes: [{ id: "thread1", path: "src/index.ts", line: 12, originalLine: 12, startLine: 12, originalStartLine: 12, diffSide: "RIGHT", isResolved: false, isOutdated: false, resolvedBy: null,
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
  const context = await client.pullContext({ id: 71, nodeId: "R_A", nameWithOwner: "owner/repo" }, 42, { budget })
  expect(budget.signal.aborted).toBe(false)
  budget.dispose()
  expect(context.threads).toHaveLength(2)
  expect(context.threads[0]).toMatchObject({ diffSide: "RIGHT", startLine: 12, originalStartLine: 12 })
  expect(context.threads[0]?.comments[0]?.diffHunk).toBe("@@ -10,1 +12,1 @@\n-before\n+after")
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

function contextTransport(surface: NonNullable<GitHubTransport["graphql"]>): GitHubTransport {
  return {
    async json<T>(): Promise<T> { throw new Error("Unexpected REST") },
    async text() { return "" },
    async graphql<T>(query: string, variables: Record<string, string>, options?: RequestOptions) {
      if (query.includes("query PullContext(")) return { data: { repository: { pullRequest: {
        headRefOid: "a".repeat(40), isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: null,
      } } } } as T
      return surface<T>(query, variables, options)
    },
  }
}

const emptyConnection = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }

function emptySurface(_query: string) {
  return { data: { repository: { pullRequest: {
    reviewThreads: emptyConnection, projectItems: emptyConnection, closingIssuesReferences: emptyConnection,
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  } } } }
}

test("PR optional connections reject page limits rather than becoming permission warnings", async () => {
  let pages = 0
  const client = createGitHubClient(contextTransport(async <T>(query: string) => {
    if (query.includes("query PullProjects(")) {
      pages++
      return { data: { repository: { pullRequest: { projectItems: {
        nodes: [], pageInfo: { hasNextPage: true, endCursor: `page${pages}` },
      } } } } } as T
    }
    return emptySurface(query) as T
  }))
  await expect(client.pullContext("owner/repo", 42)).rejects.toThrow("incomplete")
  expect(pages).toBe(20)
})

test("PR budget counts nested initial comments even when thread IDs repeat", async () => {
  const client = createGitHubClient(contextTransport(async <T>(query: string) => {
    if (query.includes("query PullThreads(")) return { data: { repository: { pullRequest: { reviewThreads: {
      nodes: Array.from({ length: 100 }, () => ({ id: "same", comments: { nodes: Array(100).fill(null) } })),
      pageInfo: { hasNextPage: false, endCursor: null },
    } } } } } as T
    return emptySurface(query) as T
  }))
  await expect(client.pullContext("owner/repo", 42)).rejects.toThrow("item limit")
})

test("mandatory PR failures abort and settle sibling requests without hiding the original error", async () => {
  const failure = new Error("Threads unavailable")
  let settled = 0
  const client = createGitHubClient(contextTransport(async <T>(query: string, _variables: Record<string, string>, options?: RequestOptions): Promise<T> => {
    if (query.includes("query PullThreads(")) throw failure
    return new Promise<T>((_resolve, reject) => {
      const abort = () => { settled++; reject(options!.signal!.reason) }
      options!.signal!.addEventListener("abort", abort, { once: true })
      if (options!.signal!.aborted) abort()
    })
  }))
  await expect(client.pullContext("owner/repo", 42)).rejects.toBe(failure)
  expect(settled).toBe(3)
})
