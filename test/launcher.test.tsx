import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { clickControl } from "./fixtures/mouse"
import {
  LoadingRepository,
  RepositoryLoadError,
  RepositoryPicker,
} from "../src/ui/launcher"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

describe("repository launcher", () => {
  test("shows repository loading without placeholder data", async () => {
    const view = await testRender(() => <LoadingRepository repository="cli/cli" />, {
      width: 80,
      height: 24,
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
      { width: 80, height: 24 },
    )
    active.push(view)
    await view.flush()
    const frame = view.captureCharFrame()
    expect(frame).toContain("Repository unavailable")
    expect(frame).toContain("cli/cli")
    expect(frame).toContain("API unavailable")
    expect(frame).toContain("r retry · q quit")
    expect(frame).not.toContain("╭")

    await view.mockMouse.click(1, 1)
    view.mockInput.pressKey("r")
    view.mockInput.pressKey("q")
    await view.flush()
    expect(retries).toBe(1)
    expect(quits).toBe(1)
    await clickControl(view, "repository-retry")
    await clickControl(view, "repository-quit")
    expect(retries).toBe(2)
    expect(quits).toBe(2)
  })

  test("opens a repository entered by the user", async () => {
    let opened = ""
    const view = await testRender(
      () => <RepositoryPicker recent={[]} onOpen={(repository) => opened = repository} />,
      { width: 80, height: 24 },
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

  test("shows twenty recent repositories and searches beyond the visible list", async () => {
    let opened = ""
    const recent = Array.from({ length: 30 }, (_, index) => `owner/repository-${index + 1}`)
    const view = await testRender(
      () => <RepositoryPicker recent={recent} onOpen={(repository) => opened = repository} />,
      { width: 100, height: 40 },
    )
    active.push(view)
    await view.flush()
    const frame = view.captureCharFrame()
    expect(frame).toContain("repository-20")
    expect(frame).not.toContain("repository-21")
    await view.mockInput.typeText("repository-30")
    view.mockInput.pressEnter()
    await view.flush()
    expect(opened).toBe("owner/repository-30")
  })

  test("opens a selected recent repository with arrow keys", async () => {
    let opened = ""
    const view = await testRender(
      () => <RepositoryPicker recent={["anomalyco/opentui", "cli/cli"]} onOpen={(repository) => opened = repository} />,
      { width: 80, height: 24 },
    )
    active.push(view)
    await view.flush()
    view.mockInput.pressArrow("down")
    view.mockInput.pressEnter()
    await view.flush()
    expect(opened).toBe("cli/cli")
  })

  test("opens a recent repository by clicking its row", async () => {
    let opened = ""
    const view = await testRender(
      () => <RepositoryPicker recent={["anomalyco/opentui", "cli/cli"]} onOpen={(repository) => opened = repository} />,
      { width: 80, height: 24 },
    )
    active.push(view)
    await view.flush()
    const row = view.captureCharFrame().split("\n").findIndex((line) => line.includes("cli / cli"))
    expect(row).toBeGreaterThan(-1)
    await view.mockMouse.click(40, row)
    await view.flush()
    expect(opened).toBe("cli/cli")
  })

  test("typing a number searches instead of opening a repository", async () => {
    let opened = ""
    const view = await testRender(
      () => <RepositoryPicker recent={["anomalyco/opentui"]} onOpen={(repository) => opened = repository} />,
      { width: 80, height: 24 },
    )
    active.push(view)
    await view.flush()
    view.mockInput.pressKey("1")
    await view.flush()
    expect(opened).toBe("")
    expect(view.captureCharFrame()).toContain("1")
  })

  test("shows validation errors directly beneath the input", async () => {
    const view = await testRender(
      () => <RepositoryPicker recent={[]} onOpen={() => {}} />,
      { width: 80, height: 24 },
    )
    active.push(view)
    await view.flush()
    await view.mockInput.typeText("invalid")
    view.mockInput.pressEnter()
    await view.flush()
    expect(view.captureCharFrame()).toContain("× Enter owner/repository or a GitHub URL")
  })
})
