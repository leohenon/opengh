import { describe, expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import { GitHubApiError, type GitHubTransport } from "../src/github/transport"

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

  test("treats only README 404 as missing", async () => {
    const path = "repos/owner/repo/readme?ref=main"
    const missing = createGitHubClient(transport({}, new GitHubApiError(path, "Not Found", 404)))
    expect(await missing.readme("owner/repo", "main")).toBe("No README found.")

    const forbidden = createGitHubClient(transport({}, new GitHubApiError(path, "Forbidden", 403)))
    expect(forbidden.readme("owner/repo", "main")).rejects.toThrow("Forbidden")
  })

  test("falls back to the default branch only for an empty response", async () => {
    const path = "repos/owner/repo/branches?per_page=100"
    const client = createGitHubClient(transport({ [path]: [] }))
    expect(await client.branches("owner/repo", "main")).toEqual(["main"])

    const failing = createGitHubClient(transport({ [path]: new Error("Unavailable") }))
    expect(failing.branches("owner/repo", "main")).rejects.toThrow("Unavailable")
  })
})
