import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { defaultConfig } from "../src/config"
import type { PullMergeMessage, PullMergeMethod, PullRequestDetail } from "../src/models"
import type { IssueActionState } from "../src/repository-state"
import { App } from "../src/ui/app"
import { clickControl } from "./fixtures/mouse"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

test("merge UI hides unauthorized actions, explains blockers, confirms methods and rejects changed heads", async () => {
  const summary = githubDataFixture.pulls.open.value!.items[0]!
  const [allowed, setAllowed] = createSignal<boolean | undefined>(false)
  const [queue, setQueue] = createSignal(true)
  const [head, setHead] = createSignal("a".repeat(40))
  const [merged, setMerged] = createSignal(false)
  const [action, setAction] = createSignal<IssueActionState>({ body: "", reason: "completed", operation: { status: "idle" } })
  const calls: Array<[number, PullMergeMethod, string, PullMergeMessage | undefined]> = []
  let defaultLoads = 0
  const pending = Promise.withResolvers<PullRequestDetail>()
  const pull = (): PullRequestDetail => ({ ...summary, state: merged() ? "closed" : "open", merged: merged(), draft: false,
    body: "PR body", url: `${githubDataFixture.repo.url}/pull/${summary.number}`, updatedAt: summary.createdAt,
    baseBranch: "main", headBranch: "feature", headSha: head(), additions: 1, deletions: 0, changedFiles: 1,
    commitCount: 1, commentCount: 0, labels: [], assignees: [], reviewers: [], mergeable: true,
    permissions: { comment: false, close: !merged(), merge: allowed() }, merge: { methods: ["squash"], queueRequired: queue() },
  })
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: true }}
    pullDetail={{ number: summary.number, resource: { status: "ready", value: pull() },
      comments: { status: "ready", value: { items: [], page: 1, hasMore: false } }, commits: { status: "ready", value: [] },
      references: { status: "ready", value: [] }, context: { status: "ready", value: {
        threads: [], warnings: [], readiness: { headSha: head(), isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
          reviewDecision: null, checks: [], checksComplete: true },
      } } }}
    getIssueAction={() => action()} onSubmitIssueAction={async () => ({})}
    onOpenInBrowser={async () => {}}
    onLoadPullMergeMessage={async (_number, sha) => {
      defaultLoads++
      return { headSha: sha, headline: "GitHub default title", body: "GitHub default description" }
    }}
    onMergePull={async (number, method, sha, message) => {
      calls.push([number, method, sha, message]); setAction((current) => ({ ...current, operation: { status: "loading" } }))
      const result = await pending.promise
      setMerged(true); setAction((current) => ({ ...current, operation: { status: "idle" } }))
      return result
    }} />, { width: 110, height: 34 })
  const settle = async () => { await Bun.sleep(35); await view.flush() }
  try {
    view.mockInput.pressKey("4"); view.mockInput.pressEnter(); await settle()
    for (const permission of [false, undefined]) {
      setAllowed(permission)
      view.mockInput.pressKey("a"); await settle()
      expect(view.renderer.root.findDescendantById("issue-menu-merge")).toBeUndefined()
      view.mockInput.pressEscape(); await settle()
    }
    setAllowed(true)
    view.mockInput.pressKey("a"); await settle()
    expect(view.captureCharFrame()).not.toContain("merge queue") // Blocked actions stay disabled without inline explanations.
    expect(view.captureCharFrame()).toContain("Open on GitHub")
    await clickControl(view, "issue-menu-merge")
    expect(view.renderer.root.findDescendantById("merge-method-squash")).toBeUndefined()
    setQueue(false); await settle()
    await clickControl(view, "issue-menu-merge")
    expect(view.renderer.root.findDescendantById("merge-method-squash")).toBeDefined()
    expect(view.renderer.root.findDescendantById("merge-method-rebase")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("merge-method-merge")).toBeUndefined()
    await clickControl(view, "merge-method-squash"); await settle()
    expect(view.captureCharFrame()).toContain("GitHub default title")
    expect(view.captureCharFrame()).toContain("GitHub default description")
    view.mockInput.pressKey("a", { ctrl: true }); view.mockInput.pressKey("k", { ctrl: true }); await settle()
    await clickControl(view, "merge-message-continue")
    expect(view.renderer.root.findDescendantById("merge-confirm")).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("single-line title is required")
    await view.mockInput.typeText("Custom squash title")
    view.mockInput.pressTab(); await settle()
    view.mockInput.pressKey("a", { ctrl: true }); view.mockInput.pressKey("k", { ctrl: true })
    await view.mockInput.typeText("Custom description")
    view.mockInput.pressEnter()
    await view.mockInput.typeText("Second line")
    const bodyEditor = view.renderer.root.findDescendantById("merge-message-body") as TextareaRenderable
    const headlineEditor = view.renderer.root.findDescendantById("merge-message-headline") as TextareaRenderable
    await clickControl(view, "merge-message-continue")
    expect(view.captureCharFrame()).toContain("Custom squash title")
    expect(view.captureCharFrame()).toContain("Second line")
    expect(view.captureCharFrame()).toContain(`Squash and merge PR #${summary.number}?`)
    expect(calls).toEqual([])
    setHead("b".repeat(40)); await settle()
    expect(view.captureCharFrame()).toContain("New commits detected")
    await clickControl(view, "merge-confirm")
    expect(calls).toEqual([])
    view.mockInput.pressEscape(); await settle()
    expect(view.captureCharFrame()).toContain("Custom squash title")
    expect(view.renderer.root.findDescendantById("merge-message-body")).toBe(bodyEditor)
    expect(view.renderer.root.findDescendantById("merge-message-headline")).toBe(headlineEditor)
    view.mockInput.pressKey("z", { ctrl: true }); await settle()
    expect(bodyEditor.plainText).toBe("Custom description\n")
    view.mockInput.pressKey(".", { ctrl: true }); await settle()
    expect(bodyEditor.plainText).toBe("Custom description\nSecond line")
    view.mockInput.pressTab(); await settle()
    view.mockInput.pressKey("z", { ctrl: true }); await settle()
    expect(headlineEditor.plainText).toBe("")
    view.mockInput.pressKey(".", { ctrl: true }); await settle()
    expect(headlineEditor.plainText).toBe("Custom squash title")
    view.mockInput.pressEscape(); await settle()
    view.mockInput.pressEscape(); await settle()
    view.mockInput.pressKey("a"); await settle()
    await clickControl(view, "issue-menu-merge")
    await clickControl(view, "merge-method-squash"); await settle()
    expect(view.captureCharFrame()).toContain("GitHub default title")
    expect(view.captureCharFrame()).toContain("GitHub default description")
    expect(view.captureCharFrame()).not.toContain("Custom squash title")
    expect(view.captureCharFrame()).not.toContain("Custom description")
    expect(defaultLoads).toBe(2)
    view.mockInput.pressKey("z", { ctrl: true }); await settle()
    expect(view.captureCharFrame()).toContain("GitHub default title")
    await clickControl(view, "merge-message-continue")
    await clickControl(view, "merge-confirm")
    expect(calls).toEqual([[summary.number, "squash", "b".repeat(40), { headline: "GitHub default title", body: "GitHub default description" }]])
    expect(view.renderer.root.findDescendantById("merge-confirm")).toBeUndefined()
    await Bun.sleep(220); await view.flush()
    expect(view.captureCharFrame()).toMatch(/Merging PR[. ]{3}/) // Animated dots replace the ellipsis.
    pending.resolve({ ...pull(), merged: true, state: "closed" }); await settle()
    expect(view.captureCharFrame()).toContain("PR merged")
    expect(view.captureCharFrame()).not.toContain("Merging PR")
  } finally { view.renderer.destroy() }
})
