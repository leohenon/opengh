import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { Page } from "../src/navigation"
import { Header } from "../src/ui/components/header"
import { githubDataFixture } from "./fixtures/github-data"

const tabs: ReadonlyArray<{ page: Page; label: string }> = [
  { page: "overview", label: "Overview" },
  { page: "commits", label: "Commits" },
  { page: "issues", label: "Issues" },
  { page: "pulls", label: "Pull requests" },
  { page: "actions", label: "Actions" },
]

test("header prioritizes tabs over repository identity and counts, then reveals whole tabs on navigation", async () => {
  const repo = { ...githubDataFixture.repo, nameWithOwner: "a-very-long-owner/pi-anthropic-oauth" }
  const [page, setPage] = createSignal<Page>("overview")
  const [compact, setCompact] = createSignal(true)
  const [issues, setIssues] = createSignal(61)
  const view = await testRender(() => <Header repo={repo} page={page()} tabs={tabs} compact={compact()}
    workCounts={{ status: "ready", value: { issues: issues(), pulls: 24 } }}
  />, { width: 160, height: 8 })
  const row = () => view.captureCharFrame().split("\n")[compact() ? 0 : 3]!
  const bare = tabs.map((tab, index) => `${index + 1} ${tab.label}`)
  const counted = bare.map((label, index) => index === 2 ? `${label} (61)` : index === 3 ? `${label} (24)` : label)
  const width = (labels: string[]) => Bun.stringWidth(labels.join("   "))
  try {
    await view.flush()
    expect(row()).toContain(repo.nameWithOwner)
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
    expect(row()).toContain(repo.nameWithOwner)
    expect(row()).not.toMatch(/[‹›]/)
  } finally {
    view.renderer.destroy()
  }
})
