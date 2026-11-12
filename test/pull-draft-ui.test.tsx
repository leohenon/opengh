import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { IssueActionState } from "../src/repository-state"
import type { PullRequestDetail } from "../src/models"
import { defaultConfig } from "../src/config"
import { App } from "../src/ui/app"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { clickControl } from "./fixtures/mouse"

test("PR stage actions are permission gated, confirm, report progress and toggle merge eligibility", async () => {
  const summary = githubDataFixture.pulls.open.value!.items[0]!
  const [allowed, setAllowed] = createSignal(false)
  const [draft, setDraft] = createSignal(false)
  const [closed, setClosed] = createSignal(false)
  const [merged, setMerged] = createSignal(false)
  const [operation, setOperation] = createSignal<IssueActionState["operation"]>({ status: "idle" })
  const calls: boolean[] = []
  let finish!: () => void
  const pull = (): PullRequestDetail => ({ ...summary, state: closed() ? "closed" : "open", merged: merged(), draft: draft(),
    body: "PR body", url: `${githubDataFixture.repo.url}/pull/${summary.number}`, updatedAt: summary.createdAt,
    baseBranch: "main", headBranch: "feature", headSha: "a".repeat(40), additions: 1, deletions: 0, changedFiles: 1,
    commitCount: 1, commentCount: 0, labels: [], assignees: [], reviewers: [], mergeable: true,
    permissions: { comment: true, close: true, reopen: true, assignees: true, merge: true, markDraft: allowed(), markReady: allowed() },
    merge: { methods: ["squash"], queueRequired: false },
  })
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: true }}
    pullDetail={{ number: summary.number, resource: { status: "ready", value: pull() },
      comments: { status: "ready", value: { items: [], page: 1, hasMore: false } }, commits: { status: "ready", value: [] },
      references: { status: "ready", value: [] }, context: { status: "ready", value: { threads: [], warnings: [],
        readiness: { headSha: "a".repeat(40), isDraft: draft(), mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: null, checks: [], checksComplete: true },
      } } }}
    getIssueAction={() => ({ body: "comment draft", reason: "completed", operation: operation() })}
    onSubmitIssueAction={async () => ({})} onMergePull={async () => { throw new Error("Unexpected merge") }}
    onUpdatePullDraft={async (number, next) => {
      expect(number).toBe(summary.number); calls.push(next); setOperation({ status: "loading" })
      await new Promise<void>((resolve) => { finish = resolve })
      setDraft(next); setOperation({ status: "idle" })
      return pull()
    }} />, { width: 110, height: 34 })
  const settle = async () => { await Bun.sleep(35); await view.flush() }
  const menu = async () => { view.mockInput.pressKey("a"); await settle() }
  const close = async () => { view.mockInput.pressEscape(); await settle() }
  try {
    view.mockInput.pressKey("4"); view.mockInput.pressEnter(); await settle()
    await menu()
    expect(view.renderer.root.findDescendantById("issue-menu-draft")).toBeUndefined()
    await close()
    setAllowed(true)
    await menu(); await clickControl(view, "issue-menu-draft")
    expect(view.captureCharFrame()).toContain(`Mark PR #${summary.number} as draft?`)
    expect(calls).toEqual([])
    setAllowed(false); await settle()
    await clickControl(view, "pull-draft-confirm")
    expect(calls).toEqual([])
    setAllowed(true); await settle()
    await clickControl(view, "pull-draft-confirm")
    expect(view.renderer.root.findDescendantById("pull-draft-confirm")).toBeUndefined()
    await Bun.sleep(220); await view.flush()
    expect(view.captureCharFrame()).toMatch(/Marking PR as draft[. ]{3}/) // Animated dots replace the ellipsis.
    finish(); await settle()
    await menu()
    expect(view.renderer.root.findDescendantById("issue-menu-draft")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("issue-menu-merge")).toBeUndefined()
    await clickControl(view, "issue-menu-ready")
    expect(view.captureCharFrame()).not.toContain("code-owner reviews")
    expect(view.captureCharFrame()).not.toContain("trigger automation")
    await clickControl(view, "pull-draft-confirm")
    expect(calls).toEqual([true, false])
    finish(); await settle()
    await menu()
    expect(view.renderer.root.findDescendantById("issue-menu-merge")).toBeDefined()
    expect(view.renderer.root.findDescendantById("issue-menu-draft")).toBeDefined()
    await close()
    setClosed(true); await menu()
    expect(view.renderer.root.findDescendantById("issue-menu-draft")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("issue-menu-ready")).toBeUndefined()
    await close()
    setMerged(true); await menu()
    expect(view.renderer.root.findDescendantById("issue-menu-draft")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("issue-menu-ready")).toBeUndefined()
  } finally { view.renderer.destroy() }
})
