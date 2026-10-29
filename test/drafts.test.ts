import { expect, test } from "bun:test"
import { mkdtempSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDiskDraftStore } from "../src/drafts"
import { createReviewDraftStorage } from "../src/pull-review-session"
import { createInlineCommentStorage } from "../src/inline-comments"
import type { IssueComment } from "../src/models"
import { createRepositorySession, type RepositoryLoaders, type RepositorySession } from "../src/repository-session"
import { commitDetailFixture, githubDataFixture, issueCommentsFixture, issueDetailFixture, pullContextFixture } from "./fixtures/github-data"

test("drafts survive restarts, isolate subjects/actions, retain failures, and durably settle confirmed posts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "opengh-drafts-"))
  const drafts = join(directory, "drafts")
  const sessions: RepositorySession[] = []
  let failComment = false
  let failClose = true
  let commentCalls = 0
  let pendingComment: Promise<IssueComment> | undefined
  const number = issueDetailFixture.number
  const loaders: RepositoryLoaders = {
    metadata: async (repository) => ({ ...githubDataFixture.repo, nameWithOwner: repository }),
    workCounts: async () => ({ issues: 0, pulls: 0 }),
    documents: async () => [], document: async () => "",
    branches: async () => ({ items: [], hasMore: false }),
    commits: async () => ({ items: [], hasMore: false }), commitCount: async () => 0,
    commit: async () => commitDetailFixture,
    issue: async (_repository, number) => ({ ...issueDetailFixture, number, commentCount: 0 }),
    issueComments: async () => ({ items: [], hasMore: false }), issueReferences: async () => [],
    issues: async () => ({ items: [], hasMore: false }), pulls: async () => ({ items: [], hasMore: false }),
    pullCommits: async () => [], pullContext: async () => pullContextFixture,
    runs: async () => ({ items: [], hasMore: false }),
    createIssueComment: async (_repository, _number, body) => {
      commentCalls++
      if (failComment) throw new Error("Comment offline")
      return pendingComment ?? { ...issueCommentsFixture[0]!, body }
    },
    updateIssueState: async (_repository, number, state, reason) => {
      if (failClose) throw new Error("Close offline")
      return { ...issueDetailFixture, number, state, stateReason: reason }
    },
  }
  const restart = async (repository = "owner/repo") => {
    const session = createRepositorySession(loaders, createDiskDraftStore(drafts))
    sessions.push(session)
    await session.load(repository)
    return session
  }
  try {
    let session = await restart()
    // Reading the active action before prepare does not prevent lazy restoration.
    expect(session.issueAction(number).body).toBe("")
    session.prepareIssueAction(number, "comment")
    session.updateIssueDraft(number, { body: "Independent comment" })
    session.prepareIssueAction(number, "assignees")
    session.prepareIssueAction(number, "duplicate")
    expect(session.issueAction(number).body).toBe("Independent comment")
    session.prepareIssueAction(number, "close")
    expect(session.issueAction(number).body).toBe("")
    session.updateIssueDraft(number, { body: "Closing explanation", reason: "not_planned" })
    session.prepareIssueAction(number, "reopen")
    session.updateIssueDraft(number, { body: "Reopening explanation" })
    session.prepareIssueAction(number, "comment", "pull")
    session.updateIssueDraft(number, { body: "PR discussion" }, "pull")
    session.prepareIssueAction(number + 1, "comment")
    session.updateIssueDraft(number + 1, { body: "Other issue" })
    await session.load("owner/other")
    session.prepareIssueAction(number, "comment")
    session.updateIssueDraft(number, { body: "Other repository" })
    session.flushDrafts!()
    for (const file of readdirSync(drafts)) expect(statSync(join(drafts, file)).mode & 0o777).toBe(0o600)

    session = await restart()
    expect(session.issueAction(number).body).toBe("")
    session.prepareIssueAction(number, "assignees")
    session.prepareIssueAction(number, "comment")
    expect(session.issueAction(number).body).toBe("Independent comment")
    session.prepareIssueAction(number, "close")
    expect(session.issueAction(number)).toMatchObject({ body: "Closing explanation", reason: "not_planned", operation: { status: "idle" } })
    session.prepareIssueAction(number, "reopen")
    expect(session.issueAction(number).body).toBe("Reopening explanation")
    session.prepareIssueAction(number, "comment", "pull")
    expect(session.issueAction(number, "pull").body).toBe("PR discussion")
    session.prepareIssueAction(number + 1, "comment")
    expect(session.issueAction(number + 1).body).toBe("Other issue")

    // A failed disk write remains dirty, reports nonblockingly, and retries on flush.
    session.prepareIssueAction(number, "comment")
    session.updateIssueDraft(number, { body: "Latest retained comment" })
    renameSync(drafts, `${drafts}.backup`)
    writeFileSync(drafts, "not a directory")
    session.flushDrafts!()
    expect(session.draftSaveError!()).toContain("Draft save failed")
    expect(session.issueAction(number).body).toBe("Latest retained comment")
    rmSync(drafts)
    renameSync(`${drafts}.backup`, drafts)
    session.flushDrafts!()
    expect(session.draftSaveError!()).toBeUndefined()

    session = await restart()
    session.prepareIssueAction(number, "comment")
    expect(session.issueAction(number).body).toBe("Latest retained comment")
    await session.loadIssue(number)
    failComment = true
    await expect(session.submitIssueAction(number, "comment")).rejects.toThrow("Comment offline")
    session.flushDrafts!()
    session = await restart()
    session.prepareIssueAction(number, "comment")
    expect(session.issueAction(number)).toMatchObject({ body: "Latest retained comment", operation: { status: "idle" } })
    failComment = false
    await session.loadIssue(number)
    session.prepareIssueAction(number, "close")
    await expect(session.submitIssueAction(number, "close")).rejects.toThrow("Comment posted, but closing failed")
    // No explicit flush: confirmation must persist the cleared text and retry immediately.
    session = await restart()
    session.prepareIssueAction(number, "close")
    expect(session.issueAction(number)).toMatchObject({ body: "", retry: "close", reason: "not_planned" })
    session.prepareIssueAction(number, "comment")
    expect(session.issueAction(number).body).toBe("Latest retained comment")
    session.prepareIssueAction(number, "close")
    await session.loadIssue(number)
    failClose = false
    const beforeRetry = commentCalls
    await session.submitIssueAction(number, "close")
    expect(commentCalls).toBe(beforeRetry)
    expect(createDiskDraftStore(drafts).load(`owner/repo#${number}:close`)).toBeUndefined()
    session = await restart()
    session.prepareIssueAction(number, "close")
    expect(session.issueAction(number).retry).toBeUndefined()

    // Background confirmation must clear only the original repository's draft.
    session.prepareIssueAction(number, "comment")
    await session.loadIssue(number)
    let resolve!: (comment: IssueComment) => void
    pendingComment = new Promise((done) => { resolve = done })
    const posting = session.submitIssueAction(number, "comment")
    session.prepareIssueAction(number, "reopen") // no kind swap during a submit
    expect(session.issueAction(number).body).toBe("Latest retained comment")
    await session.load("owner/other")
    session.prepareIssueAction(number, "comment")
    expect(session.issueAction(number).body).toBe("Other repository")
    resolve(issueCommentsFixture[0]!)
    await posting
    expect(session.issueAction(number).body).toBe("Other repository")
    session = await restart()
    session.prepareIssueAction(number, "comment")
    expect(session.issueAction(number).body).toBe("")

    // Manual clear intentionally removes both saved text and pending retry.
    session.prepareIssueAction(number, "close")
    session.updateIssueDraft(number, { body: "Another closing explanation" })
    await session.loadIssue(number)
    pendingComment = undefined
    failClose = true
    await expect(session.submitIssueAction(number, "close")).rejects.toThrow("closing failed")
    session.discardIssueDraft(number)
    session = await restart()
    session.prepareIssueAction(number, "close")
    expect(session.issueAction(number)).toMatchObject({ body: "", reason: "completed" })
    expect(session.issueAction(number).retry).toBeUndefined()
    session.prepareIssueAction(number, "reopen")
    expect(session.issueAction(number).body).toBe("Reopening explanation")

    // Edits made before first prepare take precedence over disk restoration.
    session = await restart()
    session.updateIssueDraft(number, { body: "Already editing" })
    session.prepareIssueAction(number, "reopen")
    expect(session.issueAction(number).body).toBe("Already editing")
  } finally {
    for (const session of sessions) session.flushDrafts!()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("draft stores sweep only stale atomic-write files, not drafts or submission markers", () => {
  for (const create of [createDiskDraftStore, createReviewDraftStorage, createInlineCommentStorage]) {
    const directory = mkdtempSync(join(tmpdir(), "opengh-draft-cleanup-"))
    try {
      const base = `${"a".repeat(64)}.json`
      const stale = [`${base}.${randomUUID()}.tmp`, `${base}.submission.${randomUUID()}.tmp`]
      const retained = [base, `${base}.submission`, `${base}.${randomUUID()}.tmp`, "unrelated.tmp"]
      for (const name of [...stale, ...retained]) writeFileSync(join(directory, name), "preserve")
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
      for (const name of [...stale, retained[0]!, retained[1]!, retained[3]!]) utimesSync(join(directory, name), old, old)
      create(directory)
      expect(readdirSync(directory).sort()).toEqual(retained.sort())
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }
})
