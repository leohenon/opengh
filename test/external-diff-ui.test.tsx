import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { initializeHunk } from "../src/ui/hunk-host"
import { DiffScreen } from "../src/ui/pages/diff"
import { parseDiff } from "../src/ui/diff-model"
import { reviewRows, reviewSplitBoundary } from "../src/ui/review-lines"
import type { ContextMenuItem } from "../src/ui/components/context-menu"
import { App } from "../src/ui/app"
import { defaultConfig } from "../src/config"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const patch = `diff --git a/first.txt b/first.txt
--- a/first.txt
+++ b/first.txt
@@ -10 +20 @@
-old
+new
diff --git a/second.txt b/second.txt
--- a/second.txt
+++ b/second.txt
@@ -1 +1 @@
-before
+after
`

test("diff viewer and GitHub keys work in both context menus without review; e is unclaimed and typing owns e/v/o", async () => {
  const setup = await createTestRenderer({ width: 110, height: 20 })
  initializeHunk(setup.renderer)
  const calls: unknown[][] = []
  let github = 0
  let menu: ContextMenuItem[] = []
  await render(() => <DiffScreen target={{ kind: "commit", sha: "abc" }}
    resource={{ status: "ready", value: { kind: "patch", patch } }} interactive showScrollbar={false} onLoadFiles={() => {}}
    onOpenGitHub={() => { github++ }} onOpenExternal={(...args) => { calls.push(args) }}
    onContextMenu={(_, items) => { menu = items }} />, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  try {
    await settle()
    const unclaimed: boolean[] = []
    setup.renderer.keyInput.on("keypress", event => {
      if (event.name === "e") unclaimed.push(!event.defaultPrevented && !event.propagationStopped)
    })
    setup.mockInput.pressKey("v"); setup.mockInput.pressKey("e"); setup.mockInput.pressKey("o")
    await settle()
    expect(calls).toEqual([[]])
    expect(unclaimed).toEqual([true])
    expect(github).toBe(1)
    const body = parseDiff({ kind: "patch", patch }).files[0]!.body!
    const row = setup.renderer.root.findDescendantById(reviewRows(body, "split")[0]!.id)!
    await setup.mockMouse.click(row.x + reviewSplitBoundary(row.width) + 5, row.y, 2)
    await settle()
    expect(menu.some(item => item.label.includes("review comment"))).toBe(false)
    expect(menu.some(item => item.label.includes("editor"))).toBe(false)
    menu.find(item => item.label === "Open diff in external viewer")!.run()
    expect(calls).toEqual([[], []])
    menu.find(item => item.label === "Open diff on GitHub")!.run()
    expect(github).toBe(2)
    const sidebar = setup.renderer.root.findDescendantById("diff-files-pane")!
    await setup.mockMouse.click(sidebar.x + 5, sidebar.y + 2, 2)
    await settle()
    menu.find(item => item.label === "Open diff in external viewer")!.run()
    expect(calls).toEqual([[], [], []])
    const before = calls.length
    setup.mockInput.pressKey("f")
    await settle()
    setup.mockInput.pressKey("e"); setup.mockInput.pressKey("v"); setup.mockInput.pressKey("o")
    await settle()
    expect(calls).toHaveLength(before)
    expect(github).toBe(2)
    expect(setup.captureCharFrame()).toContain("evo")
    setup.mockInput.pressEscape()
    await Bun.sleep(30); await settle()
    setup.mockInput.pressEscape()
    await Bun.sleep(30); await settle()
    setup.mockInput.pressKey("e")
    await settle()
    expect(calls).toHaveLength(before)
    expect(unclaimed.at(-1)).toBe(true)
    setup.mockInput.pressKey("v")
    await settle()
    expect(calls).toHaveLength(before + 1)
  } finally { setup.renderer.destroy() }
})

test("hiding the file sidebar from its menu releases filter keyboard ownership", async () => {
  const setup = await createTestRenderer({ width: 110, height: 20 })
  initializeHunk(setup.renderer)
  const calls: unknown[][] = []
  let menu: ContextMenuItem[] = []
  await render(() => <DiffScreen target={{ kind: "commit", sha: "abc" }}
    resource={{ status: "ready", value: { kind: "patch", patch } }} interactive showScrollbar={false} onLoadFiles={() => {}}
    onOpenExternal={(...args) => { calls.push(args) }}
    onContextMenu={(_, items) => { menu = items }} />, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  try {
    await settle()
    setup.mockInput.pressKey("f")
    await settle()
    const body = setup.renderer.root.findDescendantById("diff-content-pane")!
    await setup.mockMouse.click(body.x + 5, body.y + 1, 2)
    await settle()
    menu.find(item => item.label === "Toggle files")!.run()
    await settle()
    expect(setup.renderer.root.findDescendantById("diff-files-pane")!.visible).toBe(false)
    expect(!!setup.renderer.root.findDescendantById("diff-file-filter")).toBe(false)
    setup.mockInput.pressKey("e"); setup.mockInput.pressKey("v")
    await settle()
    expect(calls).toEqual([[]])
  } finally { setup.renderer.destroy() }
})

test("App reports unavailable patches regardless of local checkout, without launching tools", async () => {
  for (const localRepository of [undefined, { directory: "/not-used", repository: "owner/repo" }]) {
    const setup = await createTestRenderer({ width: 110, height: 20 })
    const data = structuredClone(githubDataFixture)
    data.repo.nameWithOwner = "owner/repo"
    const target = { kind: "commit" as const, sha: "abc" }
    await render(() => <App data={data} operations={repositoryOperationsFixture}
      initialNavigation={{ diff: target, page: "commits" }} localRepository={localRepository}
      config={{ ...defaultConfig, diffViewerCommand: ["viewer", "{patch}"] }}
      diffs={{ commit: { target, resource: { status: "ready", value: { kind: "files", files: [], truncated: false } } } }} />, setup.renderer)
    try {
      await setup.flush()
      setup.mockInput.pressKey("v")
      await setup.flush(); await setup.renderer.idle(); await setup.flush()
      expect(setup.captureCharFrame()).toContain("Reload the full diff")
    } finally { setup.renderer.destroy() }
  }
})
