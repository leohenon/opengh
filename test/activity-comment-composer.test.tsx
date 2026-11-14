import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { defaultConfig } from "../src/config"
import type { IssueActionParent, IssueActionResult, IssueComment } from "../src/models"
import type { IssueActionState, IssueDetailState, PullDetailState } from "../src/repository-state"
import { App } from "../src/ui/app"
import { clickControl } from "./fixtures/mouse"
import { githubDataFixture, issueCommentsFixture, issueDetailFixture, pullContextFixture, repositoryOperationsFixture } from "./fixtures/github-data"

for (const parent of ["issue", "pull"] as const) {
  test(`${parent} comments compose in activity, preserve drafts, expand, confirm and retry with configured shortcuts`, async () => {
    const summary = githubDataFixture.pulls.open.value!.items[0]!
    const number = parent === "issue" ? issueDetailFixture.number : summary.number
    const prefix = `${parent}-comment`
    const empty: IssueActionState = { body: "", reason: "completed", operation: { status: "idle" } }
    const [action, setAction] = createSignal(empty)
    const [config, setConfig] = createSignal({ ...defaultConfig, showStatusBarHints: true,
      keybindings: { "dialog.togglePreview": ["ctrl+t"] } })
    const comments = Array.from({ length: 12 }, (_, index) => ({ ...issueCommentsFixture[0]!, id: 1000 + index, body: `Earlier comment ${index}` }))
    const [issue, setIssue] = createSignal<IssueDetailState>({ number: issueDetailFixture.number,
      resource: { status: "ready", value: issueDetailFixture },
      comments: { status: "ready", value: { items: comments, page: 1, hasMore: false } }, references: { status: "ready", value: [] } })
    const [pull, setPull] = createSignal<PullDetailState>({ number: summary.number,
      resource: { status: "ready", value: { ...summary, url: `${githubDataFixture.repo.url}/pull/${summary.number}`, body: "PR description",
        updatedAt: summary.createdAt, baseBranch: "main", headBranch: "feature", additions: 1, deletions: 0, changedFiles: 1,
        commitCount: 0, commentCount: comments.length, labels: [], assignees: [], reviewers: [], mergeable: null, permissions: { comment: true } } },
      comments: { status: "ready", value: { items: comments, page: 1, hasMore: false } }, references: { status: "ready", value: [] },
      commits: { status: "ready", value: [] }, context: { status: "ready", value: pullContextFixture } })
    let pending = Promise.withResolvers<IssueActionResult>()
    const calls: Array<{ number: number; parent?: IssueActionParent; body: string }> = []
    const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
      config={config()} issueDetail={issue()} pullDetail={pull()}
      initialNavigation={{ detail: { kind: parent, number } }} getIssueAction={() => action()}
      onPrepareIssueAction={() => setAction(current => ({ ...current, operation: { status: "idle" } }))}
      onIssueDraftChange={(_number, draft) => setAction(current => ({ ...current, ...draft }))}
      onDiscardIssueDraft={() => setAction(empty)}
      onSubmitIssueAction={async (target, kind, subject) => {
        expect(kind).toBe("comment")
        calls.push({ number: target, parent: subject, body: action().body })
        setAction(current => ({ ...current, operation: { status: "loading" } }))
        try {
          const result = await pending.promise
          if (result.comment) {
            if (parent === "issue") setIssue(current => ({ ...current, comments: { status: "ready", value: { items: [...comments, result.comment!], page: 1, hasMore: false } } }))
            else setPull(current => ({ ...current, comments: { status: "ready", value: { items: [...comments, result.comment!], page: 1, hasMore: false } } }))
          }
          setAction(empty)
          return result
        } catch (error) {
          setAction(current => ({ ...current, operation: { status: "error", message: String(error) } }))
          throw error
        }
      }} />, { width: 120, height: 30 })
    const settle = async () => { await view.flush(); await Bun.sleep(35); await view.flush() }
    const editor = () => view.renderer.root.findDescendantById(`${prefix}-editor`) as TextareaRenderable | undefined
    const footer = () => view.captureCharFrame().split("\n")[29]!.trim()
    const scroll = () => view.renderer.root.findDescendantById(`${parent}-detail-scroll`) as ScrollBoxRenderable
    try {
      await settle()
      view.mockInput.pressKey("c")
      await settle()
      expect(editor()?.focused).toBe(true)
      expect(scroll().findDescendantById(`${prefix}-editor`)).toBe(editor())
      expect(view.renderer.root.findDescendantById("issue-comment-writer")).toBeUndefined()
      view.mockInput.pressEscape()
      await settle()
      expect(editor()).toBeUndefined()
      expect(view.renderer.root.findDescendantById(`${prefix}-resume`)).toBeUndefined()
      expect(scroll()).toBeDefined()
      view.mockInput.pressKey("c")
      await settle()
      expect(scroll().scrollTop).toBeGreaterThan(0)
      for (let attempt = 0; attempt < 20 && !view.captureCharFrame().includes("Earlier comment 11"); attempt++) await settle()
      expect(view.captureCharFrame()).toContain("Earlier comment 11")
      await view.mockInput.typeText("@ma")
      await settle()
      expect(view.renderer.root.findDescendantById("mention-option:maria-dev")).toBeDefined()
      view.mockInput.pressKey("s", { ctrl: true })
      await settle()
      expect(view.renderer.root.findDescendantById("mention-completions")).toBeUndefined()
      expect(view.renderer.root.findDescendantById("issue-action-confirm")).toBeDefined()
      view.mockInput.pressEscape(); await settle()
      expect(calls).toHaveLength(0)
      await view.mockInput.typeText("r"); await settle()
      view.mockInput.pressEnter()
      await settle()
      expect(action().body).toBe("@maria-dev ")
      expect(calls).toHaveLength(0)
      view.mockInput.pressKey("d", { ctrl: true })
      await settle()
      await view.mockInput.typeText("Saved **draft** q?hc")
      await settle()
      expect(action().body).toBe("Saved **draft** q?hc")
      expect(footer()).toContain("ctrl+s post · ctrl+t preview · ctrl+o expand")
      expect(view.captureCharFrame()).not.toContain("Help")
      const instance = editor()
      view.mockInput.pressKey("t", { ctrl: true })
      await settle()
      expect(editor()).toBe(instance)
      expect(view.captureCharFrame()).toContain("Saved draft q?hc")
      expect(footer()).toContain("ctrl+t write")
      view.mockInput.pressKey("t", { ctrl: true })
      setConfig(current => ({ ...current, showStatusBarHints: false }))
      await settle()
      expect(footer()).toBe("")
      setConfig(current => ({ ...current, showStatusBarHints: true }))
      await settle()

      view.mockInput.pressKey("o", { ctrl: true })
      await settle()
      expect(editor()).toBeUndefined()
      const expanded = view.renderer.root.findDescendantById("issue-comment-writer") as TextareaRenderable
      expect(expanded.plainText).toBe(action().body)
      expect(expanded.height).toBeGreaterThan(view.renderer.height - 10)
      expect(expanded.width).toBe(Math.floor(view.renderer.width * 0.9) - 4)
      expect(expanded.x * 2 + expanded.width).toBe(120)
      view.resize(240, 30)
      await settle()
      expect(expanded.width).toBe(Math.floor(view.renderer.width * 0.9) - 4)
      expect(expanded.x * 2 + expanded.width).toBe(240)
      view.resize(48, 30)
      await settle()
      expect(expanded.width).toBeLessThanOrEqual(44)
      view.resize(120, 30)
      await settle()
      expect(footer()).toContain("ctrl+o restore")
      expect(footer()).toStartWith("ctrl+s post")
      await view.mockInput.typeText(" @ma")
      await settle()
      expect(view.renderer.root.findDescendantById("mention-option:max")).toBeDefined()
      view.mockInput.pressEscape(); await settle()
      expect(view.renderer.root.findDescendantById("issue-comment-writer")).toBe(expanded)
      expect(view.renderer.root.findDescendantById("mention-completions")).toBeUndefined()
      view.mockInput.pressKey("z", { ctrl: true }); await settle()
      expect(action().body).toBe("Saved **draft** q?hc")
      await view.mockInput.typeText(" expanded")
      const expandedIssue = issue(), expandedPull = pull()
      if (parent === "issue") setIssue({ ...expandedIssue, resource: { status: "ready", value: { ...expandedIssue.resource.value!,
        permissions: { ...expandedIssue.resource.value!.permissions!, comment: false } } } })
      else setPull({ ...expandedPull, resource: { status: "ready", value: { ...expandedPull.resource.value!,
        permissions: { ...expandedPull.resource.value!.permissions, comment: false } } } })
      await settle()
      await view.mockInput.typeText("!"); await settle()
      expect(action().body).toBe("Saved **draft** q?hc expanded!")
      view.mockInput.pressKey("s", { ctrl: true }); await settle()
      expect(view.renderer.root.findDescendantById("issue-action-confirm")).toBeUndefined()
      expect(calls).toHaveLength(0)
      view.mockInput.pressBackspace(); await settle()
      setIssue(expandedIssue); setPull(expandedPull); await settle()
      view.mockInput.pressKey("o", { ctrl: true })
      await settle()
      expect(view.renderer.root.findDescendantById("issue-comment-writer")).toBeUndefined()
      expect(editor()?.plainText).toBe("Saved **draft** q?hc expanded")
      expect(editor()?.focused).toBe(true)
      const inlineReadyIssue = issue(), inlineReadyPull = pull()
      for (const unavailable of ["loading", "permission"] as const) {
        if (parent === "issue") setIssue({ ...inlineReadyIssue, resource: unavailable === "loading"
          ? { status: "loading", phase: "load", value: inlineReadyIssue.resource.value }
          : { status: "ready", value: { ...inlineReadyIssue.resource.value!, permissions: { ...inlineReadyIssue.resource.value!.permissions!, comment: false } } } })
        else setPull({ ...inlineReadyPull, resource: unavailable === "loading"
          ? { status: "loading", phase: "load", value: inlineReadyPull.resource.value }
          : { status: "ready", value: { ...inlineReadyPull.resource.value!, permissions: { ...inlineReadyPull.resource.value!.permissions, comment: false } } } })
        await settle()
        expect(editor()?.focused).toBe(true)
        await view.mockInput.typeText("!"); await settle()
        expect(action().body).toBe("Saved **draft** q?hc expanded!")
        view.mockInput.pressKey("s", { ctrl: true }); await settle()
        await clickControl(view, `${prefix}-post`); await settle()
        expect(view.renderer.root.findDescendantById("issue-action-confirm")).toBeUndefined()
        expect(calls).toHaveLength(0)
        view.mockInput.pressKey("o", { ctrl: true }); await settle()
        expect(view.renderer.root.findDescendantById("issue-comment-writer")).toBeDefined()
        view.mockInput.pressKey("o", { ctrl: true }); await settle()
        expect(editor()?.focused).toBe(true)
        view.mockInput.pressEscape(); await settle()
        expect(editor()).toBeUndefined()
        expect(scroll()).toBeDefined()
        expect(view.captureCharFrame()).toContain("Draft saved · Resume")
        view.mockInput.pressKey("c"); await settle()
        expect(editor()?.plainText).toBe("Saved **draft** q?hc expanded!")
        expect(editor()?.focused).toBe(true)
        view.mockInput.pressBackspace(); await settle()
        setIssue(inlineReadyIssue); setPull(inlineReadyPull); await settle()
      }

      view.mockInput.pressEscape()
      await settle()
      expect(editor()).toBeUndefined()
      expect(view.captureCharFrame()).toContain("Draft saved · Resume")
      await clickControl(view, `${prefix}-resume`)
      await settle()
      expect(editor()?.plainText).toBe(action().body)
      expect(editor()?.focused).toBe(true)
      view.resize(48, 30)
      await settle()
      expect(editor()!.width).toBeLessThanOrEqual(44)
      if (parent === "issue") {
        scroll().scrollTo(scroll().scrollHeight)
        await settle()
        const dueRow = view.captureCharFrame().split("\n").findIndex(row => row.trim().startsWith("Due "))
        expect(dueRow).toBeGreaterThanOrEqual(0)
        expect(view.renderer.root.findDescendantById("issue-comment-area")!.y).toBeGreaterThan(dueRow)
      }
      expect(editor()?.plainText).toBe(action().body)
      view.resize(120, 30)
      await settle()
      scroll().scrollTo(0)
      await settle()
      const description = view.renderer.root.findDescendantById(`${parent}-detail-description`)!
      await view.mockMouse.click(description.x + 1, description.y + 1)
      await settle()
      expect(editor()?.focused).toBe(false)
      view.mockInput.pressKey("j")
      await settle()
      expect(action().body).toBe("Saved **draft** q?hc expanded")
      view.mockInput.pressKey("c")
      await settle()
      expect(editor()?.focused).toBe(true)
      const confirmedInstance = editor()
      view.mockInput.pressKey("s", { ctrl: true })
      await settle()
      expect(view.captureCharFrame()).toContain(`Post comment to ${parent === "pull" ? "PR " : ""}#${number}?`)
      expect(view.renderer.root.findDescendantById("issue-action-submit")).toBeUndefined()
      expect(editor()).toBe(confirmedInstance)
      expect(footer()).toBe("enter confirm · esc back")
      expect(calls).toHaveLength(0)
      const readyIssue = issue(), readyPull = pull()
      for (const unavailable of ["loading", "permission"] as const) {
        if (parent === "issue") setIssue({ ...readyIssue, resource: unavailable === "loading"
          ? { status: "loading", phase: "load", value: readyIssue.resource.value }
          : { status: "ready", value: { ...readyIssue.resource.value!, permissions: { ...readyIssue.resource.value!.permissions!, comment: false } } } })
        else setPull({ ...readyPull, resource: unavailable === "loading"
          ? { status: "loading", phase: "load", value: readyPull.resource.value }
          : { status: "ready", value: { ...readyPull.resource.value!, permissions: { ...readyPull.resource.value!.permissions, comment: false } } } })
        await settle()
        view.mockInput.pressEnter()
        await settle()
        expect(calls).toHaveLength(0)
        expect(view.renderer.root.findDescendantById("issue-action-confirm")).toBeDefined()
        await clickControl(view, "issue-action-confirm")
        await settle()
        expect(calls).toHaveLength(0)
        expect(view.renderer.root.findDescendantById("issue-action-confirm")).toBeDefined()
        setIssue(readyIssue); setPull(readyPull)
        await settle()
      }
      view.mockInput.pressEscape()
      await settle()
      expect(editor()).toBe(confirmedInstance)
      expect(editor()?.focused).toBe(true)
      view.mockInput.pressKey("s", { ctrl: true })
      await settle()
      await clickControl(view, "issue-action-confirm")
      await settle()
      expect(editor()).toBeUndefined()
      expect(calls).toEqual([{ number, parent: parent === "pull" ? "pull" : undefined, body: "Saved **draft** q?hc expanded" }])
      view.mockInput.pressKey("c")
      await clickControl(view, `${prefix}-resume`)
      await settle()
      expect(editor()).toBeUndefined()
      expect(calls).toHaveLength(1)
      pending.reject(new Error("Network unavailable"))
      await settle()
      expect(view.captureCharFrame()).toContain("Network")
      expect(view.captureCharFrame()).toContain("unavailable")
      pending = Promise.withResolvers<IssueActionResult>()
      await clickControl(view, `${prefix}-resume`)
      await settle()
      expect(editor()?.plainText).toBe("Saved **draft** q?hc expanded")
      view.mockInput.pressKey("s", { ctrl: true })
      await settle()
      await clickControl(view, "issue-action-confirm")
      await settle()
      expect(calls).toHaveLength(2)
      const posted: IssueComment = { ...comments[0]!, id: 9999, body: calls[1]!.body, createdAt: "2026-11-11T12:00:00Z" }
      pending.resolve({ comment: posted })
      await settle()
      expect(action().body).toBe("")
      expect(editor()).toBeUndefined()
      expect(view.renderer.root.findDescendantById(`${prefix}-resume`)).toBeUndefined()
      expect(view.captureCharFrame()).toContain("Comment posted")
      expect(view.captureCharFrame()).toContain("Saved draft q?hc expanded")
    } finally { view.renderer.destroy() }
  }, 15_000)
}

test("inline comments retain and confirm text without an injected action-state getter", async () => {
  const number = issueDetailFixture.number
  const pending = Promise.withResolvers<IssueActionResult>()
  const [allowed, setAllowed] = createSignal(true)
  let body = "", submissions = 0
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    initialNavigation={{ detail: { kind: "issue", number } }}
    issueDetail={{ number, resource: { status: "ready", value: { ...issueDetailFixture,
      permissions: { ...issueDetailFixture.permissions!, comment: allowed() } } },
      comments: { status: "ready", value: { items: [], page: 1, hasMore: false } }, references: { status: "ready", value: [] } }}
    onIssueDraftChange={(_number, draft) => { if (draft.body !== undefined) body = draft.body }}
    onSubmitIssueAction={async () => { submissions++; return pending.promise }} />, { width: 100, height: 30 })
  const settle = async () => { await view.flush(); await Bun.sleep(35); await view.flush() }
  try {
    await settle()
    view.mockInput.pressKey("c")
    await settle()
    await view.mockInput.typeText("Local draft")
    view.mockInput.pressKey("s", { ctrl: true })
    await settle()
    expect(body).toBe("Local draft")
    expect(submissions).toBe(0)
    await clickControl(view, "issue-action-confirm")
    await settle()
    expect(submissions).toBe(1)
    view.mockInput.pressKey("c")
    await clickControl(view, "issue-comment-resume")
    expect(view.renderer.root.findDescendantById("issue-comment-editor")).toBeUndefined()
    pending.resolve({ comment: { ...issueCommentsFixture[0]!, body } })
    await settle()
    expect(view.renderer.root.findDescendantById("issue-comment-resume")).toBeUndefined()
    expect(view.captureCharFrame()).toContain("Comment posted")
    view.mockInput.pressKey("c"); await settle()
    await view.mockInput.typeText("Read-only draft")
    setAllowed(false); await settle()
    expect((view.renderer.root.findDescendantById("issue-comment-editor") as TextareaRenderable).focused).toBe(true)
    await view.mockInput.typeText(" retained"); await settle()
    view.mockInput.pressKey("s", { ctrl: true }); await settle()
    expect(submissions).toBe(1)
    expect(view.renderer.root.findDescendantById("issue-action-confirm")).toBeUndefined()
    view.mockInput.pressEscape(); await settle()
    expect(view.renderer.root.findDescendantById("issue-detail-scroll")).toBeDefined()
    expect(view.renderer.root.findDescendantById("issue-comment-editor")).toBeUndefined()
    await clickControl(view, "issue-comment-resume"); await settle()
    expect((view.renderer.root.findDescendantById("issue-comment-editor") as TextareaRenderable).plainText).toBe("Read-only draft retained")
    setAllowed(true); await settle()
    expect(body).toBe("Read-only draft retained")
  } finally { view.renderer.destroy() }
})
