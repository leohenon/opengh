import { expect, test } from "bun:test"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "../src/config"
import { App } from "../src/ui/app"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

test("list rows truncate the right edge and resize without horizontal overflow", async () => {
  const data = structuredClone(githubDataFixture)
  const title = `Long title ${"漢字 🧑‍💻 ".repeat(35)}OFFSCREEN_END`
  const metadata = `Long author ${"name ".repeat(50)}OFFSCREEN_END`
  data.currentBranch = `topic/${"long-branch-".repeat(20)}OFFSCREEN_END`
  data.commits.value!.items[0]!.message = title
  data.commits.value!.items[0]!.author = metadata
  data.issues.open.value!.items[0]!.title = title
  data.issues.open.value!.items[0]!.author = metadata
  data.pulls.open.value!.items[0]!.title = title
  data.pulls.open.value!.items[0]!.author = metadata
  data.runs.value!.items[0]!.title = title
  data.runs.value!.items[0]!.name = metadata
  const view = await testRender(() => (
    <App data={data} operations={repositoryOperationsFixture} config={{ ...defaultConfig, showScrollbars: true }} />
  ), { width: 100, height: 26 })
  try {
    await view.flush()
    for (const width of [100, 40, 26, 59, 60, 100]) {
      view.resize(width, 26)
      for (const key of ["2", "3", "4", "5"]) {
        view.mockInput.pressKey(key)
        await view.flush()
        const frame = view.captureCharFrame()
        const row = frame.split("\n").find((line) => line.includes("Long tit"))!
        expect(row).toBeDefined()
        expect(row).toContain("...")
        expect(frame).not.toContain("OFFSCREEN_END")
        expect(frame).not.toContain("�")
        if (key === "2") {
          expect(frame.includes(data.commits.value!.items[0]!.sha.slice(0, 7))).toBe(width >= 60)
        }
        const inspect = (renderable: Renderable) => {
          if (!renderable.visible) return
          if (renderable instanceof ScrollBoxRenderable) {
            expect(renderable.scrollWidth).toBeLessThanOrEqual(renderable.viewport.width)
          }
          for (const child of renderable.getChildren()) inspect(child)
        }
        inspect(view.renderer.root)
      }
    }
  } finally { view.renderer.destroy() }
})


test("list rows keep metadata, selection, and half-page navigation correct through resizes", async () => {
  const data = structuredClone(githubDataFixture)
  data.commits.value!.items = Array.from({ length: 30 }, (_, index) => ({
    ...data.commits.value!.items[0]!,
    sha: index.toString(16).padStart(40, "0"),
    message: `list row ${index.toString().padStart(2, "0")}`,
    author: "octocat",
  }))
  data.commits.value!.hasMore = false
  const view = await testRender(() => (
    <App data={data} operations={repositoryOperationsFixture} config={defaultConfig} />
  ), { width: 100, height: 20 })
  const rows = () => view.captureCharFrame().split("\n")
  try {
    await view.flush()
    view.mockInput.pressKey("2")
    await view.flush()
    view.mockInput.pressKey("g")
    await view.flush()
    const first = rows().findIndex((row) => row.includes("list row 00"))
    const second = rows().findIndex((row) => row.includes("list row 01"))
    expect(second - first).toBe(3)
    expect(rows()[first + 1]).toContain("octocat committed")
    expect(rows()[first]?.indexOf("list row")).toBe(4)
    const visibleRows = rows().filter((row) => row.includes("list row")).length
    const halfPage = Math.max(1, Math.floor(visibleRows / 2))
    view.mockInput.pressKey("d")
    await view.flush()
    expect(rows().find((row) => row.includes("▌"))).toContain(`list row ${halfPage.toString().padStart(2, "0")}`)
    view.mockInput.pressKey("G")
    await view.flush()
    expect(rows().find((row) => row.includes("▌"))).toContain("list row 29")
    expect(view.captureCharFrame()).toContain("octocat committed")
    for (const width of [40, 100]) {
      view.resize(width, 24)
      await view.flush()
      expect(rows().find((row) => row.includes("▌"))).toContain("list row 29")
    }
  } finally {
    view.renderer.destroy()
  }
})
