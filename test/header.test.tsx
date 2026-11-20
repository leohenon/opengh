import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { Page } from "../src/navigation"
import { Header, ReviewHeader } from "../src/ui/components/header"
import { githubDataFixture } from "./fixtures/github-data"
import { clickControl } from "./fixtures/mouse"

const tabs: ReadonlyArray<{ page: Page; label: string }> = [
  { page: "overview", label: "Overview" },
  { page: "commits", label: "Commits" },
  { page: "issues", label: "Issues" },
  { page: "pulls", label: "Pull requests" },
  { page: "actions", label: "Actions" },
]

test.each([120, 35])("fullscreen repository back label hovers and guards clicks at width %i", async (width) => {
  const [interactive, setInteractive] = createSignal(true)
  let backs = 0
  const view = await testRender(
    () => (
      <ReviewHeader
        repo={githubDataFixture.repo}
        target={{ kind: "commit", sha: "abcdef123456" }}
        interactive={interactive()}
        onBack={() => backs++}
      />
    ),
    { width, height: 4 },
  )
  const foreground = () => view.captureSpans().lines[0]!.spans.find((span) => span.text.includes("opentui"))!.fg
  try {
    await view.flush()
    const control = view.renderer.root.findDescendantById("review-repository-back")!
    const normal = foreground()
    expect(control.width).toBe(Bun.stringWidth(width < 60 ? "opentui" : "anomalyco/opentui"))
    await view.mockMouse.moveTo(control.x, control.y)
    await view.flush()
    expect(foreground()).not.toEqual(normal)
    expect(backs).toBe(0)
    await view.mockMouse.moveTo(width - 1, 2)
    await view.flush()
    expect(foreground()).toEqual(normal)
    await view.mockMouse.moveTo(control.x + 1, control.y)
    await view.flush()
    setInteractive(false)
    await view.flush()
    expect(foreground()).toEqual(normal)
    await clickControl(view, "review-repository-back")
    expect(backs).toBe(0)
    setInteractive(true)
    await view.flush()
    for (const button of [1, 2] as const) await view.mockMouse.click(control.x, control.y, button)
    await view.mockMouse.drag(control.x, control.y, control.x + 2, control.y)
    expect(backs).toBe(0)
    await clickControl(view, "review-repository-back")
    expect(backs).toBe(1)
  } finally {
    view.renderer.destroy()
  }
})

test("mouse tabs include their underline, respect disabled/drag guards, and reveal hidden tabs", async () => {
  const [page, setPage] = createSignal<Page>("overview")
  const [compact, setCompact] = createSignal(false)
  const [interactive, setInteractive] = createSignal(true)
  let repositories = 0
  const [repo, setRepo] = createSignal(githubDataFixture.repo)
  const view = await testRender(
    () => (
      <Header
        repo={repo()}
        page={page()}
        tabs={tabs}
        compact={compact()}
        interactive={interactive()}
        onSelect={setPage}
        onOpenRepository={() => {
          repositories++
        }}
      />
    ),
    { width: 140, height: 8 },
  )
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
    await click("4 PRs")
    expect(page()).toBe("pulls")
    await click("›")
    expect(page()).toBe("actions")
    await click("‹")
    expect(page()).toBe("issues")
    expect(view.captureCharFrame()).not.toContain("anomalyco/opentui")
    expect(view.captureCharFrame()).not.toContain("▾")
    expect(view.renderer.root.findDescendantById("repository-dropdown")).toBeUndefined()
    expect(repositories).toBe(1)
    view.resize(160, 8)
    await view.flush()
    expect(view.captureCharFrame()).toContain("opentui")
    expect(view.captureCharFrame()).not.toContain("▾")
    expect(view.captureCharFrame()).not.toContain("anomalyco/")
    await clickControl(view, "repository-dropdown")
    expect(repositories).toBe(2)
    setCompact(false)
    setRepo({ ...githubDataFixture.repo, nameWithOwner: "a-very-long-owner/a-very-long-repository-name" })
    view.resize(30, 8)
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("▾")
    await clickControl(view, "repository-dropdown")
    expect(repositories).toBe(3)
  } finally {
    view.renderer.destroy()
  }
})

test.each([true, false])(
  "Repo keeps another tab visible, but Overview stays when shortening does not help (shortcuts: %s)",
  async (showTabShortcuts) => {
    const [page, setPage] = createSignal<Page>("overview")
    const [compact, setCompact] = createSignal(false)
    const view = await testRender(
      () => (
        <Header
          repo={githubDataFixture.repo}
          tabs={tabs}
          page={page()}
          compact={compact()}
          showTabShortcuts={showTabShortcuts}
          showTabCounts={false}
          onSelect={setPage}
        />
      ),
      { width: 160, height: 8 },
    )
    const label = (index: number, name: string) => `${showTabShortcuts ? `${index + 1} ` : ""}${name}`
    const full = tabs.map((tab, index) => label(index, tab.page === "pulls" ? "PRs" : tab.label))
    const repoWidth = Bun.stringWidth(full.join("   ")) // Repo saves the four columns used by header padding.
    const row = () => view.captureCharFrame().split("\n")[compact() ? 0 : 3]!
    try {
      for (const mode of [false, true]) {
        setCompact(mode)
        for (const active of ["overview", "actions"] as const) {
          setPage(active)
          view.resize(160, 8)
          await view.flush()
          expect(row()).toContain("Overview")
          expect(row()).toContain("Pull requests")
          view.resize(repoWidth + 4, 8)
          await view.flush()
          expect(row()).toContain(label(0, "Overview"))
          expect(row()).not.toMatch(/[‹›]/)
          view.resize(repoWidth, 8)
          await view.flush()
          for (const text of [label(0, "Repo"), ...full.slice(1)]) expect(row()).toContain(text)
          expect(row()).not.toContain("Overview")
          expect(row()).not.toContain("CI")
          expect(row()).not.toMatch(/[‹›]/)
          if (active === "actions") {
            const text = label(0, "Repo")
            await view.mockMouse.click(row().indexOf(text), compact() ? 0 : 3)
            await view.flush()
            expect(page()).toBe("overview")
            setPage(active)
          }
          view.resize(repoWidth - 1, 8)
          await view.flush()
          expect(row()).not.toContain(label(0, "Repo"))
          expect(row()).toContain(active === "overview" ? "Overview" : "Actions")
          expect(row()).toMatch(/[‹›]/)
        }
      }
    } finally {
      view.renderer.destroy()
    }
  },
)

test("header prioritizes tabs over repository identity and counts, then reveals whole tabs on navigation", async () => {
  const repo = { ...githubDataFixture.repo, nameWithOwner: "a-very-long-owner/pi-anthropic-oauth" }
  const [page, setPage] = createSignal<Page>("overview")
  const [compact, setCompact] = createSignal(true)
  const [issues, setIssues] = createSignal(61)
  const [showTabCounts, setShowTabCounts] = createSignal(true)
  const view = await testRender(
    () => (
      <Header
        repo={repo}
        page={page()}
        tabs={tabs}
        compact={compact()}
        showTabCounts={showTabCounts()}
        workCounts={{ status: "ready", value: { issues: issues(), pulls: 24 } }}
      />
    ),
    { width: 160, height: 8 },
  )
  const row = () => view.captureCharFrame().split("\n")[compact() ? 0 : 3]!
  const bare = tabs.map((tab, index) => `${index + 1} ${tab.label}`)
  const counted = bare.map((label, index) => (index === 2 ? `${label} (61)` : index === 3 ? `${label} (24)` : label))
  const narrow = bare.map((label) => label.replace("Pull requests", "PRs"))
  const narrowCounted = counted.map((label) => label.replace("Pull requests", "PRs"))
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

    view.resize(width(narrowCounted) + 4, 8)
    await view.flush()
    for (const label of narrowCounted) expect(row()).toContain(label)
    view.resize(width(narrowCounted) + 3, 8)
    await view.flush()
    for (const label of narrow) expect(row()).toContain(label)
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
          expect(row()).toContain(narrow[index]!)
          expect(row()).not.toContain("(")
          expect(row()).toMatch(/[‹›]/)
          // Every displayed shortcut belongs to a full tab, never a clipped label.
          const withoutTabs = narrow.reduce((text, label) => text.replace(label, ""), row())
          expect(withoutTabs.replace(/[‹›\s]/g, "")).toBe("")
          if (!mode) expect(view.captureCharFrame().split("\n")[4]).toContain("─".repeat(Bun.stringWidth(narrow[index]!)))
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
