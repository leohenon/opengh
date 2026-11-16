import { describe, expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import { createRequestBudget, MAX_DETAIL_ITEMS, RequestBudgetLimitError, type RequestBudget } from "../src/github/request-budget"
import type { GitHubTransport, RequestOptions } from "../src/github/transport"

const repository = { id: 123, nodeId: "R_123", nameWithOwner: "renamed/repository" }
const date = "2026-01-01T00:00:00Z"
const issue = (number = 1, overrides: Record<string, unknown> = {}) => ({
  number,
  state: "open",
  title: `Work ${number}`,
  user: { login: "octocat" },
  created_at: date,
  ...overrides,
})
const pull = (number = 1, overrides: Record<string, unknown> = {}) => issue(number, { pull_request: { merged_at: null }, ...overrides })
const search = (items: unknown[], total_count = items.length) => ({ total_count, incomplete_results: false, items })

function fixture(response: unknown | ((path: string) => unknown)) {
  const calls: { path: string; options?: RequestOptions }[] = []
  const transport: GitHubTransport = {
    async json<T>(path: string, options?: RequestOptions) {
      calls.push({ path, options })
      const value = typeof response === "function" ? response(path) : response
      if (value instanceof Error) throw value
      return value as T
    },
    async text() {
      throw new Error("Unexpected text request")
    },
  }
  return { client: createGitHubClient(transport), calls }
}

function searchURL(path: string) {
  const url = new URL(`https://api.github.com/${path}`)
  expect(url.pathname).toBe("/search/issues")
  expect(url.searchParams.get("per_page")).toBe("30")
  expect(url.searchParams.get("sort")).toBe("created")
  expect(url.searchParams.get("order")).toBe("desc")
  expect(url.hash).toBe("")
  return url
}

describe("GitHub work queries", () => {
  test("omitted, empty, and whitespace queries preserve REST listing and summary behavior", async () => {
    const issues = [issue(), ...Array.from({ length: 29 }, (_, index) => pull(index + 2))]
    const pulls = [pull(31, { state: "closed", merged_at: date, draft: true, user: null })]
    const { client, calls } = fixture((path: string) => (path.includes("/pulls?") ? pulls : issues))
    for (const query of [undefined, "", " \t\n "]) {
      expect(await client.issues(repository, "open", 2, undefined, query)).toEqual({
        items: [{ number: 1, state: "open", title: "Work 1", author: "octocat", createdAt: date }],
        hasMore: true,
      })
      expect(await client.pulls(repository, "closed", 3, undefined, query)).toEqual({
        items: [{ number: 31, state: "closed", title: "Work 31", author: "ghost", createdAt: date, merged: true, draft: true }],
        hasMore: false,
      })
    }
    expect(calls.map(({ path }) => path)).toEqual(
      Array.from({ length: 3 }, () => [
        "repositories/123/issues?state=open&per_page=30&page=2",
        "repositories/123/pulls?state=closed&per_page=30&page=3",
      ]).flat(),
    )
  })

  test("encodes text and qualifiers, uses the current repository name, and forwards request options", async () => {
    const { client, calls } = fixture(search([issue(7, { user: null })]))
    const options: RequestOptions = { signal: new AbortController().signal, maxBytes: 4096 }
    const query = '  fix & regression #7 label:"help wanted" author:octocat assignee:hubot in:title -label:wontfix  '
    expect(await client.issues(repository, "open", 1, options, query)).toEqual({
      items: [{ number: 7, state: "open", title: "Work 7", author: "ghost", createdAt: date }],
      hasMore: false,
      total: 1,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.options).toBe(options)
    const url = searchURL(calls[0]!.path)
    expect(url.searchParams.get("q")).toBe(`repo:renamed/repository is:issue state:open ${query.trim()}`)
    expect(url.searchParams.get("page")).toBe("1")
    expect([...url.searchParams.keys()]).toHaveLength(5)
  })

  test("passes @me to GitHub search without another identity request", async () => {
    const { client, calls } = fixture(search([pull()]))
    const query = "review-requested:@me assignee:@me author:@me involves:@me draft:true"
    await client.pulls("owner/repo", "open", undefined, undefined, query)
    expect(calls).toHaveLength(1)
    expect(searchURL(calls[0]!.path).searchParams.get("q")).toBe(`repo:owner/repo is:pr state:open ${query}`)
  })

  test("maps nested PR merge timestamps and optional drafts without detail requests", async () => {
    const { client, calls } = fixture(
      search([
        pull(1, { state: "closed", merged_at: null, pull_request: { merged_at: date }, draft: true }),
        pull(2, { state: "closed", draft: false, user: null }),
        pull(3, { state: "closed", pull_request: {} }),
      ]),
    )
    const result = await client.pulls(repository, "closed", 1, undefined, "label:bug")
    expect(result).toEqual({
      items: [
        { number: 1, state: "closed", title: "Work 1", author: "octocat", createdAt: date, merged: true, draft: true },
        { number: 2, state: "closed", title: "Work 2", author: "ghost", createdAt: date, merged: false, draft: false },
        { number: 3, state: "closed", title: "Work 3", author: "octocat", createdAt: date, merged: false, draft: false },
      ],
      hasMore: false,
      total: 3,
    })
    expect(calls).toHaveLength(1)
    expect(searchURL(calls[0]!.path).searchParams.get("q")).toBe("repo:renamed/repository is:pr state:closed label:bug")
  })

  test("uses totals to stop at exact full pages and handles short or empty pages", async () => {
    for (const method of ["issues", "pulls"] as const) {
      const item = method === "issues" ? issue : pull
      for (const [page, count, total, hasMore] of [
        [1, 0, 0, false],
        [1, 30, 30, false],
        [1, 30, 31, true],
        [2, 1, 31, false],
        [2, 30, 60, false],
        [2, 30, 61, true],
        [3, 0, 60, false],
      ] as const) {
        const { client, calls } = fixture(
          search(
            Array.from({ length: count }, (_, index) => item(index + 1)),
            total,
          ),
        )
        const result = await client[method]("owner/repo", "open", page, undefined, "label:bug")
        expect(result.items).toHaveLength(count)
        expect(result.hasMore).toBe(hasMore)
        expect(searchURL(calls[0]!.path).searchParams.get("page")).toBe(String(page))
      }
    }
  })

  test("keeps per_page=30 at page 34, exposes at most 1000 results, and budgets all fetched items", async () => {
    for (const method of ["issues", "pulls"] as const) {
      const consumed: number[] = []
      const budget: RequestBudget = {
        signal: new AbortController().signal,
        takeRequest() {},
        consumeBytes() {},
        consumeItems(count) {
          consumed.push(count)
        },
        dispose() {},
      }
      const item = method === "issues" ? issue : pull
      const { client, calls } = fixture((path: string) => {
        const page = Number(searchURL(path).searchParams.get("page"))
        return search(
          Array.from({ length: 30 }, (_, index) => item((page - 1) * 30 + index + 1)),
          2000,
        )
      })
      const options = { budget }
      const penultimate = await client[method](repository, "open", 33, options, "label:bug")
      expect(penultimate.items).toHaveLength(30)
      expect(penultimate.hasMore).toBe(true)
      const last = await client[method](repository, "open", 34, options, "label:bug")
      expect(last.items.map(({ number }) => number)).toEqual(Array.from({ length: 10 }, (_, index) => 991 + index))
      expect(last.hasMore).toBe(false)
      for (const page of [35, 100, Number.MAX_SAFE_INTEGER])
        expect(await client[method](repository, "open", page, options, "label:bug")).toEqual({ items: [], hasMore: false })
      expect(calls).toHaveLength(2)
      expect(calls.every((call) => call.options === options)).toBe(true)
      expect(consumed).toEqual([30, 30])
    }
  })

  test("accepts the ten-item final page actually returned by GitHub", async () => {
    const { client } = fixture(
      search(
        Array.from({ length: 10 }, (_, index) => issue(991 + index)),
        1500,
      ),
    )
    const result = await client.issues(repository, "open", 34, undefined, "label:bug")
    expect(result.items).toHaveLength(10)
    expect(result.hasMore).toBe(false)
  })

  test("rejects malformed search envelopes rather than returning an empty page", async () => {
    const valid = search([])
    const malformed = [
      undefined,
      null,
      [],
      {},
      ...[undefined, null, -1, 1.5, "1", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((total_count) => ({ ...valid, total_count })),
      ...[undefined, null, "false", 0].map((incomplete_results) => ({ ...valid, incomplete_results })),
      ...[undefined, null, {}, "items"].map((items) => ({ ...valid, items })),
    ]
    for (const method of ["issues", "pulls"] as const) {
      for (const response of malformed) {
        const { client } = fixture(response)
        await expect(client[method](repository, "open", 1, undefined, "bug")).rejects.toThrow("invalid work search response")
      }
    }
  })

  test("fails explicitly on incomplete results, with no listing fallback", async () => {
    for (const method of ["issues", "pulls"] as const) {
      const item = method === "issues" ? issue() : pull()
      const { client, calls } = fixture({ ...search([item]), incomplete_results: true })
      await expect(client[method](repository, "open", 1, undefined, "bug")).rejects.toThrow("results are incomplete. Narrow the query")
      expect(calls).toHaveLength(1)
    }
  })

  test("validates essential item fields, selected state/type, and optional PR fields", async () => {
    const invalidFields = [
      ...[undefined, null, 0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1].map((number) => ({ number })),
      ...[undefined, null, 1, "", "  "].map((title) => ({ title })),
      ...[undefined, null, "unknown", "OPEN"].map((state) => ({ state })),
      ...[undefined, {}, { login: undefined }, { login: "" }, { login: 1 }, []].map((user) => ({ user })),
      ...[undefined, null, "not a date", 123].map((created_at) => ({ created_at })),
      ...[null, 0, "true"].map((draft) => ({ draft })),
      ...["PR", [], 1].map((pull_request) => ({ pull_request })),
    ]
    for (const method of ["issues", "pulls"] as const) {
      const item = method === "issues" ? issue : pull
      const invalid = [null, [], {}, ...invalidFields.map((fields) => item(1, fields))]
      if (method === "issues") invalid.push(pull())
      else
        invalid.push(
          issue(),
          pull(1, { pull_request: null }),
          pull(1, { pull_request: { merged_at: 1 } }),
          pull(1, { pull_request: { merged_at: "invalid" } }),
        )
      for (const value of invalid) {
        const { client } = fixture(search([value]))
        await expect(client[method](repository, "open", 1, undefined, "bug")).rejects.toThrow("invalid work search item")
      }
    }
  })

  test("rejects scope qualifiers and boolean queries before making any request", async () => {
    const { client, calls } = fixture(search([]))
    const scope = [
      "repo:other/repo",
      "-repo:owner/repo",
      'RePo:"other/repo"',
      "repo :other/repo",
      "org:other",
      "user:other",
      "type:pr",
      "-type:issue",
      "state:closed",
      "-state:open",
      "is:pr",
      'is:"open"',
      "-is:issue",
      "IS:Closed",
      "is: pr",
    ]
    const boolean = ["bug OR regression", "bug OR(label:bug)", "(label:bug)AND(bug)", "NOT label:bug", "bug AND label:bug"]
    for (const method of ["issues", "pulls"] as const) {
      for (const query of scope) await expect(client[method](repository, "open", 1, undefined, query)).rejects.toThrow("Remove repo:")
      for (const query of boolean)
        await expect(client[method](repository, "open", 1, undefined, query)).rejects.toThrow("Boolean operators (AND, OR, NOT)")
      for (const query of ["sort:updated-desc", "label:bug -sort:created"])
        await expect(client[method](repository, "open", 1, undefined, query)).rejects.toThrow("sort: is not supported")
      for (const query of ['label:"unterminated', 'label:"escaped\\" quote"'])
        await expect(client[method](repository, "open", 1, undefined, query)).rejects.toThrow("balanced double quotes")
    }
    expect(calls).toHaveLength(0)
  })

  test("allows lowercase operator words, parentheses, and is: values that do not set type or state", async () => {
    const { client, calls } = fixture(search([]))
    const queries = [
      "does not work",
      "crash or hang",
      "fix (windows)",
      "is:draft",
      "is:merged -is:locked",
      "is:unmerged",
      "user-review-requested:@me",
      "this:open",
    ]
    for (const query of queries) await client.pulls(repository, "open", 1, undefined, query)
    expect(calls.map(({ path }) => searchURL(path).searchParams.get("q"))).toEqual(
      queries.map((query) => `repo:renamed/repository is:pr state:open ${query}`),
    )
  })

  test("drops items the lagging search index still reports under the old state", async () => {
    for (const method of ["issues", "pulls"] as const) {
      const item = method === "issues" ? issue : pull
      const items = Array.from({ length: 30 }, (_, index) => item(index + 1, index === 4 ? { state: "closed" } : {}))
      const { client } = fixture(search(items, 45))
      const result = await client[method](repository, "open", 1, undefined, "label:bug")
      expect(result.items.map(({ number }) => number)).toEqual(items.map(({ number }) => number).filter((number) => number !== 5))
      expect(result.hasMore).toBe(true)
      expect(result.total).toBe(45)
    }
  })

  test("allows quoted literal operators, qualifiers, and parentheses", async () => {
    const { client, calls } = fixture(search([]))
    const query = '"OR" label:"repo:other/repo" "is:pr" "fix (regression)" label:or author:not'
    await client.issues(repository, "open", 1, undefined, query)
    expect(searchURL(calls[0]!.path).searchParams.get("q")).toBe(`repo:renamed/repository is:issue state:open ${query}`)
  })

  test("validates repository names and search pages before requesting", async () => {
    const { client, calls } = fixture(search([]))
    for (const name of ["owner", "owner/..", "owner/repo repo:other/repo", "owner/repo?x=1"]) {
      await expect(client.issues(name, "open", 1, undefined, "bug")).rejects.toThrow("Invalid repository")
      await expect(client.pulls({ ...repository, nameWithOwner: name }, "open", 1, undefined, "bug")).rejects.toThrow("Invalid repository")
    }
    for (const page of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      await expect(client.issues(repository, "open", page, undefined, "bug")).rejects.toThrow("Search page must be a positive safe integer")
    expect(calls).toHaveLength(0)
  })

  test("propagates transport and item-budget failures without retries", async () => {
    const error = new Error("Search rate limited")
    const { client, calls } = fixture(error)
    await expect(client.issues(repository, "open", 1, undefined, "bug")).rejects.toBe(error)
    expect(calls).toHaveLength(1)
    const budget = createRequestBudget()
    try {
      budget.consumeItems(MAX_DETAIL_ITEMS)
      const { client, calls } = fixture(search([pull()]))
      await expect(client.pulls(repository, "open", 1, { budget }, "bug")).rejects.toBeInstanceOf(RequestBudgetLimitError)
      expect(calls).toHaveLength(1)
    } finally {
      budget.dispose()
    }
  })
})
