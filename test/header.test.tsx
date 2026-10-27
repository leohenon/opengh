import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { Page } from "../src/navigation"
import { Header } from "../src/ui/components/header"
import { githubDataFixture } from "./fixtures/github-data"
import { clickControl } from "./fixtures/mouse"

const tabs: ReadonlyArray<{ page: Page; label: string }> = [
  { page: "overview", label: "Overview" },
  { page: "commits", label: "Commits" },
  { page: "issues", label: "Issues" },
  { page: "pulls", label: "Pull requests" },
  { page: "actions", label: "Actions" },
]

test("mouse tabs include their underline, respect disabled/drag guards, and reveal hidden tabs", async () => {
  const [page, setPage] = createSignal<Page>("overview")
  const [compact, setCompact] = createSignal(false)
  const [interactive, setInteractive] = createSignal(true)
  let repositories = 0
  const [repo, setRepo] = createSignal(githubDataFixture.repo)
  const view = await testRender(() => <Header repo={repo()} page={page()} tabs={tabs}
    compact={compact()} interactive={interactive()} onSelect={setPage} onOpenRepository={() => { repositories++ }} />, { width: 140, height: 8 })
  const click = async (label: string, offset = 0, button: 0 | 1 | 2 = 0) => {
    const lines = view.captureCharFrame().split("\n")
    const row = lines.findIndex((line) => line.includes(label))
    expect(row).toBeGreaterThan(-1)
    await view.mockMouse.click(lines[row]!.indexOf(label), row + offset, button)
    await view.flush()
  }
  try {
    await view.flush()
    await click("2 Commits", 1)
    expect(page()).toBe("commits")
    for (const button of [1, 2] as const) await click("1 Overview", 0, button)
    const row = view.captureCharFrame().split("\n")[3]!
    await view.mockMouse.drag(row.indexOf("1 Overview"), 3, row.indexOf("1 Overview") + 2, 3)
    expect(page()).toBe("commits")
    setInteractive(false)
    await clickControl(view, "repository-dropdown")
    expect(repositories).toBe(0)
    await click("3 Issues")
    expect(page()).toBe("commits")
    setInteractive(true)
    await click("3 Issues")
    expect(page()).toBe("issues")
    expect(view.renderer.currentFocusedRenderable).toBeNull()
    await clickControl(view, "repository-dropdown")
    expect(repositories).toBe(1)
    setCompact(true)
    view.resize(24, 8)
    await view.flush()
    await click("›")
    expect(page()).toBe("pulls")
    await click("‹")
    expect(page()).toBe("issues")
    expect(view.captureCharFrame()).not.toContain("anomalyco/opentui")
    expect(view.captureCharFrame()).not.toContain("Repo ▾")
    expect(view.captureCharFrame().split("\n")[0]!.trimEnd().endsWith("▾")).toBe(true)
    await clickControl(view, "repository-dropdown")
    expect(repositories).toBe(2)
    view.resize(160, 8)
    await view.flush()
    expect(view.captureCharFrame()).toContain("opentui ▾")
    expect(view.captureCharFrame()).not.toContain("anomalyco/")
    await clickControl(view, "repository-dropdown")
    expect(repositories).toBe(3)
    setCompact(false)
    setRepo({ ...githubDataFixture.repo, nameWithOwner: "a-very-long-owner/a-very-long-repository-name" })
    view.resize(30, 8)
    await view.flush()
    expect(view.captureCharFrame().split("\n")[1]!.trimEnd().endsWith("▾")).toBe(true)
    await clickControl(view, "repository-dropdown")
    expect(repositories).toBe(4)
  } finally { view.renderer.destroy() }
})

test("header prioritizes tabs over repository identity and counts, then reveals whole tabs on navigation", async () => {
  const repo = { ...githubDataFixture.repo, nameWithOwner: "a-very-long-owner/pi-anthropic-oauth" }
  const [page, setPage] = createSignal<Page>("overview")
  const [compact, setCompact] = createSignal(true)
  const [issues, setIssues] = createSignal(61)
  const [showTabCounts, setShowTabCounts] = createSignal(true)
  const view = await testRender(() => <Header repo={repo} page={page()} tabs={tabs} compact={compact()}
    showTabCounts={showTabCounts()} workCounts={{ status: "ready", value: { issues: issues(), pulls: 24 } }}
  />, { width: 160, height: 8 })
  const row = () => view.captureCharFrame().split("\n")[compact() ? 0 : 3]!
  const bare = tabs.map((tab, index) => `${index + 1} ${tab.label}`)
  const counted = bare.map((label, index) => index === 2 ? `${label} (61)` : index === 3 ? `${label} (24)` : label)
  const width = (labels: string[]) => Bun.stringWidth(labels.join("   "))
  try {
    await view.flush()
    expect(row()).toContain("pi-anthropic-oauth")
    expect(row()).not.toContain("a-very-long-owner")
    for (const label of counted) expect(row()).toContain(label)

    view.resize(width(counted) + Bun.stringWidth("pi-anthropic-oauth") + 6, 8)
    await view.flush()
    expect(row()).toContain("pi-anthropic-oauth")
    expect(row()).not.toContain("a-very-long-owner")
    for (const label of counted) expect(row()).toContain(label)

    view.resize(width(counted) + 4, 8)
    await view.flush()
    expect(row()).not.toContain("pi-anthropic-oauth")
    for (const label of counted) expect(row()).toContain(label)

    view.resize(width(bare) + 4, 8)
    await view.flush()
    for (const label of bare) expect(row()).toContain(label)
    expect(row()).not.toContain("(")
    expect(row()).not.toContain("‹")
    expect(row()).not.toContain("›")

    for (const mode of [true, false]) {
      setCompact(mode)
      for (const terminalWidth of [40, 30]) {
        view.resize(terminalWidth, 8)
        for (const [index, tab] of tabs.entries()) {
          setPage(tab.page)
          await view.flush()
          expect(row()).toContain(bare[index]!)
          expect(row()).not.toContain("(")
          expect(row()).toMatch(/[‹›]/)
          // Every displayed shortcut belongs to a full tab, never a clipped label.
          const withoutTabs = bare.reduce((text, label) => text.replace(label, ""), row())
          expect(withoutTabs.replace(/[‹›\s]/g, "")).toBe("")
          if (!mode) expect(view.captureCharFrame().split("\n")[4]).toContain("─".repeat(Bun.stringWidth(bare[index]!)))
        }
      }
    }
    setCompact(true)
    view.resize(160, 8)
    setIssues(1234567)
    await view.flush()
    expect(row()).toContain("3 Issues (1234567)")
    expect(row()).toContain("pi-anthropic-oauth")
    expect(row()).not.toContain("a-very-long-owner")
    expect(row()).not.toMatch(/[‹›]/)
    setShowTabCounts(false)
    for (const mode of [true, false]) {
      setCompact(mode)
      for (const terminalWidth of [160, 80, 40]) {
        view.resize(terminalWidth, 8)
        setPage("issues")
        await view.flush()
        expect(row()).toContain("3 Issues")
        expect(row()).not.toContain("(")
      }
    }
  } finally {
    view.renderer.destroy()
  }
})
