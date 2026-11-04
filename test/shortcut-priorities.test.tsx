import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, type ComponentProps } from "solid-js"
import { App } from "../src/ui/app"
import { Help } from "../src/ui/components/help"
import { fitStatusHints } from "../src/ui/components/status-bar"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { defaultConfig } from "../src/config"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

test("Help puts primary actions before secondary actions and omits redundant navigation keys", async () => {
  const [page, setPage] = createSignal<ComponentProps<typeof Help>["view"]>("commits")
  const view = await testRender(() => <KeybindingsProvider><Help view={page()} onClose={() => {}}
    hasDocumentTabs hasMoreFiles hasMoreComments hasReferences canComment hasIssueActions />
  </KeybindingsProvider>, { width: 100, height: 45 })
  const cases = [
    ["overview", "move / scroll"], ["commits", "open commit"], ["issues", "open issue"],
    ["pulls", "open pull request"], ["actions", "open workflow run"],
    ["commit", "back to commits"], ["issue", "back to issues"],
    ["pull", "back to pull requests"], ["run", "back to workflow runs"],
    ["diff", "close diff; return to origin"],
  ] as const
  try {
    for (const [target, primary] of cases) {
      setPage(target)
      await view.flush()
      const frame = view.captureCharFrame()
      const rows = frame.split("\n").filter(row => row.trim())
      expect(rows[1]).toContain(primary)
      expect(frame).not.toContain("1 / 2")
      expect(frame).not.toContain("PgUp")
      expect(frame).not.toContain("PgDn")
      if (target === "commits" || target === "pulls")
        expect(frame.indexOf(primary)).toBeLessThan(frame.indexOf("view diff"))
      expect(frame.indexOf("refresh / retry")).toBeLessThan(frame.indexOf("open " + (target === "overview" ? "repo on GitHub" : target === "diff" ? "diff on GitHub" : "on GitHub")))
    }
  } finally { view.renderer.destroy() }
})

test("narrow status bars retain primary and recovery actions in a stable order", async () => {
  expect(fitStatusHints("ctrl+shift+f12 excessively long hint · esc back · ? help", 18)).toBe("esc back · ? help")
  expect(fitStatusHints("enter open · ↑/↓ select · o GitHub", 23)).toBe("enter open · ↑/↓ select")
  const [data, setData] = createSignal(githubDataFixture)
  const view = await testRender(() => <App data={data()} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: true }} />, { width: 120, height: 30 })
  const footer = () => view.captureCharFrame().split("\n")[29]!.trim()
  try {
    for (const key of ["2", "3", "4", "5"]) {
      view.mockInput.pressKey(key)
      await view.flush()
      const wide = footer()
      expect(wide).toStartWith("enter open · ↑/↓ select")
      view.resize(32, 30)
      await view.flush()
      expect(footer()).toStartWith("enter open · ↑/↓ select")
      expect(Bun.stringWidth(footer())).toBeLessThanOrEqual(28)
      view.resize(120, 30)
      await view.flush()
      expect(footer()).toBe(wide)
    }
    view.mockInput.pressKey("2")
    setData(current => ({ ...current, commits: { status: "error", phase: "load", message: "Offline" } }))
    view.resize(32, 30)
    await view.flush()
    expect(footer()).toStartWith("r retry")
    expect(footer()).not.toContain("enter open")
    expect(footer()).not.toContain("D diff")
  } finally { view.renderer.destroy() }
})
