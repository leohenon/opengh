import { expect, test } from "bun:test"
import { CodeRenderable, type Renderable } from "@opentui/core"
import type { GitHubMarkdownContext } from "../src/ui/github-markdown"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { GitHubMarkdown } from "../src/ui/components/github-markdown"
import { createReactiveMarkdownStyle } from "../src/ui/markdown-style"
import { ThemeProvider, useTheme } from "../src/ui/theme"

function MarkdownSample(props: { content: string; context?: GitHubMarkdownContext; plainText?: boolean }) {
  const { colors, theme } = useTheme()
  const style = createReactiveMarkdownStyle(colors, theme)
  return <GitHubMarkdown content={props.content} syntaxStyle={style()} context={props.context} plainText={props.plainText} />
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
  const view = await testRender(() => <ThemeProvider name={theme()}><MarkdownSample content={content()} /></ThemeProvider>, { width: 120, height: 60, useThread: false })
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
      const labelRow = rows.findIndex((row) => row.trim() === "json")
      const codeRow = rows.findIndex((row) => row.includes('{"enabled"'))
      expect(labelRow).toBeGreaterThan(0)
      expect(rows[labelRow - 1]?.trim()).toBe("")
      expect(codeRow).toBe(labelRow + 1)
      expect(rows[codeRow + 1]?.trim()).toBe("")
      expect(rows[labelRow]?.indexOf("json")).toBe(width < 80 ? 1 : 2)
      const codes = codeBlocks(view.renderer.root)
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
      expect(rows[rows.indexOf("Updated") + 1]).toMatch(/^─+$/)
      expect(rows[rows.indexOf("Subsection") + 1]).toBe("")
      const first = rows.indexOf("First paragraph.")
      expect(rows[first + 1]).toBe("")
      expect(rows[first + 2]).toBe("Second paragraph.")
      expect(frame).toContain("• Official:")
      expect(frame).toContain("• Python client")
      const codes = codeBlocks(view.renderer.root)
      const prose = codes.find((block) => block.content.includes("A readable prose"))!
      expect(prose.width).toBe(Math.min(width, 96))
      const python = codes.find((block) => block.filetype === "python")!
      expect(python.parent!.width).toBe(width)
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
  /></ThemeProvider>, { width: 120, height: 60, useThread: false })
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
        expect(code.screenY - panel.screenY).toBe(2) // One padding row + language label.
        expect(panel.screenY + panel.height - code.screenY - code.height).toBe(1)
      }
      expect(codes.find((block) => block.filetype === "markdown" && !block.conceal)?.plainText).toContain("## Literal heading #777")
      const spans = view.captureSpans().lines.flatMap((line) => line.spans)
      const reference = spans.find((span) => span.text.includes("#11126"))!
      const link = spans.find((span) => span.text === "the guide")!
      expect(reference.fg.equals(link.fg)).toBe(true)
      const marker = spans.find((span) => span.text.includes("▧"))!
      const caption = spans.find((span) => span.text === "Screenshot")!
      expect(marker.fg.equals(caption.fg)).toBe(false)
      const inline = spans.find((span) => span.text === "nested")!
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
