import { expect } from "bun:test"
import type { testRender } from "@opentui/solid"

type View = Pick<Awaited<ReturnType<typeof testRender>>, "captureCharFrame" | "flush">

// Markdown appears only after its parser worker answers, which a cold or busy machine delays past any fixed sleep.
export async function waitForText(view: View, text: string, timeout = 2_000) {
  const deadline = Date.now() + timeout
  await view.flush()
  while (!view.captureCharFrame().includes(text) && Date.now() < deadline) {
    await Bun.sleep(20)
    await view.flush()
  }
  expect(view.captureCharFrame()).toContain(text)
}
