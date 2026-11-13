import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { DiffScreen } from "../src/ui/pages/diff"
import { StatusPromptBar, StatusPromptProvider } from "../src/ui/status-prompt"
import { initializeHunk } from "../src/ui/hunk-host"

test("comma and period navigate bounded filtered files regardless of sidebar visibility or mouse selection", async () => {
  const setup = await createTestRenderer({ width: 105, height: 18 })
  initializeHunk(setup.renderer)
  const patch = ["alpha.ts", "beta.ts", "other.ts", "gamma.ts"].map((name) =>
    `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old-${name}\n+new-${name}\n`).join("")
  await render(() => <StatusPromptProvider><box width="100%" height="100%" flexDirection="column">
    <DiffScreen target={{ kind: "commit", sha: "nav" }} resource={{ status: "ready", value: { kind: "patch", patch } }}
      interactive showScrollbar={false} onLoadFiles={() => {}} />
    <StatusPromptBar fallback={<text height={1}>status</text>} />
  </box></StatusPromptProvider>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const selected = () => setup.captureCharFrame().split("\n")[0]!
  try {
    await settle()
    setup.mockInput.pressKey(",")
    await settle()
    expect(selected()).toContain("alpha.ts")
    setup.mockInput.pressKey(".")
    await settle()
    expect(selected()).toContain("beta.ts")
    expect(setup.captureCharFrame()).toMatch(/▌ beta\.ts\s+│/) // The mouse index follows keyboard selection.
    const pane = setup.renderer.root.findDescendantById("diff-files-pane")!
    await setup.mockMouse.click(pane.x + 4, pane.y + 3) // Mouse-select the third file.
    await settle()
    expect(selected()).toContain("other.ts")
    setup.mockInput.pressKey("s")
    setup.mockInput.pressKey(".")
    await settle()
    expect(pane.visible).toBe(false)
    expect(selected()).toContain("gamma.ts")
    setup.mockInput.pressKey(".")
    await settle()
    expect(selected()).toContain("gamma.ts")
    setup.mockInput.pressKey("F")
    await settle()
    expect(pane.visible).toBe(true)
    await setup.mockInput.typeText(".ts")
    setup.mockInput.pressEnter()
    await settle()
    setup.mockInput.pressKey(",")
    await settle()
    expect(selected()).toContain("other.ts")
    setup.mockInput.pressKey("F")
    await settle()
    setup.mockInput.pressKey("a", { ctrl: true })
    setup.mockInput.pressKey("k", { ctrl: true })
    await setup.mockInput.typeText("a.ts") // alpha, beta and gamma match; other is excluded.
    await settle()
    expect(setup.captureCharFrame()).toContain("Files (3/4)")
    setup.mockInput.pressEnter()
    await settle()
    setup.mockInput.pressKey(",")
    await settle()
    expect(selected()).toContain("beta.ts") // The excluded other.ts is skipped.
    setup.mockInput.pressKey(",")
    await settle()
    expect(selected()).toContain("alpha.ts")
    setup.mockInput.pressKey(",")
    await settle()
    expect(selected()).toContain("alpha.ts")
    setup.mockInput.pressKey(".")
    await settle()
    expect(selected()).toContain("beta.ts")
    setup.mockInput.pressKey(".")
    await settle()
    expect(selected()).toContain("gamma.ts")
    setup.mockInput.pressKey(".")
    await settle()
    expect(selected()).toContain("gamma.ts")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("keyboard file navigation reveals the selected row beyond the sidebar viewport", async () => {
  const setup = await createTestRenderer({ width: 105, height: 10 })
  initializeHunk(setup.renderer)
  const patch = Array.from({ length: 30 }, (_, index) => {
    const name = `file${index}.ts`
    return `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+new\n`
  }).join("")
  await render(() => <box width="100%" height="100%">
    <DiffScreen target={{ kind: "commit", sha: "long-nav" }} resource={{ status: "ready", value: { kind: "patch", patch } }}
      interactive showScrollbar={false} onLoadFiles={() => {}} />
  </box>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  try {
    await settle()
    for (let i = 0; i < 20; i++) setup.mockInput.pressKey(".")
    await settle()
    expect(setup.captureCharFrame()).toContain("▌ file20.ts")
    const pane = setup.renderer.root.findDescendantById("diff-files-pane")!
    for (let i = 0; i < 5; i++) await setup.mockMouse.scroll(pane.x + 4, pane.y + 3, "up")
    await settle()
    expect(setup.captureCharFrame()).not.toContain("▌ file20.ts")
    setup.mockInput.pressKey(".")
    await settle()
    expect(setup.captureCharFrame()).toContain("▌ file21.ts")
    for (let i = 0; i < 21; i++) setup.mockInput.pressKey(",")
    await settle()
    expect(setup.captureCharFrame()).toContain("▌ file0.ts")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})
