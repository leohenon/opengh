import { expect, test } from "bun:test"
import { CodeRenderable, RGBA, TextAttributes, type Renderable } from "@opentui/core"
import type { GitHubMarkdownContext } from "../src/ui/github-markdown"
import type { MarkdownAnchorResolver } from "../src/ui/markdown-anchors"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { DetailLayout, MarkdownStyle } from "../src/config"
import { githubDataFixture, repositoryDocumentsFixture } from "./fixtures/github-data"
import { OverviewScreen, type AboutSidebar } from "../src/ui/pages/overview"
import { GitHubMarkdown } from "../src/ui/components/github-markdown"
import { createReactiveMarkdownStyle } from "../src/ui/markdown-style"
import { ThemeProvider, useTheme } from "../src/ui/theme"
import { MarkdownProvider } from "../src/ui/markdown-preferences"
import { appColors, resolveTheme } from "../src/theme"

function MarkdownSample(props: { content: string; context?: GitHubMarkdownContext; plainText?: boolean; anchorRef?: (resolver: MarkdownAnchorResolver | undefined) => void }) {
  const { colors, theme } = useTheme()
  const style = createReactiveMarkdownStyle(colors, theme)
  return <GitHubMarkdown content={props.content} syntaxStyle={style()} context={props.context} plainText={props.plainText} anchorRef={props.anchorRef} />
}

function codeBlocks(node: Renderable): CodeRenderable[] {
  return [
    ...(node instanceof CodeRenderable ? [node] : []),
    ...node.getChildren().flatMap(codeBlocks),
  ]
}

async function settle(view: Awaited<ReturnType<typeof testRender>>) {
  // The first lifecycle pass can replace blocks before their highlight update runs.
  for (let pass = 0; pass < 2; pass++) {
    await view.renderOnce()
    await Promise.all(codeBlocks(view.renderer.root).map((block) => block.highlightingDone))
    await view.flush()
  }
}

test("rejected Markdown uses bounded plain text and recovers in rich and minimal modes", async () => {
  const [content, setContent] = createSignal("# Initial\n\n```text\nstale code\n```")
  let resolveAnchor: MarkdownAnchorResolver | undefined
  const [style, setStyle] = createSignal<MarkdownStyle>("rich")
  const view = await testRender(() => <ThemeProvider name="github"><MarkdownProvider style={style()}>
    <MarkdownSample content={content()} anchorRef={(resolver) => { resolveAnchor = resolver }} />
  </MarkdownProvider></ThemeProvider>, { width: 120, height: 20 })
  try {
    await settle(view)
    expect(await resolveAnchor?.("L4")).toBeDefined()
    for (const preference of ["rich", "minimal"] as const) {
      setStyle(preference)
      for (const [source, notice] of [
        ["> ".repeat(65) + "text", "Markdown is too complex (container prefixes before parsing)"],
        ["<a>" + "<span>".repeat(12_000) + "hello" + "</span>".repeat(12_000) + "</a>", "Markdown is too complex"],
        ["Readable oversize preview\n" + "x".repeat(1024 * 1024), "Markdown is too large"],
        ["|" + "h|".repeat(3000) + "\n|" + "-|".repeat(3000) + "\n" + "|x|\n".repeat(4000), "Markdown is too complex"],
        ['<table><tr><td colspan="1000000000">x</td></tr></table>', "Markdown is too complex"],
      ] as const) {
        setContent(source)
        await settle(view)
        const frame = view.captureCharFrame()
        expect(frame).toContain(notice)
        expect(frame).toMatch(/Showing a plain-text\s+preview\./)
        expect(codeBlocks(view.renderer.root)).toHaveLength(0)
        expect(await resolveAnchor?.("L4")).toBeUndefined()
        expect(await resolveAnchor?.("initial")).toBeUndefined()
        expect(frame).not.toContain("stale code")
      }
      setContent("Recovered **Markdown**.\n\n| Resource | Status |\n| --- | --- |\n| Ragged |\n| Complete | Ready |\n\n```text\nfresh code\n```")
      await settle(view)
      const recovered = view.captureCharFrame()
      for (const text of ["Recovered Markdown.", "Resource", "Status", "Ragged", "Complete", "Ready"])
        expect(recovered).toContain(text)
      expect(recovered).not.toContain("plain-text preview")
      expect(codeBlocks(view.renderer.root).length).toBeGreaterThan(0)
      expect(await resolveAnchor?.("L1")).toBeDefined()
      const codeTarget = await resolveAnchor?.("L9")
      expect(codeTarget?.node).toBeInstanceOf(CodeRenderable)
      expect((codeTarget?.node as CodeRenderable).content.trim()).toBe("fresh code")
      expect(await resolveAnchor?.("initial")).toBeUndefined()
      expect(recovered).not.toContain("stale code")
    }
  } finally { view.renderer.destroy() }
}, 15_000)

test("shared markdown keeps padded code, compact linked labels, and block spacing across resizes and updates", async () => {
  const [content, setContent] = createSignal(`# Implementation

[Open PR](https://example.com/pr "PR title") and [x](https://example.com/x).

- A list item that wraps on narrow terminals without losing its indentation.
- Another item.

> [!NOTE]
> Readable **context**, not disabled text.

\`\`\`json
{"enabled": true, "count": 12}
\`\`\`

\`\`\`diff
- removed
+ added
\`\`\`

\`\`\`
https://example.com/log
\`\`\`

| Resource | Status |
| --- | --- |
| [Documentation](https://example.com/docs) | Ready |

End.`)
  const [theme, setTheme] = createSignal("github")
  const view = await testRender(() => <ThemeProvider name={theme()}><MarkdownSample content={content()} /></ThemeProvider>, { width: 120, height: 60 })
  try {
    await settle(view)
    for (const width of [120, 40, 120]) {
      view.resize(width, 60)
      await settle(view)
      const frame = view.captureCharFrame()
      const rows = frame.split("\n").map((row) => row.trimEnd())
      expect(frame).toContain("Open PR and x.")
      expect(frame).not.toContain("example.com/pr")
      expect(frame).not.toContain("example.com/docs")
      expect(frame).toContain("Documentation")
      expect(frame).not.toContain("PR title")
      expect(frame).not.toContain("[!NOTE]")
      expect(frame).toContain("Note")
      expect(frame).toContain("https://example.com/log") // Code must not be concealed.
      const codes = codeBlocks(view.renderer.root)
      const json = codes.find((block) => block.filetype === "json")!
      expect(rows.some((row) => row.trim() === "json")).toBe(false)
      expect(json.screenY - json.parent!.screenY).toBe(0)
      expect(json.parent!.height).toBe(json.height)
      expect(json.screenX - json.parent!.screenX).toBe(width < 80 ? 1 : 2)
      const linked = codes.find((block) => block.content.includes("Open PR"))!
      const result = await linked.treeSitterClient.highlightOnce(linked.content, "markdown")
      const highlights = await linked.onHighlight!(result.highlights ?? [], { content: linked.content, filetype: "markdown", syntaxStyle: linked.syntaxStyle })
      const { treeSitterToTextChunks } = await import("@opentui/core")
      const chunks = treeSitterToTextChunks(linked.content, highlights!, linked.syntaxStyle)
      const decorated = await linked.onChunks!(chunks, { content: linked.content, filetype: "markdown", syntaxStyle: linked.syntaxStyle, highlights: highlights! })
      expect(decorated?.find((chunk) => chunk.text === "x")?.link?.url).toBe("https://example.com/x")
      expect(decorated?.find((chunk) => chunk.text.includes("Open PR"))?.link?.url).toBe("https://example.com/pr")
    }
    const spans = view.captureSpans().lines.flatMap((line) => line.spans)
    const added = spans.find((span) => span.text.includes("added"))!
    const removed = spans.find((span) => span.text.includes("removed"))!
    expect(added.fg.equals(removed.fg)).toBe(false)
    const number = spans.find((span) => span.text === "12")!
    const string = spans.find((span) => span.text.includes('"enabled"'))!
    expect(number.fg.equals(string.fg)).toBe(false)
    setTheme("nord")
    await settle(view)
    expect(view.captureCharFrame()).toContain("Open PR and x.")
    expect(view.captureCharFrame()).not.toContain("example.com/pr")
    expect(view.captureCharFrame()).toContain("Note")
    setContent(`## Updated

### Subsection

First paragraph.

Second paragraph.

${"A readable prose line should not span the entire terminal. ".repeat(4)}

- Official:
  - [Python client](https://example.com/python)

\`\`\`python
from qdrant_client import QdrantClient

client = QdrantClient(url="http://localhost:6333")
\`\`\`

\`\`\`rust
fn main() { println!("qdrant"); }
\`\`\``)
    for (const width of [160, 40]) {
      view.resize(width, 60)
      await settle(view)
      const frame = view.captureCharFrame()
      expect(frame).toContain("Updated")
      expect(frame).not.toContain("Implementation")
      const rows = frame.split("\n").map((row) => row.trim())
      expect(rows[rows.indexOf("Updated") + 1]).toBe("")
      expect(rows[rows.indexOf("Subsection") + 1]).toBe("First paragraph.")
      const first = rows.indexOf("First paragraph.")
      expect(rows[first + 1]).toBe("")
      expect(rows[first + 2]).toBe("Second paragraph.")
      expect(frame).toContain("• Official:")
      expect(frame).toContain("• Python client")
      const codes = codeBlocks(view.renderer.root)
      const prose = codes.find((block) => block.content.includes("A readable prose"))!
      expect(prose.width).toBe(Math.min(width, 84))
      const python = codes.find((block) => block.filetype === "python")!
      expect(python.parent!.width).toBe(Math.min(width, 84))
      const spans = view.captureSpans().lines.flatMap((line) => line.spans)
      const keyword = spans.find((span) => span.text.trim() === "from")!
      const string = spans.find((span) => span.text.includes("localhost"))!
      expect(keyword.fg.equals(string.fg)).toBe(false)
      expect(codes.find((block) => block.filetype === "rust")?.plainText).toContain('println!("qdrant")')
    }
  } finally {
    view.renderer.destroy()
  }
}, 15_000)

test("references, image captions, nested fences, and plain-text documents keep their intended presentation", async () => {
  const [plainText, setPlainText] = createSignal(false)
  const [content, setContent] = createSignal(`The \`nested\` option links to #11126 and [the guide](CONTRIBUTING.md).

![Screenshot](images/ui.png)

- A nested example:

  \`\`\`json
  {"nested": true}
  \`\`\`

  \`\`\`md
  ## Literal heading #777
  \`\`\`

> [!NOTE]
> See #42.
>
> \`\`\`python
> print("#555 stays code")
> \`\`\``)
  const view = await testRender(() => <ThemeProvider name="github"><MarkdownSample
    content={content()} plainText={plainText()}
    context={{ repositoryUrl: "https://github.com/qdrant/qdrant", ref: "dev", path: "README.md" }}
  /></ThemeProvider>, { width: 120, height: 60 })
  try {
    for (const width of [120, 40]) {
      view.resize(width, 60)
      await settle(view)
      const frame = view.captureCharFrame()
      expect(frame).toContain("#11126")
      expect(frame).not.toContain("\\#11126")
      expect(frame).toContain("▧ Screenshot")
      expect(frame).not.toContain("Image:")
      expect(frame).not.toContain("```")
      const codes = codeBlocks(view.renderer.root)
      for (const filetype of ["json", "python", "markdown"]) {
        const code = codes.find((block) => block.filetype === filetype && !block.conceal)!
        const panel = code.parent!
        expect(code.screenY - panel.screenY).toBe(0) // Single-line fences omit the standalone label and padding rows.
        expect(panel.screenY + panel.height - code.screenY - code.height).toBe(0)
      }
      expect(codes.find((block) => block.filetype === "markdown" && !block.conceal)?.plainText).toContain("## Literal heading #777")
      const spans = view.captureSpans().lines.flatMap((line) => line.spans)
      const reference = spans.find((span) => span.text.includes("#11126"))!
      const link = spans.find((span) => span.text === "the guide")!
      expect(reference.fg.equals(link.fg)).toBe(true)
      const marker = spans.find((span) => span.text.includes("▧"))!
      const caption = spans.find((span) => span.text === "Screenshot")!
      expect(marker.fg.equals(caption.fg)).toBe(false)
      const inline = spans.find((span) => span.text.trim() === "nested")!
      const prose = spans.find((span) => span.text.includes("option links"))!
      expect(inline.fg.equals(prose.fg)).toBe(true)
    }
    setPlainText(true)
    setContent("  Apache License\n  Version 2.0\n\n#11126 stays literal; this is not Markdown.")
    await settle(view)
    const frame = view.captureCharFrame()
    expect(frame.split("\n").some((row) => row.startsWith("  Apache License"))).toBe(true)
    expect(frame).toContain("#11126 stays literal")
    expect(codeBlocks(view.renderer.root)).toHaveLength(0)
  } finally {
    view.renderer.destroy()
  }
}, 15_000)

test("review comments stay hidden and prose escapes render without changing code", async () => {
  const view = await testRender(() => <ThemeProvider name="github"><MarkdownSample content={`<!-- walkthrough_start -->
## Walkthrough

Review <!-- inline marker --> summary.

- Adds a feature.
  <!-- change_assessment_start
  hidden metadata -->

  **Estimated effort:** \\~20 minutes; \\*literal\\* punctuation.

<!-- walkthrough_end -->

Inline code: \`\\~20\`

\`\`\`text
<!-- literal code comment -->
\\~20 minutes
\`\`\``} /></ThemeProvider>, { width: 100, height: 35 })
  try {
    await settle(view)
    const frame = view.captureCharFrame()
    expect(frame).toContain("Walkthrough")
    expect(frame).not.toContain("walkthrough_start")
    expect(frame).not.toContain("walkthrough_end")
    expect(frame).not.toContain("inline marker")
    expect(frame).not.toContain("hidden metadata")
    expect(frame).not.toContain("change_assessment_start")
    expect(frame).toContain("Estimated effort: ~20 minutes; *literal* punctuation.")
    expect(frame).toContain(String.raw`Inline code:  \~20`)
    expect(frame).toContain("<!-- literal code comment -->")
    expect(codeBlocks(view.renderer.root).find((block) => block.filetype === "text")?.plainText).toContain(String.raw`\~20 minutes`)
  } finally {
    view.renderer.destroy()
  }
}, 15_000)


test("overview layout centers documents or uses available width independently of the About sidebar", async () => {
  const [layout, setLayout] = createSignal<DetailLayout>("centered")
  const [sidebar, setSidebar] = createSignal<AboutSidebar>("hide")
  const documents = [{ ...repositoryDocumentsFixture[0]!, resource: {
    status: "ready" as const, value: "Overview prose.\n\n```text\nexample code\n```",
  } }]
  const view = await testRender(() => <ThemeProvider name="github"><OverviewScreen
    repo={githubDataFixture.repo} documents={{ status: "ready", value: documents }}
    detailLayout={layout()} aboutSidebar={sidebar()} showScrollbar={false} scrollRef={() => {}}
  /></ThemeProvider>, { width: 160, height: 30 })
  try {
    for (const about of ["hide", "show"] as const) {
      setSidebar(about)
      setLayout("centered")
      await settle(view)
      const prose = () => codeBlocks(view.renderer.root).find((block) => block.content.includes("Overview prose"))!
      const panel = () => codeBlocks(view.renderer.root).find((block) => block.filetype === "text")!.parent!
      expect(prose().width).toBe(84)
      expect(panel().width).toBe(84)
      const centeredX = prose().screenX
      setLayout("wide")
      await settle(view)
      expect(prose().width).toBeGreaterThan(84)
      expect(panel().width).toBe(prose().width)
      expect(prose().screenX).toBeLessThan(centeredX)
      expect(view.captureCharFrame().includes("About")).toBe(about === "show")
    }
    view.resize(76, 30)
    setSidebar("hide")
    for (const mode of ["centered", "wide"] as const) {
      setLayout(mode)
      await settle(view)
      const prose = codeBlocks(view.renderer.root).find((block) => block.content.includes("Overview prose"))!
      expect(prose.width).toBeLessThanOrEqual(76)
      expect(view.captureCharFrame()).toContain("example code")
    }
  } finally {
    view.renderer.destroy()
  }
}, 15_000)


test("minimal Markdown switches live without losing structure, links, or literal code", async () => {
  const [style, setStyle] = createSignal<MarkdownStyle>("rich")
  const [mode, setMode] = createSignal<"dark" | "light">("dark")
  const content = `# Heading

[Guide](https://example.com/guide) and **important** text.

- [x] Completed task
- [ ] Pending task

![Screenshot](https://example.com/ui.png)

<form>Static form text<input type="image" src="file:///tmp/local-file" alt="Hidden control"></form>

> [!WARNING]
> Keep this warning.

- Nested code:

  \`\`\`json
  {
    "enabled": true, "count": 12
  }
  \`\`\`

\`\`\`md
## Literal heading
\`\`\`

\`\`\`html
<input list="d"><datalist id="d"></datalist>
\`\`\`

| Resource | Status |
| --- | --- |
| [Docs](https://example.com/docs) | Ready |

\`\`\`diff
- removed
+ added
\`\`\``
  const view = await testRender(() => (
    <ThemeProvider name="github" mode={mode()}>
      <MarkdownProvider style={style()}><MarkdownSample content={content} /></MarkdownProvider>
    </ThemeProvider>
  ), { width: 100, height: 60 })
  const json = () => codeBlocks(view.renderer.root).find((block) => block.filetype === "json")!
  try {
    await settle(view)
    expect(json().screenY - json().parent!.screenY).toBe(2)
    expect(view.captureCharFrame()).toContain("─")
    for (const text of ["Completed task", "Pending task", "▧ Screenshot", "Static form text"])
      expect(view.captureCharFrame()).toContain(text)
    expect(view.captureCharFrame()).not.toContain("Hidden control")
    setStyle("minimal")
    for (const appearance of ["dark", "light"] as const) {
      setMode(appearance)
      await settle(view)
      const frame = view.captureCharFrame()
      for (const text of ["Heading", "Guide and important text.", "Warning", "Keep this warning.", "Nested code:", "Docs", "Ready", "## Literal heading"])
        expect(frame).toContain(text)
      for (const text of ["Completed task", "Pending task", "▧ Screenshot", "Static form text"])
        expect(frame).toContain(text)
      expect(frame).not.toContain("Hidden control")
      expect(frame).not.toContain("local-file")
      expect(codeBlocks(view.renderer.root).find((block) => block.filetype === "html")?.plainText)
        .toBe('<input list="d"><datalist id="d"></datalist>')
      expect(frame).not.toContain("https://example.com")
      expect(frame).not.toMatch(/[─│┌└]/)
      expect(frame.split("\n").some((row) => row.trim() === "json")).toBe(false)
      expect(json().screenY - json().parent!.screenY).toBe(0)
      expect(json().plainText).toBe('{\n  "enabled": true, "count": 12\n}')
      const foreground = RGBA.fromHex(resolveTheme("github", appearance).text)
      expect(json().syntaxStyle.getStyle("number")?.fg).toEqual(foreground)
      expect(json().syntaxStyle.getStyle("string")?.fg).toEqual(foreground)
      const spans = view.captureSpans().lines.flatMap((line) => line.spans)
      expect(spans.find((span) => span.text.includes('"enabled"'))?.fg).toEqual(foreground)
      expect(spans.find((span) => span.text.includes("added"))?.fg.equals(spans.find((span) => span.text.includes("removed"))!.fg)).toBe(false)
    }
    setStyle("rich")
    await settle(view)
    expect(json().screenY - json().parent!.screenY).toBe(2)
    expect(view.captureCharFrame()).toContain("─")
    expect(json().syntaxStyle.getStyle("number")?.fg?.equals(json().syntaxStyle.getStyle("string")!.fg!)).toBe(false)
  } finally {
    view.renderer.destroy()
  }
}, 15_000)


test("task markers, deleted text, and lower headings render semantic styles in rich and minimal Markdown", async () => {
  const [style, setStyle] = createSignal<MarkdownStyle>("rich")
  const view = await testRender(() => <ThemeProvider name="github"><MarkdownProvider style={style()}>
    <MarkdownSample content={`#### Fourth

##### Fifth

###### Sixth

~~Obsolete~~ and current.

- [x] Finished
- [ ] Pending
  - [x] Nested finished`} />
  </MarkdownProvider></ThemeProvider>, { width: 80, height: 30 })
  try {
    for (const preference of ["rich", "minimal", "rich"] as const) {
      setStyle(preference)
      await settle(view)
      const frame = view.captureCharFrame()
      expect(frame).toContain("☑ Finished")
      expect(frame).toContain("☐ Pending")
      expect(frame).toContain("☑ Nested finished")
      expect(frame).not.toContain("[x]")
      const spans = view.captureSpans().lines.flatMap((line) => line.spans)
      const span = (text: string) => spans.find((item) => item.text.trim() === text || item.text.trim().startsWith(`${text} `))!
      expect(span("Obsolete").attributes & TextAttributes.STRIKETHROUGH).not.toBe(0)
      expect(span("Fourth").attributes & TextAttributes.UNDERLINE).not.toBe(0)
      expect(span("Fifth").attributes & TextAttributes.BOLD).not.toBe(0)
      expect(span("Sixth").attributes & TextAttributes.ITALIC).not.toBe(0)
      expect(span("Fourth").attributes & TextAttributes.BOLD).toBe(0)
      const checked = span("☑")
      const unchecked = span("☐")
      expect(checked.attributes & TextAttributes.BOLD).not.toBe(0)
      if (preference === "minimal") {
        const foreground = RGBA.fromHex(resolveTheme("github", "dark").text)
        for (const text of ["☑", "☐", "Obsolete", "Fourth", "Fifth", "Sixth"])
          expect(span(text).fg).toEqual(foreground)
      } else expect(checked.fg.equals(unchecked.fg)).toBe(false)
    }
  } finally { view.renderer.destroy() }
}, 15_000)

test("Markdown hierarchy, compact examples, and inline padding respect rich and minimal styles", async () => {
  const [style, setStyle] = createSignal<MarkdownStyle>("rich")
  const content = `# Bun

[Documentation](https://example.com/docs) · [Discord](https://example.com/chat)

## What is Bun?

Bun runs \`bun\` and [\`bun test\`](https://example.com/test).

### Install

Run this:

\`\`\`bash
bun install
\`\`\`

\`\`\`typescript
const runtime = "bun"
console.log(runtime)
\`\`\``
  const view = await testRender(() => <ThemeProvider name="github"><MarkdownProvider style={style()}>
    <MarkdownSample content={content} />
  </MarkdownProvider></ThemeProvider>, { width: 120, height: 50 })
  try {
    for (const preference of ["rich", "minimal", "rich"] as const) {
      setStyle(preference)
      for (const width of [120, 44]) {
        view.resize(width, 50)
        await settle(view)
        const frame = view.captureCharFrame()
        const rows = frame.split("\n").map((row) => row.trim())
        const rules = rows.filter((row) => /^─+$/.test(row))
        expect(rules).toHaveLength(preference === "rich" ? 1 : 0)
        const title = rows.indexOf("Bun")
        expect(rows[title + (preference === "rich" ? 2 : 1)]).toContain("Documentation")
        expect(rows[rows.indexOf("What is Bun?") + 1]).toContain("Bun runs")
        expect(rows[rows.indexOf("Install") + 1]).toBe("Run this:")
        const codes = codeBlocks(view.renderer.root)
        const bash = codes.find((code) => code.filetype === "bash")!
        expect(bash.parent!.height).toBe(1)
        expect(bash.plainText).toBe("bun install")
        expect(rows).not.toContain("bash")
        const multiline = codes.find((code) => code.filetype === "typescript")!
        expect(multiline.screenY - multiline.parent!.screenY).toBe(preference === "rich" ? 2 : 0)
        expect(multiline.plainText).toBe('const runtime = "bun"\nconsole.log(runtime)')
        const spans = view.captureSpans().lines.flatMap((line) => line.spans)
        const h1 = spans.find((span) => span.text.trim() === "Bun")!
        const h2 = spans.find((span) => span.text.trim() === "What is Bun?")!
        const h3 = spans.find((span) => span.text.trim() === "Install")!
        expect(h1.attributes & TextAttributes.BOLD).not.toBe(0)
        expect(h2.attributes & TextAttributes.BOLD).not.toBe(0)
        expect(h3.attributes & TextAttributes.ITALIC).not.toBe(0)
        expect(h3.attributes & TextAttributes.BOLD).toBe(0)
        if (preference === "rich") {
          const chip = spans.find((span) => span.text.trim() === "bun")!
          expect(chip.text).toBe(" bun ")
          const linkedChip = spans.find((span) => span.text.trim() === "bun test")!
          expect(linkedChip.text).toBe(" bun test ")
          expect(chip.bg).toEqual(linkedChip.bg)
        } else {
          expect(h1.attributes & TextAttributes.UNDERLINE).not.toBe(0)
          expect(frame).toContain("Bun runs bun and bun test.")
        }
        expect(frame).not.toContain("https://example.com")
      }
    }
  } finally { view.renderer.destroy() }
}, 15_000)

test("GitHub alert borders keep their colors with document source anchors", async () => {
  const [anchored, setAnchored] = createSignal(false)
  const colors = appColors(resolveTheme("opengh"))
  const alerts = [["NOTE", "Note", colors.blue], ["TIP", "Tip", colors.green],
    ["IMPORTANT", "Important", colors.purple], ["WARNING", "Warning", colors.yellow],
    ["CAUTION", "Caution", colors.red]] as const
  const content = alerts.map(([marker]) => `> [!${marker}]\n> Alert body.`).join("\n\n")
  const Sample = () => {
    const theme = useTheme()
    const style = createReactiveMarkdownStyle(theme.colors, theme.theme)
    return <GitHubMarkdown content={content} syntaxStyle={style()}
      anchorRef={anchored() ? () => {} : undefined} />
  }
  const view = await testRender(() => <ThemeProvider name="opengh"><MarkdownProvider style="rich">
    <Sample />
  </MarkdownProvider></ThemeProvider>, { width: 80, height: 32 })
  try {
    for (const anchors of [false, true]) {
      setAnchored(anchors)
      await settle(view)
      for (const [, title, color] of alerts) {
        const row = view.captureSpans().lines.find((line) => line.spans.some((span) => span.text.includes(title)))
        expect(row?.spans.find((span) => span.text.includes("│"))?.fg).toEqual(RGBA.fromHex(color))
      }
    }
  } finally { view.renderer.destroy() }
})
