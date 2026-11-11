import { expect, test } from "bun:test"
import { createGitHubReviews } from "../src/github/reviews"
import { createRequestBudget, MAX_DETAIL_REQUESTS, RequestBudgetLimitError } from "../src/github/request-budget"
import type { GitHubTransport, RequestOptions } from "../src/github/transport"
import type { ReviewDraft, InlineCommentInput } from "../src/review-types"
import { createInlineComments, InlineCommentUncertainError } from "../src/inline-comments"

test("review reconciliation shares its request ceiling across candidate comment collections", async () => {
  let calls = 0
  let owned: RequestOptions | undefined
  const draft: ReviewDraft = { accountId: 1, repository: "owner/repo", number: 1, headSha: "a".repeat(40), event: "APPROVE", body: "", comments: [], submission: { startedAt: new Date().toISOString(), reviewIds: [] } }
  const transport: GitHubTransport = {
    text: async () => "",
    json: async <T>(path: string, options?: RequestOptions) => {
      options!.budget!.takeRequest()
      calls++
      owned ??= options
      expect(options!.budget).toBe(owned!.budget)
      if (path.includes("/comments?")) return [{ path: "file", line: 1, side: "RIGHT", body: "different" }] as T
      return (path.endsWith("page=1") ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1, user: { id: 1 }, state: "APPROVED", body: "", commit_id: draft.headSha, submitted_at: "2026-01-01" })) : []) as T
    },
  }
  await expect(createGitHubReviews(transport).reconcile(draft)).rejects.toBeInstanceOf(RequestBudgetLimitError)
  expect(calls).toBe(MAX_DETAIL_REQUESTS)
  expect(owned!.budget!.signal.aborted).toBe(true)
})

test("inline reconciliation limits retain uncertain markers and block retries", async () => {
  const input: InlineCommentInput = { accountId: 1, repository: "owner/repo", number: 2, headSha: "a".repeat(40), baseSha: "b".repeat(40), body: "hello", anchor: { path: "file", line: 1, side: "RIGHT" } }
  let removed = false
  let writes = 0
  let calls = 0
  const transport: GitHubTransport = { text: async () => "", json: async <T>(path: string, options?: RequestOptions) => {
    options!.budget!.takeRequest()
    if (path === "user") return { id: 1 } as T
    calls++
    return Array.from({ length: 100 }, (_, id) => ({ id: id + 1 })) as T
  }, mutate: async <T>() => { writes++; return {} as T } }
  const api = createInlineComments({ transport, storage: {
    load: async () => ({ input, commentIds: [] }), save: async () => {}, update: async () => {}, remove: async () => { removed = true },
  } })
  try { await api.post(input, { retryUnconfirmed: true }); throw new Error("Expected uncertain outcome") }
  catch (error) {
    expect(error).toBeInstanceOf(InlineCommentUncertainError)
    expect((error as InlineCommentUncertainError).retryAllowed).toBe(false)
  }
  expect(calls).toBe(20)
  expect(removed).toBe(false)
  expect(writes).toBe(0)
})

test("review pagination stops on parent cancellation without disposing a borrowed budget", async () => {
  const parent = new AbortController()
  const budget = createRequestBudget()
  let calls = 0
  const transport: GitHubTransport = { text: async () => "", json: async <T>() => {
    calls++
    parent.abort()
    return Array.from({ length: 100 }, (_, id) => ({ id })) as T
  } }
  try {
    await expect(createGitHubReviews(transport).list("owner/repo", 1, { signal: parent.signal, budget })).rejects.toThrow()
    expect(calls).toBe(1)
    expect(budget.signal.aborted).toBe(false)
  } finally { budget.dispose() }
})
