import { expect, test } from "bun:test"
import { TextBufferRenderable, type Renderable, type TextareaRenderable, type TextRenderable } from "@opentui/core"
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
import { reviewRows } from "../src/ui/review-lines"
import { clickControl } from "./fixtures/mouse"
import { githubDataFixture, repositoryOperationsFixture, pullContextFixture } from "./fixtures/github-data"
import { patchFixture } from "./fixtures/diff"

test("draft PR inline comments open from Hunk's [+] in opengh's editor and publish immediately, independently of the overall review", async () => {
  const number = githubDataFixture.pulls.open.value!.items[0]!.number
  const repository = githubDataFixture.repo.nameWithOwner
  const headSha = "a".repeat(40), baseSha = "b".repeat(40)
  const [revision, setRevision] = createSignal({ headSha, baseSha })
  const patch = patchFixture.replace("@@ -1 +1 @@", "@@ -1,2 +1,2 @@") + " const stable = 3\n"
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
      setState(s => ({ status: "ready", eligibility: { accountId: 1, login: "reviewer", repositoryId: 71, repository, number, headSha, baseSha,
        url: `${githubDataFixture.repo.url}/pull/${number}`, canComment: true, canInlineComment: true, canApprove: false, canRequestChanges: false,
        reason: "Approval and request changes require a non-draft pull request." },
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
      if (inlinePosts.length === 3) throw new Error("Posting failed")
      return inlineFinished.promise
    }}
    config={{ ...defaultConfig, showStatusBarHints: true }} initialNavigation={{ detail: { kind: "pull", number } }}
    onLoadPull={async () => { refreshes++ }} onLoadDiff={async () => { diffLoads++ }}
    diffs={{ pull: { target: { kind: "pull", number }, resource: { status: "ready", value: { kind: "patch", patch, ...revision() } } } }}
    pullDetail={{ number, resource: { status: "ready", value: { ...summary, draft: true, merged: false,
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
    expect(setup.captureCharFrame()).toContain("Approval and request changes require a non-draft")
    setup.mockInput.pressEscape(); await settle()
    setup.mockInput.pressKey("D"); await settle()
    expect(setup.captureCharFrame()).toContain("Existing GitHub comment")
    const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
    const composer = () => setup.renderer.root.findDescendantById("inline-comment-editor") as TextareaRenderable | undefined
    const editorBody = () => composer()?.plainText
    const sourceRow = (index: number) => setup.renderer.root.findDescendantById(reviewRows(file, "split")[index]!.id)!
    const clickMenuItem = async (label: string) => {
      for (let index = 0; ; index++) {
        const row = setup.renderer.root.findDescendantById(`context-menu-row-${index}`)
        expect(row).toBeDefined()
        if ((row!.getChildren()[0] as TextRenderable).plainText === label) { await clickControl(setup, row!.id); await settle(); return }
      }
    }
    // Hunk's hover [+] comments on the new side; the context menu reaches either side.
    const openInline = async (index = 0, side: "LEFT" | "RIGHT" = "RIGHT") => {
      const row = sourceRow(index)
      expect(row).toBeDefined()
      if (side === "RIGHT") {
        await setup.mockMouse.moveTo(row.x + 5, row.y); await settle()
        await setup.mockMouse.click(row.x + row.width - 2, row.y); await settle()
      } else {
        await setup.mockMouse.click(row.x + 5, row.y, 2); await settle()
        await clickMenuItem("Add review comment…")
      }
      expect(composer()?.focused).toBe(true)
    }
    const savedDraftMarkers = (node: Renderable = setup.renderer.root): Renderable[] => [
      ...(node.id.startsWith("diff-comment-card:draft:") ? [node] : []),
      ...node.getChildren().flatMap(child => savedDraftMarkers(child)),
    ]
    const resumeDraft = async (marker: Renderable) => {
      const resume = marker.getChildren()[0]!.getChildren().find(child => child.id.startsWith("inline-draft-resume:"))!
      await clickControl(setup, resume.id)
      await settle()
    }
    const closeInline = async () => { setup.mockInput.pressEscape(); await settle() }
    const post = async () => { setup.mockInput.pressKey("s", { ctrl: true }); await settle() }
    await openInline()
    expect(setup.captureCharFrame()).toContain("╭─ Comment ─")
    expect(setup.captureCharFrame()).toContain("ctrl+s post · ctrl+p preview · ctrl+o expand")
    await setup.mockInput.typeText("@al"); await settle()
    expect(setup.renderer.root.findDescendantById("mention-option:alice")).toBeDefined()
    setup.mockInput.pressEnter(); await settle()
    expect(editorBody()).toBe("@alice ")
    expect(inlinePosts).toHaveLength(0)
    setup.mockInput.pressKey("d", { ctrl: true }); await settle()
    await setup.mockInput.typeText("Please explain this change.")
    // Reloading reviews keeps the same editor, and cancelling the confirmation returns to it.
    const instance = composer()
    const ready = state()
    setState({ status: "loading" }); await settle()
    expect(composer()).toBe(instance)
    setState(ready); await settle()
    expect(composer()).toBe(instance)
    expect(composer()?.focused).toBe(true)
    await post()
    expect(setup.captureCharFrame()).toContain("Post inline comment?")
    setup.mockInput.pressEscape(); await settle()
    expect(composer()).toBe(instance)
    expect(composer()?.focused).toBe(true)
    expect(inlinePosts).toHaveLength(0)
    await closeInline()
    expect(composer()).toBeUndefined()
    expect(setup.captureCharFrame()).toContain("Draft saved · Resume")
    expect(savedDraftMarkers()).toHaveLength(1)
    expect(savedDraftMarkers()[0]!.parent).toBe(sourceRow(0))
    setup.mockInput.pressEscape(); await settle() // Leaving the diff does not lose the saved marker.
    setup.mockInput.pressKey("D"); await settle()
    expect(savedDraftMarkers()).toHaveLength(1)
    expect(savedDraftMarkers()[0]!.parent).toBe(sourceRow(0))
    await resumeDraft(savedDraftMarkers()[0]!)
    expect(editorBody()).toBe("Please explain this change.")
    expect(composer()?.focused).toBe(true)
    expect(savedDraftMarkers()).toHaveLength(0)
    await closeInline()
    await openInline(1)
    expect(editorBody()).toBe("")
    await setup.mockInput.typeText("Keep the second line draft")
    await setup.mockMouse.click(sourceRow(0).x + 5, sourceRow(0).y); await settle() // Clicking source keeps the draft.
    expect(composer()?.focused).toBe(false)
    expect(editorBody()).toBe("Keep the second line draft")
    await openInline(0, "LEFT")
    expect(editorBody()).toBe("")
    await setup.mockInput.typeText(" \n ")
    await closeInline()
    expect(savedDraftMarkers()).toHaveLength(2) // Empty or whitespace-only drafts do not leave a marker.
    expect(savedDraftMarkers().map(marker => marker.parent)).toEqual([sourceRow(0), sourceRow(1)])
    const eligibility = state().eligibility!
    for (const change of [{ accountId: 2 }, { headSha: "c".repeat(40) }, { baseSha: "d".repeat(40) }]) {
      setState(s => ({ ...s, eligibility: { ...eligibility, ...change } }))
      setRevision({ headSha, baseSha, ...change }); await settle()
      expect(savedDraftMarkers()).toHaveLength(0) // Drafts belong to their account and exact diff revision.
      await openInline()
      expect(editorBody()).toBe("")
      await setup.mockInput.typeText("Separate context")
      await closeInline()
    }
    setState(s => ({ ...s, eligibility }))
    setRevision({ headSha, baseSha }); await settle()
    await openInline()
    expect(editorBody()).toBe("Please explain this change.")
    await post()
    expect(inlinePosts).toHaveLength(0)
    expect(setup.captureCharFrame()).toContain("Post inline comment?")
    await clickControl(setup, "inline-comment-confirm"); await settle()
    expect(inlinePosts).toEqual([{ accountId: 1, repositoryId: 71, repository, number, headSha, baseSha,
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
    expect(composer()?.focused).toBe(false) // The draft stays visible but cannot post twice while in flight.
    inlineFinished.resolve({ id: 123, path: "example.ts", line: 1, side: "RIGHT", body: inlinePosts[0]!.body, url: "https://github.com/example/comment" })
    await settle()
    expect(setup.captureCharFrame()).toContain("Inline comment posted")
    expect(setup.captureCharFrame()).toContain("Please explain this change.")
    expect(composer()).toBeUndefined()
    expect(savedDraftMarkers()).toHaveLength(1)
    expect(savedDraftMarkers()[0]!.parent).toBe(sourceRow(1)) // The posted draft's marker was removed.
    setThreads([remoteThread, { ...remoteThread, id: "new-server-thread", comments: [{ ...remoteThread.comments[0]!, id: "new-server-comment",
      body: "Please explain this change.", url: "https://github.com/example/comment" }] }])
    await settle()
    // Reconciliation must rebuild the server card, not just remove the local one.
    const diffBody = setup.renderer.root.findDescendantById("diff-body-scroll")!
    expect(diffBody.findDescendantById("diff-comment-card:posted-123")).toBeUndefined()
    expect(diffBody.findDescendantById("diff-comment-card:new-server-thread")).toBeDefined()
    expect(diffBody.findDescendantById("diff-comment-card:remote-thread")).toBeDefined()
    const bodyTexts = (node: Renderable): string[] => [
      ...(node instanceof TextBufferRenderable ? [node.plainText] : []),
      ...node.getChildren().flatMap(bodyTexts),
    ]
    expect(bodyTexts(diffBody).filter(text => text === "Please explain this change.")).toHaveLength(1)
    expect(setup.captureCharFrame().split("Please explain this change.")).toHaveLength(2)
    await openInline()
    expect(editorBody()).toBe("") // Successful posting clears only the submitted context.
    await setup.mockInput.typeText("Retain after failure")
    await post()
    await clickControl(setup, "inline-comment-confirm"); await settle()
    expect(inlinePosts).toHaveLength(3)
    expect(editorBody()).toBe("Retain after failure") // A failed post reopens its text.
    await openInline()
    expect(editorBody()).toBe("Retain after failure")
    setup.mockInput.pressKey("d", { ctrl: true }); await settle()
    await closeInline()
    await openInline()
    expect(editorBody()).toBe("") // Explicit clear must not resurrect the old draft.
    await closeInline()
    await openInline(1)
    expect(editorBody()).toBe("Keep the second line draft")
    setup.mockInput.pressKey("o", { ctrl: true }); await settle()
    const fullEditor = () => setup.renderer.root.findDescendantById("review-editor-body") as TextareaRenderable | undefined
    expect(fullEditor()?.plainText).toBe("Keep the second line draft")
    expect(composer()).toBeUndefined()
    expect(fullEditor()!.height).toBeGreaterThan(Math.floor(setup.renderer.height / 2))
    expect(fullEditor()!.width).toBe(Math.floor(setup.renderer.width * 0.9) - 4)
    expect(Math.abs(fullEditor()!.x * 2 + fullEditor()!.width - setup.renderer.width)).toBeLessThanOrEqual(1)
    expect((setup.renderer.root.findDescendantById("review-editor-save") as TextRenderable).plainText).toBe("Post")
    expect(setup.captureCharFrame()).toContain("ctrl+o restore")
    setup.resize(240, 34); await settle()
    expect(fullEditor()!.width).toBe(Math.floor(setup.renderer.width * 0.9) - 4)
    expect(fullEditor()!.x * 2 + fullEditor()!.width).toBe(240)
    setup.resize(48, 34); await settle()
    expect(fullEditor()!.width).toBeLessThanOrEqual(44)
    setup.resize(110, 34); await settle()
    setup.mockInput.pressKey("o", { ctrl: true }); await settle()
    expect(fullEditor()).toBeUndefined()
    expect(editorBody()).toBe("Keep the second line draft")
    expect(composer()?.focused).toBe(true)
    setup.mockInput.pressKey("o", { ctrl: true }); await settle()
    expect(fullEditor()!.height).toBeGreaterThan(Math.floor(setup.renderer.height / 2))
    await setup.mockInput.typeText(" @al"); await settle()
    expect(setup.renderer.root.findDescendantById("mention-option:alice")).toBeDefined()
    setup.mockInput.pressEscape(); await settle()
    expect(fullEditor()).toBeDefined()
    expect(setup.renderer.root.findDescendantById("mention-completions")).toBeUndefined()
    setup.mockInput.pressKey("d", { ctrl: true })
    await setup.mockInput.typeText("Expanded draft"); await settle()
    setup.mockInput.pressEscape(); await settle()
    expect(fullEditor()).toBeUndefined()
    expect(editorBody()).toBe("Expanded draft")
    expect(composer()?.focused).toBe(true)
    // A new PR revision closes an open draft with notice; reopening its line there carries the text.
    const newHead = "e".repeat(40)
    setRevision({ headSha: newHead, baseSha }); await settle()
    expect(composer()).toBeUndefined()
    expect(setup.captureCharFrame()).toContain("Pull request updated")
    setState(s => ({ ...s, eligibility: { ...eligibility, headSha: newHead } })); await settle()
    await openInline(1)
    expect(editorBody()).toBe("Expanded draft")
    await closeInline()
    setState(s => ({ ...s, eligibility })); setRevision({ headSha, baseSha }); await settle()
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
}, 15_000)
