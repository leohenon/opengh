import { expect, test } from "bun:test"
import { testRender, useKeyboard } from "@opentui/solid"
import { createSignal } from "solid-js"
import { defaultConfig } from "../src/config"
import { App } from "../src/ui/app"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import type { CommandResult } from "../src/command-actions"
import { clickControl } from "./fixtures/mouse"

test("command overlay isolates destination input and retains logs; Ctrl+C cancels rather than quits", async () => {
  const [hints, setHints] = createSignal(false)
  let quit = 0
  let refresh = 0
  let copies = ""
  let cancel: (() => void) | undefined
  let complete!: (result: CommandResult) => void
  let calls = 0
  const view = await testRender(() => {
    // Mirrors Root's earlier listener and its command cancellation coordination.
    useKeyboard((event) => {
      if (event.ctrl && event.name === "c") { event.stopPropagation(); if (cancel) cancel(); else quit++ }
    })
    return <App
      data={githubDataFixture} operations={repositoryOperationsFixture} cwd="/tmp"
      config={{ ...defaultConfig, showStatusBarHints: hints() }}
      onQuit={() => quit++} onRefresh={() => refresh++}
      onCommandCaptureCancel={(callback) => { cancel = callback }}
      onCopyToClipboard={async (output) => { copies = output; return true }}
      onRunCommand={async (_spec, output) => {
        calls++
        output("stdout\nstderr\rprogress\n")
        return { cancel: () => { complete({ exitCode: 143, cancelled: true }) }, result: new Promise((done) => { complete = done }) }
      }}
    />
  }, { width: 100, height: 32, exitOnCtrlC: false })
  try {
    await view.flush()
    view.mockInput.pressKey("x")
    await view.flush()
    await view.mockMouse.click(0, 0)
    await view.flush()
    expect(cancel).toBeUndefined()
    expect(calls).toBe(0)
    view.mockInput.pressKey("x")
    await view.flush()
    expect(view.renderer.root.findDescendantById("command-edit")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("command-copy")).toBeUndefined()
    expect(view.captureCharFrame()).toContain("Confirm")
    const destination = view.renderer.root.findDescendantById("command-destination")!
    const confirm = view.renderer.root.findDescendantById("command-confirm")!
    const destinationBox = destination.parent!
    expect(confirm.y).toBe(destination.y + destination.height + 1)
    expect(confirm.x).toBe(destination.x)
    expect(view.renderer.root.findDescendantById("command-close")).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("Edit path")
    expect(view.captureCharFrame()).not.toContain("enter confirm")
    expect(view.captureCharFrame()).not.toContain("e edit path")
    setHints(true)
    await view.flush()
    const previewLines = view.captureCharFrame().split("\n")
    expect(previewLines[31]).toContain("enter confirm")
    expect(previewLines.slice(0, 31).join("\n")).not.toContain("enter confirm")
    setHints(false)
    await view.flush()
    await clickControl(view, "command-destination")
    for (const key of ["q", "r", "?", "4", "x"]) view.mockInput.pressKey(key)
    await view.flush()
    expect(view.captureCharFrame()).toContain(`Clone ${githubDataFixture.repo.nameWithOwner}?`)
    expect(view.captureCharFrame()).not.toContain("Noninteractive:")
    expect(view.captureCharFrame()).not.toContain("--progress")
    expect(view.captureCharFrame()).toContain("qr?4x")
    const input = destinationBox.getChildren()[0]!
    expect(confirm.y).toBe(input.y + input.height + 1)
    expect(confirm.x).toBe(input.x)
    expect(quit).toBe(0)
    expect(refresh).toBe(0)
    await clickControl(view, "command-confirm")
    expect(calls).toBe(1)
    expect(view.captureCharFrame()).toContain("Running")
    expect(view.captureCharFrame()).toContain("Cancel")
    expect(view.renderer.root.findDescendantById("command-close")).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("Copy output")
    expect(view.captureCharFrame()).not.toContain("ctrl+c cancel")
    await view.mockMouse.click(0, 0); await view.flush()
    expect(view.captureCharFrame()).toContain("Running")
    await view.mockMouse.click(0, 0)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Running")
    expect(cancel).toBeDefined()
    view.mockInput.pressEscape()
    view.mockInput.pressKey("q")
    view.mockInput.pressEnter()
    await view.flush()
    expect(calls).toBe(1)
    expect(quit).toBe(0)
    view.mockInput.pressKey("c", { ctrl: true })
    await view.flush()
    expect(quit).toBe(0)
    expect(view.captureCharFrame()).toContain("Cancelled (exit 143)")
    expect(view.captureCharFrame()).toContain("stderr")
    expect(view.renderer.root.findDescendantById("command-copy")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("command-cancel")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("command-confirm")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("command-close")).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("Copy output")
    expect(view.captureCharFrame()).not.toContain("y copy output")
    view.mockInput.pressKey("y")
    await view.flush()
    expect(copies).toBe("stdout\nstderr\nprogress\n")
    await view.mockMouse.click(0, 0); await view.flush()
    await Bun.sleep(40)
    await view.flush()
    expect(cancel).toBeUndefined()
    view.mockInput.pressKey("x")
    await view.flush()
    await clickControl(view, "command-confirm")
    expect(calls).toBe(2)
    await clickControl(view, "command-cancel")
    expect(view.captureCharFrame()).toContain("Cancelled (exit 143)")
    expect(quit).toBe(0)
    await view.mockMouse.click(0, 0); await view.flush()
  } finally { view.renderer.destroy() }
})
