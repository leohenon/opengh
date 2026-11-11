import { expect, spyOn, test } from "bun:test"
import type { TextareaRenderable, TextRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { PullReviewSession, ReviewSessionState } from "../src/review-types"
import { InlineCommentRetryDialog } from "../src/ui/components/inline-comment-retry"
import { PullReviewDialog, ReviewCommentDialog } from "../src/ui/components/pull-review-dialog"
import { KeybindingsProvider } from "../src/ui/keybindings"
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
    expect(view.captureCharFrame()).toContain("Approve…")
    view.mockInput.pressArrow("down"); await view.flush()
    expect(view.captureCharFrame()).toContain("› Request changes…")
    view.mockInput.pressArrow("up"); await view.flush()
    view.mockInput.pressEnter(); await view.flush()
    expect(view.captureCharFrame()).toContain("Comment on PR #42")
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(view.renderer.root.findDescendantById("review-confirm")).toBeUndefined()
    fixture.session.setBody("Feedback")
    await view.flush()
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(submissions).toBe(0)
    const frame = view.captureCharFrame()
    expect(frame).toContain("PR #42")
    expect(frame).toContain("Event: Comment")
    expect(frame).not.toContain("Commit:")
    expect(frame).not.toContain("a".repeat(40))
    expect(frame).not.toContain("Inline comments:")
    view.mockInput.pressEnter(); await view.flush()
    expect(submissions).toBe(1)
    fixture.setState(s => ({ ...s, uncertain: true }))
    await view.flush()
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(view.renderer.root.findDescendantById("review-confirm")).toBeUndefined()
    view.mockInput.pressKey("d", { ctrl: true }); await view.flush()
    expect(fixture.session.state().draft?.body).toBe("Feedback")
    fixture.setState(s => ({ ...s, uncertain: false }))
    await view.flush()
    view.mockInput.pressKey("d", { ctrl: true }); await view.flush()
    expect(fixture.session.state().draft?.body).toBe("")
    expect(fixture.session.state().draft?.event).toBe("COMMENT")
    expect(view.renderer.root.findDescendantById("review-confirm")).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("all inline drafts")
    expect(fixture.discarded()).toBe(0)
    expect(closes).toBe(0)
    view.mockInput.pressKey("z", { ctrl: true }); await view.flush()
    expect(fixture.session.state().draft?.body).toBe("Feedback")
    view.mockInput.pressKey(".", { ctrl: true }); await view.flush()
    expect(fixture.session.state().draft?.body).toBe("")
    await view.mockInput.typeText("Keep this feedback")
    view.mockInput.pressEscape(); await Bun.sleep(40); await view.flush()
    expect(closes).toBe(0)
    expect(view.renderer.root.findDescendantById("review-type-menu")).toBeDefined()
    expect(fixture.session.state().draft?.body).toBe("Keep this feedback")
    view.mockInput.pressEscape(); await Bun.sleep(40); await view.flush()
    expect(closes).toBe(1)
    expect(fixture.session.state().draft?.body).toBe("Keep this feedback")
    expect(fixture.discarded()).toBe(0)
  } finally { view.renderer.destroy() }
})

test("inline editor keeps its native buffer through preview and Ctrl+S invokes submission", async () => {
  let draft = ""
  let saved = ""
  let hint = ""
  let rejectSave = true
  const view = await testRender(() => <ReviewCommentDialog anchor={{ path: "src/a.ts", line: 4, side: "RIGHT" }}
    repositoryUrl="https://github.com/a/b" headSha={"a".repeat(40)} showScrollbar={false}
    onChange={body => { draft = body }} onSave={body => { if (rejectSave) throw new Error("Draft could not be saved"); saved = body }} onClose={() => {}} onHintChange={value => { hint = value ?? "" }} />, { width: 80, height: 24 })
  try {
    await view.flush()
    const editor = view.renderer.root.findDescendantById("review-editor-body")
    view.mockInput.pressKey("j"); view.mockInput.pressKey("k"); await view.flush()
    view.mockInput.pressKey("p", { ctrl: true }); await view.flush()
    expect(view.renderer.root.findDescendantById("review-editor-body")).toBe(editor)
    expect((editor as import("@opentui/core").TextareaRenderable).plainText).toBe("jk")
    expect(hint).toStartWith("ctrl+s post ·")
    expect(hint).not.toContain("post comment")
    await Bun.sleep(40); await view.flush()
    expect(view.captureCharFrame()).toContain("jk")
    view.mockInput.pressKey("p", { ctrl: true }); await view.flush()
    view.mockInput.pressKey("d", { ctrl: true }); await view.flush()
    expect((editor as TextareaRenderable).plainText).toBe("")
    expect(draft).toBe("")
    expect(view.renderer.root.findDescendantById("inline-comment-confirm")).toBeUndefined()
    view.mockInput.pressKey("z", { ctrl: true }); await view.flush()
    expect((editor as TextareaRenderable).plainText).toBe("jk")
    expect(draft).toBe("jk")
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
    expect((view.renderer.root.findDescendantById("review-editor-save") as TextRenderable).plainText).toBe("Post")
    expect(view.captureCharFrame()).not.toContain("Add to review")
  } finally { view.renderer.destroy() }
})

test("legacy inline drafts are preserved until explicit removal; approval may be empty", async () => {
  const [state, setState] = createSignal<ReviewSessionState>({
    status: "ready",
    eligibility: { accountId: 1, login: "reviewer", repository: "a/b", number: 42, headSha: "a".repeat(40), baseSha: "b".repeat(40), url: "https://github.com/a/b/pull/42", canComment: true, canApprove: true, canRequestChanges: true },
    draft: { accountId: 1, repository: "a/b", number: 42, headSha: "a".repeat(40), baseSha: "b".repeat(40), body: "Keep my review body", event: "REQUEST_CHANGES", comments: [{ id: "1", path: "a.ts", line: 1, side: "RIGHT", body: "Please fix" }] },
  })
  const session: PullReviewSession = { state, open: async () => {}, setBody: body => setState(s => ({ ...s, draft: { ...s.draft!, body } })), setEvent: () => {}, addComment: () => {}, updateComment: () => {}, removeComment: id => setState(s => ({ ...s, draft: { ...s.draft!, comments: s.draft!.comments.filter(comment => comment.id !== id) } })), discard: async () => {}, useCurrentHead: () => {}, submit: async () => true, flush: async () => {} }
  const view = await testRender(() => <PullReviewDialog session={session} repositoryUrl="https://github.com/a/b" showScrollbar={false}
    onSubmit={() => {}} onClose={() => {}} onOpenGitHub={() => {}} onJump={() => {}} onHintChange={() => {}} />, { width: 80, height: 24 })
  try {
    await view.flush()
    view.mockInput.pressEnter(); await view.flush()
    expect(state().draft?.comments).toHaveLength(1)
    view.mockInput.pressKey("d", { ctrl: true }); await view.flush()
    expect(state().draft?.body).toBe("")
    expect(state().draft?.comments).toHaveLength(1)
    expect(view.renderer.root.findDescendantById("review-confirm")).toBeUndefined()
    session.setBody("Keep my review body"); await view.flush()
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


test("review menu shows disabled choices, skips them, and preserves text between editors", async () => {
  const fixture = sessionFixture()
  const reason = "You cannot approve or request changes on your own pull request."
  fixture.setState(s => ({ ...s, message: reason, eligibility: { ...s.eligibility!, reason, canApprove: false, canRequestChanges: false } }))
  let submissions = 0
  const view = await testRender(() => <PullReviewDialog session={fixture.session} repositoryUrl="https://github.com/a/b" showScrollbar={false}
    onSubmit={() => submissions++} onClose={() => {}} onOpenGitHub={() => {}} onJump={() => {}} onHintChange={() => {}} />, { width: 80, height: 24 })
  const escape = async () => { view.mockInput.pressEscape(); await Bun.sleep(40); await view.flush() }
  try {
    await view.flush()
    expect(view.captureCharFrame()).not.toContain(reason)
    const comment = view.renderer.root.findDescendantById("review-type-COMMENT")!
    const approve = view.renderer.root.findDescendantById("review-type-APPROVE")!
    const request = view.renderer.root.findDescendantById("review-type-REQUEST_CHANGES")!
    const color = (node: typeof approve) => (node.getChildren()[0] as TextRenderable).fg
    expect(color(comment).equals(color(approve))).toBe(false)
    expect(color(approve).equals(color(request))).toBe(true)
    await clickControl(view, "review-type-APPROVE")
    expect(view.renderer.root.findDescendantById("review-body")).toBeUndefined()
    view.mockInput.pressArrow("down"); await view.flush()
    expect(view.captureCharFrame()).toContain("› Comment…")
    view.mockInput.pressEnter(); await view.flush()
    const editor = view.renderer.root.findDescendantById("review-body") as TextareaRenderable
    await view.mockInput.typeText("Review text"); await view.flush()
    editor.gotoBufferHome()
    view.mockInput.pressTab(); await view.flush()
    expect(fixture.session.state().draft?.event).toBe("COMMENT")
    expect(fixture.session.state().draft?.body).toBe("  Review text")
    view.mockInput.pressTab({ shift: true }); await view.flush()
    expect(fixture.session.state().draft?.body).toBe("Review text")
    await escape()
    fixture.setState(s => ({ ...s, message: undefined, eligibility: { ...s.eligibility!, reason: undefined, canApprove: true, canRequestChanges: true } }))
    await view.flush()
    view.mockInput.pressArrow("down"); view.mockInput.pressEnter(); await view.flush()
    expect(fixture.session.state().draft?.event).toBe("APPROVE")
    expect(view.captureCharFrame()).toContain("Approve PR #42")
    expect(view.renderer.root.findDescendantById("review-body") === editor).toBe(true)
    expect(editor.plainText).toBe("Review text")
    view.mockInput.pressKey("d", { ctrl: true }); await view.flush()
    expect(editor.plainText).toBe("")
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(view.renderer.root.findDescendantById("review-confirm")).toBeDefined()
    expect(submissions).toBe(0)
    view.mockInput.pressEnter(); await view.flush()
    expect(submissions).toBe(1)
    await escape()
    view.mockInput.pressArrow("down"); view.mockInput.pressEnter(); await view.flush()
    expect(fixture.session.state().draft?.event).toBe("REQUEST_CHANGES")
    expect(view.captureCharFrame()).toContain("Request changes on PR #42")
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush()
    expect(view.renderer.root.findDescendantById("review-confirm")).toBeUndefined()
    expect(submissions).toBe(1)
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


test("review and inline editors share remapped preview, expansion and undoable external editing", async () => {
  const previousVisual = process.env.VISUAL
  try {
    for (const kind of ["review", "inline"] as const) {
      const fixture = sessionFixture()
      const [expanded, setExpanded] = createSignal(false)
      let hint = ""
      let closes = 0
      const presentation = { get expanded() { return expanded() }, onExpandedChange: setExpanded, showStatusBarHints: false }
      const view = await testRender(() => <KeybindingsProvider overrides={{ "dialog.togglePreview": ["ctrl+t"] }}>
        {kind === "review" ? <PullReviewDialog {...presentation} session={fixture.session} repositoryUrl="https://github.com/a/b" showScrollbar={false}
          onSubmit={() => {}} onClose={() => { closes++ }} onOpenGitHub={() => {}} onJump={() => {}} onHintChange={value => { hint = value ?? "" }} />
          : <ReviewCommentDialog {...presentation} anchor={{ path: "src/a.ts", line: 4, side: "RIGHT" }} repositoryUrl="https://github.com/a/b"
            headSha={"a".repeat(40)} showScrollbar={false} onChange={fixture.session.setBody} onSave={() => {}} onClose={() => { closes++ }} onHintChange={value => { hint = value ?? "" }} />}
      </KeybindingsProvider>, { width: 100, height: 32 })
      const suspend = spyOn(view.renderer, "suspend").mockResolvedValue(undefined)
      const resume = spyOn(view.renderer, "resume").mockResolvedValue(undefined)
      try {
        await view.flush()
        if (kind === "review") { view.mockInput.pressEnter(); await view.flush() }
        const id = kind === "review" ? "review-body" : "review-editor-body"
        const editor = view.renderer.root.findDescendantById(id) as TextareaRenderable
        await view.mockInput.typeText("# Heading")
        await view.flush()
        const compactWidth = editor.width
        expect(hint).toContain("ctrl+t preview")
        expect(hint).toContain("ctrl+o expand")
        expect(hint).toContain("ctrl+g editor")
        expect(view.renderer.root.findDescendantById("review-editor-preview")).toBeUndefined()
        view.mockInput.pressKey("t", { ctrl: true }); await view.flush()
        expect(editor.visible).toBe(false)
        expect(hint).toContain("ctrl+t write")
        view.mockInput.pressKey("o", { ctrl: true }); await view.flush()
        expect(expanded()).toBe(true)
        view.mockInput.pressKey("t", { ctrl: true }); await view.flush()
        expect(editor.visible).toBe(true)
        expect(editor.width).toBeGreaterThan(compactWidth)
        expect(view.renderer.root.findDescendantById(id) === editor).toBe(true)
        view.mockInput.pressKey("p", { ctrl: true }); await view.flush()
        expect(editor.visible).toBe(true)
        view.mockInput.pressKey("t", { ctrl: true }); await view.flush()
        process.env.VISUAL = "printf '# External edit\\n' >"
        view.mockInput.pressKey("g", { ctrl: true })
        for (let attempt = 0; attempt < 100 && editor.plainText !== "# External edit\n"; attempt++) {
          await Bun.sleep(10)
          await view.flush()
        }
        await view.flush()
        expect(editor.plainText).toBe("# External edit\n")
        expect(editor.visible).toBe(true)
        expect(suspend).toHaveBeenCalledTimes(1)
        expect(resume).toHaveBeenCalledTimes(1)
        expect(fixture.session.state().draft?.body).toBe("# External edit\n")
        view.mockInput.pressKey("z", { ctrl: true }); await view.flush()
        expect(editor.plainText).toBe("# Heading")
        expect(fixture.session.state().draft?.body).toBe("# Heading")
        view.mockInput.pressEscape(); await Bun.sleep(40); await view.flush()
        if (kind === "review") {
          expect(closes).toBe(0)
          view.mockInput.pressEscape(); await Bun.sleep(40); await view.flush()
        }
        expect(closes).toBe(1)
        expect(expanded()).toBe(true)
      } finally {
        suspend.mockRestore()
        resume.mockRestore()
        view.renderer.destroy()
      }
    }
  } finally {
    if (previousVisual === undefined) delete process.env.VISUAL
    else process.env.VISUAL = previousVisual
  }
}, 10_000)
