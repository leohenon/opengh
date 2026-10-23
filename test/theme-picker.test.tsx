import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { defaultConfig, type Config } from "../src/config"
import { Settings } from "../src/ui/components/settings"
import { ThemeProvider } from "../src/ui/theme"
import type { ThemeName } from "../src/theme"
import { ThemePicker } from "../src/ui/components/theme-picker"
import { clickControl } from "./fixtures/mouse"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

describe("ThemePicker", () => {
  test("settings rows and chevrons share guarded changes and theme rows choose the clicked theme", async () => {
    const [config, setConfig] = createSignal<Config>({ ...defaultConfig, theme: "github" })
    const [saving, setSaving] = createSignal(false)
    let writes = 0
    let closes = 0
    const view = await testRender(() => <ThemeProvider name={config().theme}>
      <Settings config={config()} saving={saving()} onClose={() => { closes++ }}
        onChange={async (next) => { writes++; setConfig(next) }} />
    </ThemeProvider>, { width: 100, height: 32 })
    active.push(view)
    await view.flush()
    await clickControl(view, "setting-about-sidebar")
    expect(config().aboutSidebar).toBe("show")
    await clickControl(view, "setting-about-sidebar-previous")
    expect(config().aboutSidebar).toBe("auto")
    await clickControl(view, "setting-about-sidebar-next")
    expect(config().aboutSidebar).toBe("show")
    await clickControl(view, "setting-scrollbars")
    expect(config().showScrollbars).toBe(true)
    setSaving(true)
    await clickControl(view, "setting-scrollbars-next")
    expect(writes).toBe(4)
    setSaving(false)
    await clickControl(view, "setting-theme")
    await clickControl(view, "theme-dracula")
    expect(config().theme).toBe("dracula")
    expect(view.captureCharFrame()).toContain("Settings")
    await clickControl(view, "settings-close")
    expect(closes).toBe(1)
  })

  test("outside dismissal respects an in-flight theme save without a parent save lock", async () => {
    const [config, setConfig] = createSignal<Config>({ ...defaultConfig, theme: "github" })
    let closes = 0
    let finish!: () => void
    const save = new Promise<void>((resolve) => { finish = resolve })
    const view = await testRender(() => (
      <ThemeProvider name={config().theme}>
        <Settings config={config()} onClose={() => { closes++ }}
          onChange={async (next) => { await save; setConfig(next) }} />
      </ThemeProvider>
    ), { width: 100, height: 32 })
    active.push(view)
    await view.flush()
    view.mockInput.pressEnter()
    await view.flush()
    await view.mockInput.typeText("nord")
    view.mockInput.pressEnter()
    await view.flush()
    await view.mockMouse.click(0, 0)
    await view.flush()
    expect(closes).toBe(0)
    expect(view.captureCharFrame()).toContain("Themes")
    expect(config().theme).toBe("github")
    await clickControl(view, "theme-back")
    expect(view.captureCharFrame()).toContain("Themes")

    finish()
    await view.flush()
    expect(config().theme).toBe("nord")
    expect(view.captureCharFrame()).toContain("Settings")
    expect(view.captureCharFrame()).not.toContain("Themes")
    await view.mockMouse.click(0, 0)
    await view.flush()
    expect(closes).toBe(1)
  })

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
    await clickControl(view, "theme-back")
    expect(cancelled).toBe(2)
  })
})
