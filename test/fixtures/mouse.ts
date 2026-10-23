import { expect } from "bun:test"
import type { testRender } from "@opentui/solid"

type View = Pick<Awaited<ReturnType<typeof testRender>>, "renderer" | "mockMouse" | "flush">

export async function clickControl(view: View, id: string) {
  await view.flush()
  const control = view.renderer.root.findDescendantById(id)
  expect(control).toBeDefined()
  expect(control!.width).toBeGreaterThan(0)
  expect(control!.height).toBeGreaterThan(0)
  expect(control!.x).toBeGreaterThanOrEqual(0)
  expect(control!.y).toBeGreaterThanOrEqual(0)
  expect(control!.x + control!.width).toBeLessThanOrEqual(view.renderer.width)
  expect(control!.y + control!.height).toBeLessThanOrEqual(view.renderer.height)
  await view.mockMouse.click(control!.x, control!.y)
  await view.flush()
}
