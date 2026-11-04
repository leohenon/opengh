import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { PullReviewThread } from "../src/models"
import { defaultConfig } from "../src/config"
import type { InlineCommentInput, PostedInlineComment, PullReviewSession, ReviewSessionState } from "../src/review-types"
import { InlineCommentUncertainError } from "../src/inline-comments"
import { App } from "../src/ui/app"
import { initializeHunk } from "../src/ui/hunk-host"
import { parseDiff } from "../src/ui/diff-model"
import { reviewRows, reviewSplitBoundary } from "../src/ui/review-lines"
import { clickControl } from "./fixtures/mouse"
import { githubDataFixture, repositoryOperationsFixture, pullContextFixture } from "./fixtures/github-data"
import { patchFixture } from "./fixtures/diff"

test("inline comments publish immediately and independently of the overall review", async () => {
  const number = githubDataFixture.pulls.open.value!.items[0]!.number
  const repository = githubDataFixture.repo.nameWithOwner
  const headSha = "a".repeat(40), baseSha = "b".repeat(40)
  const [state, setState] = createSignal<ReviewSessionState>({ status: "idle" })
  const remoteThread: PullReviewThread = { kind: "review-thread", id: "remote-thread", path: "example.ts", line: 1, diffSide: "RIGHT",
    isResolved: false, isOutdated: false, comments: [{ id: "remote-comment", author: "alice", authorAssociation: "", body: "Existing GitHub comment",
      createdAt: "2026-01-01", updatedAt: "2026-01-01", url: "https://github.com/example/existing" }] }
  const [threads, setThreads] = createSignal<PullReviewThread[]>([remoteThread])
  const finished = Promise.withResolvers<boolean>()
  const inlineFinished = Promise.withResolvers<PostedInlineComment>()
  const inlinePosts: InlineCommentInput[] = []
  const retryOptions: Array<{ retryUnconfirmed?: boolean } | undefined> = []
  let submissions = 0, refreshes = 0, diffLoads = 0
  const reviews: PullReviewSession = {
    state,
    open: async (repo, n) => {
      expect([repo, n]).toEqual([repository, number])
      setState(s => ({ status: "ready", eligibility: { accountId: 1, login: "reviewer", repository, number, headSha, baseSha,
        url: `${githubDataFixture.repo.url}/pull/${number}`, canComment: true, canApprove: true, canRequestChanges: true },
        draft: s.draft ?? { accountId: 1, repository, number, headSha, baseSha, event: "COMMENT", body: "", comments: [] } }))
    },
    setBody: body => setState(s => ({ ...s, draft: { ...s.draft!, body } })),
    setEvent: event => setState(s => ({ ...s, draft: { ...s.draft!, event } })),
    addComment: () => { throw new Error("Inline comments must not be queued in a review") },
    updateComment: () => {}, removeComment: () => {}, useCurrentHead: () => {}, discard: async () => {}, flush: async () => {},
    submit: async () => { submissions++; return finished.promise },
  }
  const setup = await createTestRenderer({ width: 110, height: 34 })
  initializeHunk(setup.renderer)
  const summary = githubDataFixture.pulls.open.value!.items[0]!
  await render(() => <App data={githubDataFixture} operations={repositoryOperationsFixture} reviews={reviews}
    onPostInlineComment={async (input, options) => {
      inlinePosts.push(input); retryOptions.push(options)
      if (inlinePosts.length === 1) throw new InlineCommentUncertainError("Network connection lost. No matching comment found.", true)
      return inlineFinished.promise
    }}
    config={{ ...defaultConfig, showStatusBarHints: true }} initialNavigation={{ detail: { kind: "pull", number } }}
    onLoadPull={async () => { refreshes++ }} onLoadDiff={async () => { diffLoads++ }}
    diffs={{ pull: { target: { kind: "pull", number }, resource: { status: "ready", value: { kind: "patch", patch: patchFixture, headSha, baseSha } } } }}
    pullDetail={{ number, resource: { status: "ready", value: { ...summary, draft: false, merged: false,
      body: "PR body", url: `${githubDataFixture.repo.url}/pull/${number}`, updatedAt: summary.createdAt,
      baseBranch: "main", headBranch: "feature", headSha, additions: 1, deletions: 1, changedFiles: 1, commitCount: 1,
      commentCount: 0, labels: [], assignees: [], reviewers: [], mergeable: null, permissions: { comment: true } } },
      comments: { status: "ready", value: { items: [], page: 1, hasMore: false } }, commits: { status: "ready", value: [] },
      references: { status: "ready", value: [] }, context: { status: "ready", value: { ...pullContextFixture, readiness: { ...pullContextFixture.readiness, headSha }, threads: threads() } } }} />,
    setup.renderer)
  const settle = async () => { await Bun.sleep(40); await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  try {
    await settle()
    setup.mockInput.pressKey("R"); await settle()
    expect(setup.captureCharFrame()).not.toContain(`Review PR #${number}`)
    setup.mockInput.pressKey("a"); await settle()
    await clickControl(setup, "issue-menu-review"); await settle()
    expect(setup.captureCharFrame()).toContain(`Review PR #${number}`)
    setup.mockInput.pressEscape(); await settle()
    setup.mockInput.pressKey("D"); await settle()
    expect(setup.captureCharFrame()).toContain("Existing GitHub comment")
    const file = parseDiff({ kind: "patch", patch: patchFixture }).files[0]!.body!
    const row = setup.renderer.root.findDescendantById(reviewRows(file, "split")[0]!.id)!
    expect(row).toBeDefined()
    await setup.mockMouse.click(row.x + reviewSplitBoundary(row.width) + 5, row.y, 2); await settle()
    await clickControl(setup, "context-menu-row-0"); await settle()
    await setup.mockInput.typeText("Please explain this change.")
    await clickControl(setup, "review-editor-save"); await settle()
    expect(inlinePosts).toHaveLength(0)
    expect(setup.captureCharFrame()).toContain("Post inline comment?")
    await clickControl(setup, "inline-comment-confirm"); await settle()
    expect(inlinePosts).toEqual([{ accountId: 1, repository, number, headSha, baseSha,
      anchor: { path: "example.ts", line: 1, side: "RIGHT" }, body: "Please explain this change." }])
    expect(reviews.state().draft?.comments).toEqual([])
    expect(submissions).toBe(0)
    expect(setup.renderer.root.findDescendantById("inline-comment-retry-confirm")).toBeDefined()
    expect(inlinePosts).toHaveLength(1) // No automatic retry after an uncertain response.
    await clickControl(setup, "inline-comment-retry-confirm"); await settle()
    expect(inlinePosts).toHaveLength(2)
    expect(inlinePosts[1]).toEqual(inlinePosts[0])
    expect(retryOptions).toEqual([undefined, { retryUnconfirmed: true }])
    await Bun.sleep(220); await setup.flush()
    expect(setup.captureCharFrame()).toContain("Posting comment")
    inlineFinished.resolve({ id: 123, path: "example.ts", line: 1, side: "RIGHT", body: inlinePosts[0]!.body, url: "https://github.com/example/comment" })
    await settle()
    expect(setup.captureCharFrame()).toContain("Inline comment posted")
    expect(setup.captureCharFrame()).toContain("Please explain this change.")
    setThreads([remoteThread, { ...remoteThread, id: "new-server-thread", comments: [{ ...remoteThread.comments[0]!, id: "new-server-comment",
      body: "Please explain this change.", url: "https://github.com/example/comment" }] }])
    await settle()
    expect(setup.captureCharFrame().split("Please explain this change.")).toHaveLength(2)
    const beforeRefresh = diffLoads
    setup.mockInput.pressKey("r"); await settle()
    expect(diffLoads).toBe(beforeRefresh + 1)
    expect(setup.renderer.root.findDescendantById("review-submit")).toBeUndefined()
    setup.mockInput.pressEscape(); await settle()
    setup.mockInput.pressKey("a"); await settle()
    await clickControl(setup, "issue-menu-review"); await settle()
    setup.mockInput.pressEnter(); await settle()
    await setup.mockInput.typeText("Overall review feedback"); await settle()
    setup.mockInput.pressKey("s", { ctrl: true }); await settle()
    expect(submissions).toBe(0)
    await clickControl(setup, "review-confirm"); await settle()
    expect(submissions).toBe(1)
    expect(setup.renderer.root.findDescendantById("review-confirm")).toBeUndefined()
    await Bun.sleep(220); await setup.flush()
    expect(setup.captureCharFrame()).toContain("Submitting review")
    finished.resolve(true); await settle()
    expect(setup.captureCharFrame()).toContain("Review submitted")
    expect(refreshes).toBe(4)
  } finally { setup.renderer.destroy() }
})
