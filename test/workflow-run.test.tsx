import { expect, spyOn, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { RunDetailState } from "../src/repository-state"
import { App } from "../src/ui/app"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { workflowJobFixture, workflowRunFixture } from "./fixtures/workflow-run"

test("Actions opens run details, retains them across tabs, and restores the selected run", async () => {
  const [detail, setDetail] = createSignal<RunDetailState>()
  const opened: number[] = []
  const browser: (string | number | undefined)[] = []
  const copies: string[] = []
  let jobPages = 0
  const view = await testRender(() => (
    <App data={githubDataFixture} operations={repositoryOperationsFixture}
      runDetail={detail()}
      onLoadRun={async (id) => {
        opened.push(id)
        setDetail({ id, resource: { status: "ready", value: { ...workflowRunFixture, id } },
          jobs: { status: "ready", value: { items: [workflowJobFixture], page: 1, hasMore: false } } })
      }}
      onCloseRun={() => setDetail(undefined)}
      onLoadMoreRunJobs={async () => { jobPages++ }}
      onOpenInBrowser={async (target) => { browser.push(target) }}
      onCopyToClipboard={async (value) => { copies.push(value); return true }}
    />
  ), { width: 110, height: 36 })
  try {
    await view.flush()
    view.mockInput.pressKey("5")
    await view.flush()
    view.mockInput.pressKey("j")
    await view.flush()
    view.mockInput.pressEnter()
    await view.flush()
    expect(opened).toEqual([9809])
    const frame = view.captureCharFrame()
    expect(frame).toContain("Build terminal UI")
    expect(frame).toContain("Build and test")
    expect(frame).toContain("Run unit tests")
    expect(frame).toContain("octocat")
    view.mockInput.pressKey("o")
    view.mockInput.pressKey("y")
    await view.flush()
    expect(browser).toEqual(["actions/runs/9809"])
    expect(copies).toEqual([`${githubDataFixture.repo.url}/actions/runs/9809`])
    view.mockInput.pressKey("1")
    await view.flush()
    view.mockInput.pressKey("5")
    await view.flush()
    expect(opened).toHaveLength(1)
    expect(view.captureCharFrame()).toContain("Run unit tests")
    view.resize(45, 24)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Run unit tests")
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    expect(detail()).toBeUndefined()
    view.mockInput.pressEnter()
    await view.flush()
    expect(opened).toEqual([9809, 9809])
    view.mockInput.pressKey("r")
    await view.flush()
    expect(opened).toEqual([9809, 9809, 9809])
    setDetail((current) => ({ ...current!,
      resource: { status: "error", phase: "load", message: "Run refresh failed", value: current!.resource.value },
      jobs: { status: "error", phase: "pagination", message: "Jobs page failed", value: current!.jobs.value },
    }))
    await view.flush()
    view.mockInput.pressKey("r")
    await view.flush()
    expect(opened).toEqual([9809, 9809, 9809, 9809])
    expect(jobPages).toBe(0)
  } finally {
    view.renderer.destroy()
  }
})


test("active run details poll every five seconds, pause off-tab, and stop on completion or close", async () => {
  const timers = new Map<ReturnType<typeof setInterval>, () => void>()
  const interval = globalThis.setInterval
  const clear = globalThis.clearInterval
  const start = spyOn(globalThis, "setInterval").mockImplementation(((...args: Parameters<typeof setInterval>) => {
    const [callback, delay, ...rest] = args
    const timer = interval(callback, delay === 5000 ? 2 ** 30 : delay, ...rest)
    if (delay === 5000) timers.set(timer, () => callback(...rest))
    return timer
  }) as typeof setInterval)
  const stop = spyOn(globalThis, "clearInterval").mockImplementation(((timer: Parameters<typeof clearInterval>[0]) => {
    if (typeof timer === "object") timers.delete(timer)
    clear(timer)
  }) as typeof clearInterval)
  const [detail, setDetail] = createSignal<RunDetailState>()
  let loads = 0
  let complete = false
  let jobsComplete = false
  const view = await testRender(() => (
    <App data={githubDataFixture} operations={repositoryOperationsFixture}
      runDetail={detail()}
      onLoadRun={async (id) => {
        loads++
        setDetail({ id, resource: { status: "ready", value: {
          ...workflowRunFixture, id, status: complete ? "completed" : "in_progress", conclusion: complete ? "success" : "",
        } }, jobs: { status: "ready", value: { items: [{ ...workflowJobFixture,
          status: jobsComplete ? "completed" : "in_progress",
        }], page: 1, hasMore: false } } })
      }}
      onCloseRun={() => setDetail(undefined)}
    />
  ), { width: 110, height: 36 })
  const tick = async () => {
    for (const callback of [...timers.values()]) callback()
    await view.flush()
  }
  try {
    await view.flush()
    view.mockInput.pressKey("5")
    await view.flush()
    view.mockInput.pressEnter()
    await view.flush()
    expect(loads).toBe(1)
    expect(timers.size).toBe(1)
    await tick()
    expect(loads).toBe(2)
    view.mockInput.pressKey("1")
    await view.flush()
    expect(timers.size).toBe(0)
    await tick()
    expect(loads).toBe(2)
    view.mockInput.pressKey("5")
    await view.flush()
    expect(timers.size).toBe(1)
    complete = true
    await tick()
    expect(loads).toBe(3)
    expect(timers.size).toBe(1) // The run endpoint can finish before the jobs endpoint catches up.
    jobsComplete = true
    await tick()
    expect(loads).toBe(4)
    expect(timers.size).toBe(0)
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    complete = false
    view.mockInput.pressEnter()
    await view.flush()
    expect(timers.size).toBe(1)
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    expect(timers.size).toBe(0)
    view.mockInput.pressEnter()
    await view.flush()
    expect(timers.size).toBe(1)
    view.renderer.destroy()
    expect(timers.size).toBe(0)
  } finally {
    if (!view.renderer.isDestroyed) view.renderer.destroy()
    for (const timer of timers.keys()) clear(timer)
    start.mockRestore()
    stop.mockRestore()
  }
})

test("automatic retries deduplicate retained run errors until success or a manual retry", async () => {
  const notices: (() => void)[] = []
  const timeout = globalThis.setTimeout
  const start = spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
    const [callback, delay, ...rest] = args
    if (delay === 5000) notices.push(() => callback(...rest))
    return timeout(callback, delay, ...rest)
  }) as typeof setTimeout)
  const value = { ...workflowRunFixture, status: "in_progress", conclusion: "" }
  const jobs = { items: [workflowJobFixture], page: 1, hasMore: false }
  const [detail, setDetail] = createSignal<RunDetailState>()
  let failure: "resource" | "jobs" | undefined
  const refresh = async (id: number) => {
    const previousJobs = detail()?.jobs ?? { status: "ready" as const, value: jobs }
    setDetail({ id, resource: { status: "loading", phase: "load", value },
      jobs: { status: "loading", phase: "load", value: jobs } })
    await Promise.resolve()
    if (failure === "resource") {
      setDetail({ id, resource: { status: "error", phase: "load", message: "Run unavailable", value }, jobs: previousJobs })
      return
    }
    setDetail({ id, resource: { status: "ready", value }, jobs: { status: "loading", phase: "load", value: jobs } })
    await Promise.resolve()
    setDetail({ id, resource: { status: "ready", value }, jobs: failure === "jobs"
      ? { status: "error", phase: "load", message: "Jobs unavailable", value: jobs }
      : { status: "ready", value: jobs } })
  }
  const view = await testRender(() => (
    <App data={githubDataFixture} operations={repositoryOperationsFixture}
      runDetail={detail()} onLoadRun={refresh} onCloseRun={() => setDetail(undefined)} />
  ), { width: 110, height: 36 })
  try {
    await view.flush()
    view.mockInput.pressKey("5")
    await view.flush()
    view.mockInput.pressEnter()
    await view.flush()
    for (const part of ["resource", "jobs"] as const) {
      const before = notices.length
      failure = part
      await refresh(9812)
      await view.flush()
      expect(notices).toHaveLength(before + 1)
      notices.at(-1)!()
      await view.flush()
      await refresh(9812)
      await view.flush()
      expect(notices).toHaveLength(before + 1)
      view.mockInput.pressKey("r")
      await view.flush()
      expect(notices).toHaveLength(before + 2)
      failure = undefined
      await refresh(9812)
      await view.flush()
      failure = part
      await refresh(9812)
      await view.flush()
      expect(notices).toHaveLength(before + 3)
      failure = undefined
      await refresh(9812)
      await view.flush()
    }
  } finally {
    view.renderer.destroy()
    start.mockRestore()
  }
})
