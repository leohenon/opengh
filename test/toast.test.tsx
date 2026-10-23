import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { Toast } from "../src/ui/components/toast"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

describe("Toast", () => {
  test("fits a short title without a minimum width and stays within the terminal", async () => {
    const view = await testRender(
      () => <Toast title="Config reloaded" message="" onDismiss={() => {}} />,
      { width: 80, height: 24 },
    )
    active.push(view)
    await view.flush()
    const toast = view.renderer.root.getChildren().find((child) => child.zIndex === 150)
    expect(toast?.width).toBe(20)
    expect(view.captureCharFrame()).toContain("Config reloaded")

    view.resize(18, 12)
    await view.flush()
    expect(toast?.width).toBe(14)
  })

  test("auto-dismisses without a visible countdown or close button", async () => {
    const [visible, setVisible] = createSignal(true)
    const view = await testRender(() => <box width={80} height={24}>
      <Show when={visible()}><Toast title="Text copied to clipboard" message="" tone="success" duration={200} onDismiss={() => setVisible(false)} /></Show>
    </box>, { width: 80, height: 24 })
    active.push(view)
    await view.flush()
    const frame = view.captureCharFrame()
    expect(view.renderer.root.findDescendantById("toast")!.getChildrenCount()).toBe(2)
    expect(view.renderer.root.findDescendantById("toast-countdown")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("toast-dismiss")).toBeUndefined()
    expect(frame).not.toContain("×")
    await Bun.sleep(120)
    await view.flush()
    expect(view.captureCharFrame()).toBe(frame)
    await Bun.sleep(100)
    await view.flush()
    expect(view.renderer.root.findDescendantById("toast")).toBeUndefined()
  })

  test("appears without a backdrop and dismisses after its duration", async () => {
    const [visible, setVisible] = createSignal(true)
    const view = await testRender(
      () => (
        <box width={80} height={24}>
          <text>Underlying content</text>
          <Show when={visible()}>
            <Toast title="Refresh failed" message="API unavailable" duration={20} onDismiss={() => setVisible(false)} />
          </Show>
        </box>
      ),
      { width: 80, height: 24 },
    )
    active.push(view)
    await view.flush()
    const frame = view.captureCharFrame()
    expect(frame).toContain("Underlying content")
    expect(frame).toContain("Refresh failed")
    expect(frame).toContain("API unavailable")

    await Bun.sleep(30)
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Refresh failed")
  })
})
