import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { IssueReference } from "../src/models"
import { IssueReferencesPicker } from "../src/ui/components/issue-references-picker"
import { referencedItems, type IssueLinkReference } from "../src/ui/issue-references"

test("shows all unique references without hints and restores each tab's selection and scroll", async () => {
  const link = (kind: "pull" | "issue", number: number): IssueLinkReference => ({
    kind, number, id: `${kind}-${number}`, repository: "owner/repo", title: `${kind} title ${number}`,
    url: `https://github.com/owner/repo/${kind === "pull" ? "pull" : "issues"}/${number}`, actor: "author",
    createdAt: `2026-01-${String(number).padStart(2, "0")}T00:00:00Z`, state: "open",
    ...(kind === "pull" ? { merged: false, draft: false } : {}),
  } as IssueLinkReference)
  const references: IssueReference[] = [
    ...Array.from({ length: 8 }, (_, index) => link("pull", index + 1)),
    ...Array.from({ length: 8 }, (_, index) => link("issue", index + 11)),
    { ...link("pull", 8), title: "older duplicate", createdAt: "2025-01-01T00:00:00Z" },
    link("issue", 30),
    { kind: "commit", id: "commit", repository: "owner/repo", sha: "a".repeat(40), title: "commit title", url: `https://github.com/owner/repo/commit/${"a".repeat(40)}`, actor: "author", createdAt: "2026-02-01T00:00:00Z" },
  ]
  const currentIssue = { repository: "owner/repo", number: 30 }
  const items = referencedItems(references, currentIssue)
  expect(items).toHaveLength(16)
  expect(items[0]?.number).toBe(18)
  expect(items.find((item) => item.number === 8)?.title).toBe("pull title 8")
  let opened: IssueLinkReference | undefined
  let copied: IssueLinkReference | undefined
  const view = await testRender(() => (
    <IssueReferencesPicker references={references} currentIssue={currentIssue} showScrollbar={false}
      onOpen={(item) => { opened = item }} onCopy={(item) => { copied = item }} />
  ), { width: 100, height: 28 })
  try {
    await view.flush()
    const initial = view.captureCharFrame()
    expect(initial).toContain("References")
    expect(initial).toContain("PRs (8)")
    expect(initial).toContain("Issues (8)")
    expect(initial).toContain("pull title 8")
    for (const hint of ["esc", "enter", "Tab", "copy", "older duplicate", "commit title", "issue title 30"]) {
      expect(initial).not.toContain(hint)
    }
    view.mockInput.pressKey("G")
    await view.flush()
    const pullFrame = view.captureCharFrame()
    expect(pullFrame.split("\n").find((line) => line.includes("pull title 1"))).toContain("▌")
    expect(pullFrame).not.toContain("pull title 8")
    view.mockInput.pressTab()
    await view.flush()
    expect(view.captureCharFrame()).toContain("issue title 18")
    view.mockInput.pressKey("G")
    view.mockInput.pressKey("k")
    await view.flush()
    const issueFrame = view.captureCharFrame()
    expect(issueFrame.split("\n").find((line) => line.includes("issue title 12"))).toContain("▌")
    view.mockInput.pressTab({ shift: true })
    await view.flush()
    expect(view.captureCharFrame()).toBe(pullFrame)
    view.mockInput.pressEnter()
    expect(opened?.number).toBe(1)
    expect(opened?.kind).toBe("pull")
    view.mockInput.pressArrow("right")
    await view.flush()
    expect(view.captureCharFrame()).toBe(issueFrame)
    view.mockInput.pressKey("o")
    view.mockInput.pressKey("y")
    expect(opened?.number).toBe(12)
    expect(copied?.kind).toBe("issue")
    expect(copied?.number).toBe(12)
    view.mockInput.pressArrow("left")
    await view.flush()
    expect(view.captureCharFrame()).toBe(pullFrame)
  } finally {
    view.renderer.destroy()
  }
})
