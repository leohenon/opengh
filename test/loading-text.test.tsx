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
  const glyph = () => view.captureCharFrame().match(/[◐◓◑◒]/)?.[0]

  try {
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Loading…")
    await Bun.sleep(100)
    await view.flush()
    expect(view.captureCharFrame()).toContain("◐ Loading…")
    await Bun.sleep(170)
    await view.flush()
    expect(glyph()).toBe("◐")

    setReduced(false)
    await view.flush()
    for (let attempt = 0; attempt < 8 && glyph() === "◐"; attempt++) {
      await Bun.sleep(40)
      await view.flush()
    }
    expect(glyph()).not.toBe("◐")

    setReduced(true)
    await view.flush()
    expect(glyph()).toBe("◐")
    await Bun.sleep(170)
    await view.flush()
    expect(view.captureCharFrame()).toContain("◐ Loading…")
  } finally {
    view.renderer.destroy()
  }
})
