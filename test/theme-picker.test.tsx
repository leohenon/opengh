import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { ThemeName } from "../src/theme"
import { ThemePicker } from "../src/ui/components/theme-picker"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

describe("ThemePicker", () => {
  test("filters, previews, and confirms a theme", async () => {
    let preview: ThemeName = "opengh"
    let selected: ThemeName | undefined
    const view = await testRender(
      () => (
        <ThemePicker
          current="opengh"
          onPreview={(theme) => { preview = theme }}
          onCancel={() => {}}
          onSelect={async (theme) => { selected = theme }}
        />
      ),
      { width: 80, height: 45 },
    )
    active.push(view)
    await view.flush()
    expect(view.captureCharFrame()).toContain("opengh (default)")

    await view.mockInput.typeText("drac")
    await view.flush()
    expect(view.captureCharFrame()).toContain("dracula")
    expect(String(preview)).toBe("dracula")

    view.mockInput.pressEnter()
    await Bun.sleep(0)
    await view.flush()
    expect(selected).toBe("dracula")
  })

  test("cancels previews and reports save failures", async () => {
    let preview: ThemeName = "github"
    let cancelled = 0
    const view = await testRender(
      () => (
        <ThemePicker
          current="github"
          onPreview={(theme) => { preview = theme }}
          onCancel={() => { cancelled++ }}
          onSelect={async () => { throw new Error("Theme config is read-only") }}
        />
      ),
      { width: 80, height: 20 },
    )
    active.push(view)
    await view.flush()

    await view.mockInput.typeText("nord")
    view.mockInput.pressEnter()
    await Bun.sleep(0)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Theme config is read-only")
    expect(preview).toBe("github")

    view.mockInput.pressEscape()
    await Bun.sleep(30)
    expect(cancelled).toBe(1)
  })
})
