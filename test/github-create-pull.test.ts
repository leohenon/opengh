import { describe, expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import { GitHubApiError, type GitHubTransport } from "../src/github/transport"
import { githubDataFixture } from "./fixtures/github-data"

const repository = { ...githubDataFixture.repo, id: 123 }
const date = "2026-01-01T00:00:00Z"
const body = "  Markdown\r\n\n`$(not a command)`\n"
const pull = {
  number: 43,
  state: "open",
  title: "New pull request",
  user: { login: "viewer" },
  created_at: date,
  updated_at: date,
  html_url: "https://github.com/owner/repo/pull/43",
  body,
  locked: false,
  merged_at: null,
  closed_at: null,
  base: { ref: "main" },
  head: { ref: "topic", repo: null },
  additions: 1,
  deletions: 0,
  changed_files: 1,
  commits: 1,
  comments: 0,
  labels: [],
  assignees: [],
  requested_reviewers: [],
  requested_teams: [],
  mergeable: null,
}

const transport = (): GitHubTransport => ({
  async json<T>(): Promise<T> {
    throw new Error("Unexpected read")
  },
  async text(): Promise<string> {
    throw new Error("Unexpected text request")
  },
})

describe("create pull request", () => {
  test("POSTs base, head, title and raw description, and rejects missing branches or title", async () => {
    const calls: { path: string; method: string; body: Record<string, unknown> }[] = []
    const client = createGitHubClient({
      ...transport(),
      async mutate<T>(path: string, method: "POST" | "PATCH", input: Record<string, unknown>) {
        calls.push({ path, method, body: input })
        return pull as T
      },
    })
    expect(await client.createPull(repository, { base: "main", head: "topic", title: "New pull request", body })).toMatchObject({
      number: 43,
      state: "open",
      title: "New pull request",
      body,
      baseBranch: "main",
      headBranch: "topic",
      author: "viewer",
    })
    await expect(client.createPull(repository, { base: "main", head: "topic", title: "  ", body })).rejects.toThrow(
      "Pull request title is required.",
    )
    await expect(client.createPull(repository, { base: "main", head: " ", title: "Title", body })).rejects.toThrow(
      "Choose a base and a head branch.",
    )
    await expect(client.createPull(repository, { base: "", head: "topic", title: "Title", body })).rejects.toThrow(
      "Choose a base and a head branch.",
    )
    await expect(
      createGitHubClient(transport()).createPull(repository, { base: "main", head: "topic", title: "Title", body }),
    ).rejects.toThrow("does not support mutations")
    expect(calls).toEqual([
      { path: "repositories/123/pulls", method: "POST", body: { base: "main", head: "topic", title: "New pull request", body } },
    ])
  })

  test("sends draft: true only for a draft pull request", async () => {
    const bodies: Record<string, unknown>[] = []
    const client = createGitHubClient({
      ...transport(),
      async mutate<T>(_path: string, _method: "POST" | "PATCH", input: Record<string, unknown>) {
        bodies.push(input)
        return { ...pull, draft: input.draft === true } as T
      },
    })
    expect(await client.createPull(repository, { base: "main", head: "topic", title: "Title", body: "", draft: true })).toMatchObject({
      draft: true,
    })
    expect(await client.createPull(repository, { base: "main", head: "topic", title: "Title", body: "" })).toMatchObject({
      draft: false,
    })
    expect(bodies).toEqual([
      { base: "main", head: "topic", title: "Title", body: "", draft: true },
      { base: "main", head: "topic", title: "Title", body: "" },
    ])
    expect("draft" in bodies[1]!).toBe(false)
  })

  test("passes definite rejections through and warns when creation or its response is unconfirmed", async () => {
    const failing = (respond: () => unknown) =>
      createGitHubClient({
        ...transport(),
        async mutate<T>(): Promise<T> {
          return respond() as T
        },
      })
    const input = { base: "main", head: "topic", title: "Title", body: "" }
    const exists = new GitHubApiError("repositories/123/pulls", "A pull request already exists for owner:topic. (HTTP 422)")
    await expect(
      failing(() => {
        throw exists
      }).createPull(repository, input),
    ).rejects.toBe(exists)
    for (const respond of [
      () => {
        throw new GitHubApiError("repositories/123/pulls", "Bad Gateway (HTTP 502)")
      },
      () => {
        throw new Error("socket hang up")
      },
      () => null,
    ])
      await expect(failing(respond).createPull(repository, input)).rejects.toThrow(
        "Couldn't confirm the pull request was created. Check the pull request list before trying again.",
      )
  })

  test("finds an open pull request for a base and head branch of this repository", async () => {
    const paths: string[] = []
    let items: unknown[] = [pull]
    const client = createGitHubClient({
      ...transport(),
      async json<T>(path: string) {
        paths.push(path)
        return items as T
      },
    })
    expect(await client.openPull(repository, "main", "feature/x")).toEqual({
      number: 43,
      state: "open",
      title: "New pull request",
      author: "viewer",
      createdAt: date,
      merged: false,
      draft: false,
    })
    items = []
    expect(await client.openPull(repository, "main", "feature/x")).toBeUndefined()
    const owner = repository.nameWithOwner.split("/")[0]
    expect(paths).toEqual(
      Array(2).fill(`repositories/123/pulls?state=open&base=main&head=${encodeURIComponent(`${owner}:feature/x`)}&per_page=1`),
    )
  })

  test("summarizes a comparison with encoded branch names and keeps the message only for a single commit", async () => {
    const calls: Array<[string, string | undefined]> = []
    let response: Record<string, unknown> = {
      status: "ahead",
      ahead_by: 1,
      behind_by: 0,
      total_commits: 1,
      files: 2,
      additions: 6,
      deletions: 1,
      message: "Fix\n\nBody",
    }
    const client = createGitHubClient({
      ...transport(),
      async json<T>(path: string, options?: { jq?: string }) {
        calls.push([path, options?.jq])
        return response as T
      },
    })
    expect(await client.comparePull(repository, "main", "feature/x")).toEqual({
      status: "ahead",
      aheadBy: 1,
      behindBy: 0,
      commits: 1,
      files: 2,
      additions: 6,
      deletions: 1,
      message: "Fix\n\nBody",
    })
    response = { status: "diverged", ahead_by: 3, behind_by: 2, total_commits: 3, files: 5, additions: 0, deletions: 4, message: null }
    expect(await client.comparePull(repository, "main", "feature/x")).toEqual({
      status: "diverged",
      aheadBy: 3,
      behindBy: 2,
      commits: 3,
      files: 5,
      additions: 0,
      deletions: 4,
    })
    expect(calls[0]![0]).toBe("repositories/123/compare/main...feature%2Fx")
    expect(calls[0]![1]).toContain("total_commits")
    expect(calls[0]![1]).toContain("[.files[]?.additions] | add // 0")
    for (const invalid of [
      { status: "unknown", ahead_by: 0, behind_by: 0, total_commits: 0, files: 0, additions: 0, deletions: 0 },
      { status: "ahead", ahead_by: -1, behind_by: 0, total_commits: 0, files: 0, additions: 0, deletions: 0 },
      { status: "ahead", ahead_by: 0, behind_by: 0, total_commits: 0 },
      { status: "ahead", ahead_by: 0, behind_by: 0, total_commits: 0, files: 0, additions: 0 },
    ]) {
      response = invalid
      await expect(client.comparePull(repository, "main", "feature/x")).rejects.toThrow("GitHub returned an unexpected comparison.")
    }
  })

  test("loads pull request templates in one GraphQL request, skipping invalid entries", async () => {
    const queries: string[] = []
    let response: unknown = {
      data: {
        repository: {
          pullRequestTemplates: [
            { filename: "PULL_REQUEST_TEMPLATE.md", body: "## Summary\n<!-- keep -->\n" },
            { filename: "bug.md", body: "## Bug\n" },
            { filename: "", body: "No name" },
            { filename: "no-body.md" },
          ],
        },
      },
    }
    const client = createGitHubClient({
      ...transport(),
      async graphql<T>(query: string) {
        queries.push(query)
        return response as T
      },
    })
    expect(await client.pullTemplates(repository)).toEqual([
      { filename: "PULL_REQUEST_TEMPLATE.md", body: "## Summary\n<!-- keep -->\n" },
      { filename: "bug.md", body: "## Bug\n" },
    ])
    expect(queries[0]).toContain("pullRequestTemplates { filename body }")
    response = { data: { repository: { pullRequestTemplates: null } } }
    expect(await client.pullTemplates(repository)).toEqual([])
    response = { errors: [{ message: "Something went wrong" }] }
    await expect(client.pullTemplates(repository)).rejects.toThrow("Something went wrong")
    expect(await createGitHubClient(transport()).pullTemplates(repository)).toEqual([])
  })

  describe("forks", () => {
    const node = (id: number, nameWithOwner: string, extra: Record<string, unknown> = {}) => ({
      databaseId: id,
      id: `R_${id}`,
      nameWithOwner,
      isArchived: false,
      viewerPermission: "ADMIN",
      defaultBranchRef: { name: "main" },
      ...extra,
    })
    const pick = (id: number, nameWithOwner: string, defaultBranch = "main") => ({ id, nodeId: `R_${id}`, nameWithOwner, defaultBranch })
    const browsing = (nameWithOwner: string, id: number) => ({ ...repository, id, nodeId: `R_${id}`, nameWithOwner, defaultBranch: "main" })
    const client = (response: unknown, queries: string[] = []) =>
      createGitHubClient({
        ...transport(),
        async graphql<T>(query: string) {
          queries.push(query)
          return response as T
        },
      })

    test("on the original repository, offers your pushable, unarchived forks as heads", async () => {
      const queries: string[] = []
      const forks = {
        nodes: [
          node(2, "you/repo", { defaultBranchRef: { name: "dev" } }),
          node(3, "your-org/repo", { viewerPermission: "WRITE" }),
          node(4, "other-org/repo", { viewerPermission: "READ" }),
          node(5, "you/old-repo", { isArchived: true }),
          node(2, "you/repo"),
        ],
      }
      expect(
        await client({ data: { repository: { ...node(1, "owner/repo"), parent: null, forks } } }, queries).pullRepositories(
          browsing("owner/repo", 1),
        ),
      ).toEqual({
        bases: [pick(1, "owner/repo")],
        heads: [pick(1, "owner/repo"), pick(2, "you/repo", "dev"), pick(3, "your-org/repo")],
      })
      expect(queries[0]).toContain("forks(first: 100, affiliations: [OWNER, ORGANIZATION_MEMBER])")
    })

    test("on a fork, offers the original repository first as the base, and its other forks as heads", async () => {
      const parent = {
        ...node(1, "owner/repo", { viewerPermission: "READ" }),
        forks: { nodes: [node(2, "you/repo"), node(3, "your-org/repo")] },
      }
      expect(await client({ data: { repository: { ...node(2, "you/repo"), parent } } }).pullRepositories(browsing("you/repo", 2))).toEqual({
        bases: [pick(1, "owner/repo"), pick(2, "you/repo")],
        heads: [pick(2, "you/repo"), pick(1, "owner/repo"), pick(3, "your-org/repo")],
      })
    })

    test("falls back to the browsed repository without GraphQL, and reports GraphQL errors", async () => {
      const self = browsing("owner/repo", 1)
      expect(await createGitHubClient(transport()).pullRepositories(self)).toEqual({
        bases: [pick(1, "owner/repo")],
        heads: [pick(1, "owner/repo")],
      })
      await expect(client({ errors: [{ message: "Something went wrong" }] }).pullRepositories(self)).rejects.toThrow("Something went wrong")
      await expect(client({ data: { repository: null } }).pullRepositories(self)).rejects.toThrow("could not be loaded")
    })

    test("a fork head is sent as owner:branch, with maintainer edits allowed, and finds its open pull request", async () => {
      const bodies: Record<string, unknown>[] = []
      const paths: string[] = []
      const forked = createGitHubClient({
        ...transport(),
        async json<T>(path: string) {
          paths.push(path)
          return [] as T
        },
        async mutate<T>(_path: string, _method: "POST" | "PATCH", input: Record<string, unknown>) {
          bodies.push(input)
          return pull as T
        },
      })
      await forked.createPull(repository, { base: "main", head: "you:topic", title: "Title", body: "" })
      await forked.createPull(repository, { base: "main", head: "topic", title: "Title", body: "" })
      expect(bodies).toEqual([
        { base: "main", head: "you:topic", title: "Title", body: "", maintainer_can_modify: true },
        { base: "main", head: "topic", title: "Title", body: "" },
      ])
      await forked.openPull(repository, "main", "you:topic")
      expect(paths).toEqual([`repositories/123/pulls?state=open&base=main&head=${encodeURIComponent("you:topic")}&per_page=1`])
    })
  })
})
