import { expect, test } from "bun:test"
import type { ScrollBoxRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render, type testRender } from "@opentui/solid"
import { defaultConfig } from "../src/config"
import type { ReactionKind, ReactionState, ReactionTarget } from "../src/models"
import { createRepositorySession, type RepositoryLoaders } from "../src/repository-session"
import { initializeHunk } from "../src/ui/hunk-host"
import { Root } from "../src/root"
import { clickControl } from "./fixtures/mouse"
import { commitDetailFixture, githubDataFixture, issueCommentsFixture, issueDetailFixture, pullContextFixture } from "./fixtures/github-data"

async function setup(overrides: Partial<RepositoryLoaders> = {}, launcher = false) {
  const session = createRepositorySession({
    metadata: async (repository) => ({ ...githubDataFixture.repo, nameWithOwner: repository }),
    workCounts: async () => ({ issues: 1, pulls: 1 }),
    documents: async () => [], document: async () => "",
    branches: async () => ({ items: ["main"], hasMore: false }),
    commits: async () => ({ items: [], hasMore: false }), commitCount: async () => 0,
    commit: async () => commitDetailFixture,
    issues: async (_repo, state) => ({ items: githubDataFixture.issues[state].value!.items, hasMore: false }),
    pulls: async (_repo, state) => ({ items: githubDataFixture.pulls[state].value!.items, hasMore: false }),
    runs: async () => ({ items: [], hasMore: false }),
    issue: async () => ({ ...issueDetailFixture, nodeId: "I_body", body: "", reactions: {}, viewerReactions: [], canReact: true }),
    issueComments: async () => ({ items: [], hasMore: false }), issueReferences: async () => [],
    pull: async (_repo, number) => ({ ...issueDetailFixture, number, url: `https://github.com/anomalyco/opentui/pull/${number}`,
      nodeId: "PR_body", body: "", merged: false, baseBranch: "main", headBranch: "next", additions: 0, deletions: 0,
      changedFiles: 0, commitCount: 0, reviewCommentCount: 1, reviewers: [], mergeable: null, mergeableState: "unknown" }),
    pullCommits: async () => [], pullContext: async () => pullContextFixture,
    ...overrides,
  })
  const copied: string[] = []
  const view = await createTestRenderer({ width: 100, height: 36 })
  if (launcher) initializeHunk(view.renderer)
  await render(() => <Root cwd="/fixture" services={{
    resolveRepository: async () => launcher ? undefined : "anomalyco/opentui", resolveLocalRepository: async () => undefined,
    loadRecentRepositories: async () => ["anomalyco/opentui", "owner/other"], rememberRepository: async () => {},
    copyToHostClipboard: async (value) => { copied.push(value); return true },
    loadConfig: async () => ({ ...defaultConfig, showScrollbars: false }), createRepositorySession: () => session,
  }} />, view.renderer)
  await settle(view)
  return { view, session, copied }
}
async function settle(view: Awaited<ReturnType<typeof testRender>>) {
  await Bun.sleep(30)
  await view.flush()
}
async function escape(view: Awaited<ReturnType<typeof testRender>>) {
  view.mockInput.pressEscape()
  await settle(view)
}
async function messageGesture(view: Awaited<ReturnType<typeof testRender>>, text: string, right = false, single = false) {
  await view.flush()
  const rows = view.captureCharFrame().split("\n")
  const y = rows.findIndex((row) => row.includes(text))
  expect(y).toBeGreaterThanOrEqual(0)
  const x = Bun.stringWidth(rows[y]!.slice(0, rows[y]!.indexOf(text)))
  if (single) await view.mockMouse.click(x, y)
  else if (right) await view.mockMouse.click(x, y, 2)
  else await view.mockMouse.doubleClick(x, y)
  await settle(view)
}
const confirmed = (kind: ReactionKind, count = 1): ReactionState => ({ reactions: { [kind]: count }, viewerReactions: [kind], canReact: true })

test("Root/session first reaction uses message double-click, context menu, pending, error/retry and confirmed membership", async () => {
  let pending = Promise.withResolvers<ReactionState>()
  const calls: Array<{ target: ReactionTarget; kind: ReactionKind }> = []
  const { view, session } = await setup({ addReaction: async (_repo, target, kind) => { calls.push({ target, kind }); return pending.promise } })
  try {
    view.mockInput.pressKey("3")
    view.mockInput.pressEnter()
    await settle(view)
    expect(view.captureCharFrame()).toContain("No description provided.")
    await messageGesture(view, "No description provided.", false, true)
    expect(view.renderer.root.findDescendantById("reaction-picker")).toBeUndefined()
    await Bun.sleep(510)
    await messageGesture(view, "No description provided.")
    const picker = view.renderer.root.findDescendantById("reaction-picker")!
    expect(picker).toBeDefined()
    expect(picker.parent!.height).toBe(13)
    expect(view.renderer.currentFocusedRenderable).toBe(picker)
    expect(view.renderer.root.findDescendantById("picker-query")).toBeUndefined()
    await view.mockInput.typeText("eyes") // Printable input no longer filters the eight choices.
    await view.flush()
    expect(view.captureCharFrame()).toContain("confused")
    expect(view.captureCharFrame()).not.toContain("Find reaction")
    expect(view.captureCharFrame()).not.toContain("Add reaction")
    expect(view.renderer.root.findDescendantById("page-actions")).toBeUndefined()
    expect(view.captureCharFrame()).toContain("eyes") // All eight fit, including the last kind.
    await clickControl(view, "reaction-picker-row-heart")
    view.mockInput.pressEnter()
    await settle(view)
    expect(calls).toEqual([{ target: { kind: "issue", number: 412, nodeId: "I_body" }, kind: "heart" }])
    expect(session.issueDetail()?.resource.value?.reactions).toEqual({})
    expect(view.captureCharFrame()).toContain("Adding…")
    pending.reject(new Error("Fixture offline"))
    await settle(view)
    expect(view.captureCharFrame()).toContain("Fixture offline")
    pending = Promise.withResolvers<ReactionState>()
    view.mockInput.pressEnter()
    await settle(view)
    expect(calls).toHaveLength(2)
    pending.resolve(confirmed("heart", 4))
    await settle(view)
    expect(view.captureCharFrame()).toContain("✓ added")
    view.mockInput.pressEnter()
    expect(calls).toHaveLength(2)
    await view.mockMouse.click(0, 0)
    await settle(view)
    await clickControl(view, "reaction-issue:412:body-heart")
    expect(calls).toHaveLength(2)
    expect(view.captureCharFrame()).toContain("✓ ❤️ 4")
    await messageGesture(view, "No description provided.", true)
    expect(view.captureCharFrame()).toContain("Copy text")
    await clickControl(view, "context-menu-row-0")
    expect(view.captureCharFrame()).toContain("eyes")
    view.resize(32, 10)
    await settle(view)
    for (let index = 0; index < 7; index++) view.mockInput.pressArrow("down")
    await view.flush()
    expect(view.captureCharFrame()).toContain("eyes")
    pending = Promise.withResolvers<ReactionState>()
    await clickControl(view, "reaction-picker-row-eyes")
    expect(calls.at(-1)?.kind).toBe("eyes")
    pending.resolve({ reactions: { heart: 4, eyes: 1 }, viewerReactions: ["heart", "eyes"], canReact: true })
    await settle(view)
    expect(view.captureCharFrame()).toContain("✓ added")
    await escape(view)
    view.resize(100, 36)
    view.mockInput.pressKey("?")
    await settle(view)
    expect(view.captureCharFrame()).not.toContain("choose message, then kind")
  } finally { view.renderer.destroy() }
})

test("ordinary and opaque review comment chips target the right message and retain scroll/renderables", async () => {
  const calls: Array<{ target: ReactionTarget; kind: ReactionKind }> = []
  let pending = Promise.withResolvers<ReactionState>()
  const comments = Array.from({ length: 14 }, (_, index) => ({ ...issueCommentsFixture[0]!,
    id: 101 + index, nodeId: `IC_${index}`, body: `Selectable comment ${index}`, reactions: { "+1": 2 }, canReact: index !== 0,
  }))
  const { view, session, copied } = await setup({
    issueComments: async () => ({ items: comments, hasMore: false }),
    pullContext: async () => ({ ...pullContextFixture, threads: [{ kind: "review-thread", id: "thread", path: "src/input.ts", isResolved: false, isOutdated: false,
      comments: [{ id: "PRRC_opaque", author: "reviewer", authorAssociation: "MEMBER", body: "Selectable review", createdAt: "2026-04-15T00:00:00Z", updatedAt: "2026-04-15T00:00:00Z", url: "https://github.com/review", reactions: { rocket: 3 } }] }] }),
    addReaction: async (_repo, target, kind) => { calls.push({ target, kind }); return pending.promise },
  })
  try {
    view.mockInput.pressKey("3")
    view.mockInput.pressEnter()
    await settle(view)
    await clickControl(view, "reaction-issue:412:comment:101-+1")
    expect(calls).toHaveLength(0) // Explicitly forbidden.
    await Bun.sleep(60) // Message markdown renders asynchronously.
    await view.flush()
    await messageGesture(view, "Selectable comment 0")
    expect(view.renderer.root.findDescendantById("reaction-picker")).toBeUndefined()
    await messageGesture(view, "Selectable comment 0", true)
    await clickControl(view, "context-menu-row-0")
    expect(view.renderer.root.findDescendantById("reaction-picker")).toBeUndefined()
    expect(calls).toHaveLength(0)
    await escape(view)
    view.mockInput.pressKey("G")
    await settle(view)
    const scroll = view.renderer.root.findDescendantById("issue-detail-scroll") as ScrollBoxRenderable
    const top = scroll.scrollTop
    const id = "reaction-issue:412:comment:114-+1"
    const chip = view.renderer.root.findDescendantById(id)!
    const row = view.captureCharFrame().split("\n").findIndex((line) => line.includes("Selectable comment 13"))
    await view.mockMouse.drag(chip.x, row, chip.x + 8, row)
    expect(view.renderer.getSelection()?.getSelectedText()).toBeTruthy()
    expect(view.renderer.root.findDescendantById("reaction-picker")).toBeUndefined()
    for (const button of [1, 2] as const) await view.mockMouse.click(chip.x, chip.y, button)
    await view.mockMouse.drag(chip.x, chip.y, chip.x + 3, chip.y)
    expect(calls).toHaveLength(0)
    await clickControl(view, id)
    await clickControl(view, id)
    expect(calls).toEqual([{ target: { kind: "comment", parent: "issue", number: 412, id: 114, nodeId: "IC_13" }, kind: "+1" }])
    await view.mockMouse.drag(chip.x, row, chip.x + 8, row)
    const selectedText = view.renderer.getSelection()?.getSelectedText()
    pending.resolve(confirmed("+1", 3))
    await settle(view)
    expect(view.renderer.root.findDescendantById(id)).toBe(chip)
    expect(scroll.scrollTop).toBe(top)
    expect(view.renderer.getSelection()?.getSelectedText()).toBe(selectedText)
    expect(view.captureCharFrame()).toContain("✓ 👍 3")
    await messageGesture(view, "Selectable comment 13", true)
    await clickControl(view, "context-menu-row-1")
    expect(copied).toEqual(["Selectable comment 13"])

    view.mockInput.pressKey("4")
    view.mockInput.pressEnter()
    await settle(view)
    expect(session.pullDetail()?.number).toBe(421)
    view.mockInput.pressKey("G")
    await settle(view)
    const reviewId = "reaction-pull:421:review-comment:PRRC_opaque-rocket"
    const reviewChip = view.renderer.root.findDescendantById(reviewId)!
    pending = Promise.withResolvers<ReactionState>()
    await clickControl(view, reviewId)
    expect(calls.at(-1)).toEqual({ target: { kind: "review-comment", number: 421, id: "PRRC_opaque", nodeId: "PRRC_opaque" }, kind: "rocket" })
    pending.resolve(confirmed("rocket", 4))
    await settle(view)
    expect(view.renderer.root.findDescendantById(reviewId)).toBe(reviewChip)
    expect(session.issueDetail()?.comments.value?.items.at(-1)?.reactions).toEqual({ "+1": 3 })
    // The ordinary PR comment remains distinct from the retained issue with the same REST ID.
    await messageGesture(view, "Selectable comment 13")
    for (let index = 0; index < 7; index++) view.mockInput.pressArrow("down")
    pending = Promise.withResolvers<ReactionState>()
    view.mockInput.pressEnter()
    await settle(view)
    expect(calls.at(-1)).toEqual({ target: { kind: "comment", parent: "pull", number: 421, id: 114, nodeId: "IC_13" }, kind: "eyes" })
    pending.resolve(confirmed("eyes"))
    await settle(view)
  } finally { view.renderer.destroy() }
})

test("dismissal shields background controls and old completions cannot affect replacement popups or repositories", async () => {
  const pending = Promise.withResolvers<ReactionState>()
  let calls = 0
  let nodeId = "I_body"
  const { view, session } = await setup({ issue: async () => ({ ...issueDetailFixture, nodeId, body: "", reactions: {} }),
    addReaction: async () => { calls++; return pending.promise },
  })
  try {
    view.mockInput.pressKey("3")
    view.mockInput.pressEnter()
    await settle(view)
    await messageGesture(view, "No description provided.")
    view.mockInput.pressEnter()
    await settle(view)
    expect(calls).toBe(1)
    await escape(view) // Pending writes don't trap the reader in a modal.
    await messageGesture(view, "No description provided.", true)
    const menu = view.renderer.root.findDescendantById("context-menu")
    pending.resolve(confirmed("+1"))
    await settle(view)
    expect(view.renderer.root.findDescendantById("context-menu")).toBe(menu)
    // Outside dismissal consumes the gesture without activating the covered page.
    await view.mockMouse.click(0, 0)
    await settle(view)
    expect(view.renderer.root.findDescendantById("reaction-picker")).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("Help")
    await messageGesture(view, "No description provided.")
    nodeId = "I_replacement"
    await session.loadIssue(412)
    await settle(view)
    expect(view.renderer.root.findDescendantById("reaction-picker")).toBeUndefined()
    await messageGesture(view, "No description provided.")
    await session.load("owner/other")
    await settle(view)
    expect(view.renderer.root.findDescendantById("reaction-picker")).toBeUndefined()
    expect(calls).toBe(1)
  } finally { view.renderer.destroy() }
})


test("mouse-only fixture route crosses launcher, repository, tabs, branches, documents, Hunk, reactions and dismissal", async () => {
  const writes: ReactionTarget[] = []
  const patch = "diff --git a/route.txt b/route.txt\n--- a/route.txt\n+++ b/route.txt\n@@ -1,60 +1,60 @@\n"
    + Array.from({ length: 60 }, (_, index) => `-old-${index}\n`).join("")
    + Array.from({ length: 60 }, (_, index) => `+new-${index}\n`).join("")
  const { view, session } = await setup({
    documents: async (repo, ref) => ["README", "Security"].map((label) => ({ id: label, path: `${label}.md`, label, repository: repo.nameWithOwner, ref })),
    document: async (source) => Array.from({ length: 60 }, (_, index) => `${source.label} line ${index}\n\n`).join(""),
    commits: async () => ({ items: githubDataFixture.commits.value!.items, hasMore: false }),
    branches: async () => ({ items: ["main", "next"], hasMore: false }),
    diff: async () => ({ kind: "patch", patch }),
    addReaction: async (_repo, target, kind) => { writes.push(target); return confirmed(kind) },
  }, true)
  const clickText = async (label: string, right = false) => {
    await view.flush()
    const rows = view.captureCharFrame().split("\n")
    const y = rows.findIndex((row) => row.includes(label))
    expect(y).toBeGreaterThanOrEqual(0)
    const x = Bun.stringWidth(rows[y]!.slice(0, rows[y]!.indexOf(label)))
    await view.mockMouse.click(x, y, right ? 2 : 0)
    await settle(view)
  }
  try {
    expect(view.captureCharFrame()).toContain("Open a GitHub repository")
    await clickControl(view, "picker-row-0")
    await settle(view)
    await clickControl(view, "repository-dropdown")
    await clickControl(view, "picker-row-1")
    await settle(view)
    expect(session.state().repository).toBe("owner/other")
    await clickText("Commits")
    await clickControl(view, "branch-dropdown")
    await clickControl(view, "picker-row-1")
    await settle(view)
    expect(view.captureCharFrame()).toContain("next ▾")
    await clickText("Overview")
    await clickText("Security")
    await Bun.sleep(60)
    await view.flush()
    const document = view.renderer.root.findDescendantById("overview-document-scroll") as ScrollBoxRenderable
    await view.mockMouse.scroll(document.viewport.x + 2, document.viewport.y + 2, "down")
    await settle(view)
    expect(document.scrollTop).toBeGreaterThan(0)
    expect(view.captureCharFrame()).toContain("Security line")
    await clickText("Commits")
    await clickText(githubDataFixture.commits.value!.items[0]!.message, true)
    await clickControl(view, "context-menu-row-1")
    await view.renderer.idle()
    await settle(view)
    await clickText("route.txt")
    expect(view.renderer.root.findDescendantById("diff-controls")).toBeUndefined()
    const body = view.renderer.root.findDescendantById("diff-body-scroll") as ScrollBoxRenderable
    await view.mockMouse.scroll(body.viewport.x + 4, body.viewport.y + 3, "down")
    await settle(view)
    const retainedScroll = body.scrollTop
    expect(retainedScroll).toBeGreaterThan(0)
    await clickText("Issues")
    await clickText(issueDetailFixture.title)
    await messageGesture(view, "No description provided.")
    await clickControl(view, "reaction-picker-row-rocket")
    await settle(view)
    expect(writes).toEqual([{ kind: "issue", number: 412, nodeId: "I_body" }])
    await view.mockMouse.click(0, 0)
    await settle(view)
    expect(view.captureCharFrame()).toContain("✓ 🚀 1")
    await clickText("Commits")
    expect(view.renderer.root.findDescendantById("diff-body-scroll")).toBe(body)
    expect(body.scrollTop).toBe(retainedScroll)
    await clickText("Issues")
    expect(view.captureCharFrame()).toContain("✓ 🚀 1")
    view.resize(48, 28)
    await settle(view)
    await messageGesture(view, "No description provided.")
    await view.mockMouse.click(0, 0)
    await settle(view)
    expect(view.renderer.root.findDescendantById("reaction-picker")).toBeUndefined()
    expect(writes).toHaveLength(1)
    // Finish with a keyboard scroll after the uninterrupted mouse route.
    view.mockInput.pressKey("j")
    expect(session.issueDetail()?.number).toBe(412)
  } finally { view.renderer.destroy() }
})
