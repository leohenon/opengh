import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, Match, Switch } from "solid-js"
import { defaultConfig } from "../src/config"
import { Help } from "../src/ui/components/help"
import { Settings } from "../src/ui/components/settings"

test("popups have no Back buttons and retain outside-click dismissal", async () => {
  const [screen, setScreen] = createSignal("help")
  const view = await testRender(() => (
    <Switch>
      <Match when={screen() === "help"}>
        <Help view="diff" tabCount={5} onClose={() => setScreen("settings")} />
      </Match>
      <Match when={screen() === "settings"}>
        <Settings config={defaultConfig} onChange={async () => {}} onClose={() => setScreen("done")} />
      </Match>
      <Match when={screen() === "done"}><text>Returned</text></Match>
    </Switch>
  ), { width: 60, height: 14 })
  try {
    await view.flush()
    expect(view.captureCharFrame()).toContain("close diff")
    expect(view.renderer.root.findDescendantById("help-back")).toBeUndefined()
    await view.mockMouse.click(0, 0); await view.flush()
    expect(view.captureCharFrame()).toContain("Settings")
    expect(view.renderer.root.findDescendantById("settings-close")).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("Close")
    await view.mockMouse.click(0, 0); await view.flush()
    expect(view.captureCharFrame()).toContain("Returned")
  } finally { view.renderer.destroy() }
})
