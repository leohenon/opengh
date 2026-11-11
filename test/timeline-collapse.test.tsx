import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "../src/config"
import type { IssueDetailState, PullDetailState } from "../src/repository-state"
import { App } from "../src/ui/app"
import { githubDataFixture, issueCommentsFixture, issueDetailFixture, issuePullReferenceFixture, pullContextFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { clickControl } from "./fixtures/mouse"

test("one timeline toggle hides bodies, keeps headers and descriptions, and carries across issues and PRs", async () => {
  const comments: IssueDetailState["comments"] = { status: "ready", value: { items: [issueCommentsFixture[0]!], page: 1, hasMore: false } }
  const references: IssueDetailState["references"] = { status: "ready", value: [issuePullReferenceFixture] }
  const issue: IssueDetailState = {
    number: issueDetailFixture.number,
    resource: { status: "ready", value: { ...issueDetailFixture, body: "Issue description remains visible.", commentCount: 1 } },
    comments, references,
  }
  const summary = githubDataFixture.pulls.open.value!.items[0]!
  const date = issueCommentsFixture[0]!.createdAt
  const pull: PullDetailState = {
    number: summary.number,
    resource: { status: "ready", value: { ...summary, body: "PR description remains visible.", url: `${githubDataFixture.repo.url}/pull/${summary.number}`,
      updatedAt: date, baseBranch: "main", headBranch: "feature", additions: 1, deletions: 0, changedFiles: 1, commitCount: 1,
      commentCount: 1, labels: [], assignees: [], reviewers: [], mergeable: null } },
    comments, references,
    commits: { status: "ready", value: [githubDataFixture.commits.value!.items[0]!] },
    events: [{ kind: "review", event: "reviewed", id: "review-1", reviewId: 1, actor: "reviewer", state: "approved",
      body: "Review body to collapse.", authorAssociation: "MEMBER", createdAt: date, url: `${githubDataFixture.repo.url}/pull/${summary.number}#review-1` }],
    context: { status: "ready", value: { ...pullContextFixture,
      readiness: { ...pullContextFixture.readiness, isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "UNSTABLE", reviewDecision: "APPROVED",
        checks: [{ id: "ci", name: "Readiness check to collapse", state: "failure", required: true }] },
      threads: [{ kind: "review-thread", id: "thread-1", path: "src/example.ts",
      line: 42, isResolved: true, isOutdated: false, createdAt: date,
      comments: [{ id: "thread-comment-1", author: "reviewer", authorAssociation: "MEMBER", body: "Thread body to collapse.",
        createdAt: date, updatedAt: date, url: `${githubDataFixture.repo.url}/pull/${summary.number}#discussion-1`, diffHunk: "@@ -1 +1 @@\n-oldCode\n+newCode" }] }] } },
  }
  const view = await testRender(() => <App
    config={{ ...defaultConfig, showStatusBarHints: true }} data={githubDataFixture} operations={repositoryOperationsFixture}
    initialNavigation={{ detail: { kind: "issue", number: issue.number } }} issueDetail={issue} pullDetail={pull}
    getReactionAction={() => ({ operation: { status: "idle" } })} onAddReaction={async () => ({ reactions: {}, viewerReactions: [], canReact: true })}
  />, { width: 160, height: 100 })
  const settle = async () => { await view.flush(); await Bun.sleep(60); await view.flush() }
  try {
    await settle()
    expect(view.captureCharFrame()).toContain("Thanks for the clear reproduction.")
    expect(view.captureCharFrame()).toContain("z collapse")
    view.mockInput.pressKey("z")
    await settle()
    let frame = view.captureCharFrame()
    expect(frame).not.toContain("Thanks for the clear reproduction.")
    expect(frame).toContain("max commented")
    expect(frame).toContain("Issue description remains visible.")
    expect(frame).toContain("referenced this in PR")
    expect(frame).toContain("z expand")
    view.mockInput.pressKey("?")
    await settle()
    expect(view.captureCharFrame()).toContain("collapse / expand timeline")
    view.mockInput.pressKey("z") // Help must not toggle the underlying timeline.
    view.mockInput.pressEscape()
    await settle()
    expect(view.captureCharFrame()).toContain("z expand")
    view.mockInput.pressKey("4")
    view.mockInput.pressEnter()
    await settle()
    frame = view.captureCharFrame()
    expect(frame).toContain("PR description remains visible.")
    expect(frame).toContain("approved these changes")
    expect(frame).toContain("Review thread · src/example.ts:42 · 1 comment")
    expect(frame).toContain("Resolved")
    expect(frame).toContain("1 commit")
    expect(frame).toContain("Merge blocked · Current status")
    expect(view.renderer.root.findDescendantById("pull-merge-readiness")!.height).toBe(1)
    for (const text of ["Thanks for the clear reproduction.", "Review body to collapse.", "Thread body to collapse.", "newCode", "fix: avoid duplicate key events",
      "Fix failed required checks.", "Reviews: Approved", "Branch: No conflicts", "Required checks:", "Readiness check to collapse"])
      expect(frame).not.toContain(text)
    view.mockInput.pressKey("z")
    await settle()
    frame = view.captureCharFrame()
    for (const text of ["Thanks for the clear reproduction.", "Review body to collapse.", "Thread body to collapse.", "newCode", "fix: avoid duplicate key events",
      "Merge blocked · Current status", "Fix failed required checks.", "Reviews: Approved", "Branch: No conflicts", "Required checks:", "Readiness check to collapse"])
      expect(frame).toContain(text)
    expect(view.renderer.root.findDescendantById("pull-merge-readiness")!.height).toBeGreaterThan(1)
    expect(frame).toContain("z collapse")
    view.mockInput.pressKey("3")
    await settle()
    expect(view.captureCharFrame()).toContain("Thanks for the clear reproduction.")
    const description = view.renderer.root.findDescendantById("issue-detail-description")!
    await view.mockMouse.click(description.x + 1, description.y + 1, 2)
    await settle()
    expect(view.captureCharFrame()).toContain("React")
    expect(view.captureCharFrame()).toContain("Collapse")
    await clickControl(view, "context-menu-row-3")
    await settle()
    expect(view.captureCharFrame()).not.toContain("Thanks for the clear reproduction.")
    expect(view.captureCharFrame()).toContain("z expand")
    await view.mockMouse.click(1, 10, 2)
    await settle()
    expect(view.captureCharFrame()).toContain("Expand")
    await clickControl(view, "context-menu-row-3")
    await settle()
    expect(view.captureCharFrame()).toContain("Thanks for the clear reproduction.")
    expect(view.captureCharFrame()).toContain("z collapse")
  } finally { view.renderer.destroy() }
})
