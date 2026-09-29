import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import {
  LoadingRepository,
  RepositoryLoadError,
  RepositoryPicker,
} from "../src/launcher"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

describe("repository launcher", () => {
  test("shows repository loading without placeholder data", async () => {
    const view = await testRender(() => <LoadingRepository repository="cli/cli" />, {
      width: 80,
      height: 24,
      useThread: false,
    })
    active.push(view)
    await view.flush()
    const frame = view.captureCharFrame()
    expect(frame).toContain("cli/cli")
    expect(frame).toContain("Loading repository data")
    expect(frame).not.toContain("anomalyco/opentui")
  })

  test("shows load failures and retries", async () => {
    let retries = 0
    const view = await testRender(
      () => <RepositoryLoadError repository="cli/cli" message="API unavailable" onRetry={() => retries++} />,
      { width: 80, height: 24, useThread: false },
    )
    active.push(view)
    await view.flush()
    expect(view.captureCharFrame()).toContain("API unavailable")
    view.mockInput.pressKey("r")
    await view.flush()
    expect(retries).toBe(1)
  })

  test("opens a repository entered by the user", async () => {
    let opened = ""
    const view = await testRender(
      () => <RepositoryPicker recent={[]} onOpen={(repository) => opened = repository} />,
      { width: 80, height: 24, useThread: false },
    )
    active.push(view)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Open a GitHub repository")
    await view.mockInput.typeText("cli/cli")
    view.mockInput.pressEnter()
    await view.flush()
    expect(opened).toBe("cli/cli")
  })

  test("opens a recent repository by number", async () => {
    let opened = ""
    const view = await testRender(
      () => <RepositoryPicker recent={["anomalyco/opentui"]} onOpen={(repository) => opened = repository} />,
      { width: 80, height: 24, useThread: false },
    )
    active.push(view)
    await view.flush()
    view.mockInput.pressKey("1")
    await view.flush()
    expect(opened).toBe("anomalyco/opentui")
  })
})
