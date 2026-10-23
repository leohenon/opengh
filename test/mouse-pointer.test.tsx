import { expect, spyOn, test } from "bun:test"
import { Writable } from "node:stream"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { initializeHunk } from "../src/ui/hunk-host"
import { DiffScreen } from "../src/ui/pages/diff"
import { patchFixture } from "./fixtures/diff"
import { MouseSurface } from "../src/ui/components/mouse-surface"
import { mouseClick } from "../src/ui/mouse"

for (const tmux of [false, true]) {
  test(`native cursor output stays unwrapped ${tmux ? "under tmux" : "in plain terminals"}`, async () => {
    const chunks: Buffer[] = []
    const sink = new Writable({ write(bytes, _encoding, done) { chunks.push(Buffer.from(bytes)); done() } })
    Object.assign(sink, { isTTY: true, columns: 40, rows: 10, getColorDepth: () => 24 })
    const view = await createTestRenderer({
      width: 40, height: 10, stdout: sink as unknown as NodeJS.WriteStream, bufferedOutput: "stdout", remote: true,
      enableMouseMovement: true,
      environment: tmux ? { TERM: "tmux-256color", TERM_PROGRAM: "tmux", TMUX: "/fixture,1,0" }
        : { TERM: "xterm-ghostty", TERM_PROGRAM: "ghostty" },
    })
    const nativePointer = spyOn(view.renderer, "setMousePointer")
    const bytes = () => Buffer.concat(chunks).toString()
    try {
      initializeHunk(view.renderer)
      await render(() => <MouseSurface>
        <text height={1} flexShrink={0} {...mouseClick(() => {})}>Clickable</text><text height={1} flexShrink={0}>Plain text</text>
        <DiffScreen target={{ kind: "commit", sha: "wire-fixture" }} interactive showScrollbar={false} onLoadFiles={() => {}}
          resource={{ status: "ready", value: { kind: "patch", patch: patchFixture } }} />
      </MouseSurface>, view.renderer)
      await view.renderer.setupTerminal()
      await view.flush()
      await view.renderer.idle()
      expect(view.captureCharFrame()).toContain("newValue")
      nativePointer.mockClear()
      chunks.length = 0
      await view.mockMouse.moveTo(2, 0)
      await view.flush()
      await view.renderer.idle()
      expect(nativePointer).toHaveBeenCalledWith("pointer")
      expect(bytes()).toContain("\u001b]22;pointer\u001b\\")
      expect(bytes()).not.toContain("\u001bPtmux;")
      chunks.length = 0
      view.mockInput.pressKey("k")
      await view.flush()
      await view.renderer.idle()
      expect(bytes()).toMatch(/\u001b\]22;(?:default)?\u001b\\/)
      await view.mockMouse.moveTo(3, 0)
      await view.flush()
      await view.renderer.idle()
      chunks.length = 0
      view.renderer.destroy()
      await view.renderer.closed
      expect(bytes()).toMatch(/\u001b\]22;(?:default)?\u001b\\/)
      expect(bytes()).not.toContain("\u001bPtmux;")
    } finally {
      view.renderer.destroy()
      await view.renderer.closed
      nativePointer.mockRestore()
      sink.destroy()
    }
  })
}
