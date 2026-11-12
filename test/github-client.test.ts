import { describe, expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import { githubDataFixture } from "./fixtures/github-data"
import { createRequestBudget, MAX_DETAIL_ITEMS, ResponseLimitError } from "../src/github/request-budget"
import { currentPullReviews } from "../src/ui/pull-reviews"
import { GitHubApiError, type GitHubTransport, type RequestOptions } from "../src/github/transport"

const repository = { ...githubDataFixture.repo, id: 123, nameWithOwner: "renamed/repository" }

type Responses = Record<string, unknown>

function transport(responses: Responses = {}, textResponse: string | Error = "README"): GitHubTransport {
  return {
    async json<T>(path: string) {
      const value = responses[path]
      if (value instanceof Error) throw value
      return value as T
    },
    async text(_path: string) {
      if (textResponse instanceof Error) throw textResponse
      return textResponse
    },
  }
}

describe("GitHub client", () => {
  test("resolves shared issue/PR numbers without fetching lists and preserves lookup failures", async () => {
    const error = new GitHubApiError("repos/owner/repo/issues/3", "Not Found (HTTP 404)")
    const client = createGitHubClient(transport({
      "repos/owner/repo/issues/1": { number: 1 },
      "repos/owner/repo/issues/2": { number: 2, pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/2" } },
      "repos/owner/repo/issues/3": error,
    }))
    expect(await client.issueKind("owner/repo", 1)).toBe("issue")
    expect(await client.issueKind("owner/repo", 2)).toBe("pull")
    await expect(client.issueKind("owner/repo", 3)).rejects.toBe(error)
  })

  test("loads PR commits in API order across pages without exceeding GitHub's 250-commit limit", async () => {
    const paths: string[] = []
    const client = createGitHubClient({
      async json<T>(path: string) {
        paths.push(path)
        if (path === "repos/owner/repo/pulls/42") return { commits: 250 } as T
        const page = Number(new URL(`https://api.github.com/${path}`).searchParams.get("page"))
        if (page > 3) throw new Error("Unexpected commit page")
        return Array.from({ length: page === 3 ? 50 : 100 }, (_, index) => {
          const number = (page - 1) * 100 + index
          return { sha: number.toString(16).padStart(40, "0"), author: number === 0 ? null : { login: "octocat" },
            commit: { message: `Commit ${number}\n\nFull body`, author: { name: "Local Author", date: "2026-01-01T00:00:00Z" } } }
        }) as T
      },
      async text() { return "" },
    })
    const commits = await client.pullCommits("owner/repo", 42)
    expect(paths).toEqual([...([1, 2, 3].map((page) => `repos/owner/repo/pulls/42/commits?per_page=100&page=${page}`)), "repos/owner/repo/pulls/42"])
    expect(commits).toHaveLength(250)
    expect(commits[0]).toMatchObject({ sha: "0".repeat(40), message: "Commit 0", author: "Local Author" })
    expect(commits.at(-1)?.message).toBe("Commit 249")
  })

  test("maps repository metadata", async () => {
    const client = createGitHubClient(transport({
      "repos/owner/repo": {
        id: 123,
        node_id: "R_fixture_123",
        full_name: "owner/repo",
        html_url: "https://github.com/owner/repo",
        description: null,
        default_branch: "main",
        stargazers_count: 2,
        forks_count: 1,
        subscribers_count: 3,
        open_issues_count: 4,
        language: null,
        license: null,
        updated_at: "2026-01-01T00:00:00Z",
      },
    }))
    const repo = await client.metadata("owner/repo")
    expect(repo.id).toBe(123)
    expect(repo.nodeId).toBe("R_fixture_123")
    expect(repo.nameWithOwner).toBe("owner/repo")
    expect(repo.url).toBe("https://github.com/owner/repo")
    expect(repo.description).toBe("No description provided.")
    expect(repo.language).toBe("Unknown")
  })

  test("preserves complete commit SHAs and distinguishes authored and committed dates", async () => {
    const sha = "a".repeat(40)
    const path = "repos/owner/repo/commits?per_page=30&page=1&sha=main"
    const client = createGitHubClient(transport({
      [path]: [{
        sha,
        author: { login: "octocat" },
        commit: { message: "title\n\nbody", author: { name: "Octo Cat", date: "2026-01-01T00:00:00Z" }, committer: { name: "Octo Cat", date: "2026-01-02T00:00:00Z" } },
      }],
    }))
    const result = await client.commits("owner/repo", "main")
    expect(result.items[0]?.sha).toBe(sha)
    expect(result.items[0]?.message).toBe("title")
    expect(result.items[0]?.date).toBe("2026-01-01T00:00:00Z")
    expect(result.items[0]?.committedAt).toBe("2026-01-02T00:00:00Z")
  })

  test("loads exact branch commit totals beyond page size using qualified heads, not colliding tags", async () => {
    const calls: { query: string; variables: Record<string, string> }[] = []
    const totals: Record<string, number> = { "refs/heads/main": 2345, "refs/heads/feature/detail": 1234, "refs/heads/v1.0": 456, "refs/heads/refs/heads/topic": 789 }
    const client = createGitHubClient({
      ...transport(),
      async json<T>(): Promise<T> { throw new Error("REST must not be used for commit counts") },
      async graphql<T>(query: string, variables: Record<string, string>) {
        calls.push({ query, variables })
        // A tag named v1.0 would resolve differently if the branch were not qualified.
        const totalCount = totals[variables.ref!] ?? 1
        return { data: { repository: { ref: { target: { __typename: "Commit", history: { totalCount } } } } } } as T
      },
    })
    for (const branch of ["main", "feature/detail", "v1.0", "refs/heads/topic"]) {
      expect(await client.commitCount("owner/repo", branch)).toBe(totals[`refs/heads/${branch}`]!)
    }
    expect(calls).toHaveLength(4)
    expect(calls.map(({ variables }) => variables)).toEqual([
      { owner: "owner", name: "repo", ref: "refs/heads/main" },
      { owner: "owner", name: "repo", ref: "refs/heads/feature/detail" },
      { owner: "owner", name: "repo", ref: "refs/heads/v1.0" },
      { owner: "owner", name: "repo", ref: "refs/heads/refs/heads/topic" },
    ])
    expect(calls[0]?.query).toContain("repository(owner: $owner, name: $name)")
    expect(calls[0]?.query).toContain("ref(qualifiedName: $ref)")
    expect(calls[0]?.query).toContain("... on Commit { history { totalCount } }")
  })

  test("accepts a verified zero commit total", async () => {
    const client = createGitHubClient({ ...transport(), async graphql<T>() {
      return { data: { repository: { ref: { target: { __typename: "Commit", history: { totalCount: 0 } } } } } } as T
    } })
    expect(await client.commitCount("owner/repo", "main")).toBe(0)
  })

  test("validates commit count inputs before querying and requires GraphQL", async () => {
    let calls = 0
    const client = createGitHubClient({ ...transport(), async graphql<T>(): Promise<T> {
      calls++
      throw new Error("Unexpected query")
    } })
    for (const repository of ["", "owner", "/repo", "owner/", "owner/repo/extra", "owner /repo", "owner/repo?x=1", "./repo", "owner/.."]) {
      await expect(client.commitCount(repository, "main")).rejects.toThrow("Invalid repository")
    }
    for (const branch of ["", " \t\n"]) {
      await expect(client.commitCount("owner/repo", branch)).rejects.toThrow("must not be blank")
    }
    expect(calls).toBe(0)
    await expect(createGitHubClient(transport()).commitCount("owner/repo", "main"))
      .rejects.toThrow("Commit count for owner/repo branch main could not be verified")
  })

  test("rejects missing or non-Commit targets and invalid commit counts without substituting zero", async () => {
    let response: unknown
    const client = createGitHubClient({ ...transport(), async graphql<T>() { return response as T } })
    for (const value of [undefined, null, {}, { data: null }, { data: {} }, { data: { repository: null } },
      { data: { repository: {} } }, { data: { repository: { ref: null } } },
      ...[undefined, null, {}, { __typename: "Tag" }, { __typename: "Tree", history: { totalCount: 1 } },
        { history: { totalCount: 1 } }, { __typename: "Commit" }, { __typename: "Commit", history: null },
        ...[undefined, null, -1, 1.5, "2", true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((totalCount) =>
          ({ __typename: "Commit", history: { totalCount } })),
      ].map((target) => ({ data: { repository: { ref: { target } } } })),
    ]) {
      response = value
      await expect(client.commitCount("owner/repo", "main")).rejects.toThrow("could not be verified")
    }
  })

  test("rejects GraphQL commit count errors even with partial data and propagates transport failures", async () => {
    const data = { repository: { ref: { target: { __typename: "Commit", history: { totalCount: 2 } } } } }
    let response: unknown = { data, errors: [{ message: "Access denied" }, { message: "History unavailable" }] }
    const client = createGitHubClient({ ...transport(), async graphql<T>() { return response as T } })
    await expect(client.commitCount("owner/repo", "main")).rejects.toThrow("Access denied · History unavailable")
    for (const errors of [[{}], [null], { message: "Malformed errors" }]) {
      response = { data, errors }
      await expect(client.commitCount("owner/repo", "main")).rejects.toThrow("could not be verified")
    }
    response = { data, errors: [] }
    expect(await client.commitCount("owner/repo", "main")).toBe(2)
    const error = new Error("GraphQL unavailable")
    const failing = createGitHubClient({ ...transport(), async graphql<T>(): Promise<T> { throw error } })
    await expect(failing.commitCount("owner/repo", "main")).rejects.toBe(error)
  })

  test("maps commit details and respects the file pagination cap", async () => {
    const sha = "b".repeat(40)
    const date = "2026-01-01T00:00:00Z"
    const fullMessage = "Rename file\n\nKeep the full body.\n"
    const file = {
      filename: "new.ts",
      previous_filename: "old.ts",
      status: "renamed",
      additions: 3,
      deletions: 2,
      patch: "@@ -1 +1 @@\n-old\n+new",
    }
    const response = {
      sha,
      author: null,
      committer: null,
      commit: {
        message: fullMessage,
        author: { name: "Local Author", date },
        committer: { name: "Local Committer", date },
      },
      stats: { additions: 300, deletions: 200 },
      files: Array.from({ length: 100 }, (_, index) => ({
        ...file, filename: `new-${index}.ts`, previous_filename: `old-${index}.ts`,
      })),
    }
    const path = "repos/owner/repo/commits/topic%2Fdetail?per_page=100&page="
    const client = createGitHubClient(transport({
      [`${path}1`]: response,
      [`${path}2`]: {
        ...response,
        commit: { ...response.commit, author: null, committer: null },
        files: [file],
      },
      [`${path}29`]: response,
      [`${path}30`]: response,
    }))

    const detail = await client.commit("owner/repo", "topic/detail")
    expect(detail).toEqual({
      sha,
      message: "Rename file",
      fullMessage,
      author: "Local Author",
      date,
      committedAt: date,
      committer: { name: "Local Committer", date },
      additions: 300,
      deletions: 200,
      files: {
        items: Array.from({ length: 100 }, (_, index) => ({
          path: `new-${index}.ts`,
          previousPath: `old-${index}.ts`,
          status: "renamed",
          additions: 3,
          deletions: 2,
        })),
        page: 1,
        hasMore: true,
      },
      filesTruncated: false,
    })
    const shortPage = await client.commit("owner/repo", "topic/detail", 2)
    expect(shortPage.author).toBe("ghost")
    expect(shortPage.date).toBe("")
    expect(shortPage).not.toHaveProperty("committer")
    expect(shortPage.files.page).toBe(2)
    expect(shortPage.files.items).toHaveLength(1)
    expect(shortPage.files.hasMore).toBe(false)
    expect(shortPage.filesTruncated).toBe(false)

    for (const page of [29, 30]) {
      const result = await client.commit("owner/repo", "topic/detail", page)
      expect(result.files.page).toBe(page)
      expect(result.files.hasMore).toBe(page < 30)
      expect(result.filesTruncated).toBe(page === 30)
    }
  })

  test("excludes pull requests from issue results", async () => {
    const path = "repos/owner/repo/issues?state=open&per_page=30&page=1"
    const base = { state: "open", user: { login: "octocat" }, created_at: "2026-01-01T00:00:00Z" }
    const client = createGitHubClient(transport({
      [path]: [
        { ...base, number: 1, title: "Issue" },
        { ...base, number: 2, title: "Pull", pull_request: {} },
      ],
    }))
    const result = await client.issues("owner/repo", "open")
    expect(result.items.map((issue) => issue.number)).toEqual([1])
  })

  test("loads separate open issue and PR totals beyond pagination in one GraphQL query", async () => {
    const calls: { query: string; variables: Record<string, string> }[] = []
    const client = createGitHubClient({
      ...transport(),
      async json<T>(): Promise<T> { throw new Error("REST must not be used for work counts") },
      async graphql<T>(query: string, variables: Record<string, string>) {
        calls.push({ query, variables })
        return { data: { repository: { issues: { totalCount: 2345 }, pullRequests: { totalCount: 1234 } } } } as T
      },
    })
    expect(await client.workCounts("owner/repo")).toEqual({ issues: 2345, pulls: 1234 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.variables).toEqual({ owner: "owner", name: "repo" })
    expect(calls[0]?.query).toContain("repository(owner: $owner, name: $name)")
    expect(calls[0]?.query).toContain("issues(states: OPEN) { totalCount }")
    expect(calls[0]?.query).toContain("pullRequests(states: OPEN) { totalCount }")
  })

  test("accepts zero open work counts", async () => {
    const client = createGitHubClient({ ...transport(), async graphql<T>() {
      return { data: { repository: { issues: { totalCount: 0 }, pullRequests: { totalCount: 0 } } } } as T
    } })
    expect(await client.workCounts("owner/repo")).toEqual({ issues: 0, pulls: 0 })
  })

  test("rejects invalid repositories before requesting work counts and requires GraphQL", async () => {
    let calls = 0
    const client = createGitHubClient({ ...transport(), async graphql<T>(): Promise<T> {
      calls++
      throw new Error("Unexpected query")
    } })
    for (const repository of ["", "owner", "/repo", "owner/", "owner/repo/extra", "owner /repo", "owner/repo?x=1", "./repo", "owner/.."]) {
      await expect(client.workCounts(repository)).rejects.toThrow("Invalid repository")
    }
    expect(calls).toBe(0)
    await expect(createGitHubClient(transport()).workCounts("owner/repo"))
      .rejects.toThrow("Open issue and pull request counts could not be verified")
  })

  test("rejects missing, null, and invalid work counts rather than substituting zero", async () => {
    const valid = { totalCount: 1 }
    let response: unknown
    const client = createGitHubClient({ ...transport(), async graphql<T>() { return response as T } })
    for (const value of [undefined, null, {}, { data: null }, { data: {} }, { data: { repository: null } }]) {
      response = value
      await expect(client.workCounts("owner/repo")).rejects.toThrow("could not be verified")
    }
    for (const field of ["issues", "pullRequests"]) {
      for (const connection of [undefined, null, {}, ...[null, -1, 1.5, "2", true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((totalCount) => ({ totalCount }))]) {
        response = { data: { repository: { issues: valid, pullRequests: valid, [field]: connection } } }
        await expect(client.workCounts("owner/repo")).rejects.toThrow("could not be verified")
      }
    }
  })

  test("rejects GraphQL work count errors even with partial data and propagates transport failures", async () => {
    let response: unknown = {
      data: { repository: { issues: { totalCount: 2 }, pullRequests: { totalCount: 3 } } },
      errors: [{ message: "Access denied" }, { message: "Count unavailable" }],
    }
    const client = createGitHubClient({ ...transport(), async graphql<T>() { return response as T } })
    await expect(client.workCounts("owner/repo")).rejects.toThrow("Access denied · Count unavailable")
    for (const errors of [[{}], [null], { message: "Malformed errors" }]) {
      response = { errors }
      await expect(client.workCounts("owner/repo")).rejects.toThrow("could not be verified")
    }
    const error = new Error("GraphQL unavailable")
    const failing = createGitHubClient({ ...transport(), async graphql<T>(): Promise<T> { throw error } })
    await expect(failing.workCounts("owner/repo")).rejects.toBe(error)
  })

  test("verifies regular-issue availability with exact counts rather than PR-inclusive REST pages", async () => {
    const variables: Record<string, string>[] = []
    let denied = false
    const client = createGitHubClient({ ...transport(), async graphql<T>(_query: string, input: Record<string, string>) {
      variables.push(input)
      return (denied ? { errors: [{ message: "Count unavailable" }] }
        : { data: { repository: { issues: { totalCount: input.state === "OPEN" ? 1 : 0 } } } }) as T
    } })
    expect(await client.hasIssues("owner/repo", "open")).toBe(true)
    expect(await client.hasIssues("owner/repo", "closed")).toBe(false)
    expect(variables).toEqual([
      { owner: "owner", name: "repo", state: "OPEN" },
      { owner: "owner", name: "repo", state: "CLOSED" },
    ])
    denied = true
    await expect(client.hasIssues("owner/repo", "open")).rejects.toThrow("Count unavailable")
  })

  test("maps issue details without inferring state reasons and rejects pull requests", async () => {
    const createdAt = "2026-01-01T00:00:00Z"
    const updatedAt = "2026-01-02T00:00:00Z"
    const body = "# Details\r\n\r\nKeep **Markdown** untouched.\n"
    const response = {
      number: 42,
      state: "closed",
      title: "Issue details",
      user: { login: "octocat" },
      created_at: createdAt,
      html_url: "https://github.com/owner/repo/issues/42",
      body,
      updated_at: updatedAt,
      closed_at: updatedAt,
      state_reason: "not_planned",
      locked: true,
      labels: ["bug", { id: 123, name: "help wanted", color: "008672" }],
      assignees: [{ login: "octocat" }, { login: "maintainer" }],
      milestone: { title: "v1", due_on: updatedAt },
      comments: 100,
    }
    const client = createGitHubClient(transport({
      "repos/owner/repo/issues/42": response,
      "repos/owner/repo/issues/43": {
        ...response, number: 43, user: null, body: null, closed_at: null, state_reason: null,
        locked: false, labels: [], assignees: [], milestone: null, comments: 0,
      },
      "repos/owner/repo/issues/44": { ...response, milestone: { title: "Later", due_on: null } },
      "repos/owner/repo/issues/45": { ...response, pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/45" } },
    }))

    expect(await client.issue("owner/repo", 42)).toEqual({
      number: 42, state: "closed", title: "Issue details", author: "octocat", createdAt,
      url: response.html_url, body, updatedAt, closedAt: updatedAt, stateReason: "not_planned",
      locked: true, labels: ["bug", "help wanted"], assignees: ["octocat", "maintainer"],
      milestone: { title: "v1", dueAt: updatedAt }, commentCount: 100,
    })
    const nullable = await client.issue("owner/repo", 43)
    expect(nullable).toMatchObject({ author: "ghost", body: "", state: "closed", locked: false, commentCount: 0 })
    expect(nullable).not.toHaveProperty("closedAt")
    expect(nullable).not.toHaveProperty("stateReason")
    expect(nullable).not.toHaveProperty("milestone")
    expect((await client.issue("owner/repo", 44)).milestone).toEqual({ title: "Later" })
    await expect(client.issue("owner/repo", 45)).rejects.toThrow("is a pull request")
  })

  test("loads viewer issue permissions and fails closed when lookup fails", async () => {
    const rest = transport({
      "repos/owner/repo/issues/42": {
        number: 42, state: "open", title: "Issue", user: { login: "author" },
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/issues/42", body: "", locked: true,
        closed_at: null, state_reason: null, labels: [], assignees: [], milestone: null, comments: 0,
      },
    })
    let permission = "READ"
    let archived = false
    let failure: Error | undefined
    const client = createGitHubClient({ ...rest, async graphql<T>(_query: string, variables: Record<string, string>) {
      expect(variables).toEqual({ owner: "owner", name: "repo" })
      expect(_query).toContain("issue(number: 42)")
      expect(_query).not.toContain("viewerCanCreateIssues")
      if (failure) throw failure
      return { data: { repository: { isArchived: archived, viewerCanCreateIssues: false, viewerPermission: permission,
        issue: { viewerCanClose: true, viewerCanReopen: false, viewerCanAssign: true } } } } as T
    } })
    expect((await client.issue("owner/repo", 42)).permissions).toEqual({
      comment: false, close: true, reopen: false, duplicate: false, assignees: true,
    })
    permission = "WRITE"
    expect((await client.issue("owner/repo", 42)).permissions).toEqual({
      comment: true, close: true, reopen: false, duplicate: true, assignees: true,
    })
    archived = true
    expect(Object.values((await client.issue("owner/repo", 42)).permissions!)).toEqual([false, false, false, false, false])
    for (const error of [
      new Error("unavailable"),
      new GitHubApiError("graphql", "Bad credentials (HTTP 401)"),
      new Error("GitHub account changed. Restart opengh before continuing; no changes were sent."),
    ]) {
      failure = error
      const detail = await client.issue("owner/repo", 42)
      expect(detail.permissions).toBeUndefined()
      expect(detail.permissionsError).toBe(error.message)
    }
    failure = undefined
    expect((await client.issue("owner/repo", 42)).permissionsError).toBeUndefined()
  })

  test("maps issue comments with full IDs and raw bodies through the terminal page", async () => {
    const createdAt = "2026-01-01T00:00:00Z"
    const updatedAt = "2026-01-02T00:00:00Z"
    const body = "## Comment\r\n\r\n```ts\nconst x = 1\n```\n"
    const comments = Array.from({ length: 100 }, (_, index) => ({
      id: 9876543210 + index,
      user: { login: "octocat" },
      author_association: "OWNER",
      body,
      created_at: createdAt,
      updated_at: updatedAt,
    }))
    const path = "repos/owner/repo/issues/42/comments?per_page=100&page="
    const client = createGitHubClient(transport({
      [`${path}1`]: comments,
      [`${path}2`]: [],
      [`${path}3`]: [{ id: 9876543310, user: null, body: null, created_at: createdAt, updated_at: updatedAt }],
    }))

    expect(await client.issueComments("owner/repo", 42)).toEqual({
      items: comments.map((comment) => ({
        id: comment.id, author: "octocat", authorAssociation: "OWNER", body, createdAt, updatedAt,
      })),
      hasMore: true,
    })
    expect(await client.issueComments("owner/repo", 42, 2)).toEqual({ items: [], hasMore: false })
    expect(await client.issueComments("owner/repo", 42, 3)).toEqual({
      items: [{ id: 9876543310, author: "ghost", authorAssociation: "NONE", body: "", createdAt, updatedAt }],
      hasMore: false,
    })
  })

  test("maps issue mutations and preserves raw comment bodies and state reasons", async () => {
    const body = "  Markdown\r\n\n`$(not a command)`\n"
    const date = "2026-01-01T00:00:00Z"
    const issue = {
      number: 42, state: "open", title: "Issue", user: null, created_at: date,
      html_url: "https://github.com/owner/repo/issues/42", body: null, updated_at: date,
      closed_at: null, state_reason: null, locked: false, labels: [], assignees: [],
      milestone: null, comments: 1,
    }
    const calls: { path: string; method: string; body: Record<string, unknown> }[] = []
    const client = createGitHubClient({
      ...transport({ user: { id: 7 }, "repositories/123/issues/42": { number: 42, comments: 0 }, "repositories/123/issues/42/comments?per_page=100&page=1": [] }),
      async mutate<T>(path: string, method: "POST" | "PATCH", input: Record<string, unknown>) {
        calls.push({ path, method, body: input })
        return (method === "POST"
          ? { id: 9876543210, user: { id: 7, login: "viewer" }, body: input.body, created_at: date, updated_at: date }
          : { ...issue, state: input.state, state_reason: input.state_reason ?? null }) as T
      },
    }, { load: async () => undefined, save: async () => {}, claim: async attempt => attempt, update: async () => {}, remove: async () => {} })
    expect(await client.createIssueComment(repository, 42, body)).toEqual({
      id: 9876543210, author: "viewer", authorAssociation: "NONE", body, createdAt: date, updatedAt: date,
    })
    expect(await client.updateIssueState(repository, 42, "closed")).toMatchObject({
      state: "closed", stateReason: "completed", body: "", author: "ghost", commentCount: 1,
    })
    expect(await client.updateIssueState(repository, 42, "closed", "not_planned")).toMatchObject({
      state: "closed", stateReason: "not_planned",
    })
    const reopened = await client.updateIssueState(repository, 42, "open", "not_planned")
    expect(reopened.state).toBe("open")
    expect(reopened).not.toHaveProperty("stateReason")
    expect(calls).toEqual([
      { path: "repositories/123/issues/42/comments", method: "POST", body: { body } },
      { path: "repositories/123/issues/42", method: "PATCH", body: { state: "closed", state_reason: "completed" } },
      { path: "repositories/123/issues/42", method: "PATCH", body: { state: "closed", state_reason: "not_planned" } },
      { path: "repositories/123/issues/42", method: "PATCH", body: { state: "open" } },
    ])
  })

  test("paginates assignable logins and clears assignees with an isolated PATCH", async () => {
    const paths: string[] = []
    const calls: unknown[] = []
    let returnedAssignees: string[] = []
    const client = createGitHubClient({
      ...transport(),
      async json<T>(path: string) {
        paths.push(path)
        return Array.from({ length: path.endsWith("page=1") ? 100 : 1 }, (_, index) => ({ login: `user${index}` })) as T
      },
      async mutate<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
        calls.push({ path, method, body })
        return { number: 42, state: "closed", title: "Original", body: "", user: null,
          created_at: "2026-01-01", updated_at: "2026-01-01", html_url: "https://github.com/owner/repo/issues/42",
          locked: false, labels: [], assignees: returnedAssignees.map((login) => ({ login })), comments: 0 } as T
      },
      async graphql<T>(query: string, variables: Record<string, string>) {
        expect(variables).toEqual({ repositoryId: "R_fixture_123" })
        expect(query).toContain("repository: node(id: $repositoryId)")
        expect(query).not.toContain("$owner")
        expect(query).toContain("viewerCanAssign")
        expect(query).not.toContain("viewerCanUpdate")
        expect(query).not.toContain("viewerCanLabel")
        return { data: { repository: { isArchived: false, viewerPermission: "READ", issue: {
          viewerCanClose: false, viewerCanReopen: false, viewerCanAssign: true,
        } } } } as T
      },
    })
    expect(await client.assignableUsers("owner/repo")).toMatchObject({ hasMore: true })
    expect(await client.assignableUsers("owner/repo", 2)).toEqual({ items: ["user0"], hasMore: false })
    expect(paths).toEqual(["repos/owner/repo/assignees?per_page=100&page=1", "repos/owner/repo/assignees?per_page=100&page=2"])
    const updated = await client.setIssueAssignees(repository, 42, [])
    expect(updated.permissions?.assignees).toBe(true)
    expect(updated.assignees).toEqual([])
    expect(calls).toEqual([{ path: "repositories/123/issues/42", method: "PATCH", body: { assignees: [] } }])
    returnedAssignees = ["BOB", "Alice"]
    expect((await client.setIssueAssignees(repository, 42, ["alice", "bob"])).assignees).toEqual(returnedAssignees)
    for (const [requested, returned] of [
      [["alice"], []], // Ignored addition.
      [[], ["alice"]], // Ignored removal.
      [["alice", "bob"], ["alice"]], // Partial assignment.
      [["alice"], ["bob"]], // Different assignee, same count.
      [["alice"], ["alice", "bob"]], // Unexpected extra assignee.
    ]) {
      returnedAssignees = returned!
      await expect(client.setIssueAssignees(repository, 42, requested!)).rejects.toThrow("did not confirm the requested assignees")
    }
  })

  test("closes duplicates using the canonical global ID and rejects invalid targets without writes", async () => {
    const date = "2026-01-01T00:00:00Z"
    const source = {
      number: 42, state: "open", title: "Duplicate", user: null, created_at: date,
      html_url: "https://github.com/owner/repo/issues/42", body: null, updated_at: date,
      closed_at: null, state_reason: null, locked: false, labels: [], assignees: [],
      milestone: null, comments: 0,
    }
    const sourcePath = "repositories/123/issues/42"
    const canonicalPath = "repositories/123/issues/7"
    const responses: Responses = {
      [sourcePath]: source,
      [canonicalPath]: { ...source, number: 7, id: 9876543210, state: "closed" },
    }
    const reads: string[] = []
    const writes: { path: string; method: string; body: Record<string, unknown> }[] = []
    const stub = transport(responses)
    const fixture: GitHubTransport = {
      ...stub,
      async json<T>(path: string) { reads.push(path); return stub.json<T>(path) },
      async mutate<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
        writes.push({ path, method, body })
        return { ...source, state: body.state, state_reason: body.state_reason, closed_at: date } as T
      },
    }
    const client = createGitHubClient(fixture)
    await expect(client.markIssueDuplicate(repository, 42, 42)).rejects.toThrow("itself")
    await expect(client.markIssueDuplicate(repository, 0, 7)).rejects.toThrow("positive safe integers")
    await expect(client.markIssueDuplicate(repository, 42, 1.5)).rejects.toThrow("positive safe integers")
    await expect(createGitHubClient({ ...fixture, mutate: undefined }).markIssueDuplicate(repository, 42, 7))
      .rejects.toThrow("does not support mutations")
    expect(reads).toEqual([])
    responses[sourcePath] = { ...source, state: "closed" }
    await expect(client.markIssueDuplicate(repository, 42, 7)).rejects.toThrow("Reopen the issue first")
    expect(reads).toEqual([sourcePath])
    responses[sourcePath] = source
    responses[canonicalPath] = { number: 7, id: 9876543210, pull_request: {} }
    await expect(client.markIssueDuplicate(repository, 42, 7)).rejects.toThrow("is a pull request")
    responses[canonicalPath] = { number: 7 }
    await expect(client.markIssueDuplicate(repository, 42, 7)).rejects.toThrow("valid global issue ID")
    expect(writes).toEqual([])
    responses[canonicalPath] = { number: 7, id: 9876543210, state: "closed" }
    expect(await client.markIssueDuplicate(repository, 42, 7)).toEqual({
      number: 42, state: "closed", stateReason: "duplicate", title: "Duplicate", author: "ghost",
      createdAt: date, url: source.html_url, body: "", updatedAt: date, closedAt: date,
      locked: false, labels: [], assignees: [], commentCount: 0,
    })
    expect(writes).toEqual([{ path: sourcePath, method: "PATCH", body: {
      state: "closed", state_reason: "duplicate", duplicate_issue_id: 9876543210,
    } }])
  })

  test("rejects blank comments and unsupported mutations, and does not retry failed writes", async () => {
    const readonly = createGitHubClient(transport())
    await expect(readonly.createIssueComment(repository, 42, "body")).rejects.toThrow("does not support mutations")
    await expect(readonly.updateIssueState(repository, 42, "closed")).rejects.toThrow("does not support mutations")
    let calls = 0
    const error = new GitHubApiError("comments", "Write denied", 422)
    const client = createGitHubClient({
      ...transport({ user: { id: 7 }, "repositories/123/issues/42": { number: 42, comments: 0 }, "repositories/123/issues/42/comments?per_page=100&page=1": [] }),
      async mutate<T>(): Promise<T> { calls++; throw error },
    }, { load: async () => undefined, save: async () => {}, claim: async attempt => attempt, update: async () => {}, remove: async () => {} })
    await expect(client.createIssueComment(repository, 42, " \r\n\t")).rejects.toThrow("must not be blank")
    expect(calls).toBe(0)
    await expect(client.createIssueComment(repository, 42, "body")).rejects.toBe(error)
    expect(calls).toBe(1)
    await expect(client.updateIssueState(repository, 42, "closed")).rejects.toBe(error)
    expect(calls).toBe(2)
  })

  test("distinguishes merged pulls from closed and open pulls", async () => {
    const base = { title: "Pull", user: { login: "octocat" }, created_at: "2026-01-01T00:00:00Z" }
    const client = createGitHubClient(transport({
      "repos/owner/repo/pulls?state=closed&per_page=30&page=1": [
        { ...base, number: 1, state: "closed", merged_at: "2026-01-02T00:00:00Z" },
        { ...base, number: 2, state: "closed", merged_at: null },
      ],
      "repos/owner/repo/pulls?state=open&per_page=30&page=1": [
        { ...base, number: 3, state: "open", merged_at: null },
        { ...base, number: 4, state: "open", merged_at: null, draft: true },
      ],
    }))
    expect((await client.pulls("owner/repo", "closed")).items.map(({ number, state, merged }) => ({ number, state, merged })))
      .toEqual([{ number: 1, state: "closed", merged: true }, { number: 2, state: "closed", merged: false }])
    const open = (await client.pulls("owner/repo", "open")).items
    expect(open[0]).toMatchObject({ number: 3, state: "open", merged: false, draft: false })
    expect(open[1]).toMatchObject({ number: 4, state: "open", merged: false, draft: true })
  })

  test("paginates branches and falls back only for an empty first page", async () => {
    const firstPath = "repos/owner/repo/branches?per_page=100&page=1"
    const secondPath = "repos/owner/repo/branches?per_page=100&page=2"
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ name: `branch-${index}` }))
    const client = createGitHubClient(transport({
      [firstPath]: fullPage,
      [secondPath]: [],
    }))

    expect(await client.branches("owner/repo", "main")).toEqual({
      items: fullPage.map((branch) => branch.name),
      hasMore: true,
    })
    expect(await client.branches("owner/repo", "main", 2)).toEqual({ items: [], hasMore: false })

    const empty = createGitHubClient(transport({ [firstPath]: [] }))
    expect(await empty.branches("owner/repo", "main")).toEqual({ items: ["main"], hasMore: false })

    const failing = createGitHubClient(transport({ [firstPath]: new Error("Unavailable") }))
    expect(failing.branches("owner/repo", "main")).rejects.toThrow("Unavailable")
  })
})

describe("GitHub issue references", () => {
  test("maps committed timeline entries using event or committer time, never old author dates", async () => {
    const path = "repos/owner/repo/issues/42/timeline?per_page=100&page=1"
    const first = { event: "committed", sha: "a".repeat(40), message: "First commit\n\nBody",
      author: { name: "Original Author", date: "2010-01-01T00:00:00Z" },
      committer: { name: "Rebaser", date: "2026-10-05T12:00:00Z" } }
    const second = { ...first, sha: "b".repeat(40), created_at: "2026-10-05T13:00:00Z" }
    const client = createGitHubClient(transport({ [path]: [first, second, first,
      { ...first, sha: "c".repeat(40), committer: null }, { ...first, sha: "invalid" },
    ] }))
    const timeline = await client.issueTimeline("owner/repo", 42)
    const commits = timeline.events.filter((event) => event.kind === "commit-added")
    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({ sha: first.sha, message: "First commit", author: "Original Author", createdAt: first.committer.date, timelineIndex: 0 })
    expect(commits[1]).toMatchObject({ sha: second.sha, createdAt: second.created_at, timelineIndex: 1 })
    expect(commits[0]?.url).toBe(`https://github.com/owner/repo/commit/${first.sha}`)
  })

  test("maps submitted reviews, dismissals, draft changes, and repeated user/team review requests", async () => {
    const path = "repos/owner/repo/issues/42/timeline?per_page=100&page=1"
    const actor = { login: "maintainer" }
    const review = (id: number, login: string, state: string, hour: number) => ({ id, event: "reviewed", user: { login }, state,
      submitted_at: `2026-01-01T${hour}:00:00Z`, body: `**${state}**`, author_association: "MEMBER",
      html_url: `https://github.com/owner/repo/pull/42#pullrequestreview-${id}`, commit_id: "a".repeat(40) })
    const request = (id: number, event: string, hour: number, team = false) => ({ id, event, actor,
      created_at: `2026-01-01T${hour}:00:00Z`, ...(team ? { requested_team: { name: "Maintainers", slug: "maintainers" } } : { requested_reviewer: { login: "bob" } }) })
    const client = createGitHubClient(transport({ [path]: [
      review(1, "alice", "APPROVED", 10), review(2, "bob", "changes_requested", 11), review(3, "bob", "COMMENTED", 15),
      { ...review(4, "alice", "PENDING", 16), submitted_at: null },
      { id: 20, event: "review_dismissed", actor, created_at: "2026-01-01T12:00:00Z",
        dismissed_review: { review_id: "1", state: "approved", dismissal_message: "The patch changed." } },
      { id: 21, event: "convert_to_draft", actor, created_at: "2026-01-01T12:30:00Z" },
      { id: 22, event: "ready_for_review", actor, created_at: "2026-01-01T12:45:00Z" },
      request(30, "review_requested", 10), request(31, "review_request_removed", 12), request(32, "review_requested", 14),
      request(33, "review_requested", 10, true), request(34, "review_request_removed", 12, true), request(35, "review_requested", 14, true),
    ] }))
    const timeline = await client.issueTimeline("owner/repo", 42)
    const reviews = timeline.events.filter((event) => event.kind === "review")
    expect(reviews).toHaveLength(3)
    expect(reviews[0]).toMatchObject({ actor: "alice", state: "dismissed", originalState: "approved", body: "**APPROVED**", createdAt: "2026-01-01T10:00:00Z" })
    expect(timeline.events.find((event) => event.kind === "review-dismissed")).toMatchObject({ actor: "maintainer", reviewer: "alice", reviewId: 1, body: "The patch changed." })
    expect(timeline.events.filter((event) => event.kind === "draft").map((event) => event.event)).toEqual(["convert_to_draft", "ready_for_review"])
    const repeats = timeline.events.filter((event) => event.kind === "review-request" && event.event === "review_requested" && event.reRequested)
    expect(repeats).toHaveLength(2)
    expect(currentPullReviews(timeline.events).find((event) => event.actor === "bob")?.state).toBe("changes_requested")
    expect(currentPullReviews(timeline.events).find((event) => event.actor === "alice")?.state).toBe("dismissed")
  })

  test("maps force pushes chronologically with exact commit pairs and retains events when details are unavailable", async () => {
    const before = "a".repeat(40)
    const after = "b".repeat(40)
    const path = "repos/owner/repo/issues/42/timeline?per_page=100&page=1"
    const firstPush = { id: 11, node_id: "F1", event: "head_ref_force_pushed", actor: { login: "alice" }, created_at: "2026-01-01T12:00:00Z" }
    const stub = transport({ [path]: [
      { id: 1, node_id: "C1", event: "closed", actor: { login: "bob" }, created_at: "2026-01-03T12:00:00Z" },
      { ...firstPush, id: 12, node_id: "F2", actor: null, created_at: "2026-01-02T12:00:00Z" },
      firstPush, firstPush,
    ] })
    let queries = 0
    const client = createGitHubClient({ ...stub, async graphql<T>(query: string) {
      queries++
      expect(query).toContain("ClosedEvent")
      expect(query).toContain("HeadRefForcePushedEvent")
      return { data: { nodes: [
        { id: "C1", closer: null },
        { id: "F2", beforeCommit: { oid: before, url: `https://evil.invalid/commit/${before}` }, afterCommit: null },
        { id: "F1", beforeCommit: { oid: before, url: `https://github.com/owner/repo/commit/${before}` },
          afterCommit: { oid: after, url: `https://github.com/owner/repo/commit/${after}` } },
      ] } } as T
    } })
    const timeline = await client.issueTimeline("owner/repo", 42)
    expect(queries).toBe(1)
    expect(timeline.events.map((event) => event.kind)).toEqual(["force-push", "force-push", "state"])
    expect(timeline.events[0]).toMatchObject({ kind: "force-push", event: "head_ref_force_pushed", actor: "alice", createdAt: firstPush.created_at,
      beforeCommit: { sha: before, url: `https://github.com/owner/repo/commit/${before}` },
      afterCommit: { sha: after, url: `https://github.com/owner/repo/commit/${after}` } })
    const pushes = timeline.events.filter((event) => event.kind === "force-push")
    expect(pushes[1]).toMatchObject({ kind: "force-push", actor: "ghost" })
    expect(pushes[1]?.beforeCommit).toBeUndefined()
    expect(pushes[1]?.afterCommit).toBeUndefined()
    const failing = createGitHubClient({ ...stub, async graphql<T>(): Promise<T> { throw new Error("GraphQL unavailable") } })
    const fallback = await failing.issueTimeline("owner/repo", 42)
    expect(fallback.events).toHaveLength(3)
    expect(fallback.events[0]).toMatchObject({ kind: "force-push", actor: "alice", createdAt: firstPush.created_at })
    expect(fallback.events.filter((event) => event.kind === "force-push")[0]?.beforeCommit).toBeUndefined()
  })

  test("attributes closures to exact GraphQL event nodes, never to a nearby PR reference", async () => {
    const sha = "f".repeat(40)
    const path = "repos/owner/repo/issues/42/timeline?per_page=100&page=1"
    const stub = transport({ [path]: [
      ...["C1", "C2", "C3", "C4"].map((node_id, index) => ({ id: index + 1, node_id, event: "closed",
        actor: { login: "alice" }, created_at: `2026-01-0${index + 1}T12:00:00Z` })),
      { event: "cross-referenced", actor: { login: "bob" }, created_at: "2026-01-02T12:00:00Z",
        source: { issue: { number: 99, title: "A related PR, not the closer", state: "closed",
          html_url: "https://github.com/owner/repo/pull/99", repository: { full_name: "owner/repo" },
          pull_request: { merged_at: "2026-01-02T12:00:00Z" } } } },
    ] })
    let queries = 0
    const client = createGitHubClient({ ...stub, async graphql<T>(query: string) {
      queries++
      expect(query).toContain("ClosedEvent")
      for (const id of ["C1", "C2", "C3", "C4"]) expect(query).toContain(id)
      return { data: { nodes: [
        { id: "C2", closer: null },
        { id: "C3", closer: { __typename: "Commit", oid: sha, messageHeadline: "Close with a commit",
          url: `https://github.com/other/repo/commit/${sha}`, repository: { nameWithOwner: "other/repo" } } },
        { id: "C1", closer: { __typename: "PullRequest", number: 4, title: "The actual fix",
          url: "https://github.com/owner/repo/pull/4", repository: { nameWithOwner: "owner/repo" } } },
        { id: "C4", closer: { __typename: "ProjectV2" } },
      ] } } as T
    } })
    const timeline = await client.issueTimeline("owner/repo", 42)
    const stateEvents = timeline.events.filter((event) => event.kind === "state")
    expect(queries).toBe(1)
    expect(stateEvents[0]?.closer).toEqual({ kind: "pull", number: 4, title: "The actual fix",
      url: "https://github.com/owner/repo/pull/4", repository: "owner/repo" })
    expect(stateEvents[1]?.closer).toBeUndefined()
    expect(stateEvents[2]?.closer).toMatchObject({ kind: "commit", sha, repository: "other/repo" })
    expect(stateEvents[3]?.closer).toBeUndefined()
    expect(timeline.references[0]).toMatchObject({ kind: "pull", number: 99 })
    const failing = createGitHubClient({ ...stub, async graphql<T>(): Promise<T> { throw new Error("GraphQL unavailable") } })
    const fallback = await failing.issueTimeline("owner/repo", 42)
    expect(fallback.events).toHaveLength(4)
    expect(fallback.events.every((event) => event.kind !== "state" || event.closer === undefined)).toBe(true)
    expect(fallback.references).toHaveLength(1)
  })

  test("retains closure actors and times, reopening history, and a single merged event across pages", async () => {
    const path = "repos/owner/repo/issues/42/timeline?per_page=100&page="
    const closed = { id: 1, event: "closed", actor: { login: "alice" }, created_at: "2026-01-01T12:00:00Z" }
    const reopened = { id: 2, event: "reopened", actor: null, created_at: "2026-01-02T12:00:00Z" }
    const merged = { id: 4, event: "merged", actor: { login: "bob" }, created_at: "2026-01-03T12:00:00+00:00" }
    const calls: string[] = []
    const stub = transport({
      [`${path}1`]: [closed, reopened, ...Array.from({ length: 98 }, () => ({ event: "commented" }))],
      [`${path}2`]: [closed, { ...closed, id: 3, created_at: "2026-01-03T12:00:00Z" }, merged,
        { ...closed, id: 5, created_at: "invalid" }, { ...closed, id: 6, created_at: null }],
    })
    const client = createGitHubClient({ ...stub, async json<T>(endpoint: string) {
      calls.push(endpoint)
      return stub.json<T>(endpoint)
    } })
    const timeline = await client.issueTimeline("owner/repo", 42)
    expect(timeline.references).toEqual([])
    expect(timeline.events.filter((entry) => entry.kind === "state").map(({ event, actor, createdAt }) => ({ event, actor, createdAt }))).toEqual([
      { event: "closed", actor: "alice", createdAt: closed.created_at },
      { event: "reopened", actor: "ghost", createdAt: reopened.created_at },
      { event: "merged", actor: "bob", createdAt: merged.created_at },
    ])
    expect(calls).toEqual([`${path}1`, `${path}2`])
  })

  test("maps timeline mentions without comments or PR hydration", async () => {
    const createdAt = "2026-10-11T06:18:45Z"
    const source = {
      number: 11082,
      title: "[AI] fix(edge): acknowledge the persisted version in EdgeShard::flush",
      html_url: "https://github.com/qdrant/qdrant/pull/11082",
      state: "closed",
      draft: false,
      repository: { full_name: "qdrant/qdrant" },
      pull_request: {
        url: "https://api.github.com/repos/qdrant/qdrant/pulls/11082",
        merged_at: "2026-10-11T08:40:06Z",
      },
    }
    const event = {
      event: "cross-referenced", actor: { login: "Harsh23Kashyap" }, created_at: createdAt,
      source: { type: "issue", issue: source },
    }
    const path = "repos/qdrant/qdrant/issues/11069/timeline?per_page=100&page=1"
    const calls: string[] = []
    const stub = transport({
      [path]: [event, {
        ...event, actor: null, created_at: "2026-10-12T00:00:00Z",
        source: { issue: {
          ...source, number: 7, state: "open", draft: true,
          repository: { full_name: "other/repo" }, html_url: "https://github.com/other/repo/pull/7",
          pull_request: { merged_at: null },
        } },
      }],
    })
    const client = createGitHubClient({
      ...stub,
      async json<T>(endpoint: string) {
        calls.push(endpoint)
        return stub.json<T>(endpoint)
      },
    })
    expect(await client.issueReferences("qdrant/qdrant", 11069)).toEqual([
      {
        kind: "pull", id: `cross-referenced:qdrant/qdrant:11082:${createdAt}:Harsh23Kashyap`,
        repository: "qdrant/qdrant", number: 11082, title: source.title, url: source.html_url,
        state: "closed", merged: true, draft: false, actor: "Harsh23Kashyap", createdAt,
      },
      {
        kind: "pull", id: "cross-referenced:other/repo:7:2026-10-12T00:00:00Z:ghost",
        repository: "other/repo", number: 7, title: source.title, url: "https://github.com/other/repo/pull/7",
        state: "open", merged: false, draft: true, actor: "ghost", createdAt: "2026-10-12T00:00:00Z",
      },
    ])
    expect(calls).toEqual([path])
  })

  test("paginates raw timeline pages, deduplicates mentions, skips malformed sources and propagates failures", async () => {
    const path = "repos/owner/repo/issues/42/timeline?per_page=100&page="
    const event = {
      event: "cross-referenced", actor: null, created_at: "2026-01-02T00:00:00Z",
      source: { issue: {
        number: 7, title: "Referenced pull", html_url: "https://github.com/other/repo/pull/7",
        state: "closed", repository: { full_name: "other/repo" }, pull_request: { merged_at: null },
      } },
    }
    const unrelated = Array.from({ length: 100 }, () => ({ event: "commented" }))
    const earlier = { ...event, created_at: "2026-01-01T00:00:00Z" }
    const pages = {
      [`${path}1`]: unrelated,
      [`${path}2`]: [event, ...unrelated.slice(1)],
      [`${path}3`]: [
        event, earlier, null, { ...event, source: null }, { ...event, source: { issue: null } },
        { ...event, source: { issue: {} } },
        { ...event, source: { issue: { ...event.source.issue, repository: null } } },
        { ...event, source: { issue: { ...event.source.issue, number: "7" } } },
        { ...event, source: { issue: { ...event.source.issue, state: "unknown" } } },
        { ...event, source: { issue: { ...event.source.issue, html_url: null } } },
        { ...event, created_at: null },
        { ...event, event: "connected" }, { ...event, event: "disconnected" },
      ],
    }
    const references = await createGitHubClient(transport(pages)).issueReferences("owner/repo", 42)
    expect(references).toHaveLength(2)
    expect(references.map(({ createdAt }) => createdAt)).toEqual([earlier.created_at, event.created_at])
    expect(references[0]).toMatchObject({ draft: false, merged: false, actor: "ghost", repository: "other/repo" })
    expect(references[0]?.id).not.toBe(references[1]?.id)

    const failing = createGitHubClient(transport({ ...pages, [`${path}3`]: new Error("Timeline unavailable") }))
    await expect(failing.issueReferences("owner/repo", 42)).rejects.toThrow("Timeline unavailable")
  })

  test("maps mixed references, shares commit hydration, and keeps inaccessible commits visible", async () => {
    const sha = "a".repeat(40)
    const privateSha = "b".repeat(40)
    const path = "repos/owner/repo/issues/42/timeline?per_page=100&page=1"
    const commitEvent = {
      event: "referenced", actor: null, created_at: "2026-01-01T12:30:00+02:00",
      commit_id: sha, commit_url: `https://api.github.com/repos/other/repo/commits/${sha}`,
    }
    const issueEvent = {
      event: "cross-referenced", actor: { login: "alice" }, created_at: "2026-01-01T11:00:00Z",
      source: { type: "issue", issue: {
        number: 7, title: "A related regular issue", state: "open",
        html_url: "https://github.com/other/repo/issues/7", repository: { full_name: "other/repo" },
      } },
    }
    const pullEvent = {
      ...issueEvent, created_at: "2026-01-01T11:30:00Z",
      source: { type: "issue", issue: { ...issueEvent.source.issue,
        number: 8, html_url: "https://github.com/other/repo/pull/8", pull_request: { merged_at: null },
      } },
    }
    const calls: string[] = []
    const stub = transport({
      [path]: [
        issueEvent, pullEvent, commitEvent, commitEvent,
        { ...commitEvent, created_at: "2026-01-01T12:00:00Z" },
        { ...commitEvent, created_at: "2026-01-01T13:00:00Z", commit_id: privateSha,
          commit_url: `https://api.github.com/repos/private/repo/commits/${privateSha}` },
        { ...commitEvent, commit_url: `https://evil.invalid/repos/other/repo/commits/${sha}` },
        { ...commitEvent, commit_url: `https://user:secret@api.github.com/repos/other/repo/commits/${sha}` },
        { ...commitEvent, commit_url: `https://api.github.com/repos/other/repo/commits/${privateSha}` },
        { ...commitEvent, created_at: "invalid" },
        { ...commitEvent, commit_id: "invalid" },
        { event: "commented" },
      ],
      [`repos/other/repo/commits/${sha}`]: { sha, commit: { message: "A useful commit title\n\nFull message body" } },
      [`repos/private/repo/commits/${privateSha}`]: new Error("Commit inaccessible"),
    })
    const client = createGitHubClient({ ...stub, async json<T>(endpoint: string) {
      calls.push(endpoint)
      return stub.json<T>(endpoint)
    } })
    const references = await client.issueReferences("owner/repo", 42)
    expect(references.map((reference) => reference.kind)).toEqual(["commit", "issue", "pull", "commit", "commit"])
    expect(references[0]).toMatchObject({
      kind: "commit", sha, repository: "other/repo", title: "A useful commit title", actor: "ghost",
      url: `https://github.com/other/repo/commit/${sha}`,
    })
    expect(references[1]).toMatchObject({ kind: "issue", number: 7, state: "open", title: "A related regular issue" })
    expect(references[1]).not.toHaveProperty("merged")
    expect(references[3]).toMatchObject({ kind: "commit", sha, title: "A useful commit title" })
    expect(references[0]?.id).not.toBe(references[3]?.id)
    expect(references[4]).toMatchObject({ kind: "commit", sha: privateSha, title: `Commit ${privateSha.slice(0, 7)}` })
    expect(calls).toEqual([path, `repos/other/repo/commits/${sha}`, `repos/private/repo/commits/${privateSha}`])
  })

})

test("workflow details map nullable fields and fetch jobs for the selected attempt", async () => {
  const client = createGitHubClient(transport({
    "repos/owner/repo/actions/runs/42": {
      id: 42, name: "CI", display_title: "Build", status: "in_progress", conclusion: null,
      created_at: "2026-04-14T09:02:00Z", updated_at: "2026-04-14T09:03:00Z", run_started_at: null,
      html_url: "https://github.com/owner/repo/actions/runs/42", run_number: 10, run_attempt: 3,
      event: "push", head_branch: null, head_sha: "abc", actor: null, path: ".github/workflows/ci.yml",
    },
    "repos/owner/repo/actions/runs/42/attempts/3/jobs?per_page=30&page=2": {
      total_count: 61, jobs: [{ id: 7, name: "Test", status: "queued", conclusion: null,
        started_at: null, completed_at: null, runner_name: null,
        steps: [{ number: 1, name: "Setup", status: "queued", conclusion: null, started_at: null, completed_at: null }] }],
    },
  }))
  expect(await client.run("owner/repo", 42)).toMatchObject({ id: 42, attempt: 3, branch: "", actor: "ghost", conclusion: "", startedAt: null })
  const jobs = await client.runJobs("owner/repo", 42, 3, 2)
  expect(jobs.hasMore).toBe(true)
  expect(jobs.items[0]).toMatchObject({ id: 7, runner: "", conclusion: "", steps: [{ number: 1, conclusion: "" }] })
})

test("workflow run pages map nullable fields and report further pages from the total count", async () => {
  const run = (id: number, conclusion: string | null = "success") => ({
    id, name: "CI", display_title: `Build ${id}`, status: "completed", conclusion, created_at: "2026-04-14T09:02:00Z" })
  const client = createGitHubClient(transport({
    "repos/owner/repo/actions/runs?per_page=30&page=1": { total_count: 31, workflow_runs: [run(1), run(2, null)] },
    "repos/owner/repo/actions/runs?per_page=30&page=2": { total_count: 31, workflow_runs: [run(31)] },
    "repos/owner/empty/actions/runs?per_page=30&page=1": { total_count: 0, workflow_runs: [] },
  }))
  expect(await client.runs("owner/repo")).toEqual({ hasMore: true, items: [
    { id: 1, name: "CI", title: "Build 1", status: "completed", conclusion: "success", createdAt: "2026-04-14T09:02:00Z" },
    { id: 2, name: "CI", title: "Build 2", status: "completed", conclusion: "", createdAt: "2026-04-14T09:02:00Z" },
  ] })
  expect(await client.runs("owner/repo", 2)).toMatchObject({ hasMore: false, items: [{ id: 31 }] })
  expect(await client.runs("owner/empty")).toEqual({ items: [], hasMore: false })
})

test("a malformed workflow runs response fails instead of becoming an empty page", async () => {
  const path = "repos/owner/repo/actions/runs?per_page=30&page=1"
  const run = { id: 1, name: "CI", display_title: "Build", status: "completed", conclusion: null, created_at: "2026-04-14T09:02:00Z" }
  for (const response of [
    null, {}, [], { message: "Unexpected" },
    { total_count: 1 }, { total_count: 1, workflow_runs: null }, { total_count: 1, workflow_runs: {} }, { total_count: 1, workflow_runs: "none" },
    { workflow_runs: [run] }, { total_count: null, workflow_runs: [run] }, { total_count: "1", workflow_runs: [run] },
    { total_count: -1, workflow_runs: [run] }, { total_count: 1.5, workflow_runs: [run] }, { total_count: Number.MAX_SAFE_INTEGER + 1, workflow_runs: [run] },
  ]) {
    await expect(createGitHubClient(transport({ [path]: response })).runs("owner/repo"))
      .rejects.toThrow("GitHub returned an invalid workflow runs response.")
  }
})

test("timeline propagates inherited options, bounds raw pages and preserves cancellation during enrichment", async () => {
  const budget = createRequestBudget()
  let calls = 0
  const client = createGitHubClient({
    ...transport(),
    async json<T>(_path: string, options?: RequestOptions) {
      expect(options?.budget).toBe(budget)
      expect(options?.signal).toBe(budget.signal)
      calls++
      return Array(100).fill(null) as T
    },
  })
  try {
    await expect(client.issueTimeline("owner/repo", 42, { budget })).rejects.toThrow("incomplete")
    expect(calls).toBe(20)
    expect(budget.signal.aborted).toBe(false)
  } finally { budget.dispose() }

  for (const error of [new DOMException("Stopped", "AbortError"), new ResponseLimitError("Response too large")]) {
    const controller = new AbortController()
    const enriching = createGitHubClient({
      ...transport(),
      async json<T>() {
        return [{ id: 1, node_id: "C1", event: "closed", created_at: "2026-01-01T00:00:00Z" }] as T
      },
      async graphql<T>(): Promise<T> { if (error.name === "AbortError") controller.abort(error); throw error },
    })
    await expect(enriching.issueTimeline("owner/repo", 42, { signal: controller.signal })).rejects.toBe(error)
  }
})

test("raw item overflow includes timelines, comments, and nested job steps", async () => {
  const client = createGitHubClient({ ...transport(), async json<T>() { return Array(10_001).fill(null) as T } })
  await expect(client.issueReferences("owner/repo", 42)).rejects.toThrow("item limit")
  const budget = createRequestBudget()
  const comments = createGitHubClient(transport({
    "repos/owner/repo/issues/42/comments?per_page=100&page=1": Array(2).fill({ id: 1, user: null, body: "comment", created_at: "2026-01-01", updated_at: "2026-01-01" }),
  }))
  try {
    budget.consumeItems(MAX_DETAIL_ITEMS - 1)
    await expect(comments.issueComments("owner/repo", 42, 1, { budget })).rejects.toThrow("item limit")
  } finally { budget.dispose() }
  const jobsBudget = createRequestBudget()
  const jobs = createGitHubClient(transport({
    "repos/owner/repo/actions/runs/42/attempts/1/jobs?per_page=30&page=1": {
      total_count: 1, jobs: [{ id: 1, name: "job", status: "queued", steps: Array(MAX_DETAIL_ITEMS).fill({ number: 1, name: "step", status: "queued" }) }],
    },
  }))
  try { await expect(jobs.runJobs("owner/repo", 42, 1, 1, { budget: jobsBudget })).rejects.toThrow("item limit") }
  finally { jobsBudget.dispose() }
})

test("cached A displays and authorizes A, then writes A after its name is reused by B", async () => {
  const target = { ...repository, id: 71, nodeId: "R_A", nameWithOwner: "owner/repo" }
  const date = "2026-01-01T00:00:00Z"
  const a = { number: 42, state: "open", title: "A details", user: null, created_at: date,
    html_url: "https://github.com/moved/A/issues/42", body: "A body", updated_at: date,
    closed_at: null, state_reason: null, locked: true, labels: [], assignees: [], comments: 0 }
  const calls: string[] = []
  let permissionCalls = 0
  const client = createGitHubClient({
    async json<T>(path: string) {
      calls.push(path)
      return (path.startsWith("repositories/71/") ? a : { ...a, title: "B details", body: "B body" }) as T
    },
    async text() { return "" },
    async graphql<T>(query: string, variables: Record<string, string>) {
      permissionCalls++
      expect(query).toContain("repository: node(id: $repositoryId)")
      expect(query).toContain("... on Repository { id")
      expect(query).not.toContain("$owner")
      expect(query).not.toContain("$name")
      const isA = variables.repositoryId === "R_A"
      return { data: { repository: { id: isA ? "R_A" : "R_B", isArchived: false,
        viewerPermission: isA ? "ADMIN" : "READ",
        issue: { viewerCanClose: isA, viewerCanReopen: false, viewerCanAssign: isA } } } } as T
    },
    async mutate<T>(path: string, _method: "POST" | "PATCH", input: Record<string, unknown>) {
      calls.push(path)
      return { ...a, state: input.state, state_reason: input.state_reason } as T
    },
  })
  expect(await client.issue(target, 42)).toMatchObject({ title: "A details", body: "A body", permissions: { close: true, comment: true } })
  expect(await client.updateIssueState(target, 42, "closed")).toMatchObject({ title: "A details", state: "closed", permissions: { close: true } })
  expect(calls).toEqual(["repositories/71/issues/42", "repositories/71/issues/42"])
  expect(permissionCalls).toBe(2)
  await expect(client.issue({ ...target, id: 0 }, 42)).rejects.toThrow("Repository ID")
  await expect(client.issue({ ...target, nodeId: "" }, 42)).rejects.toThrow("node ID")
})

test("bound timeline hydrates this repository by ID while keeping foreign commit sources labeled", async () => {
  const sha = "a".repeat(40)
  const paths: string[] = []
  const target = { id: 71, nodeId: "R_A", nameWithOwner: "owner/repo" }
  const client = createGitHubClient({
    async json<T>(path: string) {
      paths.push(path)
      if (path.includes("/timeline?")) return ["owner/repo", "foreign/repo"].map(repository => ({
        event: "referenced", created_at: "2026-01-01T00:00:00Z", commit_id: sha,
        commit_url: `https://api.github.com/repos/${repository}/commits/${sha}`,
      })) as T
      return { sha, commit: { message: path.startsWith("repositories/71/") ? "A commit" : "Foreign commit" } } as T
    },
    async text() { return "" },
  })
  const references = await client.issueReferences(target, 42)
  expect(references.map(reference => [reference.repository, reference.title])).toEqual([
    ["owner/repo", "A commit"], ["foreign/repo", "Foreign commit"],
  ])
  expect(paths).toEqual(["repositories/71/issues/42/timeline?per_page=100&page=1", `repositories/71/commits/${sha}`, `repos/foreign/repo/commits/${sha}`])
})

test("text references share the detail budget, pin local targets by ID and propagate response limits", async () => {
  const target = { id: 71, nodeId: "R_A", nameWithOwner: "owner/repo" }
  const budget = createRequestBudget()
  const options = { budget, signal: budget.signal }
  const paths: string[] = []
  let limited = false
  const limit = new ResponseLimitError("Reference response too large")
  const client = createGitHubClient({
    async json<T>(path: string, received?: RequestOptions) {
      expect(received).toBe(options)
      paths.push(path)
      if (path.includes("/commits/")) return {
        sha: "a".repeat(40), author: null, committer: null,
        commit: { message: "Fix #2 and foreign/repo#3", author: null },
        stats: { additions: 0, deletions: 0 }, files: [],
      } as T
      if (limited) throw limit
      return { number: path.endsWith("/2") ? 2 : 3, title: "Reference", state: "open" } as T
    },
    async text() { return "" },
  })
  try {
    const detail = await client.commit(target, "a".repeat(40), 1, options)
    expect(detail.references?.map(ref => ref.repository)).toEqual(["owner/repo", "foreign/repo"])
    expect(paths).toEqual([
      `repositories/71/commits/${"a".repeat(40)}?per_page=100&page=1`,
      "repositories/71/issues/2", "repos/foreign/repo/issues/3",
    ])
    // One commit plus two raw reference responses were charged to the same budget.
    expect(() => budget.consumeItems(MAX_DETAIL_ITEMS - 3)).not.toThrow()
    expect(() => budget.consumeItems(1)).toThrow("item limit")
  } finally { budget.dispose() }
  limited = true
  const nextBudget = createRequestBudget()
  options.budget = nextBudget
  options.signal = nextBudget.signal
  try { await expect(client.commit(target, "a".repeat(40), 1, options)).rejects.toBe(limit) }
  finally { nextBudget.dispose() }
})

test("write routing rejects missing or unsafe repository IDs instead of falling back to names", async () => {
  let calls = 0
  const client = createGitHubClient({ ...transport(), async mutate<T>(): Promise<T> { calls++; throw new Error("Unexpected write") } })
  for (const id of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(client.createIssueComment({ ...repository, id }, 42, "body")).rejects.toThrow("Repository ID")
  }
  expect(calls).toBe(0)
})
