import { expect, test } from "bun:test"
import type { ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { App } from "../src/ui/app"
import { ActivityCommentComposer } from "../src/ui/components/activity-comment-composer"
import { githubDataFixture, issueDetailFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { clickControl } from "./fixtures/mouse"

test("issue comments hide the composer while posting, recover after failure and clear after success", async () => {
  const [body, setBody] = createSignal("")
  let pending = Promise.withResolvers<void>()
  let submissions = 0
  const view = await testRender(
    () => (
      <App
        data={githubDataFixture}
        operations={repositoryOperationsFixture}
        issueDetail={{
          number: issueDetailFixture.number,
          resource: { status: "ready", value: { ...issueDetailFixture, body: "Description." } },
          comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
          references: { status: "ready", value: [] },
        }}
        getCommentDraft={() => body()}
        getIssueAction={() => ({ body: body(), reason: "completed", operation: { status: "idle" } })}
        onPrepareIssueAction={() => {}}
        onIssueDraftChange={(_number, draft) => {
          if (draft.body !== undefined) setBody(draft.body)
        }}
        onSubmitIssueAction={async () => {
          submissions++
          await pending.promise
          setBody("")
          return {}
        }}
      />
    ),
    { width: 100, height: 32 },
  )
  try {
    await view.flush()
    view.mockInput.pressKey("3")
    view.mockInput.pressEnter()
    await view.flush()
    view.mockInput.pressKey("c")
    await view.flush()
    const draft = "Keep this text until posting succeeds."
    await view.mockInput.typeText(draft)
    view.mockInput.pressKey("s", { ctrl: true })
    await view.flush()
    await clickControl(view, "issue-action-confirm")
    await view.flush()
    expect(submissions).toBe(1)
    expect(body()).toBe(draft)
    expect(view.renderer.root.findDescendantById("issue-comment-area")).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("Posting…")
    expect(view.captureCharFrame()).not.toContain("Draft saved")
    expect(view.renderer.root.findDescendantById("issue-comment-resume")).toBeUndefined()
    await Bun.sleep(220)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Posting comment")
    view.mockInput.pressKey("c")
    view.mockInput.pressKey("s", { ctrl: true })
    await view.flush()
    expect(submissions).toBe(1)
    expect(view.renderer.root.findDescendantById("issue-comment-editor")).toBeUndefined()

    pending.reject(new Error("Posting failed"))
    await Bun.sleep(0)
    await view.flush()
    expect(body()).toBe(draft)
    expect(view.captureCharFrame()).toContain("Draft saved · Resume")
    expect(view.captureCharFrame()).not.toContain("Posting…")
    pending = Promise.withResolvers<void>()
    await clickControl(view, "issue-comment-resume")
    await view.flush()
    expect(view.captureCharFrame()).toContain(draft)
    view.mockInput.pressKey("s", { ctrl: true })
    await view.flush()
    await clickControl(view, "issue-action-confirm")
    await view.flush()
    expect(submissions).toBe(2)
    expect(view.renderer.root.findDescendantById("issue-comment-area")).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("Posting…")
    expect(view.renderer.root.findDescendantById("issue-comment-resume")).toBeUndefined()
    pending.resolve()
    await Bun.sleep(0)
    await view.flush()
    expect(body()).toBe("")
    expect(view.captureCharFrame()).not.toContain("Posting…")
    expect(view.captureCharFrame()).not.toContain("Draft saved")
    expect(view.renderer.root.findDescendantById("issue-comment-area")).toBeUndefined()
  } finally {
    view.renderer.destroy()
  }
})

test.each([false, true])("restoring a draft follows the bottom only when the user stayed there (%s)", async (atBottom) => {
  const [saved, setSaved] = createSignal(false)
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
            open: false,
            focused: false,
            body: "Retained draft",
            saved: saved(),
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
    await view.flush()
    scroll.scrollTo(atBottom ? scroll.scrollHeight : 0)
    await view.flush()
    const top = scroll.scrollTop
    setSaved(true)
    await view.flush()
    expect(view.renderer.root.findDescendantById("comment-resume")).toBeDefined()
    if (atBottom) {
      expect(scroll.scrollTop).toBeGreaterThan(top)
      expect(view.captureCharFrame()).toContain("Draft saved · Resume")
    } else {
      expect(scroll.scrollTop).toBe(top)
      expect(view.captureCharFrame()).not.toContain("Draft saved")
    }
  } finally {
    view.renderer.destroy()
  }
})
