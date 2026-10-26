import { expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import { createRepositorySession, type RepositoryLoaders } from "../src/repository-session"
import type { PullContext, PullRequestDetail } from "../src/models"
import { githubDataFixture } from "./fixtures/github-data"

const head = "a".repeat(40)
const date = "2026-01-01T00:00:00Z"
function fixture(options: { permission?: unknown; author?: unknown; archived?: boolean; state?: string; merged?: boolean; draft?: unknown; confirmed?: boolean } = {}) {
  let writes = 0
  const client = createGitHubClient({
    text: async () => "",
    async json<T>() {
      if (writes) throw new Error("Read unavailable")
      return { node_id: "PR1", number: 1, state: options.state ?? "open", title: "PR", user: { login: "me" },
        created_at: date, updated_at: date, merged_at: options.merged ? date : null,
        draft: "draft" in options ? options.draft : false, locked: false, html_url: "https://github.com/o/r/pull/1", body: "",
        base: { ref: "main" }, head: { ref: "feature", sha: head }, labels: [], assignees: [], requested_reviewers: [], requested_teams: [],
        additions: 1, deletions: 0, changed_files: 1, commits: 0, comments: 0, review_comments: 0 } as T
    },
    async graphql<T>(query: string, variables: Record<string, string>) {
      if (query.startsWith("mutation")) {
        writes++
        expect(variables).toEqual({ id: "PR1" })
        const draft = !options.draft
        const name = draft ? "convertPullRequestToDraft" : "markPullRequestReadyForReview"
        expect(query).toContain(name)
        return { data: { [name]: { pullRequest: { id: "PR1", number: 1, state: "OPEN", merged: false,
          isDraft: options.confirmed === false ? !draft : draft, headRefOid: head, updatedAt: date } } } } as T
      }
      if (query.includes("viewerPermission")) {
        expect(query).toContain("viewerDidAuthor")
        expect(query).not.toContain("viewerCanConvertToDraft")
        return { data: { repository: { isArchived: options.archived ?? false,
          viewerPermission: "permission" in options ? options.permission : "WRITE",
          pullRequest: { id: "PR1", viewerDidAuthor: options.author } } } } as T
      }
      return {} as T
    },
  })
  return { client, writes: () => writes }
}

test("draft permissions require author or write access, known stage, and an open unarchived PR", async () => {
  for (const options of [{ permission: "READ" }, { permission: null }, { permission: "UNKNOWN" },
    { permission: "READ", author: false }, { archived: true }, { state: "closed" }, { merged: true }, { draft: undefined }]) {
    const f = fixture(options)
    const detail = await f.client.pull("o/r", 1)
    expect(detail.permissions?.markDraft).toBe(false)
    expect(detail.permissions?.markReady).toBe(false)
    await expect(f.client.updatePullDraft("o/r", 1, true)).rejects.toThrow()
    expect(f.writes()).toBe(0)
  }
  for (const permission of ["READ", "WRITE", "MAINTAIN", "ADMIN"]) {
    const f = fixture({ permission, author: permission === "READ" })
    expect((await f.client.pull("o/r", 1)).permissions?.markDraft).toBe(true)
  }
})

test("draft mutations revalidate stage and return the confirmed snapshot without follow-up reads", async () => {
  for (const draft of [true, false]) {
    const f = fixture({ draft: !draft, permission: "READ", author: true })
    await expect(f.client.updatePullDraft("../r", 1, draft)).rejects.toThrow("Invalid")
    await expect(f.client.updatePullDraft("o/r", 0, draft)).rejects.toThrow("Invalid")
    await expect(f.client.updatePullDraft("o/r", 1, !draft)).rejects.toThrow("stage changed")
    expect(f.writes()).toBe(0)
    expect(await f.client.updatePullDraft("o/r", 1, draft)).toMatchObject({ draft, headSha: head,
      permissions: { markDraft: !draft, markReady: draft } })
    expect(f.writes()).toBe(1)
  }
  const bad = fixture({ confirmed: false })
  await expect(bad.client.updatePullDraft("o/r", 1, true)).rejects.toThrow("did not confirm")
  expect(bad.writes()).toBe(1)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const context = (draft: boolean): PullContext => ({ threads: [], warnings: [], readiness: { headSha: head, isDraft: draft, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", checks: [], checksComplete: true } })
async function setup(overrides: Partial<RepositoryLoaders> = {}) {
  const pull = await fixture().client.pull("o/r", 1)
  const empty = async () => ({ items: [], hasMore: false })
  const session = createRepositorySession({
    metadata: async () => githubDataFixture.repo, workCounts: async () => ({ issues: 0, pulls: 1 }),
    documents: async () => [], document: async () => "", branches: empty, commits: empty, commitCount: async () => 0,
    commit: async () => { throw new Error("unused") }, issue: async () => { throw new Error("unused") },
    issueComments: empty, issueReferences: async () => [], issues: empty, pulls: empty,
    pull: async () => pull, pullCommits: async () => [], pullContext: async () => context(false), runs: empty,
    ...overrides,
  })
  await session.load("o/r")
  await session.loadPull(1)
  return { session, pull }
}

test("draft writes share the pending guard, preserve independent drafts and reject stale same-head context", async () => {
  const write = deferred<PullRequestDetail>()
  const old = deferred<PullContext>()
  const fresh = deferred<PullContext>()
  let reads = 0
  const { session, pull } = await setup({ updatePullDraft: async () => write.promise,
    pullContext: async () => ++reads === 1 ? context(false) : reads === 2 ? old.promise : reads === 3 ? fresh.promise : context(false) })
  session.updateIssueDraft(1, { body: "keep", selectedAssignees: ["me"] }, "pull")
  const retry = session.retryPullContext()
  const writing = session.updatePullDraft(1, true)
  await expect(session.updatePullDraft(1, true)).rejects.toThrow("in progress")
  await expect(session.submitIssueAction(1, "comment", "pull")).rejects.toThrow("in progress")
  write.resolve({ ...pull, draft: true, permissions: { comment: true, markDraft: false, markReady: true } })
  await writing
  expect(session.pullDetail()?.context.status).toBe("loading")
  old.resolve(context(false))
  await retry
  expect(session.pullDetail()?.context.status).toBe("loading")
  fresh.resolve(context(true))
  await Bun.sleep(0)
  expect(session.pullDetail()?.context.value?.readiness?.isDraft).toBe(true)
  expect(session.pullDetail()?.resource.value).toMatchObject({ draft: true, permissions: { markReady: true } })
  expect(session.issueAction(1, "pull")).toMatchObject({ body: "keep", selectedAssignees: ["me"], operation: { status: "idle" } })
  await session.retryPullContext()
  expect(session.pullDetail()?.context.status).toBe("error")
  expect(session.pullDetail()?.resource.value?.draft).toBe(true)
})

test("confirmed draft survives overlapping metadata reads and readiness refresh failures", async () => {
  const write = deferred<PullRequestDetail>()
  const stale = deferred<PullRequestDetail>()
  let reads = 0
  let contexts = 0
  const original = await fixture().client.pull("o/r", 1)
  const { session } = await setup({
    pull: async () => ++reads === 1 ? original : reads === 2 ? stale.promise : original,
    updatePullDraft: async () => write.promise,
    pullContext: async () => { if (++contexts > 1) throw new Error("offline"); return context(false) },
  })
  const writing = session.updatePullDraft(1, true)
  const refreshing = session.loadPull(1)
  write.resolve({ ...original, draft: true, permissions: { comment: true, markReady: true } })
  await writing
  stale.resolve(original)
  await refreshing
  await Bun.sleep(0)
  expect(session.pullDetail()?.resource.value?.draft).toBe(true)
  expect(session.pullDetail()?.context.status).toBe("error")
  expect(session.issueAction(1, "pull").operation.status).toBe("idle")
})

test("draft stage changes reject an existing comment-plus-close retry", async () => {
  const original = await fixture().client.pull("o/r", 1)
  let writes = 0
  const { session } = await setup({
    pull: async () => ({ ...original, permissions: { ...original.permissions!, close: true } }),
    createIssueComment: async () => ({ id: 2, author: "me", authorAssociation: "OWNER", body: "comment", createdAt: date, updatedAt: date }),
    updatePullState: async () => { throw new Error("offline") },
    updatePullDraft: async () => { writes++; return { ...original, draft: true } },
  })
  session.updateIssueDraft(1, { body: "comment" }, "pull")
  await expect(session.submitIssueAction(1, "close", "pull")).rejects.toThrow("Comment posted")
  await expect(session.updatePullDraft(1, true)).rejects.toThrow("Retry or discard")
  expect(writes).toBe(0)
})

test("late draft writes cannot change another repository and failed writes preserve drafts", async () => {
  const write = deferred<PullRequestDetail>()
  const { session, pull } = await setup({ updatePullDraft: async () => write.promise })
  session.updateIssueDraft(1, { body: "keep" }, "pull")
  const writing = session.updatePullDraft(1, true)
  await session.load("other/repo")
  await session.loadPull(1)
  write.resolve({ ...pull, draft: true })
  await writing
  expect(session.pullDetail()?.resource.value?.draft).toBe(false)
  const failure = await setup({ updatePullDraft: async () => { throw new Error("Denied") } })
  failure.session.updateIssueDraft(1, { body: "keep" }, "pull")
  await expect(failure.session.updatePullDraft(1, true)).rejects.toThrow("Denied")
  expect(failure.session.issueAction(1, "pull")).toMatchObject({ body: "keep", operation: { status: "error" } })
})
