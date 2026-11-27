import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { createSignal } from "solid-js"
import type { DiffContent } from "../src/models"
import type { ResourceState } from "../src/repository-state"
import type { ScrollBoxRenderable } from "@opentui/core"
import { createTestRenderer, TestRecorder } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { DiffScreen } from "../src/ui/pages/diff"
import { StatusPromptBar, StatusPromptProvider } from "../src/ui/status-prompt"
import { initializeHunk } from "../src/ui/hunk-host"
import { SearchProvider } from "../src/ui/search-context"
import { KeybindingsProvider } from "../src/ui/keybindings"

const patches = ["alpha.ts", "beta.ts", "review.ts", "settings.ts"].map((name) => {
  const lines = Array.from({ length: 10 }, (_, index) => `+${name}-line-${index} ${"x".repeat(60)}\n`).join("")
  return `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1,10 @@\n-old\n${lines}@@ -30 +39,10 @@\n-old\n${lines.replaceAll("-line-", "-later-line-")}`
})
const patch = patches.join("")

test.each(["late patch", "wrapped mount", "hidden before paint"] as const)(
  "file and hunk reveals paint the requested source without an intermediate jump (%s)",
  async (scenario) => {
    const setup = await createTestRenderer({ width: 105, height: 15 })
    initializeHunk(setup.renderer)
    const [resource, setResource] = createSignal<ResourceState<DiffContent>>({ status: "loading", phase: "load" })
    const [active, setActive] = createSignal(true)
    const recorder = new TestRecorder(setup.renderer)
    const expectSource = async (firstSource: string) => {
      await setup.flush()
      await setup.renderer.idle()
      await setup.flush()
      expect(recorder.recordedFrames.length).toBeGreaterThan(0)
      for (const { frame } of recorder.recordedFrames) {
        expect(frame.split("\n").find((line) => line.includes("-line-"))).toContain(firstSource)
      }
    }
    const press = async (key: string, firstSource: string) => {
      recorder.clear()
      setup.mockInput.pressKey(key)
      await expectSource(firstSource)
    }
    const load = () => setResource({ status: "ready", value: { kind: "patch", patch } })
    try {
      if (scenario === "wrapped mount") {
        load()
        recorder.rec()
      }
      await render(
        () => (
          <box width="100%" height="100%" visible={active()}>
            <DiffScreen
              active={active()}
              target={{ kind: "pull", number: 8, fileHash: createHash("sha256").update("review.ts").digest("hex") }}
              resource={resource()}
              defaultWrap={scenario === "wrapped mount"}
              interactive
              showScrollbar={false}
              onLoadFiles={() => {}}
            />
          </box>
        ),
        setup.renderer,
      )
      if (scenario !== "wrapped mount") {
        await setup.flush()
        recorder.rec()
        load()
        if (scenario === "hidden before paint") {
          setActive(false)
          await setup.flush()
          recorder.clear()
          setActive(true)
        }
      }
      await expectSource("review.ts-line-0")
      expect(setup.captureCharFrame().split("\n")[0]).toContain("review.ts")
      await press(",", "beta.ts-line-0")
      await press("]", "beta.ts-later-line-0")
      await press("]", "review.ts-line-0")
      await press("[", "beta.ts-later-line-0")
      if (scenario === "hidden before paint") {
        setActive(false)
        await setup.flush()
        recorder.clear()
        setActive(true)
        await expectSource("beta.ts-later-line-0")
      }
    } finally {
      recorder.stop()
      setup.renderer.destroy()
      await setup.renderer.closed
    }
  },
)

async function navigationFixture() {
  const setup = await createTestRenderer({ width: 105, height: 15 })
  initializeHunk(setup.renderer)
  const [source, setSource] = createSignal(patch)
  const [hash, setHash] = createSignal<string>()
  const [active, setActive] = createSignal(true)
  await render(
    () => (
      <KeybindingsProvider>
        <box width="100%" height="100%" flexDirection="column">
          <SearchProvider identity="nav" enabled={active()}>
            <DiffScreen
              target={{ kind: "pull", number: 8, fileHash: hash() }}
              resource={{ status: "ready", value: { kind: "patch", patch: source() } }}
              active={active()}
              interactive
              showScrollbar={false}
              onLoadFiles={() => {}}
            />
          </SearchProvider>
        </box>
      </KeybindingsProvider>
    ),
    setup.renderer,
  )
  const settle = async () => {
    await setup.flush()
    await setup.renderer.idle()
    await setup.flush()
  }
  await settle()
  const scroll = setup.renderer.root.findDescendantById("diff-body-scroll") as ScrollBoxRenderable
  return { ...setup, settle, scroll, setSource, setHash, setActive }
}

test.each([".", "]", "k"])("navigation %s supersedes a search reveal before paint", async (key) => {
  const view = await navigationFixture()
  try {
    view.mockInput.pressKey("/")
    await view.mockInput.pasteBracketedText("alpha.ts-line-")
    await view.settle()
    view.mockInput.pressEnter()
    await view.settle()
    expect(view.captureCharFrame()).toContain("1/10")
    const before = view.scroll.scrollTop
    view.mockInput.pressKey("n")
    view.mockInput.pressKey(key)
    await view.settle()
    expect(view.captureCharFrame()).toContain("2/10")
    if (key === "k") expect(view.scroll.scrollTop).toBe(before - 1)
    else {
      const first = view
        .captureCharFrame()
        .split("\n")
        .find((line) => line.includes("-line-"))
      expect(first).toContain(key === "." ? "beta.ts-line-0" : "alpha.ts-later-line-0")
    }
  } finally {
    await view.dispose()
  }
})

test.each([".", "]"])("a pending %s jump survives a refresh that still shows its target", async (key) => {
  const view = await navigationFixture()
  try {
    view.mockInput.pressKey(key)
    const name = key === "." ? "beta.ts-line-" : "alpha.ts-later-line-"
    view.setSource(patch.replaceAll(name, "refreshed-line-"))
    await view.settle()
    const first = view
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes("-line-"))
    expect(first).toContain("refreshed-line-0")
    expect(view.captureCharFrame().split("\n")[0]).toContain(key === "." ? "beta.ts" : "alpha.ts")
  } finally {
    await view.dispose()
  }
})

test("a refreshed-away file jump does not resume when its path returns", async () => {
  const view = await navigationFixture()
  try {
    view.mockInput.pressKey(".")
    view.setSource(patches.filter((_, i) => i !== 1).join(""))
    await view.settle()
    const top = view.scroll.scrollTop
    const host = view.renderer.root.findDescendantById("embedded-diff-host")!
    const lookup = host.findDescendantById.bind(host)
    let retries = 0
    host.findDescendantById = (id) => {
      if (id === "diff-file:beta.ts") retries++
      return lookup(id)
    }
    await view.renderOnce()
    expect(retries).toBe(0)
    view.setSource(patch)
    await view.settle()
    expect(view.scroll.scrollTop).toBe(top)
    expect(view.captureCharFrame().split("\n")[0]).toContain("alpha.ts")
  } finally {
    await view.dispose()
  }
})

test("a removed hunk does not resume when the same path gets its second hunk back", async () => {
  const view = await navigationFixture()
  try {
    view.mockInput.pressKey("]")
    view.setSource(patches[0]!.split("@@ -30")[0] + patches.slice(1).join(""))
    view.setSource(patch)
    await view.settle()
    expect(view.scroll.scrollTop).toBe(0)
  } finally {
    await view.dispose()
  }
})

test("only the current hash is revealed on activation; clearing it preserves selection and scroll", async () => {
  const view = await navigationFixture()
  const link = (name: string) => view.setHash(createHash("sha256").update(name).digest("hex"))
  const header = () => view.captureCharFrame().split("\n")[0]
  try {
    view.mockInput.pressKey(".")
    await view.settle()
    const top = view.scroll.scrollTop
    link("review.ts")
    view.setActive(false)
    link("settings.ts")
    await view.settle()
    expect(header()).toContain("beta.ts")
    view.setHash(undefined)
    view.setActive(true)
    await view.settle()
    expect(header()).toContain("beta.ts")
    expect(view.scroll.scrollTop).toBe(top)
    view.setActive(false)
    link("settings.ts")
    link("review.ts")
    view.setActive(true)
    await view.settle()
    expect(header()).toContain("review.ts")
    expect(view.captureCharFrame()).toContain("review.ts-line-0")
  } finally {
    await view.dispose()
  }
})

test("comma and period navigate bounded filtered files regardless of sidebar visibility or mouse selection", async () => {
  const setup = await createTestRenderer({ width: 105, height: 18 })
  initializeHunk(setup.renderer)
  const patch = ["alpha.ts", "beta.ts", "other.ts", "gamma.ts"]
    .map((name) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old-${name}\n+new-${name}\n`)
    .join("")
  await render(
    () => (
      <StatusPromptProvider>
        <box width="100%" height="100%" flexDirection="column">
          <DiffScreen
            target={{ kind: "commit", sha: "nav" }}
            resource={{ status: "ready", value: { kind: "patch", patch } }}
            interactive
            showScrollbar={false}
            onLoadFiles={() => {}}
          />
          <StatusPromptBar fallback={<text height={1}>status</text>} />
        </box>
      </StatusPromptProvider>
    ),
    setup.renderer,
  )
  const settle = async () => {
    await setup.flush()
    await setup.renderer.idle()
    await setup.flush()
  }
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
  } finally {
    setup.renderer.destroy()
    await setup.renderer.closed
  }
})

test("keyboard file navigation reveals the selected row beyond the sidebar viewport", async () => {
  const setup = await createTestRenderer({ width: 105, height: 10 })
  initializeHunk(setup.renderer)
  const patch = Array.from({ length: 30 }, (_, index) => {
    const name = `file${index}.ts`
    return `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+new\n`
  }).join("")
  await render(
    () => (
      <box width="100%" height="100%">
        <DiffScreen
          target={{ kind: "commit", sha: "long-nav" }}
          resource={{ status: "ready", value: { kind: "patch", patch } }}
          interactive
          showScrollbar={false}
          onLoadFiles={() => {}}
        />
      </box>
    ),
    setup.renderer,
  )
  const settle = async () => {
    await setup.flush()
    await setup.renderer.idle()
    await setup.flush()
  }
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
  } finally {
    setup.renderer.destroy()
    await setup.renderer.closed
  }
})
