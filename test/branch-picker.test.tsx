import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { Paginated } from "../src/models"
import type { ResourceState } from "../src/repository-state"
import { BranchPicker } from "../src/ui/components/branch-picker"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

const readyBranches = (items: string[], hasMore = false): ResourceState<Paginated<string>> => ({
  status: "ready",
  value: { items, page: 1, hasMore },
})

describe("BranchPicker", () => {
  test("pins and selects the current branch when opened", async () => {
    const view = await testRender(
      () => (
        <BranchPicker
          branches={readyBranches(["next", "feature/search"])}
          current="main"
          showScrollbar={false}
          onSelect={() => {}}
          onLoadMore={async () => {}}
          onRetry={() => {}}
          onClose={() => {}}
        />
      ),
      { width: 100, height: 28 },
    )
    active.push(view)
    await view.flush()

    const lines = view.captureCharFrame().split("\n")
    const currentIndex = lines.findIndex((line) => line.includes("main") && line.includes("✓ current"))
    const nextIndex = lines.findIndex((line) => line.includes("next"))
    expect(currentIndex).toBeGreaterThan(-1)
    expect(currentIndex).toBeLessThan(nextIndex)
    expect(lines[currentIndex]).toContain("›")
  })

  test("loads and retries from the final row without hiding loaded branches", async () => {
    const [branches, setBranches] = createSignal<ResourceState<Paginated<string>>>(
      readyBranches(["main", "next"], true),
    )
    let loads = 0
    let selected = ""
    const view = await testRender(
      () => (
        <BranchPicker
          branches={branches()}
          current="main"
          showScrollbar={false}
          onSelect={(branch) => { selected = branch }}
          onLoadMore={async () => {
            loads++
            setBranches({ status: "loading", phase: "pagination", value: branches().value })
          }}
          onRetry={() => {}}
          onClose={() => {}}
        />
      ),
      { width: 100, height: 28 },
    )
    active.push(view)
    await view.flush()

    expect(view.captureCharFrame()).toContain("Load more branches…")
    view.mockInput.pressArrow("down")
    view.mockInput.pressArrow("down")
    view.mockInput.pressEnter()
    await view.flush()

    const loading = view.captureCharFrame()
    expect(loads).toBe(1)
    expect(selected).toBe("")
    expect(loading).toContain("main")
    expect(loading).toContain("next")
    expect(loading).toContain("Loading more branches…")

    view.mockInput.pressEnter()
    await view.flush()
    expect(loads).toBe(1)

    setBranches({
      status: "error",
      phase: "pagination",
      message: "Unavailable",
      value: { items: ["main", "next"], page: 1, hasMore: true },
    })
    await view.flush()
    expect(view.captureCharFrame()).toContain("Load failed — enter to retry")

    view.mockInput.pressEnter()
    await view.flush()
    expect(loads).toBe(2)
  })

  test("retries a failed branch refresh from inside the picker", async () => {
    let retries = 0
    const view = await testRender(
      () => (
        <BranchPicker
          branches={{
            status: "error",
            phase: "load",
            message: "Unavailable",
            value: { items: ["main"], page: 1, hasMore: false },
          }}
          current="main"
          showScrollbar={false}
          onSelect={() => {}}
          onLoadMore={async () => {}}
          onRetry={() => { retries++ }}
          onClose={() => {}}
        />
      ),
      { width: 100, height: 28 },
    )
    active.push(view)
    await view.flush()

    const frame = view.captureCharFrame()
    expect(frame).toContain("main")
    expect(frame).toContain("Refresh failed — enter to retry")
    expect(frame).toContain("enter")

    view.mockInput.pressArrow("down")
    view.mockInput.pressEnter()
    expect(retries).toBe(1)
  })

  test("preserves the query and selected branch when pages append", async () => {
    const [branches, setBranches] = createSignal<ResourceState<Paginated<string>>>(
      readyBranches(["main", "next", "feature"], true),
    )
    const view = await testRender(
      () => (
        <BranchPicker
          branches={branches()}
          current="main"
          showScrollbar={false}
          onSelect={() => {}}
          onLoadMore={async () => {}}
          onRetry={() => {}}
          onClose={() => {}}
        />
      ),
      { width: 100, height: 28 },
    )
    active.push(view)
    await view.flush()

    await view.mockInput.typeText("e")
    view.mockInput.pressArrow("down")
    await view.flush()
    setBranches(readyBranches(["main", "next", "feature", "echo"], false))
    await view.flush()

    const frame = view.captureCharFrame()
    expect(frame).toContain("echo")
    expect(frame.split("\n").find((line) => line.includes("feature"))).toContain("›")
    expect(frame).not.toContain("main")
  })

  test("keeps load-more available when a query has no loaded matches", async () => {
    let loads = 0
    const view = await testRender(
      () => (
        <BranchPicker
          branches={readyBranches(["main", "next"], true)}
          current="main"
          showScrollbar={false}
          onSelect={() => {}}
          onLoadMore={async () => { loads++ }}
          onRetry={() => {}}
          onClose={() => {}}
        />
      ),
      { width: 100, height: 28 },
    )
    active.push(view)
    await view.flush()

    await view.mockInput.typeText("zzz")
    await view.flush()
    const frame = view.captureCharFrame()
    expect(frame).toContain("No matches loaded — enter to load more")
    expect(frame).toContain("enter")

    view.mockInput.pressEnter()
    await view.flush()
    expect(loads).toBe(1)
  })

})
