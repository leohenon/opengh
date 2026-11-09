import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { LoadingText } from "../src/ui/components/loading-text"
import { MotionProvider } from "../src/ui/motion"

test("reduced motion preserves delayed loading feedback and toggles animation live", async () => {
  const [reduced, setReduced] = createSignal(true)
  const view = await testRender(() => (
    <MotionProvider reduced={reduced()}>
      <LoadingText text="Loading…" delay={80} />
    </MotionProvider>
  ), { width: 30, height: 3 })
  const dots = () => view.captureCharFrame().match(/Loading([. ]{3})/)?.[1]

  try {
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Loading")
    await Bun.sleep(100)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Loading...")
    await Bun.sleep(170)
    await view.flush()
    expect(dots()).toBe("...")

    setReduced(false)
    await view.flush()
    for (let attempt = 0; attempt < 15 && dots() === "..."; attempt++) {
      await Bun.sleep(40)
      await view.flush()
    }
    expect(dots()).not.toBe("...")

    setReduced(true)
    await view.flush()
    expect(dots()).toBe("...")
    await Bun.sleep(170)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Loading...")
  } finally {
    view.renderer.destroy()
  }
})

test("refresh text animates dots in a fixed footer and respects reduced motion", async () => {
  const { StatusBar } = await import("../src/ui/components/status-bar")
  const [reduced, setReduced] = createSignal(false)
  const [kind, setKind] = createSignal<"refreshing" | undefined>("refreshing")
  const [error, setError] = createSignal<string>()
  const view = await testRender(() => (
    <MotionProvider reduced={reduced()}>
      <box height={4} flexDirection="column">
        <box flexGrow={1}><text>Content</text></box>
        <StatusBar kind={kind()} error={error()} hint="q quit" />
      </box>
    </MotionProvider>
  ), { width: 40, height: 4 })
  const footer = () => view.captureCharFrame().split("\n")[3]!

  try {
    await view.flush()
    expect(footer()).not.toContain("Refreshing")
    await Bun.sleep(230)
    await view.flush()
    expect(footer()).toContain("Refreshing")
    expect(footer()).not.toMatch(/[◐◓◑◒━─■]/)
    const hintColumn = footer().indexOf("q quit")
    const first = footer()
    await Bun.sleep(420)
    await view.flush()
    expect(footer()).not.toBe(first)
    expect(footer().indexOf("q quit")).toBe(hintColumn)

    setReduced(true)
    await view.flush()
    expect(footer()).toContain("Refreshing... · q quit")
    const still = footer()
    await Bun.sleep(170)
    await view.flush()
    expect(footer()).toBe(still)
    setError("Refresh failed")
    await view.flush()
    expect(footer()).toContain("× Refresh failed")
    expect(footer()).not.toContain("Refreshing")
    setError(undefined)
    setKind(undefined)
    await view.flush()
    expect(footer()).not.toContain("Refreshing")
    expect(footer()).toContain("q quit")
    expect(view.captureCharFrame().split("\n")[0]).toContain("Content")
  } finally {
    view.renderer.destroy()
  }
})
