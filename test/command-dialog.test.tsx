import { expect, test } from "bun:test"
import { testRender, useKeyboard } from "@opentui/solid"
import { App } from "../src/ui/app"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import type { CommandResult } from "../src/command-actions"

test("command overlay isolates destination input and retains logs; Ctrl+C cancels rather than quits", async () => {
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
      onQuit={() => quit++} onRefresh={() => refresh++}
      onCommandCaptureCancel={(callback) => { cancel = callback }}
      onCopyToClipboard={async (output) => { copies = output; return true }}
      onRunCommand={async (_spec, output) => {
        calls++
        output("stdout\nstderr\rprogress\n")
        return { cancel: () => { complete({ exitCode: 143, cancelled: true }) }, result: new Promise((done) => { complete = done }) }
      }}
    />
  }, { width: 100, height: 32, useThread: false, exitOnCtrlC: false })
  try {
    await view.flush()
    view.mockInput.pressKey("x")
    await view.flush()
    view.mockInput.pressKey("e")
    for (const key of ["q", "r", "?", "4", "x"]) view.mockInput.pressKey(key)
    await view.flush()
    expect(view.captureCharFrame()).toContain(`Clone ${githubDataFixture.repo.nameWithOwner}?`)
    expect(view.captureCharFrame()).not.toContain("Noninteractive:")
    expect(view.captureCharFrame()).not.toContain("--progress")
    expect(quit).toBe(0)
    expect(refresh).toBe(0)
    view.mockInput.pressEnter()
    await view.flush()
    expect(calls).toBe(1)
    expect(view.captureCharFrame()).toContain("Running")
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
    view.mockInput.pressKey("y")
    await view.flush()
    expect(copies).toBe("stdout\nstderr\nprogress\n")
    view.mockInput.pressEscape()
    await Bun.sleep(40)
    await view.flush()
    expect(cancel).toBeUndefined()
  } finally { view.renderer.destroy() }
})
