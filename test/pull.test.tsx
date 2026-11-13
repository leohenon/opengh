import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { createGitHubClient } from "../src/github/client"
import type { PullDetailState } from "../src/repository-state"
import { App } from "../src/ui/app"
import { PullReadinessPanel } from "../src/ui/components/pull-context-panel"
import { relativeTime } from "../src/ui/format"
import { githubDataFixture, issueCommentsFixture, issuePullReferenceFixture, repositoryOperationsFixture, pullContextFixture } from "./fixtures/github-data"

test("pull request details map GitHub data and preserve list navigation across narrow layouts", async () => {
  const summary = githubDataFixture.pulls.open.value!.items[1]!
  const client = createGitHubClient({
    async json<T>(path: string) {
      expect(path).toBe(`repos/anomalyco/opentui/pulls/${summary.number}`)
      return {
        number: summary.number, state: "open", title: summary.title, user: { login: summary.author },
        created_at: summary.createdAt, updated_at: summary.createdAt,
        html_url: `https://github.com/anomalyco/opentui/pull/${summary.number}`,
        body: "## Summary\n\nKeep focus during layout changes.", draft: true,
        merged_at: null, closed_at: null, mergeable: false, mergeable_state: "dirty",
        base: { ref: "main" }, head: { ref: "fix/focus", repo: { full_name: "contributor/opentui" } },
        additions: 18, deletions: 7, changed_files: 2, commits: 3, comments: 2, review_comments: 4,
        labels: [{ name: "accessibility" }], assignees: [{ login: "max" }],
        requested_reviewers: [{ login: "jane" }], requested_teams: [{ name: "UI team" }],
      } as T
    },
    async text() { return "" },
  })
  const [detail, setDetail] = createSignal<PullDetailState>()
  const loaded: number[] = []
  const opened: Array<string | number | undefined> = []
  let copied = ""
  const view = await testRender(() => (
    <App
      data={githubDataFixture}
      operations={repositoryOperationsFixture}
      pullDetail={detail()}
      onLoadPull={async (number) => {
        loaded.push(number)
        setDetail({ number, resource: { status: "ready", value: await client.pull("anomalyco/opentui", number) },
          commits: { status: "ready", value: githubDataFixture.commits.value!.items.slice(0, 3).map((commit) => ({ ...commit, committedAt: commit.date })) },
          context: { status: "ready", value: pullContextFixture },
          comments: { status: "ready", value: { items: issueCommentsFixture, page: 1, hasMore: false } },
          references: { status: "ready", value: [issuePullReferenceFixture] },
          events: [{ kind: "force-push", event: "head_ref_force_pushed", id: "force-push:900", actor: "alice-dev", createdAt: "2026-04-14T12:00:00Z",
            beforeCommit: { sha: "a".repeat(40), url: `https://github.com/anomalyco/opentui/commit/${"a".repeat(40)}` },
            afterCommit: { sha: githubDataFixture.commits.value!.items[0]!.sha,
              url: `https://github.com/anomalyco/opentui/commit/${githubDataFixture.commits.value!.items[0]!.sha}` } }] })
      }}
      onClosePull={() => setDetail(undefined)}
      onCopyToClipboard={async (value) => { copied = value; return true }}
      onOpenInBrowser={async (target) => { opened.push(target) }}
    />
  ), { width: 120, height: 64 })
  const settle = async () => {
    await view.flush()
    await Bun.sleep(60) // Markdown content renders asynchronously.
    await view.flush()
  }
  try {
    await settle()
    view.mockInput.pressKey("4")
    view.mockInput.pressKey("j")
    await settle()
    view.mockInput.pressEnter()
    await settle()
    expect(loaded).toEqual([summary.number])
    const frame = view.captureCharFrame()
    expect(frame).toContain(`${summary.title} #${summary.number}`)
    expect(frame).toContain("Draft")
    expect(frame).toContain("main ←")
    expect(frame).toContain("contributor/opentui:")
    expect(frame).toContain("3 commits · 2 files")
    expect(frame).toContain("+18 −7")
    expect(frame).not.toContain("Branch has merge conflicts")
    expect(frame).toContain("Keep focus during layout changes.")
    expect(frame).toContain("jane, UI team")
    expect(frame).toContain("accessibility")
    expect(frame).not.toContain("Commit history")
    expect(frame).toContain("Activity · 3 commits")
    expect(frame).toContain("7ca91d2")
    expect(frame).toContain("fix: avoid duplicate key events")
    expect(frame.indexOf("Activity ·")).toBeLessThan(frame.indexOf("7ca91d2"))
    expect(frame).toContain("3 commits · 2 comments")
    expect(frame).toContain("Thanks for the clear reproduction.")
    expect(frame).not.toContain("Open on GitHub to read")
    const ready = detail()!
    for (const context of [
      { status: "error", phase: "load", message: "Readiness failed", value: ready.context.value },
      { status: "error", phase: "load", message: "Readiness failed" },
      { status: "loading", phase: "load", value: ready.context.value },
    ] as const) {
      setDetail({ ...ready, context })
      await settle()
      expect(view.captureCharFrame()).toContain("Branch has merge conflicts")
    }
    setDetail(ready)
    await settle()
    expect(view.captureCharFrame()).not.toContain("Branch has merge conflicts")
    const description = view.renderer.root.findDescendantById("pull-detail-description")!
    const sidebar = view.renderer.root.findDescendantById("pull-detail-sidebar")!
    expect(sidebar.y).toBe(description.y)
    expect(sidebar.x - (description.x + description.width)).toBe(2)
    view.mockInput.pressTab() // Must not toggle the hidden PR list.
    view.mockInput.pressKey("y")
    view.mockInput.pressKey("o")
    await settle()
    expect(copied).toBe(`https://github.com/anomalyco/opentui/pull/${summary.number}`)
    expect(opened).toEqual([summary.number])
    view.mockInput.pressKey("?")
    await view.flush()
    expect(view.captureCharFrame()).toContain("back to pull requests")
    expect(view.captureCharFrame()).not.toContain("toggle open/closed")
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    view.mockInput.pressKey("2")
    view.mockInput.pressKey("4")
    await settle()
    expect(loaded).toHaveLength(1)
    setDetail((current) => ({ ...current!, resource: {
      status: "error", phase: "load", message: "Could not refresh PR", value: current!.resource.value,
    } }))
    await settle()
    expect(view.captureCharFrame()).toContain("Keep focus during layout changes.")
    const failedFrame = view.captureCharFrame().split("\n")
    expect(failedFrame[63]).toContain("Could not refresh PR")
    expect(failedFrame[63]).toContain("r retry")
    expect(failedFrame.slice(0, 63).join("\n")).not.toContain("Could not refresh PR")
    view.mockInput.pressKey("r")
    await settle()
    expect(loaded).toEqual([summary.number, summary.number])
    const readyDetail = detail()!
    setDetail({ ...readyDetail, context: { status: "error", phase: "load", message: "GitHub request timed out." } })
    await settle()
    const contextFailure = view.captureCharFrame().split("\n")
    expect(contextFailure[63]).toContain("GitHub request timed out. · r retry")
    expect(contextFailure.join("\n")).not.toContain("retry PR details")
    expect(contextFailure.slice(0, 63).join("\n")).not.toContain("GitHub request timed out.")
    setDetail(readyDetail)
    view.resize(48, 34)
    await settle()
    const compactDescription = view.renderer.root.findDescendantById("pull-detail-description")!
    const compactContext = view.renderer.root.findDescendantById("pull-detail-context")!
    expect(compactContext.y - (compactDescription.y + compactDescription.height)).toBe(1)
    expect(view.captureCharFrame()).toContain("Draft")
    expect(view.captureCharFrame()).not.toContain("Branch has merge conflicts")
    expect(view.captureCharFrame()).toContain("jane, UI team")
    expect(view.captureCharFrame()).toContain("accessibility")
    view.mockInput.pressKey("G")
    await settle()
    expect(view.captureCharFrame()).toContain("referenced this in PR")
    expect(view.captureCharFrame()).toContain("alice-dev force-pushed this branch")
    expect(view.captureCharFrame()).toContain(relativeTime("2026-04-14T12:00:00Z"))
    expect(view.captureCharFrame()).toContain("from aaaaaaa to 7ca91d2")
    view.mockInput.pressKey("p")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Fix viewport focus after resize")
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    view.mockInput.pressEscape()
    await settle()
    expect(detail()).toBeUndefined()
    expect(view.captureCharFrame()).toContain(summary.title)
    view.mockInput.pressEnter()
    await settle()
    expect(loaded).toEqual([summary.number, summary.number, summary.number])
  } finally {
    view.renderer.destroy()
  }
})

test("merge conflicts remain visible in the merge-readiness section", async () => {
  const context = { ...pullContextFixture, readiness: { ...pullContextFixture.readiness,
    isDraft: false, mergeable: "CONFLICTING" as const, mergeStateStatus: "DIRTY" as const } }
  const view = await testRender(() => <PullReadinessPanel context={context} expectedHeadSha={context.readiness.headSha} />, { width: 90, height: 20 })
  try {
    await view.flush()
    expect(view.captureCharFrame()).toContain("Merge blocked")
    expect(view.captureCharFrame()).toContain("Branch: Conflicts reported")
  } finally { view.renderer.destroy() }
})
