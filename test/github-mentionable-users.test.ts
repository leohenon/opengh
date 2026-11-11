import { expect, test } from "bun:test"
import { createMentionableUserLoader } from "../src/github/mentionable-users"
import type { RepositoryReference } from "../src/github/repository-target"
import type { RequestBudget } from "../src/github/request-budget"
import type { GitHubTransport, RequestOptions } from "../src/github/transport"

const target = { id: 42, nodeId: "R_42", nameWithOwner: "old/name" }
const response = (nodes: unknown = [{ login: "alice" }]) => ({ data: { repository: { id: "R_42", mentionableUsers: { nodes } } } })

function fixture(value: unknown) {
  const calls: { query: string; variables: Record<string, string>; options?: RequestOptions }[] = []
  const transport: GitHubTransport = {
    async json<T>(): Promise<T> { throw new Error("Unexpected REST request") },
    async text() { throw new Error("Unexpected text request") },
    async graphql<T>(query: string, variables: Record<string, string>, options?: RequestOptions) {
      calls.push({ query, variables, options })
      if (value instanceof Error) throw value
      return value as T
    },
  }
  return { transport, calls, load: createMentionableUserLoader(transport) }
}

test("string selector uses variables and one bounded read-only query", async () => {
  const { calls, load } = fixture(response())
  expect(await load("owner/repo", "a-b9")).toEqual(["alice"])
  expect(calls).toHaveLength(1)
  expect(calls[0]!.variables).toEqual({ owner: "owner", name: "repo", query: "a-b9" })
  expect(calls[0]!.query).toContain("$query: String!")
  expect(calls[0]!.query).toContain("repository(owner: $owner, name: $name)")
  expect(calls[0]!.query).toContain("mentionableUsers(first: 30, query: $query)")
  expect(calls[0]!.query).toMatch(/^query /)
  expect(calls[0]!.query).not.toContain("a-b9")
  expect(calls[0]!.query).not.toContain("mutation")
})

test("node selector preserves immutable repository identity instead of the old name", async () => {
  const { calls, load } = fixture(response())
  expect(await load(target, "")).toEqual(["alice"])
  expect(calls[0]!.variables).toEqual({ repositoryId: "R_42", query: "" })
  expect(calls[0]!.query).toContain("$repositoryId: ID!")
  expect(calls[0]!.query).toContain("repository: node(id: $repositoryId) { ... on Repository { id")
  expect(calls[0]!.query).not.toContain("old/name")
  for (const id of [undefined, null, 42, "R_other"]) {
    const value = response()
    Object.assign(value.data.repository, { id })
    await expect(fixture(value).load(target, "")).rejects.toThrow("identity")
  }
})

test.each(["a".repeat(40), "a b", "a\nb", "a\tb", "a/b", "@alice", "a_b", 'a") { viewer { login } }', "a\\b", "é", "alice[bot]", "a\u0000", "a\u007f"])("rejects malformed query %j before dispatch", async query => {
  const { calls, load } = fixture(response())
  await expect(load("owner/repo", query)).rejects.toThrow("query")
  expect(calls).toHaveLength(0)
})

test("accepts empty and maximum-length fragments without interpolating them", async () => {
  const { calls, load } = fixture(response([]))
  for (const query of ["", "A9-".repeat(13)]) {
    expect(await load("owner/repo", query)).toEqual([])
    expect(calls.at(-1)!.variables.query).toBe(query)
  }
})

test("rejects invalid repository selectors before dispatch", async () => {
  const { calls, load } = fixture(response())
  for (const repository of ["../repo", "owner/repo/extra", { ...target, nodeId: "" }, { ...target, id: 0 }] satisfies RepositoryReference[]) {
    await expect(load(repository, "")).rejects.toThrow()
  }
  expect(calls).toHaveLength(0)
})

test("skips null nodes and deduplicates safe logins case-insensitively", async () => {
  const { load } = fixture(response([null, { login: "Alice" }, { login: "alice" }, { login: "a-b9" }, { login: "dependabot[bot]" }, { login: "DEPENDABOT[bot]" }, { login: "a".repeat(39) }]))
  expect(await load("owner/repo", "")).toEqual(["Alice", "a-b9", "dependabot[bot]", "a".repeat(39)])
  expect(await fixture(response([null])).load("owner/repo", "")).toEqual([])
})

test.each([null, undefined, [], {}, { data: null }, { data: {} }, { data: { repository: null } }, { data: { repository: [] } }, { data: { repository: {} } }, { data: { repository: { mentionableUsers: null } } }, response(null), response({}), response("nodes"), response(Array.from({ length: 31 }, () => ({ login: "alice" })))])("rejects missing or malformed response %j", async value => {
  await expect(fixture(value).load("owner/repo", "")).rejects.toThrow()
})

test.each([{}, [], "alice", 1, { login: null }, { login: 1 }, { login: "" }, { login: "-" }, { login: "-alice" }, { login: "a".repeat(40) }, { login: "a b" }, { login: "a\nb" }, { login: "a/b" }, { login: "a\\b" }, { login: "@alice" }, { login: "é" }, { login: "[bot]" }, { login: "a\u0000" }, { login: "a\u007f" }])("rejects malformed non-null user node %j", async node => {
  await expect(fixture(response([{ login: "valid" }, node])).load("owner/repo", "")).rejects.toThrow("login")
})

test("rejects GraphQL errors even with otherwise valid partial data", async () => {
  for (const errors of [[{ message: "denied" }], "denied", {}, null]) {
    await expect(fixture({ ...response(), errors }).load("owner/repo", "")).rejects.toThrow("query failed")
  }
  expect(await fixture({ ...response(), errors: [] }).load("owner/repo", "")).toEqual(["alice"])
})

test("forwards request options unchanged and accounts for unique output items", async () => {
  const controller = new AbortController()
  const counts: number[] = []
  const budget: RequestBudget = {
    signal: controller.signal,
    takeRequest() {}, consumeBytes() {}, dispose() {},
    consumeItems(count) { counts.push(count) },
  }
  const options = { signal: controller.signal, budget, maxBytes: 4096, limitMessage: "too large" }
  const { load, calls } = fixture(response([{ login: "Alice" }, null, { login: "alice" }, { login: "bob" }]))
  expect(await load(target, "a", options)).toEqual(["Alice", "bob"])
  expect(calls[0]!.options).toBe(options)
  expect(calls[0]!.options!.signal).toBe(controller.signal)
  expect(counts).toEqual([2])
  const error = new Error("item budget exhausted")
  budget.consumeItems = () => { throw error }
  await expect(load(target, "", options)).rejects.toBe(error)
})

test("propagates transport cancellation and failures", async () => {
  for (const error of [new DOMException("Cancelled", "AbortError"), new Error("Rate limited")]) {
    await expect(fixture(error).load("owner/repo", "")).rejects.toBe(error)
  }
})

test("fails clearly when GraphQL is unsupported without a REST fallback", async () => {
  const { transport, calls } = fixture(response())
  delete transport.graphql
  await expect(createMentionableUserLoader(transport)("owner/repo", "")).rejects.toThrow("does not support GraphQL")
  expect(calls).toHaveLength(0)
})
