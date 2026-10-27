import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { PullReviewSession, ReviewSessionState } from "../src/review-types"
import { InlineCommentRetryDialog } from "../src/ui/components/inline-comment-retry"
import { PullReviewDialog, ReviewCommentDialog } from "../src/ui/components/pull-review-dialog"
import { clickControl } from "./fixtures/mouse"

function sessionFixture() {
  const [state, setState] = createSignal<ReviewSessionState>({
    status: "ready",
    eligibility: { accountId: 1, login: "reviewer", repository: "a/b", number: 42, headSha: "a".repeat(40), url: "https://github.com/a/b/pull/42", canComment: true, canApprove: false, canRequestChanges: true },
    draft: { accountId: 1, repository: "a/b", number: 42, headSha: "a".repeat(40), body: "", event: "COMMENT", comments: [] },
  })
  let discarded = 0
  const session: PullReviewSession = {
    state, open: async () => {}, setBody: body => setState(s => ({ ...s, draft: { ...s.draft!, body } })),
    setEvent: event => setState(s => ({ ...s, draft: { ...s.draft!, event } })),
    addComment: () => {}, updateComment: () => {}, removeComment: () => {},
    discard: async () => { discarded++ }, useCurrentHead: () => {}, submit: async () => true, flush: async () => {},
  }
  return { session, setState, discarded: () => discarded }
}

test("review requires feedback and explicit confirmation; blockers prevent submission and Escape preserves draft", async () => {
  const fixture = sessionFixture()
  let submissions = 0
  let closes = 0
  const view = await testRender(() => <PullReviewDialog session={fixture.session} repositoryUrl="https://github.com/a/b" showScrollbar={false}
    onSubmit={() => submissions++} onClose={() => closes++} onOpenGitHub={() => {}} onJump={() => {}} onHintChange={() => {}} />, { width: 80, height: 24 })
  try {
    await view.flush()
    expect(view.renderer.root.findDescendantById("review-event-APPROVE")).toBeUndefined()
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(view.renderer.root.findDescendantById("review-confirm")).toBeUndefined()
    fixture.session.setBody("Feedback")
    await view.flush()
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(submissions).toBe(0)
    const frame = view.captureCharFrame()
    expect(frame).toContain("PR #42")
    expect(frame).toContain("Event: Comment")
    expect(frame).toContain("a".repeat(40))
    expect(frame).not.toContain("Inline comments:")
    view.mockInput.pressEnter(); await view.flush()
    expect(submissions).toBe(1)
    fixture.setState(s => ({ ...s, uncertain: true }))
    await view.flush()
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(view.renderer.root.findDescendantById("review-confirm")).toBeUndefined()
    fixture.setState(s => ({ ...s, uncertain: false }))
    await view.flush()
    view.mockInput.pressKey("d", { ctrl: true }); await view.flush()
    expect(fixture.discarded()).toBe(0)
    view.mockInput.pressEscape(); await Bun.sleep(40); await view.flush()
    view.mockInput.pressEscape(); await Bun.sleep(40); await view.flush()
    expect(closes).toBe(1)
    expect(fixture.session.state().draft?.body).toBe("Feedback")
    expect(fixture.discarded()).toBe(0)
  } finally { view.renderer.destroy() }
})

test("inline editor keeps its native buffer through preview and Ctrl+S invokes submission", async () => {
  let saved = ""
  let rejectSave = true
  const view = await testRender(() => <ReviewCommentDialog anchor={{ path: "src/a.ts", line: 4, side: "RIGHT" }}
    repositoryUrl="https://github.com/a/b" headSha={"a".repeat(40)} showScrollbar={false}
    onSave={body => { if (rejectSave) throw new Error("Draft could not be saved"); saved = body }} onClose={() => {}} onHintChange={() => {}} />, { width: 80, height: 24 })
  try {
    await view.flush()
    const editor = view.renderer.root.findDescendantById("review-editor-body")
    view.mockInput.pressKey("j"); view.mockInput.pressKey("k"); await view.flush()
    await clickControl(view, "review-editor-preview")
    expect(view.renderer.root.findDescendantById("review-editor-body")).toBe(editor)
    expect((editor as import("@opentui/core").TextareaRenderable).plainText).toBe("jk")
    await Bun.sleep(40); await view.flush()
    expect(view.captureCharFrame()).toContain("jk")
    await clickControl(view, "review-editor-preview")
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(saved).toBe("")
    expect(view.captureCharFrame()).toContain("Post inline comment?")
    view.mockInput.pressEscape(); await Bun.sleep(40); await view.flush()
    expect(saved).toBe("")
    expect((editor as import("@opentui/core").TextareaRenderable).plainText).toBe("jk")
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    await clickControl(view, "inline-comment-confirm")
    expect(view.captureCharFrame()).toContain("Draft could not be saved")
    expect(view.renderer.root.findDescendantById("review-editor-body")).toBe(editor)
    rejectSave = false
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(saved).toBe("")
    await clickControl(view, "inline-comment-confirm")
    expect(saved).toBe("jk")
    expect(view.captureCharFrame()).toContain("Submit")
    expect(view.captureCharFrame()).not.toContain("Add to review")
  } finally { view.renderer.destroy() }
})

test("legacy inline drafts are preserved until explicit removal; approval may be empty", async () => {
  const [state, setState] = createSignal<ReviewSessionState>({
    status: "ready",
    eligibility: { accountId: 1, login: "reviewer", repository: "a/b", number: 42, headSha: "a".repeat(40), baseSha: "b".repeat(40), url: "https://github.com/a/b/pull/42", canComment: true, canApprove: true, canRequestChanges: true },
    draft: { accountId: 1, repository: "a/b", number: 42, headSha: "a".repeat(40), baseSha: "b".repeat(40), body: "Keep my review body", event: "REQUEST_CHANGES", comments: [{ id: "1", path: "a.ts", line: 1, side: "RIGHT", body: "Please fix" }] },
  })
  const session: PullReviewSession = { state, open: async () => {}, setBody: () => {}, setEvent: () => {}, addComment: () => {}, updateComment: () => {}, removeComment: id => setState(s => ({ ...s, draft: { ...s.draft!, comments: s.draft!.comments.filter(comment => comment.id !== id) } })), discard: async () => {}, useCurrentHead: () => {}, submit: async () => true, flush: async () => {} }
  const view = await testRender(() => <PullReviewDialog session={session} repositoryUrl="https://github.com/a/b" showScrollbar={false}
    onSubmit={() => {}} onClose={() => {}} onOpenGitHub={() => {}} onJump={() => {}} onHintChange={() => {}} />, { width: 80, height: 24 })
  try {
    await view.flush()
    expect(state().draft?.comments).toHaveLength(1)
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(view.captureCharFrame()).toContain("Remove old queued inline drafts?")
    expect(state().draft?.comments).toHaveLength(1)
    view.mockInput.pressEscape(); await Bun.sleep(40); await view.flush()
    expect(state().draft?.comments).toHaveLength(1)
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    await clickControl(view, "review-confirm")
    expect(state().draft?.comments).toEqual([])
    expect(state().draft?.body).toBe("Keep my review body")
    expect(view.captureCharFrame()).not.toContain("inline comments included")
    setState(s => ({ ...s, draft: { ...s.draft!, event: "COMMENT", body: "" } }))
    await view.flush()
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(view.renderer.root.findDescendantById("review-confirm")).toBeUndefined()
    setState(s => ({ ...s, draft: { ...s.draft!, event: "APPROVE", comments: [] } }))
    await view.flush()
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(view.renderer.root.findDescendantById("review-confirm")).toBeDefined()
  } finally { view.renderer.destroy() }
})


test("review editor uses only permitted toggles and hides explanatory notices and extra actions", async () => {
  const fixture = sessionFixture()
  const reason = "You cannot approve or request changes on your own pull request."
  fixture.setState(s => ({ ...s, message: reason, eligibility: { ...s.eligibility!, reason, canApprove: false, canRequestChanges: false } }))
  const view = await testRender(() => <PullReviewDialog session={fixture.session} repositoryUrl="https://github.com/a/b" showScrollbar={false}
    onSubmit={() => {}} onClose={() => {}} onOpenGitHub={() => {}} onJump={() => {}} onHintChange={() => {}} />, { width: 80, height: 24 })
  try {
    await view.flush()
    expect(view.captureCharFrame()).toContain("Comment")
    expect(view.captureCharFrame()).not.toContain(reason)
    expect(view.captureCharFrame()).not.toContain("Feedback required")
    expect(view.renderer.root.findDescendantById("review-event-APPROVE")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("review-event-REQUEST_CHANGES")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("review-github")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("review-discard")).toBeUndefined()
    await view.mockInput.typeText("Review text")
    expect(fixture.session.state().draft?.body).toBe("Review text")
    fixture.setState(s => ({ ...s, message: undefined, eligibility: { ...s.eligibility!, reason: undefined, canApprove: true, canRequestChanges: true } }))
    await view.flush()
    view.mockInput.pressTab(); await view.flush()
    expect(fixture.session.state().draft?.event).toBe("APPROVE")
    view.mockInput.pressTab(); await view.flush()
    expect(fixture.session.state().draft?.event).toBe("REQUEST_CHANGES")
    expect(fixture.session.state().draft?.body).toBe("Review text")
  } finally { view.renderer.destroy() }
})


test("uncertain inline retries keep the duplicate warning visible above long comment text", async () => {
  let retries = 0
  const view = await testRender(() => <InlineCommentRetryDialog input={{ accountId: 1, repository: "a/b", number: 42,
    headSha: "a".repeat(40), baseSha: "b".repeat(40), anchor: { path: "a.ts", line: 1, side: "RIGHT" },
    body: Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n") }}
    onConfirm={() => retries++} onClose={() => {}} onOpenGitHub={() => {}} onHintChange={() => {}} />, { width: 80, height: 24 })
  try {
    await view.flush()
    expect(view.captureCharFrame()).toContain("avoid a duplicate")
    view.mockInput.pressKey("\u001b[6~"); await view.flush()
    expect((view.renderer.root.findDescendantById("inline-retry-body") as import("@opentui/core").ScrollBoxRenderable).scrollTop).toBeGreaterThan(0)
    expect(view.captureCharFrame()).toContain("avoid a duplicate")
    expect(retries).toBe(0)
    await clickControl(view, "inline-comment-retry-confirm")
    expect(retries).toBe(1)
  } finally { view.renderer.destroy() }
})
