import { expect, test } from "bun:test"
import { render, testRender } from "@opentui/solid"
import { createTestRenderer } from "@opentui/core/testing"
import type { TextRenderable } from "@opentui/core"
import type { DiffState } from "../src/repository-state"
import { initializeHunk } from "../src/ui/hunk-host"
import { patchFixture } from "./fixtures/diff"
import { createSignal } from "solid-js"
import { defaultConfig } from "../src/config"
import { App } from "../src/ui/app"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { clickControl } from "./fixtures/mouse"

async function clickTab(view: Awaited<ReturnType<typeof testRender>>, label: string, underline = false) {
  await view.flush()
  const rows = view.captureCharFrame().split("\n")
  const y = rows.findIndex((row) => row.includes(label))
  expect(y).toBeGreaterThanOrEqual(0)
  const x = Bun.stringWidth(rows[y]!.slice(0, rows[y]!.indexOf(label)))
  await view.mockMouse.click(x, y + (underline ? 1 : 0))
  await view.flush()
}

test("clicking the current tab backs out of each detail while other tabs and keyboard shortcuts retain it", async () => {
  const [compact, setCompact] = createSignal(false)
  const closed = { commit: 0, issue: 0, pull: 0, run: 0 }
  const loaded = { commit: 0, issue: 0, pull: 0, run: 0 }
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, compactHeader: compact() }}
    onLoadCommit={async () => { loaded.commit++ }} onCloseCommit={() => { closed.commit++ }}
    onLoadIssue={async () => { loaded.issue++ }} onCloseIssue={() => { closed.issue++ }}
    onLoadPull={async () => { loaded.pull++ }} onClosePull={() => { closed.pull++ }}
    onLoadRun={async () => { loaded.run++ }} onCloseRun={() => { closed.run++ }}
  />, { width: 140, height: 28 })
  const cases = [
    { key: "2", label: "2 Commits", kind: "commit", scroll: "commit-detail-scroll", compact: false },
    { key: "3", label: "3 Issues", kind: "issue", scroll: "issue-detail-scroll", compact: true },
    { key: "4", label: "4 Pull requests", kind: "pull", scroll: "pull-detail-scroll", compact: false },
    { key: "5", label: "5 Actions", kind: "run", scroll: "run-detail-scroll", compact: true },
  ] as const
  try {
    await view.flush()
    for (const item of cases) {
      setCompact(item.compact)
      view.mockInput.pressKey(item.key)
      view.mockInput.pressKey("j")
      await view.flush()
      const selection = view.captureCharFrame().split("\n").find((row) => row.includes("▌"))
      view.mockInput.pressEnter()
      await view.flush()
      const detail = view.renderer.root.findDescendantById(item.scroll)
      expect(detail).toBeDefined()
      expect(loaded[item.kind]).toBe(1)
      view.mockInput.pressKey(item.key) // Numbered shortcuts keep their existing retained-detail behavior.
      await view.flush()
      expect(view.renderer.root.findDescendantById(item.scroll)).toBe(detail)
      await clickTab(view, "1 Overview")
      await clickTab(view, item.label) // Returning from another page must not discard its retained detail.
      expect(view.renderer.root.findDescendantById(item.scroll)).toBe(detail)
      expect(closed[item.kind]).toBe(0)
      view.mockInput.pressKey("?")
      await view.flush()
      await clickTab(view, item.label) // This click only dismisses Help's backdrop.
      expect(closed[item.kind]).toBe(0)
      expect(view.renderer.root.findDescendantById(item.scroll)).toBe(detail)
      await clickTab(view, item.label, !item.compact)
      expect(closed[item.kind]).toBe(1)
      expect(view.renderer.root.findDescendantById(item.scroll)).toBeUndefined()
      expect(view.captureCharFrame().split("\n").find((row) => row.includes("▌"))).toBe(selection)
      expect(loaded[item.kind]).toBe(1)
    }
  } finally { view.renderer.destroy() }
})

test("clicking the current tab unwinds a diff one level, then its detail, using the existing cleanup callbacks", async () => {
  let closedCommit = 0
  let closedDiff = 0
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    onLoadCommit={async () => {}} onCloseCommit={() => { closedCommit++ }}
    onLoadDiff={async () => {}} onCloseDiff={() => { closedDiff++ }}
  />, { width: 120, height: 28 })
  try {
    await view.flush()
    view.mockInput.pressKey("2")
    view.mockInput.pressEnter()
    view.mockInput.pressKey("D")
    await view.flush()
    expect(view.renderer.root.findDescendantById("diff-view-commits")).toBeDefined()
    await clickTab(view, "2 Commits")
    expect(closedDiff).toBe(1)
    expect(closedCommit).toBe(0)
    expect(view.renderer.root.findDescendantById("diff-view-commits")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("commit-detail-scroll")).toBeDefined()
    await clickTab(view, "2 Commits")
    expect(closedCommit).toBe(1)
    expect(view.renderer.root.findDescendantById("commit-detail-scroll")).toBeUndefined()
    view.mockInput.pressKey("D") // A diff opened directly from the list returns directly to that list.
    await view.flush()
    await clickTab(view, "2 Commits")
    expect(closedDiff).toBe(2)
    expect(closedCommit).toBe(1)
    expect(view.renderer.root.findDescendantById("diff-view-commits")).toBeUndefined()
  } finally { view.renderer.destroy(); await view.renderer.closed }
})


test("detail and diff menus retain their actions with Back at the bottom", async () => {
  const closed = { commit: 0, issue: 0, pull: 0, run: 0, diff: 0 }
  const [diffs, setDiffs] = createSignal<Partial<Record<"commit" | "pull", DiffState>>>({})
  const view = await createTestRenderer({ width: 120, height: 28 })
  initializeHunk(view.renderer)
  await render(() => <App data={githubDataFixture} operations={repositoryOperationsFixture} diffs={diffs()}
    onLoadCommit={async () => {}} onCloseCommit={() => { closed.commit++ }}
    onLoadIssue={async () => {}} onCloseIssue={() => { closed.issue++ }}
    onLoadPull={async () => {}} onClosePull={() => { closed.pull++ }}
    onLoadRun={async () => {}} onCloseRun={() => { closed.run++ }}
    onLoadDiff={async (target) => { setDiffs((current) => ({ ...current, [target.kind]: { target, resource: { status: "ready", value: { kind: "patch", patch: patchFixture } } } })) }}
    onCloseDiff={(target) => {
      closed.diff++
      setDiffs((current) => { const next = { ...current }; if (target) delete next[target.kind]; return target ? next : {} })
    }}
  />, view.renderer)
  const backMenu = async (id: string, diff = false) => {
    await view.flush()
    const target = view.renderer.root.findDescendantById(id)!
    await view.mockMouse.click(target.x + 3, target.y + 2, 2)
    await view.flush()
    expect(view.renderer.root.findDescendantById("context-menu")).toBeDefined()
    expect(view.captureCharFrame()).toContain("Back")
    const actions = diff ? ["Change layout", "Toggle files", "Back"]
      : id === "commit-detail-scroll" ? ["View diff", "Open on GitHub", "Copy SHA", "Back"]
      : id === "pull-detail-scroll" ? ["View diff", "Open on GitHub", "Copy URL", "Collapse", "Back"]
      : id === "issue-detail-scroll" ? ["Open on GitHub", "Copy URL", "Collapse", "Back"]
      : ["Open on GitHub", "Copy URL", "Back"]
    for (const [index, label] of actions.entries()) {
      const row = view.renderer.root.findDescendantById(`context-menu-row-${index}`)!
      expect((row.getChildren()[0] as TextRenderable).plainText).toBe(label)
    }
    expect(view.renderer.root.findDescendantById(`context-menu-row-${actions.length}`)).toBeUndefined()
    await clickControl(view, `context-menu-row-${actions.length - 1}`)
    expect(view.renderer.root.findDescendantById("context-menu")).toBeUndefined()
  }
  const cases = [
    { key: "2", kind: "commit", scroll: "commit-detail-scroll" },
    { key: "3", kind: "issue", scroll: "issue-detail-scroll" },
    { key: "4", kind: "pull", scroll: "pull-detail-scroll" },
    { key: "5", kind: "run", scroll: "run-detail-scroll" },
  ] as const
  try {
    await view.flush()
    for (const item of cases) {
      view.mockInput.pressKey(item.key)
      view.mockInput.pressEnter()
      await view.flush()
      if (item.kind === "commit") {
        view.mockInput.pressKey("D")
        await view.flush()
        await view.renderer.idle()
        await view.flush()
        expect(view.captureCharFrame()).toContain("newValue")
        await backMenu("diff-body-scroll", true)
        expect(closed.diff).toBe(1)
        expect(closed.commit).toBe(0)
        expect(view.renderer.root.findDescendantById("commit-detail-scroll")).toBeDefined()
      }
      await backMenu(item.scroll)
      expect(closed[item.kind]).toBe(1)
      expect(view.renderer.root.findDescendantById(item.scroll)).toBeUndefined()
    }
    view.mockInput.pressKey("2")
    view.mockInput.pressKey("D")
    await view.flush()
    await view.renderer.idle()
    await view.flush()
    expect(view.captureCharFrame()).toContain("newValue")
    await backMenu("diff-body-scroll", true)
    expect(closed.diff).toBe(2)
    expect(closed.commit).toBe(1)
    expect(view.renderer.root.findDescendantById("diff-view-commits")).toBeUndefined()
  } finally { view.renderer.destroy(); await view.renderer.closed }
})
