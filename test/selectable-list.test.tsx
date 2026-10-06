import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { SelectableList } from "../src/ui/components/selectable-list"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

function visibleRows(frame: string) {
  return frame.split("\n").filter((row) => /row \d/.test(row))
}

describe("SelectableList", () => {
  test("renders only complete rows for its measured viewport", async () => {
    const items = Array.from({ length: 8 }, (_, id) => ({ id, label: `row ${id}` }))
    const view = await testRender(() => (
      <box width={50} height={11}>
        <SelectableList
          items={items}
          itemKey={(item) => item.id}
          active
          header={<text>HEADER</text>}
          empty="empty"
        >
          {(item) => <text>{item().label}</text>}
        </SelectableList>
      </box>
    ), { width: 50, height: 11, useThread: false })
    active.push(view)
    await view.flush()

    expect(visibleRows(view.captureCharFrame())).toHaveLength(2)

    for (let index = 0; index < 4; index++) {
      view.mockInput.pressKey("j")
      await view.flush()
    }

    const frame = view.captureCharFrame()
    expect(visibleRows(frame)).toHaveLength(2)
    expect(frame).toContain("row 4")
    expect(frame.split("▌").length - 1).toBe(1)
  })
})
