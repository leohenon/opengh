import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { defaultConfig } from "../src/config"
import { GitHubApiError } from "../src/github/transport"
import type { IssueComment, PullRequestDetail } from "../src/models"
import { createRepositorySession } from "../src/repository-session"
import { Root } from "../src/root"
import { clickControl } from "./fixtures/mouse"
import { commitDetailFixture, githubDataFixture, issueCommentsFixture, issueDetailFixture, pullContextFixture } from "./fixtures/github-data"

test("Root PR conversation comments use the shared editor, retain drafts, confirm, retry, and reveal the posted comment", async () => {
  const summary = githubDataFixture.pulls.open.value!.items[0]!
  const number = summary.number
  let allowed = true
  let pending = Promise.withResolvers<IssueComment>()
  const calls: Array<{ repository: string; number: number; body: string }> = []
  const comments = Array.from({ length: 12 }, (_, index) => ({ ...issueCommentsFixture[0]!, id: 1000 + index, body: `Earlier PR comment ${index}` }))
  const session = createRepositorySession({
    metadata: async (repository) => ({ ...githubDataFixture.repo, nameWithOwner: repository, url: `https://github.com/${repository}` }),
    workCounts: async () => ({ issues: 1, pulls: 1 }),
    documents: async () => [], document: async () => "",
    branches: async () => ({ items: ["main"], hasMore: false }),
    commits: async () => ({ items: [], hasMore: false }), commitCount: async () => 0,
    commit: async () => commitDetailFixture,
    issues: async (_repository, state) => ({ items: githubDataFixture.issues[state].value!.items, hasMore: false }),
    pulls: async (_repository, state) => ({ items: githubDataFixture.pulls[state].value!.items, hasMore: false }),
    runs: async () => ({ items: [], hasMore: false }),
    issue: async () => issueDetailFixture,
    issueComments: async () => ({ items: comments, hasMore: false }), issueReferences: async () => [],
    pull: async (): Promise<PullRequestDetail> => ({ ...summary, url: `${githubDataFixture.repo.url}/pull/${number}`,
      body: "PR description", nodeId: "PR_comment_fixture", canReact: true, locked: false, permissions: { comment: allowed },
      updatedAt: summary.createdAt, baseBranch: "main", headBranch: "next", additions: 0, deletions: 0,
      changedFiles: 0, commitCount: 0, commentCount: comments.length,
      labels: [], assignees: [], reviewers: [], mergeable: null }),
    pullCommits: async () => [], pullContext: async () => pullContextFixture,
    createIssueComment: async (repository, number, body) => { calls.push({ repository, number, body }); return pending.promise },
  })
  const view = await testRender(() => <Root cwd="/fixture" services={{
    resolveRepository: async () => githubDataFixture.repo.nameWithOwner, resolveLocalRepository: async () => undefined,
    loadRecentRepositories: async () => [], rememberRepository: async () => {},
    loadConfig: async () => ({ ...defaultConfig, showStatusBarHints: true, showScrollbars: false, keybindings: { "issue.comment": ["f8"] } }), saveConfig: async () => {},
    createRepositorySession: () => session, copyToHostClipboard: async () => true,
    openGitHub: async () => { throw new Error("Unexpected browser action") },
    runCommand: () => { throw new Error("Unexpected local command") },
  }} />, { width: 120, height: 40 })
  const settle = async () => { await Bun.sleep(35); await view.flush() }
  const dismiss = async () => { await view.mockMouse.click(0, 0); await settle() }
  const right = async (id: string) => {
    await view.flush()
    const target = view.renderer.root.findDescendantById(id)!
    await view.mockMouse.click(target.x + 1, target.y + 1, 2)
    await settle()
  }
  try {
    await settle()
    view.mockInput.pressKey("4")
    view.mockInput.pressEnter()
    await settle()
    expect(view.captureCharFrame()).toContain("f8 comment")
    await right("pull-detail-description")
    expect(view.captureCharFrame()).toContain("Add comment")
    await clickControl(view, "context-menu-row-2")
    expect(view.captureCharFrame()).toContain(`PR #${number}`)
    expect(calls).toEqual([])
    const body = "PR conversation draft qrs?h1l,"
    await view.mockInput.typeText(body)
    await settle()
    expect(session.issueAction(number, "pull").body).toBe(body)
    expect(session.issueAction(number).body).toBe("")
    await dismiss()
    view.mockInput.pressKey("F8")
    await settle()
    expect(view.captureCharFrame()).toContain(body)
    await clickControl(view, "issue-action-submit")
    expect(view.captureCharFrame()).toContain(`Post comment to PR #${number}?`)
    expect(view.captureCharFrame().split("enter confirm · esc back")).toHaveLength(2)
    expect(calls).toEqual([])
    await clickControl(view, "issue-action-confirm")
    await clickControl(view, "issue-action-submit")
    view.mockInput.pressKey("s", { ctrl: true })
    await dismiss()
    expect(calls).toEqual([{ repository: githubDataFixture.repo.nameWithOwner, number, body }])
    expect(session.issueAction(number, "pull").operation).toEqual({ status: "loading" })
    await Bun.sleep(220); await view.flush()
    expect(view.captureCharFrame()).toContain("Posting comment")
    expect(view.renderer.root.findDescendantById("issue-action-submit")).toBeDefined()
    pending.reject(new GitHubApiError(`repos/anomalyco/opentui/issues/${number}/comments`, "Forbidden", 403))
    await settle()
    expect(session.issueAction(number, "pull").body).toBe(body)
    expect(view.captureCharFrame()).toContain("Forbidden")
    pending = Promise.withResolvers<IssueComment>()
    await clickControl(view, "issue-action-submit")
    await clickControl(view, "issue-action-confirm")
    expect(calls).toHaveLength(2)
    const posted = { ...issueCommentsFixture[0]!, id: 9001, body, createdAt: "2026-10-23T22:00:00Z" }
    pending.resolve(posted)
    await settle()
    expect(view.renderer.root.findDescendantById("issue-action-submit")).toBeUndefined()
    expect(session.issueAction(number, "pull").body).toBe("")
    expect(session.pullDetail()?.comments.value?.items.filter((item) => item.id === posted.id)).toEqual([posted])
    const scroll = view.renderer.root.findDescendantById("pull-detail-scroll") as ScrollBoxRenderable
    expect(scroll.scrollTop).toBeGreaterThan(0)
    expect(view.captureCharFrame()).toContain(body)
    allowed = false
    await session.loadPull(number)
    await settle()
    view.mockInput.pressKey("F8")
    await settle()
    expect(view.renderer.root.findDescendantById("issue-action-submit")).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("f8 comment")
    await right("pull-detail-scroll")
    expect(view.captureCharFrame()).not.toContain("Add comment")
    expect(calls).toHaveLength(2)
    await dismiss()
    allowed = true
    await session.loadPull(number)
    view.mockInput.pressKey("F8")
    await settle()
    await view.mockInput.typeText("Late PR comment")
    pending = Promise.withResolvers<IssueComment>()
    await clickControl(view, "issue-action-submit")
    await clickControl(view, "issue-action-confirm")
    expect(calls).toHaveLength(3)
    await session.load("owner/other")
    session.updateIssueDraft(number, { body: "Replacement PR draft" }, "pull")
    await settle()
    pending.resolve({ ...posted, id: 9002, body: "Late PR comment" })
    await settle()
    expect(view.captureCharFrame()).toContain("owner/other")
    expect(view.captureCharFrame()).not.toContain("Comment posted")
    expect(view.renderer.root.findDescendantById("issue-action-submit")).toBeUndefined()
    expect(session.issueAction(number, "pull").body).toBe("Replacement PR draft")
    expect(session.pullDetail()).toBeUndefined()
  } finally { view.renderer.destroy() }
})
