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
    expect(view.captureCharFrame()).toContain("cli/cli")
    expect(view.captureCharFrame()).not.toContain("Loading…")
    await Bun.sleep(210)
    await view.flush()
    const frame = view.captureCharFrame()
    expect(frame).toContain("Loading…")
    expect(frame).not.toContain("anomalyco/opentui")
  })

  test("shows the borderless load failure and preserves retry and quit", async () => {
    let retries = 0
    let quits = 0
    const view = await testRender(
      () => (
        <RepositoryLoadError
          repository="cli/cli"
          message="API unavailable"
          onRetry={() => retries++}
          onQuit={() => quits++}
        />
      ),
      { width: 80, height: 24, useThread: false },
    )
    active.push(view)
    await view.flush()
    const frame = view.captureCharFrame()
    expect(frame).toContain("Repository unavailable")
    expect(frame).toContain("cli/cli")
    expect(frame).toContain("API unavailable")
    expect(frame).toContain("r retry · q quit")
    expect(frame).not.toContain("╭")

    view.mockInput.pressKey("r")
    view.mockInput.pressKey("q")
    await view.flush()
    expect(retries).toBe(1)
    expect(quits).toBe(1)
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
    expect(view.captureCharFrame()).toContain("owner/repository or GitHub URL")
    expect(view.captureCharFrame()).not.toContain("Recent repositories")
    expect(view.captureCharFrame()).not.toContain("No recently opened repositories")
    await view.mockInput.typeText("cli/cli")
    view.mockInput.pressEnter()
    await view.flush()
    expect(opened).toBe("cli/cli")
  })

  test("shows at most five recent repositories", async () => {
    const recent = Array.from({ length: 6 }, (_, index) => `owner/repository-${index + 1}`)
    const view = await testRender(
      () => <RepositoryPicker recent={recent} onOpen={() => {}} />,
      { width: 80, height: 24, useThread: false },
    )
    active.push(view)
    await view.flush()
    const frame = view.captureCharFrame()
    expect(frame).toContain("repository-5")
    expect(frame).not.toContain("repository-6")
  })

  test("opens a selected recent repository with arrow keys", async () => {
    let opened = ""
    const view = await testRender(
      () => <RepositoryPicker recent={["anomalyco/opentui", "cli/cli"]} onOpen={(repository) => opened = repository} />,
      { width: 80, height: 24, useThread: false },
    )
    active.push(view)
    await view.flush()
    view.mockInput.pressArrow("down")
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

  test("shows validation errors directly beneath the input", async () => {
    const view = await testRender(
      () => <RepositoryPicker recent={[]} onOpen={() => {}} />,
      { width: 80, height: 24, useThread: false },
    )
    active.push(view)
    await view.flush()
    await view.mockInput.typeText("invalid")
    view.mockInput.pressEnter()
    await view.flush()
    expect(view.captureCharFrame()).toContain("× Enter owner/repository or a GitHub URL")
  })
})
