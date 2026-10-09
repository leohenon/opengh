import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { Toast } from "../src/ui/components/toast"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

describe("Toast", () => {
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
      { width: 80, height: 24, useThread: false },
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
