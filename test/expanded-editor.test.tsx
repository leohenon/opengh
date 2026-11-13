import { expect, test } from "bun:test"
import type { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { IssueActionState } from "../src/repository-state"
import type { PullReviewSession, ReviewSessionState } from "../src/review-types"
import { IssueActionDialog } from "../src/ui/components/issue-actions"
import { PullReviewDialog, ReviewCommentDialog } from "../src/ui/components/pull-review-dialog"
import { KeybindingsProvider } from "../src/ui/keybindings"

for (const kind of ["issue", "pull", "review", "inline"] as const) {
  test(`${kind} uses the shared expanded editor popup without a reading-width cap or remount`, async () => {
    const sha = "a".repeat(40)
    const [expanded, setExpanded] = createSignal(false)
    const [action, setAction] = createSignal<IssueActionState>({ body: "A draft", reason: "completed", operation: { status: "idle" } })
    const [state, setState] = createSignal<ReviewSessionState>({ status: "ready",
      eligibility: { accountId: 1, login: "reviewer", repositoryId: 1, repository: "a/b", number: 42, headSha: sha,
        url: "https://github.com/a/b/pull/42", canComment: true, canApprove: false, canRequestChanges: false },
      draft: { accountId: 1, repositoryId: 1, repository: "a/b", number: 42, headSha: sha, body: "A draft", event: "COMMENT", comments: [] } })
    const session: PullReviewSession = {
      state, open: async () => {}, flush: async () => {}, discard: async () => {}, submit: async () => true, useCurrentHead: () => {},
      setBody: body => setState(s => ({ ...s, draft: { ...s.draft!, body } })),
      setEvent: event => setState(s => ({ ...s, draft: { ...s.draft!, event } })),
      addComment: () => {}, updateComment: () => {}, removeComment: () => {},
    }
    let submissions = 0
    const common = { get expanded() { return expanded() }, onExpandedChange: setExpanded, showStatusBarHints: false,
      repositoryUrl: "https://github.com/a/b", showScrollbar: false, onHintChange: () => {}, onClose: () => {} }
    const view = await testRender(() => <KeybindingsProvider overrides={{ "dialog.toggleExpanded": ["ctrl+e"], "dialog.togglePreview": ["ctrl+t"] }}>
      {kind === "review" ? <PullReviewDialog {...common} session={session} onSubmit={() => submissions++} onOpenGitHub={() => {}} onJump={() => {}} />
        : kind === "inline" ? <ReviewCommentDialog {...common} anchor={{ path: "a.ts", line: 1, side: "RIGHT" }} body="A draft" headSha={sha} onSave={() => submissions++} />
        : <IssueActionDialog {...common} number={42} kind="comment" parent={kind} state={action()} onSubmit={() => submissions++}
          onBodyChange={body => setAction(a => ({ ...a, body }))} onReasonChange={() => {}} onDuplicateTargetChange={() => {}} onDiscard={() => {}} />}
    </KeybindingsProvider>, { width: 120, height: 40 })
    const key = async (name: string) => { view.mockInput.pressKey(name, { ctrl: true }); await view.flush() }
    try {
      await view.flush()
      if (kind === "review") { view.mockInput.pressEnter(); await view.flush() }
      const id = kind === "review" ? "review-body" : kind === "inline" ? "review-editor-body" : "issue-comment-writer"
      const editor = view.renderer.root.findDescendantById(id) as TextareaRenderable
      const panel = () => editor.parent!.parent!.parent!
      const compact = { width: panel().width, height: panel().height }
      editor.setCursor(0, 2)
      const cursor = { ...editor.logicalCursor }
      await key("e")
      expect(expanded()).toBe(true)
      expect(panel().width).toBe(108)
      expect(panel().height).toBe(36)
      expect(editor.width).toBe(panel().width - 4)
      expect(editor.logicalCursor).toMatchObject(cursor)
      expect(panel().x).toBeGreaterThan(0)
      expect(panel().y).toBeGreaterThan(0)
      expect(panel().x + panel().width).toBeLessThan(view.renderer.width)
      expect(panel().y + panel().height).toBeLessThan(view.renderer.height)
      await key("t")
      expect(editor.visible).toBe(false)
      expect(panel().width).toBe(108)
      await key("t")
      expect(editor.visible).toBe(true)
      expect(view.renderer.root.findDescendantById(id)).toBe(editor)
      await key("s")
      const confirm = kind === "review" ? "review-confirm" : kind === "inline" ? "inline-comment-confirm" : "issue-action-confirm"
      expect(view.renderer.root.findDescendantById(confirm)).toBeDefined()
      expect(submissions).toBe(0)
      view.mockInput.pressEscape()
      await Bun.sleep(40) // Bare-Escape timeout.
      await view.flush()
      expect(!!view.renderer.root.findDescendantById(confirm)).toBe(false)
      expect(expanded()).toBe(true)
      for (const [width, height] of [[240, 60], [48, 20]] as const) {
        view.resize(width, height); await view.flush()
        expect(editor.width).toBe(panel().width - 4)
        expect(panel().x).toBeGreaterThan(0)
        expect(panel().y).toBeGreaterThan(0)
        expect(panel().x + panel().width).toBeLessThan(width)
        expect(panel().y + panel().height).toBeLessThan(height)
        expect(editor.height).toBeGreaterThan(0)
        if (width === 240) expect(editor.width).toBe(212)
      }
      view.resize(120, 40); await view.flush()
      await key("e")
      expect(expanded()).toBe(false)
      expect(panel().width).toBe(compact.width)
      expect(panel().height).toBe(compact.height)
      expect(view.renderer.root.findDescendantById(id)).toBe(editor)
      expect(editor.plainText).toBe("A draft")
      expect(editor.logicalCursor).toMatchObject(cursor)
    } finally { view.renderer.destroy() }
  })
}
