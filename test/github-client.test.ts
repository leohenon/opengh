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
