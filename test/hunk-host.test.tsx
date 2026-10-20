import { expect, test } from "bun:test"
import { BoxRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { createHunkDiffFilesFromPatch } from "hunkdiff/opentui"
import { initializeHunk, mountHunk } from "../src/ui/hunk-host"

const file = (name: string) => createHunkDiffFilesFromPatch(`diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old-${name}\n+new-${name}\n`)[0]!

test("Hunk portal preserves Solid siblings through updates, local remounts and renderer shutdown", async () => {
  const setup = await createTestRenderer({ width: 90, height: 20 })
  const { renderer } = setup
  initializeHunk(renderer)
  const [visible, setVisible] = createSignal(true)
  const [label, setLabel] = createSignal("Solid sibling")
  let pane: ReturnType<typeof mountHunk> | undefined
  let commits = 0
  let host: BoxRenderable | undefined
  function Host() {
    let box!: BoxRenderable
    onMount(() => {
      host = box
      pane = mountHunk(renderer, box, { file: file("one.ts"), width: 90, canonicalLayout: "unified", highlight: false }, () => commits++)
    })
    onCleanup(() => {
      pane?.dispose()
      pane = undefined
      if (!renderer.isDestroyed && !box.isDestroyed) box.destroyRecursively()
    })
    return <box ref={(value) => { box = value }} width="100%" height={15} />
  }
  try {
    await render(() => <box flexDirection="column"><text>{label()}</text><Show when={visible()}><Host /></Show><text>Solid footer</text></box>, renderer)
    const keyListeners = renderer.keyInput.listenerCount("keypress")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("new-one.ts")
    expect(setup.captureCharFrame()).toContain("Solid sibling")
    setLabel("Solid changed")
    pane!.update({ file: file("two.ts"), width: 90, canonicalLayout: "split", highlight: false })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("new-two.ts")
    expect(setup.captureCharFrame()).not.toContain("new-one.ts")
    expect(setup.captureCharFrame()).toContain("Solid changed")
    expect(commits).toBeGreaterThanOrEqual(2)
    setup.resize(50, 20)
    pane!.update({ file: file("two.ts"), width: 50, canonicalLayout: "unified", highlight: false })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("new-two.ts")
    for (let index = 0; index < 3; index++) {
      const oldHost = host!
      setVisible(false)
      await setup.renderOnce()
      expect(oldHost.isDestroyed).toBe(true)
      expect(setup.captureCharFrame()).toContain("Solid footer")
      setVisible(true)
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain("new-one.ts")
      expect(renderer.keyInput.listenerCount("keypress")).toBe(keyListeners)
    }
    const peerHost = new BoxRenderable(renderer, { width: 50, height: 3 })
    renderer.root.add(peerHost)
    const peer = mountHunk(renderer, peerHost, { file: file("peer.ts"), width: 50, highlight: false })
    expect(peerHost.getChildrenCount()).toBeGreaterThan(0)
    setVisible(false) // Disposing one portal must not remove another tab's rows.
    await setup.renderOnce()
    expect(peerHost.getChildrenCount()).toBeGreaterThan(0)
    setVisible(true)
    await setup.renderOnce()
    expect(host!.getChildrenCount()).toBeGreaterThan(0)
    renderer.destroy() // Both portals remain mounted for whole-renderer teardown.
    await renderer.closed
    peer.dispose()
    expect(renderer.isDestroyed).toBe(true)
    expect(pane).toBeUndefined()
  } finally {
    if (!renderer.isDestroyed) { renderer.destroy(); await renderer.closed }
  }
})
