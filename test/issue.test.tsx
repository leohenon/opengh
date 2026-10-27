import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { CommitDetailState, IssueDetailState } from "../src/repository-state"
import type { IssueDetail, IssueReference } from "../src/models"
import type { DetailTarget } from "../src/navigation"
import { App } from "../src/ui/app"
import { IssueScreen } from "../src/ui/pages/issue"
import { commitDetailFixture, githubDataFixture, issueDetailFixture, issueCommentsFixture, issuePullReferenceFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const view of active.splice(0)) if (!view.renderer.isDestroyed) view.renderer.destroy()
})

async function settle(view: Awaited<ReturnType<typeof testRender>>) {
  await view.flush()
  await Bun.sleep(60) // Markdown and fenced-code rendering complete asynchronously.
  await view.flush()
}

test("issue details retain scrolling and restore selection while hidden tabs stay inactive", async () => {
  const items = Array.from({ length: 35 }, (_, index) => ({ ...issueDetailFixture, number: index + 100, title: `Issue title ${index}` }))
  const [detail, setDetail] = createSignal<IssueDetailState>()
  const loaded: number[] = []
  const opened: Array<string | number | undefined> = []
  let copied = ""
  let more = 0
  let commitLoads = 0
  const comments = Array.from({ length: 30 }, (_, index) => ({ ...issueCommentsFixture[0]!, id: index + 1, body: `Comment body ${index}` }))
  const view = await testRender(() => (
    <App
      data={{ ...githubDataFixture, issues: { ...githubDataFixture.issues, open: { status: "ready", value: { items, page: 1, hasMore: false } } } }}
      operations={repositoryOperationsFixture}
      issueDetail={detail()}
      onLoadIssue={async (number) => {
        loaded.push(number)
        setDetail({ number, resource: { status: "ready", value: {
          ...items.find((issue) => issue.number === number)!, commentCount: 30,
          url: `https://github.com/anomalyco/opentui/issues/${number}`,
        } }, comments: { status: "ready", value: { items: comments, page: 1, hasMore: true } }, references: { status: "ready", value: [] } })
      }}
      onLoadMoreIssueComments={async () => { more++ }}
      onCloseIssue={() => setDetail(undefined)}
      onOpenInBrowser={async (target) => { opened.push(target) }}
      onCopyToClipboard={async (value) => { copied = value; return true }}
      onLoadCommit={async () => { commitLoads++ }}
    />
  ), { width: 120, height: 32 })
  active.push(view)
  await settle(view)
  view.mockInput.pressKey("3")
  await settle(view)
  for (let i = 0; i < 18; i++) view.mockInput.pressKey("j")
  await settle(view)
  const selected = view.captureCharFrame().split("\n").find((row) => row.includes("▌"))!
  expect(selected).toBeDefined()
  view.mockInput.pressEnter()
  await settle(view)
  expect(loaded).toEqual([118])
  expect(more).toBe(0) // Opening the row must not also paginate its detail.
  const frame = view.captureCharFrame()
  expect(frame).toContain("Issue title 18 #118")
  expect(frame).toContain("Issue title 18")
  expect(frame).toContain("maria-dev opened")
  expect(frame).toContain("bug · terminal")
  expect(frame).toContain("Assignees")
  expect(frame).toContain("max, jane")
  expect(frame).toContain("Milestone")
  expect(frame).toContain("Next release")
  expect(frame).toContain("viewport loses focus")
  expect(frame).toContain("renderer.resize(40, 24)")

  view.mockInput.pressKey("?")
  await view.flush()
  expect(view.captureCharFrame()).toContain("back to issues")
  expect(view.captureCharFrame()).toContain("copy issue URL")
  expect(view.captureCharFrame()).not.toContain("toggle open/closed")
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  await view.flush()
  expect(detail()?.number).toBe(118)
  view.mockInput.pressTab()
  view.mockInput.pressKey("y")
  view.mockInput.pressKey("o")
  await settle(view)
  expect(copied).toBe("https://github.com/anomalyco/opentui/issues/118")
  expect(opened).toEqual([118])
  expect(loaded).toHaveLength(1)
  view.mockInput.pressKey("G")
  await settle(view)
  expect(view.captureCharFrame()).toContain("Comment body 29")
  expect(view.captureCharFrame()).not.toContain("Issue title 18") // The issue header scrolls away with the discussion.
  const retained = detail()
  view.mockInput.pressKey("2")
  view.mockInput.pressEnter()
  view.mockInput.pressKey("r")
  await view.flush()
  expect(commitLoads).toBe(1)
  expect(more).toBe(0)
  expect(detail()).toBe(retained)
  view.mockInput.pressKey("3")
  await settle(view)
  expect(view.captureCharFrame()).toContain("Comment body 29")
  expect(loaded).toHaveLength(1)
  view.mockInput.pressEnter()
  expect(more).toBe(1)
  view.resize(40, 28)
  view.mockInput.pressKey("g")
  await settle(view)
  expect(view.captureCharFrame()).toContain("Issue title 18")
  view.mockInput.pressKey("G")
  await settle(view)
  expect(view.captureCharFrame()).toContain("Due ")
  view.resize(120, 32)
  await settle(view)
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  await view.flush()
  expect(detail()).toBeUndefined()
  expect(view.captureCharFrame().split("\n").find((row) => row.includes("▌"))).toBe(selected)
})

test("permission recovery guidance remains visible with readable issue content and clears after recovery", async () => {
  const [issue, setIssue] = createSignal<IssueDetail>({
    ...issueDetailFixture,
    body: "Readable issue description.",
    permissions: undefined,
    permissionsError: "GitHub account changed. Restart opengh before continuing; no changes were sent.",
  })
  const view = await testRender(() => <IssueScreen
    number={issueDetailFixture.number}
    detail={{
      number: issueDetailFixture.number,
      resource: { status: "ready", value: issue() },
      comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
      references: { status: "ready", value: [] },
    }}
    interactive
    showScrollbar={false}
  />, { width: 100, height: 32 })
  active.push(view)
  await settle(view)
  expect(view.captureCharFrame()).toContain("Issue actions unavailable:")
  expect(view.captureCharFrame()).toContain("Restart opengh")
  expect(view.captureCharFrame()).toContain("Readable issue description.")
  setIssue((current) => ({ ...current, permissions: issueDetailFixture.permissions, permissionsError: undefined }))
  await view.flush()
  expect(view.captureCharFrame()).not.toContain("Issue actions unavailable:")
  expect(view.captureCharFrame()).not.toContain("Restart opengh")
  expect(view.captureCharFrame()).toContain("Readable issue description.")
})

test("issue and comment failures retry separately, with honest empty states", async () => {
  const number = issueDetailFixture.number
  const [detail, setDetail] = createSignal<IssueDetailState>()
  let loads = 0
  let retries = 0
  const view = await testRender(() => (
    <App
      data={githubDataFixture}
      operations={repositoryOperationsFixture}
      issueDetail={detail()}
      onLoadIssue={async () => {
        loads++
        setDetail({ number, resource: loads === 1
          ? { status: "error", phase: "load", message: "Issue unavailable" }
          : { status: "ready", value: { ...issueDetailFixture, state: "closed", stateReason: "not_planned", locked: true, body: "", labels: [], assignees: [], milestone: undefined } },
          comments: { status: "error", phase: "load", message: "Comments unavailable" },
          references: { status: "ready", value: [] },
        })
      }}
      onLoadMoreIssueComments={async () => {
        retries++
        setDetail((current) => ({ ...current!, comments: { status: "ready", value: { items: [], page: 1, hasMore: false } } }))
      }}
    />
  ), { width: 100, height: 32 })
  active.push(view)
  await settle(view)
  view.mockInput.pressKey("3")
  view.mockInput.pressEnter()
  await settle(view)
  expect(view.captureCharFrame()).toContain("Issue unavailable")
  view.mockInput.pressKey("r")
  await settle(view)
  expect(loads).toBe(2)
  const frame = view.captureCharFrame()
  expect(frame).toContain("Closed · not planned")
  expect(frame).toContain("locked")
  expect(frame).toContain("No description provided.")
  expect(frame).toContain("Assignees none")
  expect(frame).not.toContain("Milestone")
  expect(frame).toContain("Comments unavailable")
  view.mockInput.pressKey("r")
  await settle(view)
  expect(retries).toBe(1)
  expect(loads).toBe(2)
  expect(view.captureCharFrame()).toContain("No comments or references yet.")
  view.mockInput.pressKey("r")
  await settle(view)
  expect(loads).toBe(3)
})

test("zero-comment issues still show PR mentions and open the correct source repository", async () => {
  const number = issueDetailFixture.number
  const [detail, setDetail] = createSignal<IssueDetailState>()
  let loads = 0
  let retries = 0
  let opened: { detail?: DetailTarget; repository?: string } = {}
  let copied = ""
  const view = await testRender(() => (
    <App data={githubDataFixture} operations={repositoryOperationsFixture} issueDetail={detail()}
      onLoadIssue={async () => {
        loads++
        setDetail({ number, resource: { status: "ready", value: { ...issueDetailFixture, body: "A short description.", commentCount: 0 } },
          comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
          references: { status: "error", phase: "load", message: "Timeline unavailable" },
        })
      }}
      onRetryIssueReferences={async () => {
        retries++
        setDetail((current) => ({ ...current!, references: { status: "ready", value: [issuePullReferenceFixture] } }))
      }}
      onOpenReference={(repository, detail) => { opened = { detail, repository } }}
      onCopyToClipboard={async (value) => { copied = value; return true }}
    />
  ), { width: 120, height: 36 })
  active.push(view)
  await settle(view)
  view.mockInput.pressKey("3")
  view.mockInput.pressEnter()
  await settle(view)
  expect(view.captureCharFrame()).toContain("Timeline unavailable")
  expect(view.captureCharFrame()).not.toContain("No comments or references yet.")
  view.mockInput.pressKey("r")
  await settle(view)
  expect(retries).toBe(1)
  expect(loads).toBe(1)
  expect(view.captureCharFrame()).toContain("referenced this in PR")
  expect(view.captureCharFrame()).toContain("PR other/repo#77 · Merged")
  expect(view.captureCharFrame()).toContain("Fix viewport focus after resize")
  expect(view.captureCharFrame()).not.toContain("Closes this issue")
  view.mockInput.pressKey("p")
  await view.flush()
  expect(view.captureCharFrame()).toContain("References")
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  await view.flush()
  expect(detail()?.number).toBe(number)
  view.mockInput.pressKey("p")
  await view.flush()
  view.mockInput.pressEnter()
  await view.flush()
  expect(opened).toEqual({ detail: { kind: "pull", number: 77 }, repository: "other/repo" })
  expect(view.renderer.root.findDescendantById("references-tab-pull")).toBeUndefined()
  expect(detail()?.number).toBe(number)
  view.mockInput.pressKey("p")
  await view.flush()
  view.mockInput.pressKey("y")
  await view.flush()
  expect(copied).toBe(issuePullReferenceFixture.url)
  view.resize(40, 36)
  view.mockInput.pressKey("G")
  await settle(view)
  expect(view.captureCharFrame()).toContain("repo#77")
  expect(view.captureCharFrame()).toContain("Merged")
  expect(view.captureCharFrame()).not.toContain("No comments or references yet.")
})

test("issue and commit refreshes keep one indicator and ignore repeated refresh presses", async () => {
  const initial = Promise.withResolvers<void>()
  const metadata = Promise.withResolvers<void>()
  const activity = Promise.withResolvers<void>()
  const commitRefresh = Promise.withResolvers<void>()
  const readyIssue: IssueDetailState = {
    number: issueDetailFixture.number,
    resource: { status: "ready", value: { ...issueDetailFixture, body: "Existing description." } },
    comments: { status: "ready", value: { items: issueCommentsFixture, page: 1, hasMore: false } },
    references: { status: "ready", value: [] },
  }
  const [issue, setIssue] = createSignal<IssueDetailState>()
  const [commit, setCommit] = createSignal<CommitDetailState>()
  let issueLoads = 0
  let commitLoads = 0
  const view = await testRender(() => (
    <App data={githubDataFixture} operations={repositoryOperationsFixture} issueDetail={issue()} commitDetail={commit()}
      onLoadIssue={async () => {
        issueLoads++
        if (issueLoads === 1) {
          setIssue({ ...readyIssue, comments: { status: "loading", phase: "load" }, references: { status: "loading", phase: "load" } })
          await initial.promise
        } else {
          setIssue({ ...readyIssue,
            resource: { status: "loading", phase: "load", value: readyIssue.resource.value },
            comments: { status: "loading", phase: "load", value: readyIssue.comments.value },
            references: { status: "loading", phase: "load", value: readyIssue.references.value },
          })
          await metadata.promise
          setIssue((current) => ({ ...current!, resource: readyIssue.resource }))
          await activity.promise
        }
        setIssue(readyIssue)
      }}
      onLoadCommit={async (sha) => {
        commitLoads++
        if (commitLoads > 1) {
          setCommit({ sha, resource: { status: "loading", phase: "load", value: commit()?.resource.value } })
          await commitRefresh.promise
        }
        setCommit({ sha, resource: { status: "ready", value: commitDetailFixture } })
      }}
    />
  ), { width: 120, height: 40 })
  active.push(view)
  try {
    await settle(view)
    view.mockInput.pressKey("3")
    view.mockInput.pressEnter()
    await Bun.sleep(230)
    await settle(view)
    expect(view.captureCharFrame()).toContain("Loading comments…")
    expect(view.captureCharFrame().match(/[◐◓◑◒]/g)).toHaveLength(1)
    initial.resolve()
    await settle(view)

    view.mockInput.pressKey("r")
    view.mockInput.pressKey("r")
    await Bun.sleep(230)
    await settle(view)
    expect(issueLoads).toBe(2)
    expect(view.captureCharFrame()).toContain("Existing description.")
    expect(view.captureCharFrame()).toContain("Refreshing…")
    expect(view.captureCharFrame()).not.toContain("Loading")
    expect(view.captureCharFrame().match(/[◐◓◑◒]/g)).toHaveLength(1)
    metadata.resolve()
    await settle(view)
    expect(view.captureCharFrame()).toContain("Refreshing…")
    activity.resolve()
    await settle(view)
    expect(view.captureCharFrame()).not.toContain("Refreshing…")

    view.mockInput.pressKey("2")
    view.mockInput.pressEnter()
    await settle(view)
    view.mockInput.pressKey("r")
    view.mockInput.pressKey("r")
    await Bun.sleep(230)
    await settle(view)
    expect(commitLoads).toBe(2)
    expect(view.captureCharFrame()).toContain(commitDetailFixture.message)
    expect(view.captureCharFrame()).toContain("Refreshing…")
    expect(view.captureCharFrame()).not.toContain("Loading")
    expect(view.captureCharFrame().match(/[◐◓◑◒]/g)).toHaveLength(1)
    commitRefresh.resolve()
    await settle(view)
    expect(view.captureCharFrame()).not.toContain("Refreshing…")
  } finally {
    initial.resolve()
    metadata.resolve()
    activity.resolve()
    commitRefresh.resolve()
  }
})

test("mixed references render chronologically and the references menu includes issues and PRs", async () => {
  const [detail, setDetail] = createSignal<IssueDetailState>()
  const references: IssueReference[] = [
    { kind: "issue", id: "related-issue", repository: "other/repo", number: 8, state: "open",
      title: "Related issue title", url: "https://github.com/other/repo/issues/8", actor: "alice", createdAt: "2026-04-14T00:00:00Z" },
    { kind: "commit", id: "related-commit", repository: "anomalyco/opentui", sha: "a".repeat(40),
      title: "Commit reference title", url: `https://github.com/anomalyco/opentui/commit/${"a".repeat(40)}`,
      actor: "max", createdAt: "2026-04-12T12:00:00Z" },
  ]
  let opened: { detail?: DetailTarget; repository?: string } = {}
  const view = await testRender(() => (
    <App data={githubDataFixture} operations={repositoryOperationsFixture} issueDetail={detail()}
      onLoadIssue={async () => {
        setDetail({ number: issueDetailFixture.number,
          resource: { status: "ready", value: { ...issueDetailFixture, body: "Short description.", labels: [], assignees: [], milestone: undefined, commentCount: 1 } },
          comments: { status: "ready", value: { items: [{ ...issueCommentsFixture[0]!, body: "Comment between the references." }], page: 1, hasMore: false } },
          references: { status: "ready", value: references },
        })
      }}
      onOpenReference={(repository, detail) => { opened = { detail, repository } }}
    />
  ), { width: 120, height: 40 })
  active.push(view)
  await settle(view)
  view.mockInput.pressKey("3")
  view.mockInput.pressEnter()
  await settle(view)
  const frame = view.captureCharFrame()
  expect(frame).toContain("referenced this in commit aaaaaaa")
  expect(frame).toContain("referenced this in issue other/repo#8")
  expect(frame).toContain("2 references")
  expect(frame.indexOf("Commit reference title")).toBeLessThan(frame.indexOf("Comment between the references."))
  expect(frame.indexOf("Comment between the references.")).toBeLessThan(frame.indexOf("Related issue title"))
  expect(frame).not.toContain("Referenced PRs")
  view.mockInput.pressKey("p")
  await view.flush()
  expect(view.captureCharFrame()).toContain("References")
  expect(view.captureCharFrame()).toContain("Issues (1)")
  expect(view.captureCharFrame()).toContain("PRs (0)")
  view.mockInput.pressEnter()
  await view.flush()
  expect(opened).toEqual({ detail: { kind: "issue", number: 8 }, repository: "other/repo" })
  view.mockInput.pressKey("?")
  await view.flush()
  expect(view.captureCharFrame()).toContain("open references")
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  await view.flush()

  setDetail((current) => ({ ...current!, references: { status: "ready", value: [...references, issuePullReferenceFixture] } }))
  await settle(view)
  view.mockInput.pressKey("p")
  await view.flush()
  expect(view.captureCharFrame()).toContain("References")
  expect(view.captureCharFrame()).toContain("#77 Fix viewport focus after resize")
  view.mockInput.pressEnter()
  await view.flush()
  expect(opened).toEqual({ detail: { kind: "pull", number: 77 }, repository: "other/repo" })
})
