import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { App } from "../src/app"
import { githubDataFixture } from "./fixtures/github-data"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

async function setup() {
  let quit = 0
  let refresh = 0
  let branch = ""
  const view = await testRender(
    () => (
      <App
        data={githubDataFixture}
        onQuit={() => quit++}
        onRefresh={() => refresh++}
        onBranchChange={(value) => (branch = value)}
      />
    ),
    { width: 120, height: 32, useThread: false },
  )
  active.push(view)
  await view.flush()
  return { view, quit: () => quit, refresh: () => refresh, branch: () => branch }
}

describe("openGH TUI", () => {
  test("renders the repository overview", async () => {
    const { view } = await setup()
    const frame = view.captureCharFrame()
    expect(frame).toContain("anomalyco/opentui")
    expect(frame).not.toContain("◉ openGH")
    expect(frame).toContain("About")
    expect(frame).toContain("5.3k stars")
  })

  test("switches screens and moves the selection", async () => {
    const { view } = await setup()
    view.mockInput.pressKey("2")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Commits (4)")
    expect(view.captureCharFrame()).toContain("main (2 branches)")

    view.mockInput.pressKey("3")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Open (4)")
    expect(view.captureCharFrame()).toContain("Closed (1)")
    expect(view.captureCharFrame()).toContain("ScrollBox loses focus")

    view.mockInput.pressKey("j")
    await view.flush()
    const frame = view.captureCharFrame()
    expect(frame).toContain("Add support for accessible color themes")
    expect(frame).toContain("#407")
    expect(frame).not.toContain("semantic colors")

    view.mockInput.pressKey("4")
    await view.flush()
    const pulls = view.captureCharFrame()
    expect(pulls).toContain("Pull requests")
    expect(pulls).toContain("Open (3)")
    expect(pulls).toContain("Closed (1)")
    expect(pulls).not.toContain("All checks have passed")

    view.mockInput.pressKey("5")
    await view.flush()
    const actions = view.captureCharFrame()
    expect(actions).toContain("Workflow runs (4)")
    expect(actions).not.toContain("Set up job")
  })

  test("hides Actions when the repository has no workflow runs", async () => {
    const data = { ...githubDataFixture, runs: [] }
    const view = await testRender(() => <App data={data} onQuit={() => {}} />, {
      width: 120,
      height: 32,
      useThread: false,
    })
    active.push(view)
    await view.flush()

    expect(view.captureCharFrame()).not.toContain("Actions")

    view.mockInput.pressKey("5")
    await view.flush()
    expect(view.captureCharFrame()).toContain("About")

    view.mockInput.pressKey("h")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Pull requests")
  })

  test("loads more commits and workflow runs near the end of each list", async () => {
    const [data, setData] = createSignal({
      ...githubDataFixture,
      commitsPage: { page: 1, hasMore: true },
      runsPage: { page: 1, hasMore: true },
    })
    let commitLoads = 0
    let runLoads = 0
    const view = await testRender(
      () => (
        <App
          data={data}
          onLoadMoreCommits={async () => {
            commitLoads++
            setData((value) => ({
              ...value,
              commits: [...value.commits, {
                sha: "next001",
                message: "next commit page",
                author: "octocat",
                date: "2026-04-01T00:00:00Z",
              }],
              commitsPage: { page: 2, hasMore: false },
            }))
          }}
          onLoadMoreRuns={async () => {
            runLoads++
            setData((value) => ({
              ...value,
              runs: [...value.runs, {
                id: 9790,
                name: "CI",
                title: "next workflow page",
                branch: "main",
                event: "push",
                status: "completed",
                conclusion: "success",
                createdAt: "2026-04-01T00:00:00Z",
              }],
              runsPage: { page: 2, hasMore: false }
            }))
          }}
        />
      ),
      { width: 120, height: 32, useThread: false },
    )
    active.push(view)
    await view.flush()

    view.mockInput.pressKey("2")
    view.mockInput.pressKey("j")
    await view.flush()
    expect(commitLoads).toBe(1)
    expect(view.captureCharFrame()).toContain("Commits (5)")

    view.mockInput.pressKey("5")
    view.mockInput.pressKey("j")
    await view.flush()
    expect(runLoads).toBe(1)
    expect(view.captureCharFrame()).toContain("Workflow runs (5)")
  })

  test("opens the branch picker from Overview", async () => {
    const { view } = await setup()
    view.mockInput.pressTab()
    await view.flush()
    expect(view.captureCharFrame()).toContain("Switch branch")
  })

  test("uses Tab for commit branches, issue state, and pull request state", async () => {
    const { view, branch } = await setup()
    view.mockInput.pressKey("2")
    await view.flush()
    view.mockInput.pressTab()
    await view.flush()
    expect(view.captureCharFrame()).toContain("Switch branch")
    expect(view.captureCharFrame()).toContain("Search branches")

    await view.mockInput.typeText("nxt")
    await view.flush()
    expect(view.captureCharFrame()).toContain("next")
    view.mockInput.pressEnter()
    await view.flush()
    expect(branch()).toBe("next")
    expect(view.captureCharFrame()).not.toContain("Switch branch")

    view.mockInput.pressKey("3")
    await view.flush()
    expect(view.captureCharFrame()).toContain("ScrollBox loses focus")

    view.mockInput.pressTab()
    await view.flush()
    const closed = view.captureCharFrame()
    expect(closed).toContain("Fix terminal redraw after returning from background")
    expect(closed).not.toContain("ScrollBox loses focus")

    view.mockInput.pressTab()
    await view.flush()
    expect(view.captureCharFrame()).toContain("ScrollBox loses focus")

    view.mockInput.pressKey("4")
    await view.flush()
    expect(view.captureCharFrame()).toContain("retain focused child")

    view.mockInput.pressTab()
    await view.flush()
    const closedPulls = view.captureCharFrame()
    expect(closedPulls).toContain("preserve selection after refresh")
    expect(closedPulls).not.toContain("retain focused child")
  })

  test("keeps table columns fixed while selections change", async () => {
    const { view } = await setup()
    const heading = (frame: string, label: string) =>
      frame.split("\n").find((row) => row.includes(label)) ?? ""

    view.mockInput.pressKey("3")
    await view.flush()
    const issuesHeading = heading(view.captureCharFrame(), "ISSUE")
    view.mockInput.pressKey("j")
    await view.flush()
    expect(heading(view.captureCharFrame(), "ISSUE")).toBe(issuesHeading)

    view.mockInput.pressKey("4")
    await view.flush()
    const pullsHeading = heading(view.captureCharFrame(), "PULL")
    view.mockInput.pressKey("j")
    await view.flush()
    expect(heading(view.captureCharFrame(), "PULL")).toBe(pullsHeading)

    view.mockInput.pressKey("5")
    await view.flush()
    const actionsHeading = heading(view.captureCharFrame(), "STATUS")
    view.mockInput.pressKey("j")
    await view.flush()
    expect(heading(view.captureCharFrame(), "STATUS")).toBe(actionsHeading)
  })

  test("opens help and invokes global actions", async () => {
    const { view, quit, refresh } = await setup()
    view.mockInput.pressKey("?")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Keyboard shortcuts")

    view.mockInput.pressKey("?")
    await view.flush()
    view.mockInput.pressKey("r")
    await view.flush()
    view.mockInput.pressKey("q")
    await view.flush()
    expect(refresh()).toBe(1)
    expect(quit()).toBe(1)
  })

  test("adapts to a narrow terminal", async () => {
    const view = await testRender(() => <App data={githubDataFixture} onQuit={() => {}} />, {
      width: 76,
      height: 24,
      useThread: false,
    })
    active.push(view)
    await view.flush()
    const frame = view.captureCharFrame()
    expect(frame).toContain("About")
  })
})
