import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { waitForText } from "./fixtures/wait"
import type { UpdateNotice } from "../src/update-check"
import { Help } from "../src/ui/components/help"
import { StatusBar, type StatusKind } from "../src/ui/components/status-bar"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { App } from "../src/ui/app"
import { defaultConfig } from "../src/config"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const notice: UpdateNotice = { currentVersion: "1.0.0", latestVersion: "2.0.0", instruction: "bun install --global opengh" }

test("footer adds a right-aligned update only in spare space and reacts to resizing", async () => {
  const [update, setUpdate] = createSignal<UpdateNotice>()
  const [kind, setKind] = createSignal<StatusKind>()
  const [error, setError] = createSignal<string>()
  const hint = "enter open · ↑/↓ select · ? help"
  const view = await testRender(() => <StatusBar context="Results" hint={hint} updateNotice={update()} kind={kind()} error={error()} />, {
    width: 100,
    height: 1,
  })
  try {
    await view.flush()
    const normal = view.captureCharFrame()
    setUpdate(notice)
    await view.flush()
    const wide = view.captureCharFrame().split("\n")[0]!
    expect(wide).toContain(`Results · ${hint}`)
    expect(wide.trimEnd()).toEndWith("↑ v2.0.0 available")
    expect(wide.indexOf("↑ v2.0.0 available")).toBe(100 - 2 - Bun.stringWidth("↑ v2.0.0 available"))
    setUpdate(undefined)
    view.resize(42, 1)
    await view.flush()
    const narrow = view.captureCharFrame()
    setUpdate(notice)
    await view.flush()
    expect(view.captureCharFrame()).toBe(narrow)
    for (const width of [20, 32, 48, 60]) {
      setUpdate(undefined)
      view.resize(width, 1)
      await view.flush()
      const baseline = view.captureCharFrame().split("\n")[0]!.trimEnd()
      setUpdate(notice)
      await view.flush()
      expect(view.captureCharFrame().split("\n")[0]!.trimEnd()).toStartWith(baseline)
    }
    view.resize(100, 1)
    await view.flush()
    expect(view.captureCharFrame()).toContain("↑ v2.0.0 available")
    setKind("refreshing")
    await view.flush()
    expect(view.captureCharFrame()).toContain("↑ v2.0.0 available")
    await waitForText(view, "Refreshing")
    expect(view.captureCharFrame()).not.toContain("available")
    setKind(undefined)
    setError("Offline")
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("available")
    setError(undefined)
    setUpdate(undefined)
    await view.flush()
    expect(view.captureCharFrame()).toBe(normal)
  } finally {
    view.renderer.destroy()
  }
})

test("App shows the update in the footer, not clickable; help has the instructions", async () => {
  const view = await testRender(
    () => (
      <App
        data={githubDataFixture}
        operations={repositoryOperationsFixture}
        config={{ ...defaultConfig, showStatusBarHints: true }}
        updateNotice={notice}
      />
    ),
    { width: 160, height: 35 },
  )
  try {
    await view.flush()
    const footer = view.captureCharFrame().split("\n")[34]!
    const x = footer.indexOf("↑ v2.0.0 available")
    expect(x).toBeGreaterThan(0)
    await view.mockMouse.click(x, 34)
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Installed: v1.0.0")
    view.mockInput.pressKey("?")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Installed: v1.0.0")
    expect(view.captureCharFrame()).toContain(notice.instruction)
  } finally {
    view.renderer.destroy()
  }
})

test("long help update instructions remain reachable by scrolling", async () => {
  const instruction = "Upgrade instructions\n" + "A long command argument that must wrap\n".repeat(15) + "FINAL-UPGRADE-STEP"
  const view = await testRender(
    () => (
      <KeybindingsProvider>
        <Help view="commits" onClose={() => {}} updateNotice={{ ...notice, instruction }} />
      </KeybindingsProvider>
    ),
    { width: 24, height: 12 },
  )
  try {
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("FINAL-UPGRADE-STEP")
    let reached = false
    for (let i = 0; i < 60 && !reached; i++) {
      view.mockInput.pressKey("j")
      await view.flush()
      reached = view.captureCharFrame().replace(/\s/g, "").includes("FINAL-UPGRADE-STEP")
    }
    expect(reached).toBe(true)
  } finally {
    view.renderer.destroy()
  }
})

test("help update details wrap on narrow terminals and react without changing ordinary help", async () => {
  const [update, setUpdate] = createSignal<UpdateNotice>()
  const view = await testRender(
    () => (
      <KeybindingsProvider>
        <Help view="commits" onClose={() => {}} updateNotice={update()} />
      </KeybindingsProvider>
    ),
    { width: 100, height: 45 },
  )
  try {
    await view.flush()
    const ordinary = view.captureCharFrame()
    setUpdate(notice)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Installed: v1.0.0")
    expect(view.captureCharFrame()).toContain("Latest: v2.0.0")
    expect(view.captureCharFrame()).toContain(notice.instruction)
    view.resize(24, 16)
    await view.flush()
    const narrow = view.captureCharFrame()
    expect(narrow).toContain("Installed:")
    expect(narrow).toContain("Latest: v2.0.0")
    expect(narrow).not.toContain(notice.instruction)
    expect(narrow.replace(/\s/g, "")).toContain(notice.instruction.replace(/\s/g, ""))
    setUpdate({ ...notice, latestVersion: "3.0.0", instruction: "brew upgrade opengh" })
    await view.flush()
    expect(view.captureCharFrame()).toContain("Latest: v3.0.0")
    expect(view.captureCharFrame().replace(/\s/g, "")).toContain("brewupgradeopengh")
    setUpdate(undefined)
    view.resize(100, 45)
    await view.flush()
    expect(view.captureCharFrame()).toBe(ordinary)
  } finally {
    view.renderer.destroy()
  }
})
