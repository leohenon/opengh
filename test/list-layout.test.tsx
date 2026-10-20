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
        const row = frame.split("\n").find((line) => line.includes("Long title"))!
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
