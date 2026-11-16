import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "../src/config"
import { App } from "../src/ui/app"
import { ThemeProvider } from "../src/ui/theme"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { waitForText } from "./fixtures/wait"

test("clicking a CI job link opens its parent Actions run without launching a browser", async () => {
  const url = `${githubDataFixture.repo.url}/actions/runs/56/job/78?check_suite_focus=true`
  const opened: string[] = []
  const runs: number[] = []
  const document = githubDataFixture.documents.value![0]!
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <App
          data={{
            ...githubDataFixture,
            documents: { status: "ready", value: [{ ...document, resource: { status: "ready", value: `[CI job](${url})` } }] },
          }}
          operations={repositoryOperationsFixture}
          config={{ ...defaultConfig, showStatusBarHints: false }}
          onLoadRun={async (id) => {
            runs.push(id)
          }}
          onOpenUrl={async (target) => {
            opened.push(target)
          }}
        />
      </ThemeProvider>
    ),
    { width: 100, height: 30 },
  )
  try {
    await waitForText(view, "CI job")
    let cell: { x: number; y: number } | undefined
    for (let y = 0; y < view.renderer.height && !cell; y++)
      for (let x = 0; x < view.renderer.width; x++)
        if (view.renderer.getLinkAt(x, y) === url) {
          cell = { x, y }
          break
        }
    expect(cell).toBeDefined()
    await view.mockMouse.click(cell!.x, cell!.y)
    await view.flush()
    expect(runs).toEqual([56])
    expect(opened).toEqual([])
  } finally {
    view.renderer.destroy()
  }
})
