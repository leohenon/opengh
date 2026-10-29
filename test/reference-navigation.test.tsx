import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { IssueReference, PullRequestDetail } from "../src/models"
import type { CommitDetailState, IssueDetailState } from "../src/repository-state"
import { App } from "../src/ui/app"
import { commitDetailFixture, githubDataFixture, issueDetailFixture, repositoryOperationsFixture } from "./fixtures/github-data"

test("references open internal details and every Back control unwinds the linked trail", async () => {
  const repository = githubDataFixture.repo.nameWithOwner
  const commitReference: IssueReference = {
    kind: "commit", id: "description-commit", repository, sha: commitDetailFixture.sha,
    title: commitDetailFixture.message, url: `${githubDataFixture.repo.url}/commit/${commitDetailFixture.sha}`,
    actor: "author", createdAt: issueDetailFixture.createdAt,
  }
  const issueReference: IssueReference = {
    kind: "issue", id: "message-issue", repository, number: issueDetailFixture.number,
    title: issueDetailFixture.title, url: issueDetailFixture.url, state: "open",
    actor: "author", createdAt: issueDetailFixture.createdAt,
  }
  const nextIssueReference: IssueReference = {
    ...issueReference, id: "next-issue", number: issueDetailFixture.number + 1, title: "Linked second issue",
  }
  const pull: PullRequestDetail = {
    ...issueDetailFixture, merged: false, draft: false, baseBranch: "main", headBranch: "fix",
    additions: 1, deletions: 0, changedFiles: 1, commitCount: 1, reviewers: [], mergeable: true,
    references: [commitReference],
  }
  const [commit, setCommit] = createSignal<CommitDetailState>()
  const [issue, setIssue] = createSignal<IssueDetailState>()
  const commits: string[] = []
  const issues: number[] = []
  let browserCalls = 0
  const view = await testRender(() => <App
    data={githubDataFixture} operations={repositoryOperationsFixture}
    initialNavigation={{ detail: { kind: "pull", number: pull.number } }}
    pullDetail={{ number: pull.number, resource: { status: "ready", value: pull },
      comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
      references: { status: "ready", value: [] }, commits: { status: "ready", value: [] },
      context: { status: "loading", phase: "load" } }}
    commitDetail={commit()}
    onLoadCommit={async (sha) => {
      commits.push(sha)
      setCommit({ sha, resource: { status: "ready", value: { ...commitDetailFixture, references: [issueReference] } } })
    }}
    onCloseCommit={() => setCommit(undefined)}
    issueDetail={issue()}
    onLoadIssue={async (number) => {
      issues.push(number)
      setIssue({ number, resource: { status: "ready", value: { ...issueDetailFixture, number,
        title: number === issueDetailFixture.number ? issueDetailFixture.title : nextIssueReference.title } },
        comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
        references: { status: "ready", value: number === issueDetailFixture.number ? [nextIssueReference] : [] } })
    }}
    onCloseIssue={() => setIssue(undefined)}
    onOpenInBrowser={async () => { browserCalls++ }}
  />, { width: 120, height: 32 })
  try {
    await view.flush()
    const detailScroll = view.renderer.root.findDescendantById("pull-detail-scroll")!
    await view.mockMouse.click(detailScroll.x + 3, detailScroll.y + 2, 2)
    await view.flush()
    const menuLines = view.captureCharFrame().split("\n")
    const referencesRow = menuLines.findIndex((line) => line.includes("References…"))
    expect(referencesRow).toBeGreaterThanOrEqual(0)
    await view.mockMouse.click(menuLines[referencesRow]!.indexOf("References…"), referencesRow)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Commits (1)")
    expect(view.renderer.listenerCount("selection")).toBeLessThanOrEqual(view.renderer.getMaxListeners())
    const row = view.captureCharFrame().split("\n").findIndex((line) => line.includes(commitDetailFixture.message))
    expect(row).toBeGreaterThanOrEqual(0)
    await view.mockMouse.click(40, row)
    await view.flush()
    expect(commits).toEqual([commitDetailFixture.sha])
    expect(view.captureCharFrame()).toContain("Files changed")
    const baseline = view.renderer.listenerCount("selection")
    for (let attempt = 0; attempt < 3; attempt++) {
      view.mockInput.pressKey("p")
      await view.flush()
      expect(view.renderer.listenerCount("selection")).toBeLessThanOrEqual(view.renderer.getMaxListeners())
      view.mockInput.pressEscape()
      await Bun.sleep(30) // Standalone Escape waits for the terminal escape-sequence timeout.
      await view.flush()
      expect(view.renderer.listenerCount("selection")).toBe(baseline)
    }
    view.mockInput.pressKey("p")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Issues (1)")
    view.mockInput.pressEnter()
    await view.flush()
    expect(issues).toEqual([issueDetailFixture.number])
    view.mockInput.pressKey("p")
    await view.flush()
    view.mockInput.pressEnter()
    await view.flush()
    expect(issues).toEqual([issueDetailFixture.number, nextIssueReference.number])
    expect(view.captureCharFrame()).toContain("Linked second issue")

    // Context-menu Back restores the earlier issue, whose resource was replaced.
    const issueScroll = view.renderer.root.findDescendantById("issue-detail-scroll")!
    await view.mockMouse.click(issueScroll.x + 3, issueScroll.y + 2, 2)
    await view.flush()
    const backLines = view.captureCharFrame().split("\n")
    const backRow = backLines.findIndex((line) => line.includes("Back"))
    expect(backRow).toBeGreaterThanOrEqual(0)
    await view.mockMouse.click(backLines[backRow]!.indexOf("Back"), backRow)
    await view.flush()
    expect(issues).toEqual([issueDetailFixture.number, nextIssueReference.number, issueDetailFixture.number])
    expect(view.captureCharFrame()).toContain(issueDetailFixture.title)
    expect(view.captureCharFrame()).not.toContain(`Linked second issue #${nextIssueReference.number}`)

    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Files changed")
    expect(commits).toEqual([commitDetailFixture.sha]) // The retained commit needs no refetch.

    // Clicking the active tab must also go back to the originating PR, not its list.
    const tabLines = view.captureCharFrame().split("\n")
    const tabRow = tabLines.findIndex((line) => line.includes("2 Commits"))
    expect(tabRow).toBeGreaterThanOrEqual(0)
    await view.mockMouse.click(tabLines[tabRow]!.indexOf("2 Commits"), tabRow)
    await view.flush()
    expect(view.renderer.root.findDescendantById("pull-detail-scroll")).toBeDefined()
    expect(view.captureCharFrame()).toContain(pull.title)
    expect(view.renderer.root.findDescendantById("commit-detail-scroll")).toBeUndefined()

    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    expect(view.renderer.root.findDescendantById("pull-detail-scroll")).toBeUndefined()
    expect(browserCalls).toBe(0)
  } finally {
    view.renderer.destroy()
  }
})
