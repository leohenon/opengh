import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { PullCheck, PullContext } from "../src/models"
import { PullReadinessPanel } from "../src/ui/components/pull-context-panel"
import type { PullDetailState } from "../src/repository-state"
import { App } from "../src/ui/app"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { clickControl } from "./fixtures/mouse"

const checks: PullCheck[] = [
  { id: "pass-1", name: "Passing one", state: "success", url: "https://example.com/check/1" },
  { id: "pass-2", name: "Passing two", state: "success" },
  { id: "pass-3", name: "Passing three", state: "success" },
  { id: "pass-4", name: "Passing four", state: "success" },
  { id: "pass-5", name: "Passing five", state: "success" },
  { id: "skip", name: "Skipped required", state: "skipped", required: true },
  { id: "pending", name: "Pending build", state: "pending", required: true },
  { id: "fail", name: "Failed build", state: "failure", required: true },
]

function context(checks: PullCheck[], headSha = "head-a"): PullContext {
  return {
    threads: [],
    warnings: [],
    readiness: {
      headSha,
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviewDecision: null,
      checks,
      checksComplete: true,
    },
  }
}

test("readiness shows five sorted checks, preserves summaries and links, and discloses every check", async () => {
  const view = await testRender(() => <PullReadinessPanel context={context(checks)} interactive />, { width: 100, height: 30 })
  try {
    await view.flush()
    const compact = view.captureCharFrame()
    expect(compact).toContain("Merge blocked")
    expect(compact).toContain("1 failed · 1 pending · 1 skipped")
    expect(compact).toContain("▸ 3 more checks")
    expect(compact.indexOf("Failed build")).toBeLessThan(compact.indexOf("Pending build"))
    for (const check of [checks[7]!, checks[6]!, ...checks.slice(0, 3)]) expect(compact).toContain(check.name)
    for (const check of checks.slice(3, 6)) expect(compact).not.toContain(check.name)
    const row = compact.split("\n").findIndex((line) => line.includes("Passing one"))
    const column = compact.split("\n")[row]!.indexOf("Passing one")
    expect(view.renderer.getLinkAt(column, row)).toBe(checks[0]!.url!)

    await clickControl(view, "pull-checks-disclosure")
    const expanded = view.captureCharFrame()
    for (const check of checks) expect(expanded).toContain(check.name)
    expect(expanded).toContain("▾ Fewer checks")
    expect(expanded).toContain("Merge blocked")
    expect(expanded).toContain("1 failed · 1 pending · 1 skipped")

    view.mockInput.pressKey("C")
    await view.flush()
    expect(view.captureCharFrame()).toContain("▾ Fewer checks")
    expect(view.captureCharFrame()).toContain("Passing five")
    await clickControl(view, "pull-checks-disclosure")
    expect(view.captureCharFrame()).not.toContain("Passing five")
    expect(checks).toHaveLength(8)
    expect(checks[0]!.id).toBe("pass-1")
  } finally {
    view.renderer.destroy()
  }
})

test("check expansion resets on PR identity and either head change, not a same-head refresh", async () => {
  const [identity, setIdentity] = createSignal("https://github.com/owner/repo/pull/1")
  const [value, setValue] = createSignal(context(checks))
  const [head, setHead] = createSignal("head-a")
  const [interactive, setInteractive] = createSignal(true)
  const [collapsed, setCollapsed] = createSignal(false)
  const view = await testRender(
    () => (
      <PullReadinessPanel
        context={value()}
        identity={identity()}
        expectedHeadSha={head()}
        interactive={interactive()}
        collapsed={collapsed()}
      />
    ),
    { width: 100, height: 30 },
  )
  try {
    await view.flush()
    await clickControl(view, "pull-checks-disclosure")
    setValue(context([...checks]))
    await view.flush()
    expect(view.captureCharFrame()).toContain("▾ Fewer checks")
    for (const change of [
      () => setIdentity("https://github.com/owner/repo/pull/2"),
      () => setHead("head-b"),
      () => setValue(context(checks, "head-b")),
    ]) {
      change()
      await view.flush()
      expect(view.captureCharFrame()).toContain("▸ 3 more checks")
      await clickControl(view, "pull-checks-disclosure")
      expect(view.captureCharFrame()).toContain("▾ Fewer checks")
    }
    await clickControl(view, "pull-checks-disclosure")
    setInteractive(false)
    view.mockInput.pressKey("C")
    await view.flush()
    await clickControl(view, "pull-checks-disclosure")
    expect(view.captureCharFrame()).toContain("▸ 3 more checks")
    setInteractive(true)
    setCollapsed(true)
    await view.flush()
    expect(view.renderer.root.findDescendantById("pull-checks-disclosure")).toBeUndefined()
    view.mockInput.pressKey("C")
    setCollapsed(false)
    await view.flush()
    expect(view.captureCharFrame()).toContain("▸ 3 more checks")
  } finally {
    view.renderer.destroy()
  }
})

test("required blockers stay visible ahead of optional failures and cancellations", async () => {
  const optional: PullCheck[] = Array.from({ length: 12 }, (_, index) => ({
    id: `optional-${index}`,
    name: `Optional check ${index}`,
    state: index < 6 ? "cancelled" : "failure",
    required: false,
  }))
  const required: PullCheck[] = [
    { id: "required-cancelled", name: "Required cancelled", state: "cancelled", required: true },
    { id: "required-unknown", name: "Required unknown", state: "unknown", required: true },
    { id: "required-pending", name: "Required pending", state: "pending", required: true },
    { id: "required-failed", name: "Required failed", state: "failure", required: true },
  ]
  const view = await testRender(() => <PullReadinessPanel context={context([...optional, ...required])} interactive />, {
    width: 100,
    height: 30,
  })
  try {
    await view.flush()
    const frame = view.captureCharFrame()
    for (const check of required) expect(frame).toContain(check.name)
    expect(frame.indexOf("Required failed")).toBeLessThan(frame.indexOf("Required pending"))
    expect(frame.indexOf("Required pending")).toBeLessThan(frame.indexOf("Required cancelled"))
    expect(frame.indexOf("Required cancelled")).toBeLessThan(frame.indexOf("Required unknown"))
    expect(frame.indexOf("Required unknown")).toBeLessThan(frame.indexOf("Optional check 6"))
    expect(frame).not.toContain("Optional check 0")
    expect(frame).toContain("▸ 11 more checks")
    await clickControl(view, "pull-checks-disclosure")
    for (const check of optional) expect(view.captureCharFrame()).toContain(check.name)
  } finally {
    view.renderer.destroy()
  }
})

test("read-only PR actions toggle checks in sync with mouse disclosure and reset on head changes", async () => {
  const summary = githubDataFixture.pulls.open.value!.items[0]!
  const [detail, setDetail] = createSignal<PullDetailState>({
    number: summary.number,
    resource: {
      status: "ready",
      value: {
        ...summary,
        url: `https://github.com/anomalyco/opentui/pull/${summary.number}`,
        body: "",
        updatedAt: summary.createdAt,
        baseBranch: "main",
        headBranch: "checks",
        headSha: "head-a",
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        commitCount: 0,
        commentCount: 0,
        labels: [],
        assignees: [],
        reviewers: [],
        mergeable: true,
        permissions: { comment: false, close: false, reopen: false, assignees: false, merge: false, markDraft: false, markReady: false },
      },
    },
    context: { status: "ready", value: context(checks) },
    comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
    references: { status: "ready", value: [] },
    commits: { status: "ready", value: [] },
  })
  const view = await testRender(
    () => (
      <App
        data={githubDataFixture}
        operations={repositoryOperationsFixture}
        initialNavigation={{ detail: { kind: "pull", number: summary.number } }}
        pullDetail={detail()}
      />
    ),
    { width: 120, height: 60 },
  )
  const openMenu = async (label: string) => {
    view.mockInput.pressKey("a")
    await view.flush()
    expect(view.captureCharFrame()).toContain(`PR #${summary.number} · Actions`)
    expect(view.captureCharFrame()).toContain(`› ${label}`)
    expect(view.renderer.root.findDescendantById("issue-menu-close")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("issue-menu-merge")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("issue-menu-assignees")).toBeUndefined()
  }
  const selectChecks = async () => {
    view.mockInput.pressEnter()
    await view.flush()
    expect(view.renderer.root.findDescendantById("issue-actions-scroll")).toBeUndefined()
  }
  try {
    await view.flush()
    expect(view.captureCharFrame()).toContain("▸ 3 more checks")
    view.mockInput.pressKey("C")
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Passing five")
    await openMenu("Show all checks")
    await selectChecks()
    expect(view.captureCharFrame()).toContain("▾ Fewer checks")
    expect(view.captureCharFrame()).toContain("Passing five")
    view.mockInput.pressKey("C")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Passing five")
    await openMenu("Show fewer checks")
    await selectChecks()
    expect(view.captureCharFrame()).toContain("▸ 3 more checks")
    expect(view.captureCharFrame()).not.toContain("Passing five")

    await clickControl(view, "pull-checks-disclosure")
    await openMenu("Show fewer checks")
    await selectChecks()
    expect(view.captureCharFrame()).toContain("▸ 3 more checks")
    await clickControl(view, "pull-checks-disclosure")
    setDetail((current) => ({ ...current, context: { status: "ready", value: context([...checks]) } }))
    await view.flush()
    expect(view.captureCharFrame()).toContain("▾ Fewer checks")

    for (const change of [
      () =>
        setDetail((current) => ({ ...current, resource: { status: "ready", value: { ...current.resource.value!, headSha: "head-b" } } })),
      () => setDetail((current) => ({ ...current, context: { status: "ready", value: context(checks, "head-b") } })),
    ]) {
      change()
      await view.flush()
      expect(view.captureCharFrame()).toContain("▸ 3 more checks")
      expect(view.captureCharFrame()).not.toContain("Passing five")
      await openMenu("Show all checks")
      await selectChecks()
      expect(view.captureCharFrame()).toContain("▾ Fewer checks")
    }
  } finally {
    view.renderer.destroy()
  }
})

test("five or fewer checks need no disclosure and empty checks retain their fallback", async () => {
  const [value, setValue] = createSignal(context(checks.slice(0, 5)))
  const view = await testRender(() => <PullReadinessPanel context={value()} interactive />, { width: 100, height: 30 })
  try {
    await view.flush()
    expect(view.renderer.root.findDescendantById("pull-checks-disclosure")).toBeUndefined()
    expect(view.captureCharFrame()).toContain("Passing five")
    view.mockInput.pressKey("C")
    setValue(context([]))
    await view.flush()
    expect(view.captureCharFrame()).toContain("No checks reported.")
    setValue({ ...context([]), readiness: { ...context([]).readiness, checksComplete: false } })
    await view.flush()
    expect(view.captureCharFrame()).toContain("Check details unavailable.")
    expect(view.renderer.root.findDescendantById("pull-checks-disclosure")).toBeUndefined()
  } finally {
    view.renderer.destroy()
  }
})
