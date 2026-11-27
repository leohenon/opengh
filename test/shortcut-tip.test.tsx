import { expect, spyOn, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { defaultConfig } from "../src/config"
import type { RepositoryData } from "../src/repository-state"
import { App } from "../src/ui/app"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

test("the shortcut tip starts its 45-second timer only when it can be displayed", async () => {
  const [data, setData] = createSignal<RepositoryData>({ ...githubDataFixture, documents: { status: "loading", phase: "load" } })
  const original = globalThis.setTimeout
  const expirations: (() => void)[] = []
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
    const [expire, delay, ...rest] = args
    if (delay === 45_000 && expire.name === "dismissShortcutTip") expirations.push(() => expire(...rest))
    return original(...args)
  }) as typeof setTimeout)
  let shown = 0
  const view = await testRender(
    () => (
      <App
        data={data}
        operations={repositoryOperationsFixture}
        config={{ ...defaultConfig, keybindings: { "global.settings": [";"] } }}
        onShortcutTipShown={() => shown++}
      />
    ),
    { width: 120, height: 24 },
  )
  try {
    await view.flush()
    expect(shown).toBe(0)
    expect(expirations).toHaveLength(0)
    view.resize(30, 24)
    setData(githubDataFixture)
    await view.flush()
    expect(shown).toBe(0)
    expect(expirations).toHaveLength(0)

    view.resize(120, 24)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Tip: Turn on Shortcut hints in Settings (;)")
    expect(shown).toBe(1)
    expect(expirations).toHaveLength(1)
    expirations[0]!()
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Tip: Turn on Shortcut hints")
    expect(shown).toBe(1)
  } finally {
    view.renderer.destroy()
    timers.mockRestore()
  }
})

test("opening Settings dismisses the shortcut tip for the rest of the session", async () => {
  let shown = 0
  const view = await testRender(
    () => <App data={githubDataFixture} operations={repositoryOperationsFixture} onShortcutTipShown={() => shown++} />,
    { width: 120, height: 24 },
  )
  try {
    await view.flush()
    expect(view.captureCharFrame()).toContain("Tip: Turn on Shortcut hints in Settings (,)")
    view.mockInput.pressKey(",")
    await view.flush()
    expect(view.renderer.root.findDescendantById("status-tip")).toBeUndefined()
    view.mockInput.pressEscape()
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Tip: Turn on Shortcut hints")
    expect(shown).toBe(1)
  } finally {
    view.renderer.destroy()
  }
})
