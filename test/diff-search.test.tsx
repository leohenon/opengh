import { expect, test } from "bun:test"
import { BoxRenderable, RGBA, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import { getHunkDiffSearchCells } from "hunkdiff/opentui"
import type { PullReviewThread } from "../src/models"
import { appColors, resolveTheme } from "../src/theme"
import { parseDiff } from "../src/ui/diff-model"
import { initializeHunk, mountHunk } from "../src/ui/hunk-host"
import { searchRanges } from "../src/ui/search"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { DiffScreen } from "../src/ui/pages/diff"
import { SearchProvider } from "../src/ui/search-context"
import { ThemeProvider } from "../src/ui/theme"

test("Hunk paints whole partial-match graphemes, including either active occurrence in one cell", async () => {
  const setup = await createTestRenderer({ width: 24, height: 12 })
  initializeHunk(setup.renderer)
  const host = new BoxRenderable(setup.renderer, { width: 24, height: 12 })
  setup.renderer.root.add(host)
  const patch = "diff --git a/u.txt b/u.txt\n--- a/u.txt\n+++ b/u.txt\n@@ -1 +1 @@\n-old\n+👩‍💻 é́ tail words words words\n"
  const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
  const bg = "#665500", activeBg = "#a85d00"
  const props = { file, width: 24, canonicalLayout: "unified" as const, highlight: false, showLineNumbers: true }
  const pane = mountHunk(setup.renderer, host, props)
  const painted = (color: string) => setup.captureSpans().lines.flatMap(line => line.spans)
    .filter(span => span.bg.equals(RGBA.fromHex(color))).map(span => span.text).join("")
  try {
    for (const wrapLines of [false, true]) {
      const cell = getHunkDiffSearchCells({ ...props, wrapLines }).find(cell => cell.text.includes("👩"))!
      for (const query of ["💻", "́"]) {
        const ranges = searchRanges(cell.text, query)
        expect(ranges).toHaveLength(query === "💻" ? 1 : 2)
        for (let active = 0; active < ranges.length; active++) {
          pane.update({ ...props, wrapLines, sourceHighlights: { [cell.id]: ranges.map((range, index) => ({
            ...range, active: index === active, fg: "#ffffff", bg: index === active ? activeBg : bg,
          })) } })
          await setup.renderOnce()
          const expected = query === "💻" ? "👩‍💻" : "é́"
          expect(painted(activeBg)).toBe(expected)
          expect(painted(bg)).toBe("")
          expect(setup.captureCharFrame()).toContain("👩‍💻 é́")
        }
      }
    }
  } finally { pane.dispose(); setup.renderer.destroy(); await setup.renderer.closed }
})

test("large repetitive diff search caps source results and reveals first/last without per-match row lookup", async () => {
  const setup = await createTestRenderer({ width: 72, height: 12 })
  initializeHunk(setup.renderer)
  const source = Array.from({ length: 10_001 }, (_, i) => `x${String(i).padStart(9, "0")}`).join("")
  const patch = `diff --git a/large.txt b/large.txt\n--- a/large.txt\n+++ b/large.txt\n@@ -1 +1,2 @@\n-old\n+${source}\n+x later cell\n`
  await render(() => <KeybindingsProvider><ThemeProvider name="github" mode="dark">
    <box width="100%" height="100%" flexDirection="column"><SearchProvider identity="large" enabled>
      <DiffScreen target={{ kind: "commit", sha: "large" }}
        resource={{ status: "ready", value: { kind: "patch", patch } }} interactive
        showScrollbar={false} onLoadFiles={() => {}} />
    </SearchProvider></box>
  </ThemeProvider></KeybindingsProvider>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  try {
    await settle()
    const host = setup.renderer.root.findDescendantById("embedded-diff-host")!
    const lookup = host.findDescendantById.bind(host)
    let lookups = 0
    host.findDescendantById = (id) => { lookups++; return lookup(id) }
    setup.mockInput.pressKey("/")
    await setup.mockInput.pasteBracketedText("x")
    await settle()
    setup.mockInput.pressEnter()
    await settle()
    expect(setup.captureCharFrame()).toContain("1/10000+")
    expect(setup.captureCharFrame()).toContain("x000000000")
    // Includes layout callbacks and refreshes, but must not scale with matches.
    expect(lookups).toBeLessThan(100)
    lookups = 0
    setup.mockInput.pressKey("N")
    await settle()
    expect(setup.captureCharFrame()).toContain("10000/10000+")
    expect(setup.captureCharFrame()).toContain("x000009999")
    expect(lookups).toBeLessThan(100)
    setup.mockInput.pressKey("n")
    await settle()
    expect(setup.captureCharFrame()).toContain("1/10000+")
    expect(setup.captureCharFrame()).toContain("x000000000")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
}, 20_000)

test("many matching diff rows use a shared row map, not a descendant lookup per cell", async () => {
  const setup = await createTestRenderer({ width: 72, height: 12 })
  initializeHunk(setup.renderer)
  const patch = `diff --git a/rows.txt b/rows.txt\n--- a/rows.txt\n+++ b/rows.txt\n@@ -1 +1,600 @@\n-old\n${Array.from({ length: 600 }, (_, i) => `+needle ${i}`).join("\n")}\n`
  await render(() => <KeybindingsProvider><ThemeProvider name="github" mode="dark">
    <box width="100%" height="100%" flexDirection="column"><SearchProvider identity="rows" enabled>
      <DiffScreen target={{ kind: "commit", sha: "rows" }} resource={{ status: "ready", value: { kind: "patch", patch } }}
        interactive showScrollbar={false} onLoadFiles={() => {}} />
    </SearchProvider></box>
  </ThemeProvider></KeybindingsProvider>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  try {
    await settle()
    const host = setup.renderer.root.findDescendantById("embedded-diff-host")!
    const lookup = host.findDescendantById.bind(host)
    let calls = 0
    host.findDescendantById = (id) => { calls++; return lookup(id) }
    setup.mockInput.pressKey("/")
    await setup.mockInput.pasteBracketedText("needle")
    await settle()
    setup.mockInput.pressEnter()
    await settle()
    expect(setup.captureCharFrame()).toContain("1/600")
    expect(calls).toBeLessThan(20)
    calls = 0
    setup.mockInput.pressKey("N")
    await settle()
    expect(setup.captureCharFrame()).toContain("600/600")
    expect(setup.captureCharFrame()).toContain("needle 599")
    expect(calls).toBeLessThan(20)
    // Allow the reveal's layout to settle, then leave the accepted search idle
    // through multiple provider polls. Unchanged geometry needs no tree walk.
    await Bun.sleep(180)
    await settle()
    const children = host.getChildren.bind(host)
    let walks = 0
    host.getChildren = () => { walks++; return children() }
    await Bun.sleep(350)
    await settle()
    expect(walks).toBe(0)
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

const lines = Array.from({ length: 36 }, (_, index) => index === 0 ? " const needleContext = 1"
  : index === 1 ? '-const before = "old"\n+const after = "new"'
  : index === 11 ? `-const far = "old"\n+const far = "${"x".repeat(110)} 👩‍💻 needle"`
  : ` const row${index + 1} = 0`)
const patch = `diff --git a/search.ts b/search.ts\n--- a/search.ts\n+++ b/search.ts\n@@ -1,36 +1,36 @@\n${lines.join("\n")}\n`
const thread: PullReviewThread = {
  kind: "review-thread", id: "posted", path: "search.ts", line: 2, diffSide: "RIGHT",
  isResolved: false, isOutdated: false,
  comments: [{ id: "comment", author: "alice", authorAssociation: "MEMBER", body: "Posted **needle** discussion",
    createdAt: "", updatedAt: "", url: "" }],
}

test("diff search decorates/reveals real Hunk rows and posted comments in split/unified, wrapped/panned views", async () => {
  const setup = await createTestRenderer({ width: 112, height: 16 })
  initializeHunk(setup.renderer)
  const [repo, setRepo] = createSignal("https://github.com/a/one")
  const [active, setActive] = createSignal(true)
  await render(() => <KeybindingsProvider><ThemeProvider name="github" mode="dark">
    <box width="100%" height="100%" flexDirection="column"><SearchProvider identity={repo()} enabled>
      <DiffScreen target={{ kind: "commit", sha: "search-test" }} repositoryUrl={repo()} active={active()}
        resource={{ status: "ready", value: { kind: "patch", patch } }} interactive
        threads={[thread]} showScrollbar={false} onLoadFiles={() => {}} />
    </SearchProvider></box>
  </ThemeProvider></KeybindingsProvider>, setup.renderer)
  const colors = appColors(resolveTheme("github", "dark"))
  const matchBg = RGBA.fromHex(colors.searchMatchBg)
  const currentBg = RGBA.fromHex(colors.searchCurrentMatchBg)
  const scroll = () => setup.renderer.root.findDescendantById("diff-body-scroll") as ScrollBoxRenderable
  const card = () => setup.renderer.root.findDescendantById("diff-comment-card:posted")!
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const wait = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5_000
    while (!predicate() && Date.now() < deadline) { await Bun.sleep(25); await settle() }
    expect(predicate()).toBe(true)
  }
  const key = async (value: string) => {
    if (value === "escape") { setup.mockInput.pressEscape(); await Bun.sleep(30) }
    else if (value === "enter") setup.mockInput.pressEnter()
    else if (value === "tab") setup.mockInput.pressTab()
    else setup.mockInput.pressKey(value)
    await settle()
  }
  const search = async (query: string) => {
    await key("/")
    // typeText emits UTF-16 units individually; paste preserves astral characters.
    await setup.mockInput.pasteBracketedText(query)
    await settle()
    await key("enter")
  }
  const painted = (bg: RGBA) => setup.captureSpans().lines.flatMap((line) => line.spans)
    .filter((span) => span.bg.equals(bg)).map((span) => span.text).join("")
  const rowPosition = (node: Renderable) => node.y - scroll().content.y
  try {
    await settle()
    await key("tab") // Wide screens initially focus files.
    await wait(() => !!card() && card().height > 1)
    const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
    for (const layout of ["split", "unified"] as const) {
      if (layout === "unified") await key("t")
      for (const wrapped of [false, true]) {
        if (wrapped) await key("w")
        scroll().scrollTo(0)
        await settle()
        const originalCard = card()
        await search("needle")
        await wait(() => setup.captureCharFrame().includes("1/3"))
        // Context is indexed once, but painted in both split panes. Gutters are not painted.
        expect(painted(currentBg).match(/needle/g)?.length).toBe(layout === "split" ? 2 : 1)
        expect(painted(matchBg)).toContain("needle") // posted Markdown
        if (layout === "split" && !wrapped) {
          await wait(() => {
            const line = setup.captureSpans().lines.find((line) => line.spans.map((span) => span.text).join("").includes("const after"))
            const keyword = line?.spans.find((span) => span.text.includes("const"))?.fg
            const literal = line?.spans.find((span) => span.text.includes('"'))?.fg
            return !!keyword && !!literal && !keyword.equals(literal)
          })
          expect(card()).toBe(originalCard) // Real async Hunk highlighting cannot rebuild posted Markdown.
          expect(painted(currentBg).trim()).toBe("needleneedle")
        }
        expect(painted(currentBg).trim()).toBe(layout === "split" ? "needleneedle" : "needle")
        await key("n")
        expect(setup.captureCharFrame()).toContain("2/3")
        expect(painted(currentBg)).toBe("needle")
        expect(card()).toBe(originalCard)
        await key("n")
        await wait(() => setup.captureCharFrame().includes("3/3") && painted(currentBg).includes("needle"))
        const cells = getHunkDiffSearchCells({ file, width: scroll().viewport.width, canonicalLayout: layout,
          tabWidth: 4, wrapLines: wrapped, showLineNumbers: true, showHunkHeaders: true })
        expect(cells.filter((cell) => cell.text.includes("needleContext"))).toHaveLength(1)
        expect(cells.some((cell) => cell.text.includes("@@"))).toBe(false)
        const far = cells.find((cell) => cell.text.includes("xxx") && cell.text.includes("needle"))!
        const row = setup.renderer.root.findDescendantById(far.rowId)!
        const start = far.text.indexOf("needle")
        let visual = 0, offset = 0
        while (visual < far.visualLines.length - 1 && offset + far.visualLines[visual]!.length <= start)
          offset += far.visualLines[visual++]!.length
        expect(scroll().scrollTop).toBe(rowPosition(row) + visual)
        expect(painted(currentBg).trim()).toBe("needle")
        // Poll reconciliation must not recreate comments or reset their decoration IDs.
        await Bun.sleep(350)
        await settle()
        expect(card()).toBe(originalCard)
        expect(setup.captureCharFrame()).toContain("3/3")
        const savedTop = scroll().scrollTop
        await key("/")
        await setup.mockInput.typeText("Context")
        await settle()
        expect(setup.captureCharFrame()).toContain("1/1")
        await key("escape")
        expect(setup.captureCharFrame()).toContain("3/3")
        expect(scroll().scrollTop).toBe(savedTop)
        expect(painted(currentBg).trim()).toBe("needle") // Cancel restores horizontal pan too.
        await key("N")
        expect(setup.captureCharFrame()).toContain("2/3")
        expect(painted(currentBg)).toBe("needle")
        expect(card()).toBe(originalCard)
        await key("escape")
        expect(painted(currentBg)).toBe("")
        expect(painted(matchBg)).toBe("")
        await search("💻") // Panning must reveal the whole glyph, not skip its leading cell.
        await wait(() => setup.captureCharFrame().includes("1/1") && painted(currentBg).includes("👩‍💻"))
        expect(painted(currentBg).trim()).toBe("👩‍💻")
        await key("escape")
        await search("@@") // Hunk headers/gutters are deliberately outside source search.
        expect(setup.captureCharFrame()).toContain("No matches")
        await key("escape")
        if (wrapped) await key("w")
      }
    }
    scroll().scrollTo(0)
    await search("needle")
    await key("tab")
    await key("n") // Accepted body scope survives focus moving to the visible files pane.
    expect(setup.captureCharFrame()).toContain("2/3")
    expect(painted(currentBg)).toBe("needle")
    await key("n")
    expect(setup.captureCharFrame()).toContain("3/3")
    expect(painted(currentBg).trim()).toBe("needle")
    await key("escape")
    await search("search.ts") // Restart captures the currently focused files pane instead.
    expect(setup.captureCharFrame()).toContain("1/1")
    await key("tab")
    const fileSearchTop = scroll().scrollTop
    await key("n")
    expect(setup.captureCharFrame()).toContain("1/1")
    expect(scroll().scrollTop).toBe(fileSearchTop)
    await key("escape")
    await search("needle")
    setRepo("https://github.com/a/two")
    await settle()
    expect(setup.captureCharFrame()).not.toContain("/needle")
    expect(painted(currentBg)).toBe("")
    setRepo("https://github.com/a/one")
    await settle()
    await wait(() => setup.captureCharFrame().includes("/needle"))
    scroll().scrollTo(20)
    const top = scroll().scrollTop
    setup.mockInput.pressKey("n") // Schedule reveal, then leave before its idle continuation.
    setActive(false)
    await settle()
    expect(scroll().scrollTop).toBe(top)
    await key("n")
    expect(scroll().scrollTop).toBe(top)
  } finally {
    setup.renderer.destroy()
    await setup.renderer.closed
  }
}, 20_000)
