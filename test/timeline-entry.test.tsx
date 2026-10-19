import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { TimelineEntry, TimelineItem } from "../src/ui/components/timeline-entry"

test("the final timeline connector stops at the icon and extends again when another item follows", async () => {
  const [last, setLast] = createSignal(true)
  const view = await testRender(() => (
    <TimelineItem last={last()}>
      <TimelineEntry icon="o" nodeOffset={2}>
        <text flexShrink={0}>{"First\nSecond\nThird\nFourth\nFifth"}</text>
      </TimelineEntry>
    </TimelineItem>
  ), { width: 30, height: 9, useThread: false })
  const connector = (row: number) => view.captureCharFrame().split("\n")[row]![1]
  try {
    await view.flush()
    expect(connector(0)).toBe("│")
    expect(connector(2)).toBe("o")
    expect(connector(3)).toBe(" ")
    setLast(false)
    await view.flush()
    expect(connector(2)).toBe("o")
    expect(connector(3)).toBe("│")
    setLast(true)
    await view.flush()
    expect(connector(4)).toBe(" ")
  } finally { view.renderer.destroy() }
})
