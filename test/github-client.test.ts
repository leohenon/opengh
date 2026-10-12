import { describe, expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import type { GitHubTransport } from "../src/github/transport"

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
  test("maps repository metadata", async () => {
    const client = createGitHubClient(transport({
      "repos/owner/repo": {
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
    expect(repo.nameWithOwner).toBe("owner/repo")
    expect(repo.url).toBe("https://github.com/owner/repo")
    expect(repo.description).toBe("No description provided.")
    expect(repo.language).toBe("Unknown")
  })

  test("preserves complete commit SHAs", async () => {
    const sha = "a".repeat(40)
    const path = "repos/owner/repo/commits?per_page=30&page=1&sha=main"
    const client = createGitHubClient(transport({
      [path]: [{
        sha,
        author: { login: "octocat" },
        commit: { message: "title\n\nbody", author: { name: "Octo Cat", date: "2026-01-01T00:00:00Z" } },
      }],
    }))
    const result = await client.commits("owner/repo", "main")
    expect(result.items[0]?.sha).toBe(sha)
    expect(result.items[0]?.message).toBe("title")
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

  test("distinguishes merged pulls from closed and open pulls", async () => {
    const base = { title: "Pull", user: { login: "octocat" }, created_at: "2026-01-01T00:00:00Z" }
    const client = createGitHubClient(transport({
      "repos/owner/repo/pulls?state=closed&per_page=30&page=1": [
        { ...base, number: 1, state: "closed", merged_at: "2026-01-02T00:00:00Z" },
        { ...base, number: 2, state: "closed", merged_at: null },
      ],
      "repos/owner/repo/pulls?state=open&per_page=30&page=1": [
        { ...base, number: 3, state: "open", merged_at: null },
      ],
    }))
    expect((await client.pulls("owner/repo", "closed")).items.map(({ number, state, merged }) => ({ number, state, merged })))
      .toEqual([{ number: 1, state: "closed", merged: true }, { number: 2, state: "closed", merged: false }])
    expect((await client.pulls("owner/repo", "open")).items[0]).toMatchObject({ number: 3, state: "open", merged: false })
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
