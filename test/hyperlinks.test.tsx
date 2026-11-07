import { expect, test } from "bun:test"
import { CodeRenderable, NativeSession, RGBA, ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { Writable } from "node:stream"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import type { ReactionTarget } from "../src/models"
import { GitHubMarkdown } from "../src/ui/components/github-markdown"
import { TimelineCommits } from "../src/ui/components/pull-commits"
import { Popup } from "../src/ui/components/popup"
import { messageReactionMouse, type ReactionControls } from "../src/ui/components/reactions"
import { HyperlinkProvider, HyperlinkSurface, useHyperlinkMouse } from "../src/ui/hyperlinks"
import { createReactiveMarkdownStyle } from "../src/ui/markdown-style"
import { ThemeProvider, useTheme } from "../src/ui/theme"
import { resolveTheme } from "../src/theme"
import { defaultConfig } from "../src/config"
import { App } from "../src/ui/app"
import { mouseClick } from "../src/ui/mouse"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

type View = Awaited<ReturnType<typeof testRender>>

function linkCells(view: View, url: string) {
  const cells: Array<{ x: number; y: number }> = []
  for (let y = 0; y < view.renderer.height; y++)
    for (let x = 0; x < view.renderer.width; x++)
      if (view.renderer.getLinkAt(x, y) === url) cells.push({ x, y })
  expect(cells.length).toBeGreaterThan(0)
  return cells
}

function styleAt(view: View, { x, y }: { x: number; y: number }) {
  let column = 0
  for (const span of view.captureSpans().lines[y]!.spans) {
    if (x < column + span.width) return { fg: span.fg, bg: span.bg, attributes: span.attributes }
    column += span.width
  }
  throw new Error(`No painted cell at ${x}, ${y}`)
}

function codeBlocks(node: Renderable): CodeRenderable[] {
  return [...(node instanceof CodeRenderable ? [node] : []), ...node.getChildren().flatMap(codeBlocks)]
}

async function settleMarkdown(view: View) {
  // Decoration may replace blocks during the first highlighting pass.
  for (let pass = 0; pass < 2; pass++) {
    await view.renderOnce()
    await Promise.all(codeBlocks(view.renderer.root).map((block) => block.highlightingDone))
    await view.flush()
  }
}

function MarkdownSample(props: { content: string }) {
  const { colors, theme } = useTheme()
  const style = createReactiveMarkdownStyle(colors, theme)
  return <box width="100%" flexDirection="column" backgroundColor={colors.canvas}>
    <GitHubMarkdown content={props.content} syntaxStyle={style()} />
  </box>
}

test("opens painted wrapped markdown and table links without native OSC 8 support", async () => {
  const wrappedUrl = "https://example.com/wrapped"
  const tableUrl = "https://example.com/table"
  const commitUrl = "https://github.com/owner/repo/pull/42/commits/abc1234"
  const referenceUrl = "https://github.com/owner/repo/issues/9"
  const opened: string[] = []
  const stdout = Object.assign(new Writable({
    write(_chunk, _encoding, callback) { callback() },
  }), { columns: 32, rows: 36, isTTY: true }) as unknown as NodeJS.WriteStream
  const nativeSession = new NativeSession(stdout)
  const view = await testRender(() => <HyperlinkProvider identity="markdown" onOpen={(url) => { opened.push(url) }}>
    <HyperlinkSurface>
      <MarkdownSample content={`Before [a deliberately long linked label that wraps across several visible rows](${wrappedUrl}).\n\n| Resource | Status |\n| --- | --- |\n| [Documentation](${tableUrl}) | Ready |`} />
      <TimelineCommits commits={[{ kind: "commit-added", event: "committed", id: "native-commit", url: commitUrl, sha: "abc1234", message: "Native subject #9", author: "author" }]} />
    </HyperlinkSurface>
  </HyperlinkProvider>, { width: 32, height: 36, stdout, nativeSession, bufferedOutput: "stdout" })
  try {
    await settleMarkdown(view)
    expect(nativeSession.getCapabilities().hyperlinks).toBe(false)
    const wrapped = linkCells(view, wrappedUrl)
    expect(new Set(wrapped.map((cell) => cell.y)).size).toBeGreaterThan(1)
    const continuation = wrapped.find((cell) => cell.y > wrapped[0]!.y)!
    const tableCell = linkCells(view, tableUrl)[0]!
    const normal = styleAt(view, continuation)
    const normalTable = styleAt(view, tableCell)
    const plain = { x: 0, y: 0 }
    const normalPlain = styleAt(view, plain)
    const frame = view.captureCharFrame()
    await view.mockMouse.moveTo(continuation.x, continuation.y)
    await view.flush()
    const hovered = styleAt(view, continuation)
    expect(hovered.bg.equals(normal.bg)).toBe(false)
    expect(hovered.fg).toEqual(normal.fg)
    expect(hovered.attributes).toBe(normal.attributes)
    expect(hovered.bg.a).toBeCloseTo(normal.bg.a)
    expect(Math.max(Math.abs(hovered.bg.r - normal.bg.r), Math.abs(hovered.bg.g - normal.bg.g), Math.abs(hovered.bg.b - normal.bg.b))).toBeLessThan(0.07)
    expect(styleAt(view, plain)).toEqual(normalPlain)
    expect(styleAt(view, tableCell)).toEqual(normalTable)
    expect(view.captureCharFrame()).toBe(frame)
    expect(view.renderer.getLinkAt(continuation.x, continuation.y)).toBe(wrappedUrl)
    await view.renderOnce()
    expect(styleAt(view, continuation)).toEqual(hovered)
    view.mockInput.pressKey("k")
    await view.flush()
    expect(styleAt(view, continuation)).toEqual(normal)
    await view.mockMouse.emitMouseEvent("move", continuation.x, continuation.y)
    await view.flush()
    expect(styleAt(view, continuation)).toEqual(normal)
    await view.mockMouse.moveTo(tableCell.x, tableCell.y)
    await view.flush()
    expect(styleAt(view, tableCell).bg.equals(normalTable.bg)).toBe(false)
    expect(styleAt(view, continuation)).toEqual(normal)
    await view.mockMouse.moveTo(plain.x, plain.y)
    await view.flush()
    expect(styleAt(view, tableCell)).toEqual(normalTable)
    expect(opened).toEqual([])
    await view.mockMouse.click(continuation.x, continuation.y)
    const table = linkCells(view, tableUrl)[0]!
    await view.mockMouse.click(table.x, table.y)
    const lines = view.captureCharFrame().split("\n")
    const subjectRow = lines.findIndex((line) => line.includes("Native subject"))
    expect(subjectRow).toBeGreaterThanOrEqual(0)
    const subjectX = lines[subjectRow]!.indexOf("Native subject")
    expect(view.renderer.getLinkAt(subjectX, subjectRow)).toBe(commitUrl)
    await view.mockMouse.click(subjectX, subjectRow)
    const reference = linkCells(view, referenceUrl)[0]!
    await view.mockMouse.click(reference.x, reference.y)
    expect(opened).toEqual([wrappedUrl, tableUrl, commitUrl, referenceUrl])
  } finally { view.renderer.destroy() }
})

test("keeps drag, right-click, selection and message double-click distinct from inline links", async () => {
  const url = "https://example.com/inline"
  const opened: string[] = []
  const reactions: ReactionTarget[] = []
  const callbackUrl = "https://example.com/callback"
  let callbacks = 0
  const target: ReactionTarget = { kind: "issue", number: 1, nodeId: "I_fixture" }
  const controls: ReactionControls = {
    action: () => ({ operation: { status: "idle" } }),
    add: () => {},
    open: (value) => { reactions.push(value) },
    context: () => {},
  }
  function Message() {
    const { colors } = useTheme()
    const links = useHyperlinkMouse()
    const mouse = messageReactionMouse(() => target, () => ({ canReact: true }), () => "ordinary selectable text", () => controls, () => true)
    return <box {...mouse} width="100%" flexDirection="column" backgroundColor={colors.canvas}>
      <text {...links}><a href={url}>Inline documentation</a></text>
      <text id="plain-message">ordinary selectable text</text>
      <text {...mouseClick(() => { callbacks++ })}><a href={callbackUrl}>Callback reference</a></text>
    </box>
  }
  const view = await testRender(() => <HyperlinkProvider identity="message" onOpen={(value) => { opened.push(value) }}>
    <HyperlinkSurface><Message /></HyperlinkSurface>
  </HyperlinkProvider>, { width: 50, height: 12 })
  try {
    await view.flush()
    const cell = linkCells(view, url)[0]!
    await view.mockMouse.pressDown(cell.x, cell.y)
    await view.mockMouse.emitMouseEvent("drag", cell.x + 5, cell.y)
    await view.mockMouse.emitMouseEvent("drag", cell.x, cell.y)
    await view.mockMouse.release(cell.x, cell.y)
    await view.mockMouse.click(cell.x, cell.y, 2)
    expect(opened).toEqual([])
    expect(reactions).toEqual([])

    view.renderer.clearSelection()
    const plain = view.renderer.root.findDescendantById("plain-message")!
    await view.mockMouse.drag(plain.x, plain.y, plain.x + 7, plain.y)
    expect(view.renderer.getSelection()?.getSelectedText()).toContain("ordinary")
    expect(opened).toEqual([])
    expect(reactions).toEqual([])

    view.renderer.clearSelection()
    await view.mockMouse.click(cell.x, cell.y)
    expect(opened).toEqual([url])
    view.renderer.clearSelection()
    await view.mockMouse.doubleClick(cell.x, cell.y)
    expect(reactions).toEqual([])
    view.renderer.clearSelection()
    await view.mockMouse.doubleClick(plain.x + 1, plain.y)
    expect(reactions).toEqual([target])
    view.renderer.clearSelection()
    const callbackCell = linkCells(view, callbackUrl)[0]!
    const callbackStyle = styleAt(view, callbackCell)
    await view.mockMouse.moveTo(callbackCell.x, callbackCell.y)
    await view.flush()
    expect(styleAt(view, callbackCell).bg.equals(callbackStyle.bg)).toBe(false)
    const before = [...opened]
    await view.mockMouse.click(callbackCell.x, callbackCell.y)
    expect(callbacks).toBe(1)
    expect(opened).toEqual(before)
    expect(reactions).toEqual([target])
  } finally { view.renderer.destroy() }
})

test("popup links open once and backdrop dismissal consumes the whole click", async () => {
  const popupUrl = "https://example.com/popup"
  const backgroundUrl = "https://example.com/background"
  const opened: string[] = []
  const [visible, setVisible] = createSignal(true)
  let dismissals = 0
  const view = await testRender(() => <HyperlinkProvider identity="popup" onOpen={(url) => { opened.push(url) }}>
    <HyperlinkSurface enabled={!visible()}>
      <text><a href={backgroundUrl}>Background link under backdrop</a></text>
      <Show when={visible()}>
        <Popup width={30} height={6} onClose={() => { dismissals++; setVisible(false) }}>
          <text><a href={popupUrl}>Popup documentation</a></text>
        </Popup>
      </Show>
    </HyperlinkSurface>
  </HyperlinkProvider>, { width: 60, height: 20 })
  try {
    await view.flush()
    const popup = linkCells(view, popupUrl)[0]!
    const normal = styleAt(view, popup)
    await view.mockMouse.moveTo(popup.x, popup.y)
    await view.flush()
    expect(styleAt(view, popup).bg.equals(normal.bg)).toBe(false)
    expect(styleAt(view, popup).fg).toEqual(normal.fg)
    await view.mockMouse.click(popup.x, popup.y)
    expect(opened).toEqual([popupUrl])
    expect(dismissals).toBe(0)
    await view.mockMouse.pressDown(1, 0)
    expect(dismissals).toBe(0)
    await view.mockMouse.release(1, 0)
    await view.flush()
    expect(dismissals).toBe(1)
    expect(opened).toEqual([popupUrl])
    const background = linkCells(view, backgroundUrl)[0]!
    await view.mockMouse.click(background.x, background.y)
    expect(opened).toEqual([popupUrl, backgroundUrl])
  } finally { view.renderer.destroy() }
})


test("loaded document headings and repeated footnote backlinks scroll locally with colored references", async () => {
  const repository = "leohenon/opengh-sandbox"
  const documentUrl = `https://github.com/${repository}/blob/main/README.md`
  const noteUrl = `${documentUrl}#user-content-fn-short`
  const backlinkUrl = `${documentUrl}#user-content-fnref-short-2`
  const [style, setStyle] = createSignal<"rich" | "minimal">("rich")
  const external: string[] = []
  const content = `# Anchor example

[Jump to note](${noteUrl}) · [Later heading](#later) · [Guide](GUIDE.md#guide-1)

See #42. First reference[^short].

${"Some wrapping context before the second reference. ".repeat(14)} Second reference[^short].

${Array.from({ length: 24 }, (_, index) => `Filler paragraph ${index}.`).join("\n\n")}

## Later

The heading target is here.

[^short]: Footnote target text.`
  const data = { ...githubDataFixture, repo: { ...githubDataFixture.repo, nameWithOwner: repository, url: `https://github.com/${repository}` },
    documents: { status: "ready" as const, value: [{ id: "readme", repository, ref: "main", path: "README.md", label: "README",
      resource: { status: "ready" as const, value: content } },
      { id: "guide", repository, ref: "main", path: "GUIDE.md", label: "Guide", resource: { status: "ready" as const,
        value: `## Guide\n\nFirst heading.\n\n${"Guide filler.\n\n".repeat(24)}## Guide\n\nSecond heading target.\n\n[Back to the second reference](README.md#user-content-fnref-short-2)` } }] } }
  const view = await testRender(() => <ThemeProvider name="github" mode="dark"><App data={data} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: false, markdownStyle: style() }}
    onOpenUrl={async (url) => { external.push(url) }} /></ThemeProvider>, { width: 80, height: 22 })
  const click = async (url: string) => {
    const cell = linkCells(view, url)[0]!
    await view.mockMouse.click(cell.x, cell.y)
    await settleMarkdown(view)
    await view.flush()
  }
  try {
    for (const [width, variant] of [[80, "rich"], [40, "minimal"], [80, "rich"]] as const) {
      setStyle(variant)
      view.resize(width, 22)
      await settleMarkdown(view)
      const scroll = view.renderer.root.findDescendantById("overview-document-scroll") as ScrollBoxRenderable
      scroll.scrollTo(0)
      await view.flush()
      expect(view.captureCharFrame()).not.toContain("\uE000")
      const reference = view.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("#42"))!
      expect(reference).toBeDefined()
      expect(reference.fg.equals(RGBA.fromHex(resolveTheme("github", "dark").markdownLink))).toBe(true)
      await click(noteUrl)
      expect(scroll.scrollTop).toBeGreaterThan(0)
      expect(view.captureCharFrame()).toContain("Footnote target text")
      await click(backlinkUrl)
      expect(external).toEqual([])
      expect(view.captureCharFrame()).toContain("Second reference")
      const referenceCells = linkCells(view, noteUrl)
      expect(referenceCells[0]!.y).toBe(scroll.viewport.y)
      scroll.scrollTo(0)
      await view.flush()
      await click(`${documentUrl}#later`)
      expect(view.captureCharFrame()).toContain("The heading target is here")
      expect(external).toEqual([])
    }
    const scroll = view.renderer.root.findDescendantById("overview-document-scroll") as ScrollBoxRenderable
    scroll.scrollTo(0)
    await view.flush()
    await click(documentUrl.replace("README.md", "GUIDE.md#guide-1"))
    expect(view.captureCharFrame()).toContain("Second heading target")
    expect(view.captureCharFrame()).not.toContain("First heading.")
    await click(backlinkUrl)
    expect(view.captureCharFrame()).toContain("Second reference")
    expect(external).toEqual([])
  } finally { view.renderer.destroy() }
})

test("table anchors jump to the wrapped target cell and source-row links", async () => {
  const documentUrl = `${githubDataFixture.repo.url}/blob/main/README.md`
  const noteUrl = `${documentUrl}#user-content-fn-table`
  const backlinkUrl = `${documentUrl}#user-content-fnref-table`
  const rows = Array.from({ length: 30 }, (_, row) => `| R${row} | ${row === 19
    ? `${"Wrapping context inside the target cell. ".repeat(10)}<a id="table-cell"></a>TABLE_CELL_TARGET[^table].`
    : `Description ${row}.`} |`)
  const lines = ["# Table anchors", "", "[Note](#user-content-fn-table) · [Source row](#SOURCE) · [Named cell](#table-cell)", "", "| Row | Description |", "| --- | --- |", ...rows, "",
    ...Array.from({ length: 12 }, (_, index) => `After table ${index}.\n`), "[^table]: Table footnote text."]
  const sourceLine = lines.findIndex((line) => line.startsWith("| R19 |")) + 1
  const content = lines.join("\n").replace("#SOURCE", `#L${sourceLine}`)
  const data = { ...githubDataFixture, documents: { status: "ready" as const, value: [{
    id: "table", repository: githubDataFixture.repo.nameWithOwner, ref: "main", path: "README.md", label: "README",
    resource: { status: "ready" as const, value: content },
  }] } }
  const [style, setStyle] = createSignal<"rich" | "minimal">("rich")
  const external: string[] = []
  const view = await testRender(() => <App data={data} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: false, markdownStyle: style() }}
    onOpenUrl={async (url) => { external.push(url) }} />, { width: 80, height: 22 })
  const click = async (url: string) => {
    const cell = linkCells(view, url)[0]!
    await view.mockMouse.click(cell.x, cell.y)
    await settleMarkdown(view)
  }
  try {
    for (const [width, variant] of [[80, "rich"], [40, "minimal"], [80, "rich"]] as const) {
      setStyle(variant)
      view.resize(width, 22)
      await settleMarkdown(view)
      const scroll = view.renderer.root.findDescendantById("overview-document-scroll") as ScrollBoxRenderable
      scroll.scrollTo(0)
      await view.flush()
      await click(noteUrl)
      expect(view.captureCharFrame()).toContain("Table footnote text")
      await click(backlinkUrl)
      expect(linkCells(view, noteUrl)[0]!.y).toBe(scroll.viewport.y)
      scroll.scrollTo(0)
      await view.flush()
      await click(`${documentUrl}#L${sourceLine}`)
      expect(view.captureCharFrame().split("\n")[scroll.viewport.y]).toContain("R19")
      scroll.scrollTo(0)
      await view.flush()
      await click(`${documentUrl}#table-cell`)
      expect(view.captureCharFrame().split("\n")[scroll.viewport.y]).toContain("TABLE_CELL_TARGET")
      expect(view.captureCharFrame()).not.toContain("\uE000")
      expect(external).toEqual([])
    }
  } finally { view.renderer.destroy() }
})

test("source-line ranges resolve original Markdown prose, code, moved footnotes and plain documents", async () => {
  const documentUrl = `${githubDataFixture.repo.url}/blob/main/README.md`
  const lines = ["# Source positions", "", "[Prose](#PROSE) · [Code](#CODE) · [Footnote](#NOTE) · [Plain](LICENSE#L30)", "",
    ...Array.from({ length: 20 }, (_, index) => `Before target ${index}.\n`),
    "The preceding source line wraps on narrower terminals. ".repeat(10),
    "PROSE_SOURCE_TARGET with an &amp; entity.", "", "```ts", "const first = 1;", "const second = 2; // CODE_SOURCE_TARGET", "", "console.log(second);", "```", "",
    "[^source]: MOVED_FOOTNOTE_SOURCE_TARGET", "", "Reference to the moved note[^source].", "",
    ...Array.from({ length: 20 }, (_, index) => `After target ${index}.\n`)]
  const source = lines.join("\n")
  const sourceLines = source.split("\n")
  const proseLine = sourceLines.findIndex((line) => line.startsWith("PROSE_SOURCE_TARGET")) + 1
  const codeLine = sourceLines.findIndex((line) => line.includes("CODE_SOURCE_TARGET")) + 1
  const noteLine = sourceLines.findIndex((line) => line.startsWith("[^source]:")) + 1
  const content = source.replace("#PROSE", `#L${proseLine}`).replace("#CODE", `#L${codeLine}-L${codeLine + 1}`).replace("#NOTE", `#L${noteLine}`)
  const repository = githubDataFixture.repo.nameWithOwner
  const data = { ...githubDataFixture, documents: { status: "ready" as const, value: [
    { id: "source", repository, ref: "main", path: "README.md", label: "README", resource: { status: "ready" as const, value: content } },
    { id: "license", repository, ref: "main", path: "LICENSE", label: "License", resource: { status: "ready" as const,
      value: Array.from({ length: 60 }, (_, index) => `License source line ${index + 1}`).join("\n") } },
  ] } }
  const external: string[] = []
  const view = await testRender(() => <App data={data} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: false }} onOpenUrl={async (url) => { external.push(url) }} />,
    { width: 60, height: 22 })
  const click = async (url: string) => {
    const cell = linkCells(view, url)[0]!
    await view.mockMouse.click(cell.x, cell.y)
    await settleMarkdown(view)
  }
  const top = () => view.renderer.root.findDescendantById("overview-document-scroll") as ScrollBoxRenderable
  try {
    for (const width of [60, 40, 80]) {
      view.resize(width, 22)
      await settleMarkdown(view)
      top().scrollTo(0); await view.flush()
      await click(`${documentUrl}#L${proseLine}`)
      expect(view.captureCharFrame().split("\n")[top().viewport.y]).toContain("PROSE_SOURCE_TARGET")
      top().scrollTo(0); await view.flush()
      await click(`${documentUrl}#L${codeLine}-L${codeLine + 1}`)
      expect(view.captureCharFrame().split("\n")[top().viewport.y]).toContain("const second = 2;")
      const code = codeBlocks(view.renderer.root).find((block) => !block.conceal && block.content.includes("CODE_SOURCE_TARGET"))!
      expect(code.plainText).toBe("const first = 1;\nconst second = 2; // CODE_SOURCE_TARGET\n\nconsole.log(second);")
      top().scrollTo(0); await view.flush()
      await click(`${documentUrl}#L${noteLine}`)
      expect(view.captureCharFrame()).toContain("MOVED_FOOTNOTE_SOURCE_TARGET")
      expect(view.captureCharFrame()).not.toContain("\uE000")
      expect(external).toEqual([])
    }
    top().scrollTo(0); await view.flush()
    await click(documentUrl.replace("README.md", "LICENSE#L30"))
    expect(view.captureCharFrame().split("\n")[top().viewport.y]).toContain("License source line 30")
    expect(external).toEqual([])
  } finally { view.renderer.destroy() }
})
