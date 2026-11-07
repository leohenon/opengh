import { expect, spyOn, test } from "bun:test"
import { BoxRenderable, CodeRenderable, RGBA, ScrollBoxRenderable, StyledText, SyntaxStyle, TextAttributes, TextRenderable, TextTableRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createRenderedSearch } from "../src/ui/rendered-search"

const chunk = (text: string, extra = {}) => ({ __isChunk: true as const, text, ...extra })

test("common matches index once and repaint without prefix measurements", async () => {
  const view = await createTestRenderer({ width: 80, height: 8 })
  try {
    const text = new TextRenderable(view.renderer, { content: "a ".repeat(10_000), wrapMode: "char" })
    view.renderer.root.add(text)
    await view.renderOnce()
    const measure = spyOn(text, "measureTextOffset")
    const search = createRenderedSearch(text)
    const start = performance.now()
    const matches = search.search("a")
    const indexed = performance.now()
    search.highlight(matches[9_999]!.id)
    const highlighted = performance.now()
    expect(matches).toHaveLength(10_000)
    expect(matches.at(-1)!.position).toBe(249)
    // Algorithmic guard: only the two distinct graphemes are native-measured,
    // rather than 10,000 prefixes. Reindex and active changes reuse the map.
    expect(measure.mock.calls.map(([value]) => value).sort()).toEqual([" ", "a"])
    expect(search.search("a")).toHaveLength(10_000)
    expect(measure).toHaveBeenCalledTimes(2)
    expect(highlighted - start).toBeLessThan(2_000)
    console.info(`20KB/10k matches: index ${(indexed - start).toFixed(1)}ms, highlight ${(highlighted - indexed).toFixed(1)}ms`)
    search.dispose()
  } finally { view.renderer.destroy() }
})

test("cached grapheme columns retain native widths, tabs and newlines for both width methods", async () => {
  for (const widthMethod of ["wcwidth", "unicode"] as const) {
    const view = await createTestRenderer({ width: 7, height: 20, widthMethod })
    try {
      const content = "界a\t👩‍💻é\na\r\n界a\ta"
      const text = new TextRenderable(view.renderer, { content, wrapMode: "char" })
      view.renderer.root.add(text)
      await view.renderOnce()
      const search = createRenderedSearch(text)
      const starts = [...content.matchAll(/a/g)].map(match => match.index)
      const expected = starts.map(start => {
        const column = text.measureTextOffset(content.slice(0, start))
        return text.renderedLineInfo.lineStartCols.findLastIndex(value => value <= column)
      })
      expect(search.search("a").map(match => match.position)).toEqual(expected)
      search.dispose()
    } finally { view.renderer.destroy() }
  }
})

test("rendered search preserves styled chunks/links, highlights across boundaries and never accumulates", async () => {
  const view = await createTestRenderer({ width: 30, height: 8 })
  try {
    const link = { url: "https://concealed.invalid" }
    const text = new TextRenderable(view.renderer, { content: new StyledText([
      chunk("pre ne", { attributes: TextAttributes.BOLD }), chunk("edle needle", { link }),
    ]) })
    const hidden = new BoxRenderable(view.renderer, { visible: false })
    hidden.add(new TextRenderable(view.renderer, { content: "needle" }))
    view.renderer.root.add(text)
    view.renderer.root.add(hidden)
    await view.renderOnce()
    const original = text.content
    let matchBackground = RGBA.fromHex("#665500")
    const search = createRenderedSearch(view.renderer.root, { get matchBackground() { return matchBackground } })
    expect(search.search("concealed.invalid")).toHaveLength(0)
    const matches = search.search("needle")
    expect(matches).toHaveLength(2)
    search.highlight(matches[1]!.id)
    for (let i = 0; i < 5; i++) expect(search.search("needle").map((m) => m.id)).toEqual(matches.map((m) => m.id))
    await view.renderOnce()
    expect(text.content).toBe(original)
    expect(text.plainText).toBe("pre needle needle")
    const spans = view.captureSpans().lines[0]!.spans
    expect(spans.filter((span) => span.bg.r > 0).map((span) => span.text).join("")).toBe("needleneedle")
    expect(spans.some((span) => span.text === "needle" && (span.attributes & TextAttributes.UNDERLINE))).toBe(true)
    expect(text.renderedChunks[1]!.link).toBe(link)
    matchBackground = RGBA.fromHex("#337733")
    search.search("needle")
    await view.renderOnce()
    expect(view.captureSpans().lines[0]!.spans.find((span) => span.text === "ne")!.bg.equals(matchBackground)).toBe(true)
    search.clear()
    await view.renderOnce()
    expect(text.content).toBe(original)
    expect(text.textDecorator).toBeUndefined()
    search.dispose()
  } finally { view.renderer.destroy() }
})

test("exact wrapped Unicode occurrence reveal and scroll snapshot, not block reveal", async () => {
  const view = await createTestRenderer({ width: 16, height: 4 })
  try {
    const scroll = new ScrollBoxRenderable(view.renderer, { width: 16, height: 4, scrollY: true })
    const text = new TextRenderable(view.renderer, { content: `${"before\n".repeat(12)}界👩‍💻é\tneedle\n${"after\n".repeat(8)}`, wrapMode: "char" })
    scroll.add(text)
    view.renderer.root.add(scroll)
    await view.renderOnce()
    const search = createRenderedSearch(scroll)
    const restore = search.snapshot()
    const [match] = search.search("needle")
    expect(match).toBeDefined()
    match!.reveal()
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("needle")
    expect(scroll.scrollTop).toBeGreaterThanOrEqual(9)
    restore()
    await view.renderOnce()
    expect(scroll.scrollTop).toBe(0)
    search.dispose()
  } finally { view.renderer.destroy() }
})

test("table occurrence reveal uses exact cell wrapping and row geometry; clear restores canonical cells", async () => {
  const view = await createTestRenderer({ width: 24, height: 5 })
  try {
    const scroll = new ScrollBoxRenderable(view.renderer, { width: 24, height: 5, scrollY: true })
    const content = Array.from({ length: 12 }, (_, i) => [[chunk(`row ${i}`)], [chunk(i === 10 ? "many words before the exact needle here" : "ordinary")]])
    const table = new TextTableRenderable(view.renderer, { content, width: 23, columnWidthMode: "full", wrapMode: "word" })
    scroll.add(table)
    view.renderer.root.add(scroll)
    await view.renderOnce()
    const search = createRenderedSearch(scroll)
    const [match] = search.search("needle")
    expect(match).toBeDefined()
    search.highlight(match!.id)
    await view.renderOnce()
    match!.reveal()
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("needle")
    expect(scroll.scrollTop).toBeGreaterThan(10)
    const decorated = table.content
    search.search("needle")
    expect(table.content).toBe(decorated)
    search.clear()
    expect(table.content).toBe(content)
    search.dispose()
  } finally { view.renderer.destroy() }
})

test("Code searches only post-transform displayed chunks and composes with existing callbacks", async () => {
  const view = await createTestRenderer({ width: 20, height: 5 })
  const style = SyntaxStyle.fromStyles({}, view.renderer.nativeScene)
  try {
    const code = new CodeRenderable(view.renderer, {
      content: "not the displayed content", filetype: "typescript", syntaxStyle: style,
      onChunks: () => [chunk("label "), chunk("needle", { link: { url: "https://secret.invalid" }, attributes: TextAttributes.ITALIC })],
    })
    view.renderer.root.add(code)
    await view.renderOnce()
    await code.highlightingDone
    await view.renderOnce()
    const callback = code.onChunks
    const search = createRenderedSearch(code)
    expect(search.search("not the displayed")).toHaveLength(0)
    expect(search.search("secret.invalid")).toHaveLength(0)
    expect(search.search("needle")).toHaveLength(1)
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("label needle")
    expect(code.onChunks).toBe(callback)
    expect(code.renderedChunks[1]!.attributes).toBe(TextAttributes.ITALIC)
    search.dispose()
    expect(code.onChunks).toBe(callback)
  } finally { view.renderer.destroy(); style.destroy() }
})

test("JSX-composed text keeps updating while highlighted; retained ancestors and exclusions are respected", async () => {
  const { createSignal } = await import("solid-js")
  const { testRender } = await import("@opentui/solid")
  const [value, setValue] = createSignal("needle")
  const [shown, setShown] = createSignal(true)
  let root!: BoxRenderable
  const view = await testRender(() => <box visible={shown()}><box ref={root}>
    <text id="marker">needle</text>
    <text>before <b>{value()}</b><a href="https://secret.invalid"> link</a></text>
  </box></box>, { width: 30, height: 5 })
  try {
    await view.renderOnce()
    const search = createRenderedSearch(root, { exclude: (node) => node.id === "marker" })
    expect(search.search("needle")).toHaveLength(1)
    setValue("updated needle needle")
    await view.renderOnce()
    expect(search.search("needle")).toHaveLength(2)
    expect(view.captureCharFrame()).toContain("updated needle")
    search.clear()
    setValue("still reactive")
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("still reactive")
    setShown(false)
    await view.renderOnce()
    expect(search.search("reactive")).toHaveLength(0)
    search.dispose()
  } finally { view.renderer.destroy() }
})

test("late occurrence in a single wrapped paragraph reveals after resize; unwrapped matches pan horizontally", async () => {
  const view = await createTestRenderer({ width: 22, height: 4 })
  try {
    const scroll = new ScrollBoxRenderable(view.renderer, { width: "100%", height: 4, scrollY: true, scrollX: true })
    const text = new TextRenderable(view.renderer, { content: `needle ${"a wrapped paragraph ".repeat(40)}needle end`, wrapMode: "word" })
    scroll.add(text)
    view.renderer.root.add(scroll)
    await view.renderOnce()
    const search = createRenderedSearch(scroll)
    const matches = search.search("needle")
    expect(matches).toHaveLength(2)
    expect(matches[1]!.position).toBeGreaterThan(20)
    matches[1]!.reveal()
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("needle end")
    expect(search.position()).toBeGreaterThan(20)
    view.resize(14, 4)
    await view.renderOnce()
    matches[1]!.reveal() // Closure resolves new wrapping rather than old coordinates.
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("needle end")
    text.wrapMode = "none"
    text.content = `${"prefix ".repeat(10)}needle end`
    await view.renderOnce()
    const [horizontal] = search.search("needle")
    horizontal!.reveal()
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("needle")
    expect(scroll.scrollLeft + text.scrollX).toBeGreaterThan(0)
    search.dispose()
  } finally { view.renderer.destroy() }
})
