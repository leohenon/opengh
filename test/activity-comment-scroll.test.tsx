import { expect, test } from "bun:test"
import type { BoxRenderable, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { PullRequestDetail } from "../src/models"
import type { IssueDetailState, PullDetailState } from "../src/repository-state"
import { ActivityCommentComposer, type ActivityComment } from "../src/ui/components/activity-comment-composer"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { IssueScreen } from "../src/ui/pages/issue"
import { PullScreen } from "../src/ui/pages/pull"
import { githubDataFixture, issueCommentsFixture, issueDetailFixture, issuePullReferenceFixture } from "./fixtures/github-data"

async function settle(view: Awaited<ReturnType<typeof testRender>>) {
  await view.flush()
  await view.renderer.idle()
  await view.flush()
}

for (const kind of ["issue", "pull"] as const) {
  test(`${kind} keeps the focused comment in view through late activity without replacing its draft or stealing manual scrolling`, async () => {
    const [open, setOpen] = createSignal(false)
    const [focused, setFocused] = createSignal(false)
    const [body, setBody] = createSignal("")
    const [comments, setComments] = createSignal<IssueDetailState["comments"]>({ status: "loading", phase: "load" })
    const [references, setReferences] = createSignal<IssueDetailState["references"]>({ status: "loading", phase: "load" })
    const comment: ActivityComment = {
      get open() {
        return open()
      },
      get focused() {
        return focused()
      },
      get body() {
        return body()
      },
      saved: false,
      enabled: true,
      canPost: true,
      onOpen: () => {
        setOpen(true)
        setFocused(true)
      },
      onInput: setBody,
      onPost: () => {},
      onClose: () => {
        setOpen(false)
        setFocused(false)
      },
      onExpand: () => {},
      onFocusChange: setFocused,
      onHintChange: () => {},
    }
    const description = Array.from({ length: 8 }, (_, index) => `Description paragraph ${index}.`).join("\n\n")
    const issue = { ...issueDetailFixture, body: description }
    const pull: PullRequestDetail = {
      ...githubDataFixture.pulls.open.value!.items[0]!,
      url: "https://github.com/anomalyco/opentui/pull/42",
      body: description,
      updatedAt: issue.updatedAt,
      baseBranch: "main",
      headBranch: "next",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      commitCount: 0,
      commentCount: 20,
      labels: [],
      assignees: [],
      reviewers: [],
      mergeable: null,
    }
    const view = await testRender(
      () => (
        <KeybindingsProvider>
          {kind === "issue" ? (
            <IssueScreen
              number={issue.number}
              detail={{ number: issue.number, resource: { status: "ready", value: issue }, comments: comments(), references: references() }}
              comment={comment}
              interactive
              showScrollbar={false}
            />
          ) : (
            <PullScreen
              number={pull.number}
              detail={
                {
                  number: pull.number,
                  resource: { status: "ready", value: pull },
                  comments: comments(),
                  references: references(),
                  commits: { status: "ready", value: [] },
                  context: { status: "loading", phase: "load" },
                } satisfies PullDetailState
              }
              comment={comment}
              interactive
              showScrollbar={false}
            />
          )}
        </KeybindingsProvider>
      ),
      { width: 100, height: 28 },
    )
    const loaded = Array.from({ length: 20 }, (_, index) => ({
      ...issueCommentsFixture[0]!,
      id: 1000 + index,
      body: `Late comment ${index}\n\nMore conversation content.`,
    }))
    try {
      await settle(view)
      const listeners = view.renderer.listenerCount("frame")
      comment.onOpen()
      await settle(view)
      const scroll = view.renderer.root.findDescendantById(`${kind}-detail-scroll`) as ScrollBoxRenderable
      const editor = view.renderer.root.findDescendantById(`${kind}-comment-editor`) as TextareaRenderable
      await view.mockInput.typeText("A draft that stays visible")
      editor.setCursor(0, 7)
      editor.setSelection(2, 7)
      await settle(view)
      const y = editor.y - scroll.viewport.y
      const selection = editor.getSelection()
      const cursor = { ...editor.logicalCursor }
      const checkEditor = () => {
        expect(view.renderer.root.findDescendantById(`${kind}-comment-editor`)).toBe(editor)
        expect(view.renderer.currentFocusedRenderable).toBe(editor)
        expect(editor.y - scroll.viewport.y).toBe(y)
        expect(editor.y).toBeGreaterThanOrEqual(scroll.viewport.y)
        expect(editor.y + editor.height).toBeLessThanOrEqual(scroll.viewport.y + scroll.viewport.height)
        expect(editor.plainText).toBe("A draft that stays visible")
        expect(body()).toBe(editor.plainText)
        expect(editor.logicalCursor).toMatchObject(cursor)
        expect(editor.getSelection()).toEqual(selection)
        expect(view.captureCharFrame()).toContain("A draft that stays visible")
      }
      setComments({ status: "ready", value: { items: loaded, page: 1, hasMore: false } })
      await settle(view)
      checkEditor()
      const afterComments = scroll.scrollTop
      setReferences({
        status: "ready",
        value: Array.from({ length: 10 }, (_, index) => ({ ...issuePullReferenceFixture, id: `ref-${index}` })),
      })
      await settle(view)
      checkEditor()
      expect(scroll.scrollTop).toBeGreaterThan(afterComments)

      // Scrolling away is not a layout shift.
      scroll.scrollTo(0)
      await settle(view)
      expect(scroll.scrollTop).toBe(0)
      setComments({ status: "ready", value: { items: [...loaded, { ...loaded[0]!, id: 2000 }], page: 1, hasMore: false } })
      await settle(view)
      expect(scroll.scrollTop).toBe(0)
      expect(editor.y).toBeGreaterThan(scroll.viewport.y + scroll.viewport.height)
      expect(body()).toBe("A draft that stays visible")

      comment.onFocusChange(false)
      await settle(view)
      setReferences({ status: "ready", value: [] })
      await settle(view)
      expect(scroll.scrollTop).toBe(0)
      comment.onOpen()
      await settle(view)
      expect(view.captureCharFrame()).toContain("A draft that stays visible")
      comment.onClose()
      await settle(view)
      expect(view.renderer.listenerCount("frame")).toBe(listeners)
    } finally {
      view.renderer.destroy()
    }
  })
}

test.each([false, true])("comment anchoring follows geometry changes (opening reveal settled: %s)", async (settled) => {
  const [height, setHeight] = createSignal(15)
  let scroll!: ScrollBoxRenderable
  const view = await testRender(
    () => (
      <scrollbox ref={(value) => (scroll = value)} height="100%" width="100%" focusable={false}>
        <box height={height()} flexShrink={0} />
        <ActivityCommentComposer
          idPrefix="comment"
          interactive
          repositoryUrl="https://github.com/a/b"
          scroll={() => scroll}
          comment={{
            open: true,
            focused: true,
            body: "Draft",
            saved: false,
            enabled: true,
            canPost: true,
            onOpen: () => {},
            onInput: () => {},
            onPost: () => {},
            onClose: () => {},
            onExpand: () => {},
            onFocusChange: () => {},
            onHintChange: () => {},
          }}
        />
      </scrollbox>
    ),
    { width: 80, height: 18 },
  )
  try {
    if (settled) await settle(view)
    else {
      setHeight(70) // Loading finishes before the opening reveal's first layout.
      await settle(view)
    }
    const holder = view.renderer.root.findDescendantById("comment-area") as BoxRenderable
    expect(holder.y + holder.height).toBeLessThanOrEqual(scroll.viewport.y + scroll.viewport.height)
    const y = holder.y
    const top = scroll.scrollTop
    const initialHeight = height()
    for (const next of [90, 65, 140]) {
      setHeight(next)
      await settle(view)
      expect(holder.y).toBe(y)
      expect(scroll.scrollTop).toBe(top + next - initialHeight)
      expect(view.captureCharFrame()).toContain("Draft")
    }
  } finally {
    view.renderer.destroy()
  }
})
test("manual scrolling cancels a pending opening reveal", async () => {
  const [open, setOpen] = createSignal(false)
  let scroll!: ScrollBoxRenderable
  const view = await testRender(
    () => (
      <scrollbox ref={(value) => (scroll = value)} height="100%" width="100%" focusable={false}>
        <box height={100} flexShrink={0} />
        <ActivityCommentComposer
          idPrefix="comment"
          interactive
          repositoryUrl="https://github.com/a/b"
          scroll={() => scroll}
          comment={{
            open: open(),
            focused: open(),
            body: "Draft",
            saved: false,
            enabled: true,
            canPost: true,
            onOpen: () => {},
            onInput: () => {},
            onPost: () => {},
            onClose: () => {},
            onExpand: () => {},
            onFocusChange: () => {},
            onHintChange: () => {},
          }}
        />
      </scrollbox>
    ),
    { width: 80, height: 18 },
  )
  try {
    await settle(view)
    scroll.scrollTo(20)
    await settle(view)
    setOpen(true)
    scroll.scrollTo(5)
    await settle(view)
    expect(scroll.scrollTop).toBe(5)
  } finally {
    view.renderer.destroy()
  }
})

test("dismissing an overlay preserves manual scrolling without suppressing explicit editor focus", async () => {
  const [interactive, setInteractive] = createSignal(true)
  const [focused, setFocused] = createSignal(true)
  const [height, setHeight] = createSignal(100)
  let scroll!: ScrollBoxRenderable
  const view = await testRender(
    () => (
      <scrollbox ref={(value) => (scroll = value)} height="100%" width="100%" focusable={false}>
        <box height={height()} flexShrink={0} />
        <ActivityCommentComposer
          idPrefix="comment"
          interactive={interactive()}
          repositoryUrl="https://github.com/a/b"
          scroll={() => scroll}
          comment={{
            open: true,
            focused: focused(),
            body: "Draft",
            saved: false,
            enabled: true,
            canPost: true,
            onOpen: () => {},
            onInput: () => {},
            onPost: () => {},
            onClose: () => {},
            onExpand: () => {},
            onFocusChange: setFocused,
            onHintChange: () => {},
          }}
        />
      </scrollbox>
    ),
    { width: 80, height: 18 },
  )
  try {
    await settle(view)
    expect(view.captureCharFrame()).toContain("Draft")
    scroll.scrollTo(10)
    await settle(view)
    setInteractive(false)
    await settle(view)
    setInteractive(true)
    await settle(view)
    expect(scroll.scrollTop).toBe(10)
    expect(focused()).toBe(true)
    setHeight(140)
    await settle(view)
    expect(scroll.scrollTop).toBe(10)

    setFocused(false)
    await settle(view)
    setFocused(true)
    await settle(view)
    expect(view.captureCharFrame()).toContain("Draft")
    const holder = view.renderer.root.findDescendantById("comment-area") as BoxRenderable
    const y = holder.y
    setHeight(160)
    await settle(view)
    expect(holder.y).toBe(y)
    expect(view.captureCharFrame()).toContain("Draft")
  } finally {
    view.renderer.destroy()
  }
})
