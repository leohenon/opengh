import { expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import { createRepositorySession, type RepositoryLoaders } from "../src/repository-session"
import type { PullContext, PullRequestDetail, PullMergeMessage } from "../src/models"
import { pullMergeBlocker } from "../src/pull-merge"
import { githubDataFixture } from "./fixtures/github-data"

const head = "a".repeat(40)
const date = "2026-01-01T00:00:00Z"
const context: PullContext = { threads: [], warnings: [], readiness: {
  headSha: head, isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
  reviewDecision: null, checks: [], checksComplete: true,
} }
const raw = { node_id: "PR1", number: 1, state: "open", title: "PR", user: { login: "me" },
  created_at: date, updated_at: date, merged_at: null, closed_at: null, draft: false, locked: false,
  html_url: "https://github.com/o/r/pull/1", body: "", base: { ref: "main" }, head: { ref: "feature", sha: head, repo: null },
  additions: 1, deletions: 0, changed_files: 1, commits: 1, comments: 0, review_comments: 0,
  labels: [], assignees: [], requested_reviewers: [], requested_teams: [], mergeable: true, mergeable_state: "clean" }
function clientFixture(options: { permission?: unknown; queue?: unknown; state?: string; failedCheckRequired?: boolean; method?: unknown; confirmed?: boolean; message?: PullMergeMessage; defaults?: Record<string, unknown>; errors?: unknown } = {}) {
  let writes = 0
  let reads = 0
  const empty = { nodes: [], pageInfo: { hasNextPage: false } }
  const client = createGitHubClient({
    async text() { return "" },
    async json<T>() { if (writes) throw new Error("Post-merge reads unavailable"); reads++; return raw as T },
    async graphql<T>(query: string, variables: Record<string, string>) {
      if (query.startsWith("mutation")) {
        writes++
        expect(variables).toEqual({ id: "PR1", head, method: "SQUASH",
          ...(options.message ? { commitHeadline: options.message.headline, commitBody: options.message.body } : {}) })
        expect(query.includes("commitHeadline: $commitHeadline")).toBe(!!options.message)
        expect(query.includes("commitBody: $commitBody")).toBe(!!options.message)
        expect(query).not.toContain("enqueue")
        return { data: { mergePullRequest: { pullRequest: { id: "PR1", number: 1, headRefOid: head,
          state: options.confirmed === false ? "OPEN" : "MERGED", merged: true, mergedAt: date, updatedAt: date, closedAt: date } } } } as T
      }
      if (query.includes("viewerMergeHeadlineText")) {
        expect(query).toContain("viewerMergeHeadlineText(mergeType: SQUASH)")
        expect(query).toContain("viewerMergeBodyText(mergeType: SQUASH)")
        return { errors: options.errors, data: { repository: { pullRequest: {
          id: "PR1", number: 1, headRefOid: head, viewerMergeHeadlineText: options.message?.headline ?? "Server title",
          viewerMergeBodyText: options.message?.body ?? "Server body", ...options.defaults,
        } } } } as T
      }
      let pull: Record<string, unknown> = {}
      if (query.includes("query PullContext(")) pull = { headRefOid: head, isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: options.state ?? "CLEAN", reviewDecision: null }
      else if (query.includes("query PullThreads(")) pull = { headRefOid: head, reviewThreads: empty }
      else if (query.includes("query PullChecks(")) pull = { headRefOid: head, commits: { nodes: [{ commit: {
        statusCheckRollup: options.failedCheckRequired === undefined ? null : { contexts: { ...empty, nodes: [{
          __typename: "CheckRun", id: "failed-check", name: "expected-failure", status: "COMPLETED",
          conclusion: "FAILURE", isRequired: options.failedCheckRequired,
        }] } },
      } }] } }
      else if (query.includes("query PullProjects(")) pull = { projectItems: empty }
      else if (query.includes("query PullClosingIssues(")) pull = { closingIssuesReferences: empty }
      else if (query.includes("viewerPermission")) {
        expect(query).toContain("isMergeQueueEnabled")
        expect(query).not.toContain("viewerCanMerge")
        pull = { id: "PR1", isMergeQueueEnabled: "queue" in options ? options.queue : false }
      }
      return { data: { repository: { isArchived: false, viewerPermission: "permission" in options ? options.permission : "WRITE",
        mergeCommitAllowed: false, squashMergeAllowed: "method" in options ? options.method : true, rebaseMergeAllowed: false, pullRequest: pull } } } as T
    },
  })
  return { client, writes: () => writes, reads: () => reads }
}

test("fresh preflight rejects unauthorized, unknown, queue, blocked, method and head without mutations", async () => {
  for (const options of [{ permission: "READ" }, { permission: null }, { permission: "UNKNOWN" }, { queue: true },
    { queue: undefined }, { method: undefined }, { method: false }, { state: "BLOCKED" }, { state: "BEHIND" },
    { permission: "ADMIN", state: "BLOCKED" }, { permission: "ADMIN", queue: true },
    { state: "UNSTABLE", failedCheckRequired: true }]) {
    const f = clientFixture(options)
    await expect(f.client.mergePull("o/r", 1, "squash", head)).rejects.toThrow()
    expect(f.writes()).toBe(0)
  }
  const f = clientFixture()
  await expect(f.client.mergePull("o/r", 1, "merge", head)).rejects.toThrow("method")
  await expect(f.client.mergePull("o/r", 1, "squash", "b".repeat(40))).rejects.toThrow("Head changed")
  expect(f.writes()).toBe(0)
})

test("confirmed mutation returns merged snapshot without a fallible follow-up read", async () => {
  for (const options of [{}, { state: "UNSTABLE", failedCheckRequired: false }]) {
    const f = clientFixture(options)
    expect(await f.client.mergePull("o/r", 1, "squash", head)).toMatchObject({ state: "closed", merged: true, mergedAt: date, headSha: head })
    expect(f.writes()).toBe(1)
    expect(f.reads()).toBe(1)
  }
  const bad = clientFixture({ confirmed: false })
  await expect(bad.client.mergePull("o/r", 1, "squash", head)).rejects.toThrow("did not confirm")
  expect(bad.writes()).toBe(1)
})

test("server-generated squash messages are passed verbatim, including an empty body", async () => {
  for (const body of ["", "Server description\n\nCo-authored-by: Person <p@example.com>\n"]) {
    const message = { headline: "Server-generated headline (#1)", body }
    const f = clientFixture({ message })
    const loaded = await f.client.pullMergeMessage("o/r", 1, head)
    expect(loaded).toEqual(message)
    await f.client.mergePull("o/r", 1, "squash", head, loaded)
    expect(f.writes()).toBe(1)
  }
})

test("merge defaults reject errors, malformed data and changed heads; invalid custom messages never mutate", async () => {
  for (const options of [{ errors: [{ message: "offline" }] }, { defaults: { headRefOid: "b".repeat(40) } },
    { defaults: { number: 2 } }, { defaults: { id: "" } }, { defaults: { viewerMergeBodyText: null } }]) {
    await expect(clientFixture(options).client.pullMergeMessage("o/r", 1, head)).rejects.toThrow()
  }
  const f = clientFixture()
  for (const headline of ["", "  ", "a\nb", "a\rb"]) {
    await expect(f.client.mergePull("o/r", 1, "squash", head, { headline, body: "" })).rejects.toThrow("headline")
  }
  await expect(f.client.mergePull("o/r", 1, "merge", head, { headline: "ok", body: "" })).rejects.toThrow("only")
  await expect(f.client.mergePull("o/r", 1, "squash", head, { headline: "ok", body: null as unknown as string })).rejects.toThrow("body")
  expect(f.writes()).toBe(0)
  expect(f.reads()).toBe(0)
})

test("helper requires complete readiness but does not block optional unresolved threads", async () => {
  const pull = await clientFixture().client.pull("o/r", 1)
  expect(pullMergeBlocker(pull)).toContain("unavailable")
  expect(pullMergeBlocker(pull, context)).toBeUndefined()
  expect(pullMergeBlocker({ ...pull, draft: true }, context)).toContain("ready for review")
  expect(pullMergeBlocker({ ...pull, draft: undefined }, context)).toContain("Draft status unavailable")
  expect(pullMergeBlocker(pull, { ...context, readiness: { ...context.readiness, checksComplete: false } })).toContain("incomplete")
  expect(pullMergeBlocker(pull, { ...context, readiness: { ...context.readiness, reviewDecision: "REVIEW_REQUIRED" } })).toContain("approvals")
  expect(pullMergeBlocker(pull, { ...context, threads: [{ kind: "review-thread", id: "t", path: "x", isResolved: false, isOutdated: false, comments: [] }] })).toBeUndefined()
})

async function sessionFixture(overrides: Partial<RepositoryLoaders> = {}) {
  const pull = await clientFixture().client.pull("o/r", 1)
  const empty = async () => ({ items: [], hasMore: false })
  const loaders: RepositoryLoaders = {
    metadata: async () => githubDataFixture.repo, workCounts: async () => ({ issues: 0, pulls: 1 }),
    documents: async () => [], document: async () => "", branches: empty, commits: empty, commitCount: async () => 0,
    commit: async () => { throw new Error("unused") }, issue: async () => { throw new Error("unused") },
    issueComments: empty, issueReferences: async () => [], issues: empty, pulls: empty,
    pull: async () => pull, pullCommits: async () => [], pullContext: async () => context, runs: empty,
    ...overrides,
  }
  const session = createRepositorySession(loaders)
  await session.load("o/r")
  await session.loadPull(1)
  return { session, pull, loaders }
}

test("failed merges preserve comment drafts and invalid headlines never reach the loader", async () => {
  let writes = 0
  const { session } = await sessionFixture({ mergePull: async (_repo, _number, _method, _head, message) => {
    writes++
    expect(message).toEqual({ headline: "Edited", body: "" })
    throw new Error("Merge refused")
  } })
  const draft = { headline: "Edited", body: "", headSha: head }
  session.updateIssueDraft(1, { body: "independent" }, "pull")
  await expect(session.mergePull(1, "squash", head, { headline: draft.headline, body: draft.body })).rejects.toThrow("Merge refused")
  expect(session.issueAction(1, "pull")).toMatchObject({ body: "independent" })
  await session.loadPull(1)
  await expect(session.mergePull(1, "squash", head, { headline: "bad\ntitle", body: "" })).rejects.toThrow("headline")
  expect(writes).toBe(1)
})

test("defaults are fetched anew and late responses cannot cross repository scope", async () => {
  let release!: (message: PullMergeMessage) => void
  let reads = 0
  const { session } = await sessionFixture({ pullMergeMessage: async () => {
    reads++
    return new Promise(resolve => { release = resolve })
  } })
  const first = session.loadPullMergeMessage(1, head)
  release({ headline: "First default", body: "" })
  expect(await first).toEqual({ headline: "First default", body: "", headSha: head })
  const second = session.loadPullMergeMessage(1, head)
  release({ headline: "Updated default", body: "new" })
  expect(await second).toEqual({ headline: "Updated default", body: "new", headSha: head })
  expect(reads).toBe(2)
  const oldScope = session.loadPullMergeMessage(1, head)
  await session.load("other/repo")
  await session.loadPull(1)
  release({ headline: "Wrong repository", body: "" })
  await expect(oldScope).rejects.toThrow("changed")
})

test("defaults can retry after failure and are unavailable while a shared action is pending", async () => {
  let attempts = 0
  let release!: (pull: PullRequestDetail) => void
  const { session, pull } = await sessionFixture({
    pullMergeMessage: async () => { if (++attempts === 1) throw new Error("offline"); return { headline: "Server", body: "" } },
    mergePull: async () => new Promise(resolve => { release = resolve }),
  })
  session.updateIssueDraft(1, { body: "keep" }, "pull")
  await expect(session.loadPullMergeMessage(1, head)).rejects.toThrow("offline")
  const draft = await session.loadPullMergeMessage(1, head)
  expect(draft).toEqual({ headline: "Server", body: "", headSha: head })
  const merging = session.mergePull(1, "squash", head, draft)
  await expect(session.loadPullMergeMessage(1, head)).rejects.toThrow("in progress")
  release({ ...pull, state: "closed", merged: true, mergedAt: date })
  await merging
  expect(session.issueAction(1, "pull").body).toBe("keep")
})

test("session confirms merge, preserves independent drafts, and does not fail on refresh errors", async () => {
  const pull = await clientFixture().client.pull("o/r", 1)
  let merged = false
  let release!: (value: PullRequestDetail) => void
  const pending = new Promise<PullRequestDetail>(resolve => { release = resolve })
  const empty = async () => ({ items: [], hasMore: false })
  const loaders: RepositoryLoaders = {
    metadata: async () => githubDataFixture.repo, workCounts: async () => { if (merged) throw new Error("offline"); return { issues: 0, pulls: 1 } },
    documents: async () => [], document: async () => "", branches: empty, commits: empty, commitCount: async () => 0,
    commit: async () => { throw new Error("unused") }, issue: async () => { throw new Error("unused") },
    issueComments: empty, issueReferences: async () => { if (merged) throw new Error("offline"); return [] },
    issues: empty, pulls: async () => { if (merged) throw new Error("offline"); return { items: [pull], hasMore: false } },
    pull: async () => pull, pullCommits: async () => [], pullContext: async () => context, runs: empty,
    mergePull: async () => pending,
  }
  const session = createRepositorySession(loaders)
  await session.load("o/r")
  await session.loadPull(1)
  session.updateIssueDraft(1, { body: "keep me", selectedAssignees: ["me"] }, "pull")
  const merging = session.mergePull(1, "squash", head)
  expect(session.issueAction(1, "pull").operation.status).toBe("loading")
  await expect(session.mergePull(1, "squash", head)).rejects.toThrow("already in progress")
  merged = true
  release({ ...pull, state: "closed", merged: true, mergedAt: date })
  await merging
  await Bun.sleep(0) // Follow-up refreshes run in the background after the confirmed merge.
  expect(session.pullDetail()?.resource.value).toMatchObject({ merged: true, state: "closed" })
  expect(session.issueAction(1, "pull")).toMatchObject({ body: "keep me", selectedAssignees: ["me"], operation: { status: "idle" } })
  expect(session.pullDetail()?.references.status).toBe("error")
  const state = session.state()
  if (state.status !== "ready") throw new Error("not ready")
  expect(state.data.pulls.open.value?.items).toEqual([])
  expect(state.data.pulls.closed.value?.items[0]?.merged).toBe(true)
})
