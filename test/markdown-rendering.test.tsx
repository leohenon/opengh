import { expect, spyOn, test } from "bun:test"
import { CodeRenderable, MarkdownRenderable, RGBA, TextAttributes, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import type { GitHubMarkdownContext } from "../src/ui/github-markdown"
import type { MarkdownAnchorResolver } from "../src/ui/markdown-anchors"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { PageWidth, DetailsPlacement, MarkdownStyle } from "../src/config"
import type { RepositoryDocumentState, ResourceState } from "../src/repository-state"
import { githubDataFixture, repositoryDocumentsFixture } from "./fixtures/github-data"
import { OverviewScreen, type AboutSidebar } from "../src/ui/pages/overview"
import { GitHubMarkdown } from "../src/ui/components/github-markdown"
import { createReactiveMarkdownStyle } from "../src/ui/markdown-style"
import { ThemeProvider, useTheme } from "../src/ui/theme"
import { MarkdownProvider } from "../src/ui/markdown-preferences"
import { appColors, resolveTheme } from "../src/theme"
import { createRenderedSearch } from "../src/ui/rendered-search"
import { IconProvider } from "../src/ui/icon-style"
import type { IconStyle } from "../src/config"

function MarkdownSample(props: {
  content: string
  context?: GitHubMarkdownContext
  plainText?: boolean
  anchorRef?: (resolver: MarkdownAnchorResolver | undefined) => void
}) {
  const { colors, theme } = useTheme()
  const style = createReactiveMarkdownStyle(colors, theme)
  return (
    <GitHubMarkdown
      content={props.content}
      syntaxStyle={style()}
      context={props.context}
      plainText={props.plainText}
      anchorRef={props.anchorRef}
    />
  )
}

function codeBlocks(node: Renderable): CodeRenderable[] {
  return [...(node instanceof CodeRenderable ? [node] : []), ...node.getChildren().flatMap(codeBlocks)]
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
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <MarkdownProvider style={style()}>
          <MarkdownSample
            content={content()}
            anchorRef={(resolver) => {
              resolveAnchor = resolver
            }}
          />
        </MarkdownProvider>
      </ThemeProvider>
    ),
    { width: 120, height: 20 },
  )
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
      setContent(
        "Recovered **Markdown**.\n\n| Resource | Status |\n| --- | --- |\n| Ragged |\n| Complete | Ready |\n\n```text\nfresh code\n```",
      )
      await settle(view)
      const recovered = view.captureCharFrame()
      for (const text of ["Recovered Markdown.", "Resource", "Status", "Ragged", "Complete", "Ready"]) expect(recovered).toContain(text)
      expect(recovered).not.toContain("plain-text preview")
      expect(codeBlocks(view.renderer.root).length).toBeGreaterThan(0)
      expect(await resolveAnchor?.("L1")).toBeDefined()
      const codeTarget = await resolveAnchor?.("L9")
      expect(codeTarget?.node).toBeInstanceOf(CodeRenderable)
      expect((codeTarget?.node as CodeRenderable).content.trim()).toBe("fresh code")
      expect(await resolveAnchor?.("initial")).toBeUndefined()
      expect(recovered).not.toContain("stale code")
    }
  } finally {
    view.renderer.destroy()
  }
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
  const view = await testRender(
    () => (
      <ThemeProvider name={theme()}>
        <MarkdownSample content={content()} />
      </ThemeProvider>
    ),
    { width: 120, height: 60 },
  )
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
      const highlights = await linked.onHighlight!(result.highlights ?? [], {
        content: linked.content,
        filetype: "markdown",
        syntaxStyle: linked.syntaxStyle,
      })
      const { treeSitterToTextChunks } = await import("@opentui/core")
      const chunks = treeSitterToTextChunks(linked.content, highlights!, linked.syntaxStyle)
      const decorated = await linked.onChunks!(chunks, {
        content: linked.content,
        filetype: "markdown",
        syntaxStyle: linked.syntaxStyle,
        highlights: highlights!,
      })
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

${"A prose line fills the width it is given. ".repeat(6)}

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
      const prose = codes.find((block) => block.content.includes("A prose line"))!
      expect(prose.width).toBe(width)
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
  let resolveAnchor: MarkdownAnchorResolver | undefined
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <MarkdownSample
          content={content()}
          plainText={plainText()}
          anchorRef={(resolver) => {
            resolveAnchor = resolver
          }}
          context={{ repositoryUrl: "https://github.com/qdrant/qdrant", ref: "dev", path: "README.md" }}
        />
      </ThemeProvider>
    ),
    { width: 120, height: 60 },
  )
  try {
    for (const width of [120, 40]) {
      view.resize(width, 60)
      await settle(view)
      const frame = view.captureCharFrame()
      expect(frame).toContain("#11126")
      expect(frame).not.toContain("\\#11126")
      expect(frame).toContain("│ image")
      expect(frame).toContain("│ Screenshot")
      const imageAnchor = await resolveAnchor?.("L3")
      expect(imageAnchor).toBeDefined()
      expect(imageAnchor!.node.y + imageAnchor!.row).toBe(frame.split("\n").findIndex((row) => row.includes("│ Screenshot")))
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
      const marker = spans.find((span) => span.text.trim() === "image")!
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

test("hard breaks render as newlines without hiding literal backslashes in code", async () => {
  const content = [
    "<p><em>Issue tracker.\n<br>For GSoC.</em></p>",
    "First line.\\\nSecond line.",
    "Inline `C:\\temp`.",
    "```text\nfirst\\\nsecond\n```",
  ].join("\n\n")
  const view = await testRender(() => <MarkdownSample content={content} />, { width: 60, height: 20 })
  try {
    await settle(view)
    const text = view
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
    expect(text).toContain("Issue tracker.\nFor GSoC.")
    expect(text).toContain("First line.\nSecond line.")
    expect(text).toContain("C:\\temp")
    expect(codeBlocks(view.renderer.root).find((block) => block.filetype === "text")?.plainText).toBe("first\\\nsecond")
  } finally {
    view.renderer.destroy()
  }
})

test("review comments stay hidden and prose escapes render without changing code", async () => {
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <MarkdownSample
          content={`<!-- walkthrough_start -->
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
\`\`\``}
        />
      </ThemeProvider>
    ),
    { width: 100, height: 35 },
  )
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

test("overview refresh preserves unchanged Markdown blocks and scroll position", async () => {
  const content = "# Stable README\n\n```ts\nconst example = true\n```\n\n" + "Overview prose.\n\n".repeat(40)
  const initial: RepositoryDocumentState[] = [
    { ...repositoryDocumentsFixture[0]!, resource: { status: "ready", value: content } },
    repositoryDocumentsFixture[1]!,
  ]
  const [repo, setRepo] = createSignal(githubDataFixture.repo)
  const [documents, setDocuments] = createSignal<ResourceState<RepositoryDocumentState[]>>({ status: "ready", value: initial })
  let scroll: ScrollBoxRenderable | undefined
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <OverviewScreen
          repo={repo()}
          documents={documents()}
          aboutSidebar="hide"
          showScrollbar={false}
          scrollRef={(value) => {
            scroll = value
          }}
        />
      </ThemeProvider>
    ),
    { width: 120, height: 25 },
  )
  try {
    await settle(view)
    scroll!.scrollTo(5)
    await view.flush()
    const blocks = codeBlocks(view.renderer.root)
    const frame = view.captureCharFrame()
    const scrollTop = scroll!.scrollTop
    expect(blocks.length).toBeGreaterThan(0)
    expect(scrollTop).toBeGreaterThan(0)
    const checkStable = async () => {
      await settle(view)
      expect(blocks.every((block) => !block.isDestroyed)).toBe(true)
      const current = codeBlocks(view.renderer.root)
      expect(current.length).toBe(blocks.length)
      expect(current.every((block, index) => block === blocks[index])).toBe(true)
      expect(scroll!.scrollTop).toBe(scrollTop)
      expect(view.captureCharFrame()).toBe(frame)
    }

    setRepo((current) => ({ ...current, stars: current.stars + 1 }))
    await checkStable()
    setDocuments({ status: "loading", phase: "load", value: initial })
    await checkStable()
    const loading = initial.map((document) => ({
      ...document,
      resource: { status: "loading" as const, phase: "load" as const, value: document.resource.value },
    }))
    setDocuments({ status: "ready", value: loading })
    await checkStable()
    setDocuments({
      status: "ready",
      value: [loading[0]!, { ...initial[1]!, resource: { status: "ready", value: "Updated secondary document" } }],
    })
    await checkStable()
    setDocuments({ status: "ready", value: initial.map((document) => ({ ...document, resource: { ...document.resource } })) })
    await checkStable()

    setDocuments({
      status: "ready",
      value: [{ ...initial[0]!, resource: { status: "ready", value: "# Updated README\n\n```ts\nconst updated = true\n```" } }],
    })
    scroll!.scrollTo(0)
    await settle(view)
    expect(view.captureCharFrame()).toContain("Updated README")
    expect(codeBlocks(view.renderer.root).some((block) => block.content.includes("const updated = true"))).toBe(true)
    expect(codeBlocks(view.renderer.root).some((block) => block.content.includes("const example = true"))).toBe(false)
  } finally {
    view.renderer.destroy()
  }
})

test("overview still updates relative links and plain-text mode when the document source changes", async () => {
  const [document, setDocument] = createSignal<RepositoryDocumentState>({
    ...repositoryDocumentsFixture[0]!,
    resource: { status: "ready", value: "[Guide](guide.md)" },
  })
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <OverviewScreen
          repo={githubDataFixture.repo}
          documents={{ status: "ready", value: [document()] }}
          aboutSidebar="hide"
          showScrollbar={false}
          scrollRef={() => {}}
        />
      </ThemeProvider>
    ),
    { width: 120, height: 15 },
  )
  const links = () => {
    const urls = new Set<string>()
    for (let y = 0; y < 15; y++)
      for (let x = 0; x < 120; x++) {
        const url = view.renderer.getLinkAt(x, y)
        if (url) urls.add(url)
      }
    return [...urls]
  }
  try {
    await settle(view)
    expect(links()).toContain("https://github.com/anomalyco/opentui/blob/main/guide.md")
    setDocument((current) => ({ ...current, ref: "dev" }))
    await settle(view)
    expect(links()).toContain("https://github.com/anomalyco/opentui/blob/dev/guide.md")
    setDocument((current) => ({ ...current, path: "docs/README.md" }))
    await settle(view)
    expect(links()).toContain("https://github.com/anomalyco/opentui/blob/dev/docs/guide.md")
    setDocument((current) => ({ ...current, repository: "another/repo" }))
    await settle(view)
    expect(links()).toContain("https://github.com/another/repo/blob/dev/docs/guide.md")
    setDocument((current) => ({ ...current, path: "LICENSE" }))
    await settle(view)
    expect(view.captureCharFrame()).toContain("[Guide](guide.md)")
    expect(codeBlocks(view.renderer.root)).toHaveLength(0)
  } finally {
    view.renderer.destroy()
  }
})

test("overview tabs and documents share the reading column in both layouts, with or without About", async () => {
  const [layout, setLayout] = createSignal<PageWidth>("centered")
  const [sidebar, setSidebar] = createSignal<AboutSidebar>("hide")
  const [documents, setDocuments] = createSignal<RepositoryDocumentState[]>([
    {
      ...repositoryDocumentsFixture[0]!,
      resource: {
        status: "ready" as const,
        value: "Overview prose.\n\n```text\nexample code\n```",
      },
    },
    ...repositoryDocumentsFixture.slice(1),
  ])
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <OverviewScreen
          repo={githubDataFixture.repo}
          documents={{ status: "ready", value: documents() }}
          pageWidth={layout()}
          aboutSidebar={sidebar()}
          showScrollbar={false}
          scrollRef={() => {}}
        />
      </ThemeProvider>
    ),
    { width: 200, height: 30 },
  )
  const tabRow = () =>
    view
      .captureCharFrame()
      .split("\n")
      .find((row) => row.includes("README"))!
  try {
    for (const about of ["hide", "show"] as const) {
      setSidebar(about)
      setLayout("centered")
      await settle(view)
      const prose = () => codeBlocks(view.renderer.root).find((block) => block.content.includes("Overview prose"))!
      const panel = () => codeBlocks(view.renderer.root).find((block) => block.filetype === "text")!.parent!
      expect(prose().width).toBe(120)
      expect(panel().width).toBe(120)
      const centeredX = prose().screenX
      expect(tabRow()).toContain("Contributing")
      expect(tabRow().search(/\S/)).toBe(centeredX)
      setLayout("wide")
      await settle(view)
      expect(prose().width).toBeGreaterThan(120)
      expect(panel().width).toBe(prose().width)
      expect(prose().screenX).toBeLessThan(centeredX)
      expect(tabRow().search(/\S/)).toBe(prose().screenX)
      expect(view.captureCharFrame().includes("About")).toBe(about === "show")
    }
    view.resize(76, 30)
    setSidebar("hide")
    for (const mode of ["centered", "wide"] as const) {
      setLayout(mode)
      await settle(view)
      const prose = codeBlocks(view.renderer.root).find((block) => block.content.includes("Overview prose"))!
      expect(prose.width).toBeLessThanOrEqual(76)
      expect(tabRow().search(/\S/)).toBe(prose.screenX)
      expect(view.captureCharFrame()).toContain("example code")
    }

    view.resize(160, 30)
    const license = "GNU Lesser General Public License v2.1 or, at your option, any later published version"
    setDocuments((items) => items.map((item) => (item.path === "LICENSE" ? { ...item, label: license } : item)))
    setLayout("centered")
    await settle(view)
    expect(tabRow()).toContain("‹ README ›")
    setLayout("wide")
    await settle(view)
    expect(tabRow()).toContain(license)
  } finally {
    view.renderer.destroy()
  }
}, 15_000)

test.each(["centered", "wide"] as const)(
  "inline About shares the %s reading column and scrolls away in short terminals",
  async (layout) => {
    const [placement, setPlacement] = createSignal<DetailsPlacement>("auto")
    const [interactive, setInteractive] = createSignal(true)
    let scroll: ScrollBoxRenderable | undefined
    const view = await testRender(
      () => (
        <ThemeProvider name="github">
          <OverviewScreen
            repo={{ ...githubDataFixture.repo, description: "A terminal library. https://example.com", parentRepository: "parent/repo" }}
            interactive={interactive()}
            documents={{
              status: "ready",
              value: [{ ...repositoryDocumentsFixture[0]!, resource: { status: "ready", value: "Overview body.\n\n".repeat(20) } }],
            }}
            pageWidth={layout}
            detailsPlacement={placement()}
            aboutSidebar="show"
            showScrollbar={false}
            scrollRef={(value) => {
              scroll = value
            }}
          />
        </ThemeProvider>
      ),
      { width: 160, height: 24 },
    )
    const links = () => {
      const urls = new Set<string>()
      for (let y = 0; y < view.renderer.height; y++)
        for (let x = 0; x < view.renderer.width; x++) {
          const url = view.renderer.getLinkAt(x, y)
          if (url) urls.add(url)
        }
      return urls
    }
    const inline = () => scroll!.findDescendantById("overview-inline-about")
    const sidebar = () => view.renderer.root.findDescendantById("overview-about-sidebar")
    const prose = () => codeBlocks(view.renderer.root).find((block) => block.content.includes("Overview body."))!
    try {
      await settle(view)
      expect(sidebar()).toBeDefined()
      expect(inline()).toBeUndefined()
      setPlacement("inline")
      await settle(view)
      expect(sidebar()).toBeUndefined()
      expect(inline()!.x).toBe(prose().x)
      expect(inline()!.width).toBe(prose().width)
      expect(prose().width).toBe(layout === "centered" ? 120 : 152)
      const tabs = scroll!.findDescendantById("overview-document-tabs")!
      expect(inline()!.y + inline()!.height).toBeLessThan(tabs.y)
      expect(tabs.y + tabs.height).toBeLessThan(prose().y)
      const children = inline()!.getChildren()
      expect(children[0]!.y).toBe(inline()!.y)
      expect(view.captureCharFrame()).not.toContain("About")
      expect(children.at(-1)!.y).toBe(children.at(-2)!.y + children.at(-2)!.height + 1)
      expect(view.captureCharFrame()).toContain("─".repeat(prose().width))
      expect(links().has("https://example.com")).toBe(true)
      expect(links().has("https://github.com/parent/repo")).toBe(true)
      setInteractive(false)
      await settle(view)
      expect(links().size).toBe(0)
      setInteractive(true)

      view.resize(50, 8)
      setPlacement("auto")
      await settle(view)
      expect(sidebar()).toBeUndefined()
      expect(scroll!.viewport.width).toBe(46)
      expect(scroll!.viewport.height).toBe(6)
      expect(inline()!.width).toBe(prose().width)
      expect(prose().width).toBe(42)
      expect(view.captureCharFrame()).toContain("A terminal library.")
      scroll!.scrollTo(inline()!.height + 2)
      await view.flush()
      expect(inline()!.y + inline()!.height).toBeLessThanOrEqual(scroll!.viewport.y)
      expect(view.captureCharFrame()).not.toContain("A terminal library.")
      expect(view.captureCharFrame()).toContain("Overview body.")
    } finally {
      view.renderer.destroy()
    }
  },
)

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
  const view = await testRender(
    () => (
      <ThemeProvider name="github" mode={mode()}>
        <MarkdownProvider style={style()}>
          <MarkdownSample content={content} />
        </MarkdownProvider>
      </ThemeProvider>
    ),
    { width: 100, height: 60 },
  )
  const json = () => codeBlocks(view.renderer.root).find((block) => block.filetype === "json")!
  try {
    await settle(view)
    expect(json().screenY - json().parent!.screenY).toBe(2)
    expect(view.captureCharFrame()).toContain("─")
    for (const text of ["Completed task", "Pending task", "│ Screenshot", "Static form text"])
      expect(view.captureCharFrame()).toContain(text)
    expect(view.captureCharFrame()).not.toContain("Hidden control")
    setStyle("minimal")
    for (const appearance of ["dark", "light"] as const) {
      setMode(appearance)
      await settle(view)
      const frame = view.captureCharFrame()
      for (const text of [
        "Heading",
        "Guide and important text.",
        "Warning",
        "Keep this warning.",
        "Nested code:",
        "Docs",
        "Ready",
        "## Literal heading",
      ])
        expect(frame).toContain(text)
      for (const text of ["Completed task", "Pending task", "│ Screenshot", "Static form text"]) expect(frame).toContain(text)
      expect(frame).not.toContain("Hidden control")
      expect(frame).not.toContain("local-file")
      expect(codeBlocks(view.renderer.root).find((block) => block.filetype === "html")?.plainText).toBe(
        '<input list="d"><datalist id="d"></datalist>',
      )
      expect(frame).not.toContain("https://example.com")
      expect(frame).not.toMatch(/[─┌└]/)
      // Image borders identify media even when decorative Markdown borders are off.
      expect(
        frame
          .split("\n")
          .filter((row) => row.includes("│"))
          .map((row) => row.trim()),
      ).toEqual(["│ image", "│ Screenshot"])
      expect(frame.split("\n").some((row) => row.trim() === "json")).toBe(false)
      expect(json().screenY - json().parent!.screenY).toBe(0)
      expect(json().plainText).toBe('{\n  "enabled": true, "count": 12\n}')
      const foreground = RGBA.fromHex(resolveTheme("github", appearance).text)
      expect(json().syntaxStyle.getStyle("number")?.fg).toEqual(foreground)
      expect(json().syntaxStyle.getStyle("string")?.fg).toEqual(foreground)
      const spans = view.captureSpans().lines.flatMap((line) => line.spans)
      expect(spans.find((span) => span.text.includes('"enabled"'))?.fg).toEqual(foreground)
      expect(spans.find((span) => span.text.includes("added"))?.fg.equals(spans.find((span) => span.text.includes("removed"))!.fg)).toBe(
        false,
      )
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
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <MarkdownProvider style={style()}>
          <MarkdownSample
            content={`#### Fourth

##### Fifth

###### Sixth

~~Obsolete~~ and current.

- [x] Finished
- [ ] Pending
  - [x] Nested finished`}
          />
        </MarkdownProvider>
      </ThemeProvider>
    ),
    { width: 80, height: 30 },
  )
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
        for (const text of ["☑", "☐", "Obsolete", "Fourth", "Fifth", "Sixth"]) expect(span(text).fg).toEqual(foreground)
      } else expect(checked.fg.equals(unchecked.fg)).toBe(false)
    }
  } finally {
    view.renderer.destroy()
  }
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
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <MarkdownProvider style={style()}>
          <MarkdownSample content={content} />
        </MarkdownProvider>
      </ThemeProvider>
    ),
    { width: 120, height: 50 },
  )
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
  } finally {
    view.renderer.destroy()
  }
}, 15_000)

test("GitHub alert borders keep their colors with document source anchors", async () => {
  const [anchored, setAnchored] = createSignal(false)
  const colors = appColors(resolveTheme("opengh"))
  const alerts = [
    ["NOTE", "Note", colors.blue],
    ["TIP", "Tip", colors.green],
    ["IMPORTANT", "Important", colors.purple],
    ["WARNING", "Warning", colors.yellow],
    ["CAUTION", "Caution", colors.red],
  ] as const
  const content = alerts.map(([marker]) => `> [!${marker}]\n> Alert body.`).join("\n\n")
  const Sample = () => {
    const theme = useTheme()
    const style = createReactiveMarkdownStyle(theme.colors, theme.theme)
    return <GitHubMarkdown content={content} syntaxStyle={style()} anchorRef={anchored() ? () => {} : undefined} />
  }
  const view = await testRender(
    () => (
      <ThemeProvider name="opengh">
        <MarkdownProvider style="rich">
          <Sample />
        </MarkdownProvider>
      </ThemeProvider>
    ),
    { width: 80, height: 32 },
  )
  try {
    for (const anchors of [false, true]) {
      setAnchored(anchors)
      await settle(view)
      for (const [, title, color] of alerts) {
        const row = view.captureSpans().lines.find((line) => line.spans.some((span) => span.text.includes(title)))
        expect(row?.spans.find((span) => span.text.includes("│"))?.fg).toEqual(RGBA.fromHex(color))
      }
    }
  } finally {
    view.renderer.destroy()
  }
})

test("paragraph spacing settles once per parent, including hidden documents and updates", async () => {
  const [content, setContent] = createSignal(Array.from({ length: 80 }, (_, i) => `## Heading ${i}\n\nBody ${i}.`).join("\n\n"))
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <box visible={false}>
          <MarkdownSample content={content()} />
        </box>
      </ThemeProvider>
    ),
    { width: 80, height: 10 },
  )
  const find = (node: Renderable): MarkdownRenderable | undefined =>
    node instanceof MarkdownRenderable ? node : node.getChildren().map(find).find(Boolean)
  try {
    await settle(view)
    const markdown = find(view.renderer.root)!
    const children = markdown.getChildren()
    expect(children.length).toBe(160)
    for (const node of children) expect(node.onLifecyclePass).toBeNull()
    for (let i = 1; i < children.length; i += 2) expect(children[i]!.marginTop).toBe(0)
    const siblings = spyOn(markdown, "getChildren")
    for (let i = 0; i < 5; i++) await view.renderOnce()
    expect(siblings).not.toHaveBeenCalled()
    siblings.mockRestore()
    setContent("First paragraph.\n\nSecond paragraph.\n\n## New heading\n\nNew body.")
    await settle(view)
    const updated = find(view.renderer.root)!.getChildren()
    expect(updated[1]!.marginTop).toBe(1)
    expect(updated[3]!.marginTop).toBe(0)
    for (const node of updated) expect(node.onLifecyclePass).toBeNull()
  } finally {
    view.renderer.destroy()
  }
})

test("prose and code wrap only at whitespace, and frames, selections, and search keep their punctuation", async () => {
  const content = `- New test fails without the fix (\`.env.production\` value reaches the handoff) and passes with it.
- \`test/unit/security-upgrade-nudge.test.ts\`, \`test/unit/agentic-upgrade-prompts.test.ts\`, \`test/unit/prepare-latest-upgrade.test.ts\` (existing tests, unchanged behavior)
- Manually: ran \`next upgrade --agent=latest\` in a PTY with a stand-in agent on \`PATH\` that recorded its environment; before the fix it received \`.env.production\` values and \`__NEXT_PROCESSED_ENV=true\`.

\`\`\`ts
const result = await session.refresh({ force: true, generation: session.generation + 1, signal: controller.signal })
\`\`\`

${"x".repeat(100)}/tail`
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <MarkdownSample content={content} />
      </ThemeProvider>
    ),
    { width: 80, height: 24 },
  )
  try {
    await settle(view)
    const frame = view.captureCharFrame()
    const rows = frame.split("\n").map((row) => row.trimEnd())
    expect(frame).not.toMatch(/[\ufdd0-\ufdef\ufffd]/)
    expect(rows).toContain("• New test fails without the fix ( .env.production  value reaches the handoff)")
    expect(rows).toContain("•  test/unit/security-upgrade-nudge.test.ts ,")
    expect(rows).toContain("   test/unit/agentic-upgrade-prompts.test.ts ,")
    expect(rows).toContain("   PATH  that recorded its environment; before the fix it received")
    expect(rows).toContain("   .env.production  values and  __NEXT_PROCESSED_ENV=true .")
    expect(rows).toContain("  const result = await session.refresh({ force: true, generation:")
    expect(rows).toContain(`${"x".repeat(80)}`)
    expect(rows).toContain(`${"x".repeat(20)}/tail`)
    for (const row of rows) expect(row).not.toMatch(/(?:\.env\.|upgrade-|session\.|unit\/)$/)
    const prose = codeBlocks(view.renderer.root).find((block) => block.content.includes("Manually"))!
    expect(prose.plainText).toContain(".env.production")
    expect(prose.plainText).not.toMatch(/[\ufdd0-\ufdef]/)
    const code = codeBlocks(view.renderer.root).find((block) => block.content.startsWith("const result"))!
    expect(code.plainText).toBe(
      "const result = await session.refresh({ force: true, generation: session.generation + 1, signal: controller.signal })",
    )

    const first = codeBlocks(view.renderer.root).find((block) => block.content.includes("New test fails"))!
    await view.mockMouse.pressDown(first.screenX, first.screenY)
    await view.mockMouse.emitMouseEvent("drag", first.screenX + 60, first.screenY)
    expect(view.renderer.getSelection()!.getSelectedText()).toContain("the fix (.env.production value")
    await view.mockMouse.release(first.screenX + 60, first.screenY)
    view.renderer.clearSelection()

    const search = createRenderedSearch(view.renderer.root)
    const matches = search.search(".env.production")
    expect(matches).toHaveLength(2)
    search.highlight(matches[0]!.id)
    await settle(view)
    expect(view.captureCharFrame()).not.toMatch(/[\ufdd0-\ufdef\ufffd]/)
    const painted = view
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .filter((span) => span.attributes & TextAttributes.UNDERLINE)
      .map((span) => span.text)
      .join("")
    expect(painted).toBe(".env.production")
    search.dispose()
    await settle(view)
    expect(view.captureCharFrame()).toContain("( .env.production  value")
  } finally {
    view.renderer.destroy()
  }
})

test("inline code padding wraps with its code and stays out of copied text", async () => {
  const content =
    "The router (`resolve-routes.ts`) matches against the pathname as received (`/en/`), so it decides the proxy should run and invokes the render server. `handleCatchallMiddlewareRequest` then re-checks the matcher, but only against `removeTrailingSlash(parsed.pathname)` and its decoded form, i.e. `/en`."
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <MarkdownSample content={content} />
      </ThemeProvider>
    ),
    { width: 62, height: 12 },
  )
  try {
    await settle(view)
    const rows = view
      .captureCharFrame()
      .split("\n")
      .map((row) => row.trimEnd())
    expect(rows).toContain("as received ( /en/ ), so it decides the proxy should run and")
    expect(rows).toContain("invokes the render server.  handleCatchallMiddlewareRequest")
    expect(rows).toContain(" removeTrailingSlash(parsed.pathname)  and its decoded form,")
    const padded = view.captureSpans().lines.map((line) => line.spans)
    for (const spans of padded) {
      const last = spans.findLast((span) => span.text.trim())
      const trailing = spans.slice(spans.indexOf(last!) + 1)
      const background = spans.at(-1)!.bg
      expect(trailing.every((span) => span.bg.equals(background))).toBe(true)
    }
    const prose = codeBlocks(view.renderer.root).find((block) => block.content.includes("The router"))!
    const row = rows.indexOf("as received ( /en/ ), so it decides the proxy should run and")
    await view.mockMouse.doubleClick(prose.screenX + rows[row]!.indexOf("en"), prose.screenY + row)
    await view.flush()
    expect(view.renderer.getSelection()!.getSelectedText()).toBe("(/en/)")
    view.renderer.clearSelection()
    await view.mockMouse.pressDown(prose.screenX, prose.screenY)
    await view.mockMouse.emitMouseEvent("drag", prose.screenX + 40, prose.screenY)
    expect(view.renderer.getSelection()!.getSelectedText()).toBe("The router (resolve-routes.ts) matches ")
    await view.mockMouse.release(prose.screenX + 40, prose.screenY)
  } finally {
    view.renderer.destroy()
  }
})

test("inline images follow the icon style, and their marker is muted while the label stays a link", async () => {
  const content = `Before ![Screenshot](https://example.com/ui.png) after, see image: notes.

| Name | Preview |
| --- | --- |
| Button | ![Button](https://example.com/b.png) |`
  const [style, setStyle] = createSignal<IconStyle>("unicode")
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <IconProvider style={style()}>
          <MarkdownSample content={content} />
        </IconProvider>
      </ThemeProvider>
    ),
    { width: 80, height: 12 },
  )
  try {
    for (const [iconStyle, marker] of [
      ["unicode", "image: "],
      ["nerd", "\uf03e "],
      ["none", "image: "],
    ] as const) {
      setStyle(iconStyle)
      await settle(view)
      const rows = view.captureCharFrame().split("\n")
      const row = rows.findIndex((line) => line.includes("Screenshot"))
      expect(rows[row]).toContain(`Before ${marker}Screenshot after, see image: notes.`)
      expect(rows.some((line) => line.includes(`│ ${marker}Button`))).toBe(true)
      expect(view.captureCharFrame()).not.toContain("▧")
      const spans = view.captureSpans().lines[row]!.spans
      const markerSpan = spans.find((span) => span.text.startsWith(marker.trim()))!
      const author = spans.find((span) => span.text.includes("see image:"))!
      expect(markerSpan.fg.equals(author.fg)).toBe(false)
      expect(view.renderer.getLinkAt(rows[row]!.indexOf("Screenshot") + 1, row)).toBe("https://example.com/ui.png")
    }
  } finally {
    view.renderer.destroy()
  }
})

test("table cells wrap at spaces and slashes, and search and copy see the real text", async () => {
  const content =
    "| File | Notes |\n| --- | --- |\n| packages/next/src/server/lib/router-utils/setup-dev-bundler.ts | uses `.env.production` and node_modules/next/dist |\n| a.ts | e.g. foo.bar.baz(x, y) |"
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <MarkdownSample content={content} />
      </ThemeProvider>
    ),
    { width: 60, height: 20 },
  )
  try {
    await settle(view)
    const rows = view
      .captureCharFrame()
      .split("\n")
      .map((row) => row.trimEnd())
    expect(rows).toContain("│ packages/next/src/server/   │ uses .env.production and   │")
    expect(rows).toContain("│ lib/router-utils/           │ node_modules/next/dist     │")
    expect(rows).toContain("│ setup-dev-bundler.ts        │                            │")
    expect(rows.join("\n")).not.toMatch(/[\ufdd0-\ufdef]/)
    const search = createRenderedSearch(view.renderer.root)
    expect(search.search(".env.production")).toHaveLength(1)
    search.dispose()
    const y = rows.findIndex((row) => row.includes("uses"))
    const x = rows[y]!.indexOf("uses")
    await view.mockMouse.pressDown(x, y)
    await view.mockMouse.emitMouseEvent("drag", x + 25, y)
    expect(view.renderer.getSelection()!.getSelectedText()).toBe("uses .env.production and ")
    await view.mockMouse.release(x + 25, y)
  } finally {
    view.renderer.destroy()
  }
})

test("code blocks in list items leave a blank line before the next item, but not at the end of the list", async () => {
  const content =
    "1. Run:\n   ```sh\n   pnpm install\n   ```\n2. Observe `x`:\n   ```text\n   a\n   ```\n   After.\n3. Done\n   ```\n   b\n   ```\n\nNext"
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <MarkdownSample content={content} />
      </ThemeProvider>
    ),
    { width: 40, height: 20 },
  )
  try {
    await settle(view)
    const rows = view
      .captureCharFrame()
      .split("\n")
      .map((row) => row.trimEnd())
    expect(rows.slice(0, 12)).toEqual([
      "1. Run:",
      "    pnpm install",
      "",
      "2. Observe  x :",
      "    a",
      "",
      "   After.",
      "3. Done",
      "    b",
      "",
      "Next",
      "",
    ])
  } finally {
    view.renderer.destroy()
  }
})
