import { describe, expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import type { GitHubTransport } from "../src/github/transport"

const date = "2026-01-01T00:00:00Z"
const pull = {
  number: 42, state: "open", title: "Pull", user: { login: "author" },
  created_at: date, updated_at: date, html_url: "https://github.com/owner/repo/pull/42",
  body: "PR body", locked: false, merged_at: null, closed_at: null,
  base: { ref: "main" }, head: { ref: "topic", repo: null },
  additions: 1, deletions: 0, changed_files: 1, commits: 1, comments: 0, review_comments: 0,
  labels: [], assignees: [], requested_reviewers: [], requested_teams: [],
  mergeable: true, mergeable_state: "clean", reactions: { "+1": 2 },
}

function rest(locked = false): GitHubTransport {
  return {
    async json<T>(path: string) {
      expect(path).toBe("repos/owner/repo/pulls/42")
      return { ...pull, locked } as T
    },
    async text(): Promise<string> { throw new Error("Unexpected text request") },
  }
}

function permissionResponse(isArchived = false, viewerPermission: string | null = "READ") {
  return { data: { repository: { isArchived, viewerPermission, pullRequest: { id: "PR_42" } } } }
}

const bodyReactions = { data: { repository: { pullRequest: {
  viewerCanReact: true,
  reactionGroups: [{ content: "HEART", viewerHasReacted: true, users: { totalCount: 3 } }],
} } } }

describe("PR conversation comments", () => {
  test("derives comment permission from PR existence, archive state, lock and viewer permission", async () => {
    for (const [locked, permission, archived, expected] of [
      [false, "READ", false, true], [true, "READ", false, false],
      [true, "WRITE", false, true], [true, "MAINTAIN", false, true],
      [true, "ADMIN", false, true], [true, "TRIAGE", false, false],
      [false, "READ", true, false], [true, "WRITE", true, false],
    ] as const) {
      const queries: string[] = []
      const client = createGitHubClient({ ...rest(locked), async graphql<T>(query: string, variables: Record<string, string>) {
        queries.push(query)
        expect(variables).toEqual({ owner: "owner", name: "repo" })
        expect(query).toContain("pullRequest(number: 42)")
        expect(query).not.toContain("issue(")
        expect(query).not.toContain("viewerCanComment")
        if (query.includes("BodyReactions")) return bodyReactions as T
        expect(query).toContain("isArchived viewerPermission pullRequest(number: 42) { id }")
        return permissionResponse(archived, permission) as T
      } })
      const detail = await client.pull("owner/repo", 42)
      expect(detail.permissions).toEqual({ comment: expected })
      expect(detail.locked).toBe(locked)
      expect(detail).toMatchObject({ body: "PR body", reactions: { heart: 3 }, viewerReactions: ["heart"], canReact: true })
      expect(queries).toHaveLength(2)
    }
  })

  test("keeps PRs browsable with unknown permissions for missing, failed or erroneous GraphQL", async () => {
    const valid = permissionResponse()
    const responses: unknown[] = [
      undefined, null, {}, { data: null }, { data: { repository: null } },
      { data: { repository: {} } },
      { data: { repository: { isArchived: false, viewerPermission: "WRITE", pullRequest: null } } },
      { data: { repository: { isArchived: false, viewerPermission: "WRITE", pullRequest: {} } } },
      { data: { repository: { isArchived: false, viewerPermission: "WRITE", pullRequest: { id: " " } } } },
      { data: { repository: { pullRequest: { id: "PR_42" } } } },
      { data: { repository: { isArchived: false, pullRequest: { id: "PR_42" } } } },
      { ...valid, errors: [{ message: "Denied" }] },
      { ...valid, errors: { message: "Malformed errors" } },
      new Error("GraphQL unavailable"),
    ]
    for (const response of responses) {
      const client = createGitHubClient({ ...rest(), async graphql<T>(query: string) {
        if (query.includes("BodyReactions")) return bodyReactions as T
        if (response instanceof Error) throw response
        return response as T
      } })
      const detail = await client.pull("owner/repo", 42)
      expect(detail.permissions).toBeUndefined()
      expect(detail).toMatchObject({ number: 42, body: "PR body", reactions: { heart: 3 }, viewerReactions: ["heart"] })
    }
    const detail = await createGitHubClient(rest()).pull("owner/repo", 42)
    expect(detail.permissions).toBeUndefined()
    expect(detail).toMatchObject({ number: 42, locked: false, reactions: { "+1": 2 } })
  })

  test("unknown lock state and mismatched PR identity cannot grant reader commenting", async () => {
    for (const [locked, nodeId, permission] of [
      [undefined, "PR_42", false], [null, "PR_42", false], ["false", "PR_42", false], [false, "PR_other", undefined],
    ] as const) {
      const client = createGitHubClient({ ...rest(), async json<T>() { return { ...pull, locked, node_id: nodeId } as T },
        async graphql<T>(query: string) { return (query.includes("BodyReactions") ? bodyReactions : permissionResponse()) as T },
      })
      const detail = await client.pull("owner/repo", 42)
      expect(detail.permissions?.comment).toBe(permission)
    }
  })

  test("posts PR42 conversation comments to issue-comments with exact bodies, rejecting blanks without retries", async () => {
    const body = "  **Conversation**, not an inline review.\r\n\n`$(untouched)`\n"
    const calls: { path: string; method: string; body: Record<string, unknown> }[] = []
    let failed = false
    const error = new Error("Write denied")
    const client = createGitHubClient({ ...rest(), async mutate<T>(path: string, method: "POST" | "PATCH", input: Record<string, unknown>) {
      calls.push({ path, method, body: input })
      if (failed) throw error
      return { id: 123, user: { login: "viewer" }, body: input.body, created_at: date, updated_at: date } as T
    } })
    expect(await client.createIssueComment("owner/repo", 42, body)).toMatchObject({ id: 123, body, author: "viewer" })
    expect(calls).toEqual([{ path: "repos/owner/repo/issues/42/comments", method: "POST", body: { body } }])
    await expect(client.createIssueComment("owner/repo", 42, " \r\n\t")).rejects.toThrow("must not be blank")
    expect(calls).toHaveLength(1)
    failed = true
    await expect(client.createIssueComment("owner/repo", 42, body)).rejects.toBe(error)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(calls[0])
  })
})
