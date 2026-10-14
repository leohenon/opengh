import { BoxRenderable, CodeRenderable, MarkdownRenderable, TextRenderable, TextTableRenderable, Yoga, type MarkdownOptions, type Renderable, type SyntaxStyle } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createMemo, Show } from "solid-js"
import { normalizeGitHubMarkdown, type GitHubMarkdownContext } from "../github-markdown"
import { compactLinkChunks, compactMarkdownLinks } from "../markdown-links"
import "../markdown-parsers"
import { useTheme } from "../theme"

// One prose renderer for repository documents, issue descriptions, and comments.
export function GitHubMarkdown(props: { content: string; syntaxStyle: SyntaxStyle; preserveImages?: boolean; codePanels?: boolean; backgroundColor?: string; context?: GitHubMarkdownContext; plainText?: boolean }) {
  const renderer = useRenderer()
  const { colors } = useTheme()
  const content = createMemo(() => props.plainText ? props.content : normalizeGitHubMarkdown(props.content, { preserveImages: props.preserveImages, codePanels: props.codePanels, context: props.context }))
  const tableOptions = createMemo<MarkdownOptions["tableOptions"]>(() => ({
    style: "grid",
    widthMode: "full",
    columnFitter: "balanced",
    wrapMode: "word",
    cellPaddingX: 1,
    borderColor: colors.border,
  }))
  const renderNode = createMemo<MarkdownOptions["renderNode"]>(() => {
    const background = colors.panel
    const canvas = props.backgroundColor ?? colors.canvas
    const muted = colors.muted
    const foreground = colors.text
    const codePadding = renderer.width < 80 ? 1 : 2
    const panels = props.codePanels !== false
    const syntaxStyle = props.syntaxStyle
    const border = colors.border
    const yellow = colors.yellow
    const red = colors.red
    const green = colors.green
    const blue = colors.blue
    const tables = tableOptions()
    const codePanels = new WeakSet<Renderable>()
    const codePanel = (source: CodeRenderable, language = source.filetype ?? "text") => {
      const parent = source.parent
      const index = parent?.getChildren().indexOf(source)
      const panel = new BoxRenderable(renderer, {
        width: "100%", minWidth: 0, flexShrink: 0, flexDirection: "column",
        paddingX: codePadding, paddingY: 1, backgroundColor: background,
      })
      // Margin getters are incomplete in 0.4.5; copy Yoga values before reparenting.
      for (const edge of [Yoga.Edge.Top, Yoga.Edge.Right, Yoga.Edge.Bottom, Yoga.Edge.Left]) {
        panel.getLayoutNode().setMargin(edge, source.getLayoutNode().getMargin(edge))
      }
      source.marginTop = 0
      source.marginRight = 0
      source.marginBottom = 0
      source.marginLeft = 0
      panel.onSizeChange = () => {
        const padding = panel.width < 80 ? 1 : 2
        if (panel.paddingLeft !== padding) {
          panel.paddingLeft = padding
          panel.paddingRight = padding
        }
      }
      source.syntaxStyle = syntaxStyle
      source.bg = background
      source.fg = foreground
      source.wrapMode = "word"
      panel.add(new TextRenderable(renderer, {
        content: language.trim().split(/\s+/)[0] || "text",
        height: 1, fg: muted, bg: background,
      }))
      // Keep the native source, including its plain-code content and concealment.
      panel.add(source)
      if (parent) parent.add(panel, index)
      codePanels.add(panel)
      return panel
    }
    const quoteColor = (text: string) => {
      const alert = text.match(/^\*\*(Note|Tip|Important|Warning|Caution)\*\*(?:\s|$)/)?.[1]
      return alert === "Warning" ? yellow : alert === "Caution" ? red
        : alert === "Tip" ? green : alert ? blue : border
    }
    const quoteContent = (text: string) => new MarkdownRenderable(renderer, {
      content: text, syntaxStyle, fg: foreground, bg: canvas, conceal: true,
      renderNode: renderBlock, internalBlockMode: "top-level", tableOptions: tables,
      width: "100%", minWidth: 0, flexShrink: 0,
    })
    const decorateProse = (node: Renderable, list = false) => {
      // Nested Markdown owns its own decorated blocks. Never revisit inserted panels.
      if (codePanels.has(node) || node instanceof MarkdownRenderable) return
      if (node instanceof CodeRenderable) {
        node.syntaxStyle = syntaxStyle
        if (node.filetype === "markdown" && node.conceal) compactMarkdownLinks(node)
        else if (panels && node.parent) {
          codePanel(node)
          return
        }
      }
      if (node instanceof BoxRenderable) {
        const children = node.getChildren()
        const source = children[0]
        // Native list blockquotes contain one markdown CodeRenderable, not blocks.
        if (children.length === 1 && source instanceof CodeRenderable && source.baseHighlight === "markup.quote") {
          const text = source.content
          node.borderColor = quoteColor(text)
          source.destroyRecursively()
          node.add(quoteContent(text))
          return
        }
      }
      if (node instanceof TextTableRenderable)
        node.content = node.content.map((row) => row.map((cell) => cell ? compactLinkChunks(cell) : cell))
      if (list && node instanceof TextRenderable && node.chunks.length === 1) {
        const marker = node.chunks[0]!.text
        if (/^\s*[-*+]\s$/.test(marker)) {
          node.content = marker.replace(/[-*+](?=\s$)/, "•")
          node.fg = muted
        }
      }
      for (const child of [...node.getChildren()]) decorateProse(child, list)
    }
    const renderBlock: NonNullable<MarkdownOptions["renderNode"]> = (token, context) => {
      let block: Renderable | null
      if (token.type === "blockquote") {
        const quote = new BoxRenderable(renderer, {
          width: "100%", minWidth: 0, flexShrink: 0, flexDirection: "column",
          border: ["left"], borderColor: quoteColor(token.text), paddingLeft: 1,
        })
        quote.add(quoteContent(token.text))
        block = quote
      } else {
        block = context.defaultRender()
      }
      if (!block) return undefined
      block.marginTop = 0
      block.marginBottom = 0
      if (token.type === "code" && panels && block instanceof CodeRenderable) return codePanel(block, token.lang ?? "text")
      // Do not interpret markdown-language fence contents as prose.
      if (token.type !== "code") decorateProse(block, token.type === "list")
      const prose = token.type !== "code" && token.type !== "table" && token.type !== "hr"
      const section = token.type === "heading" && token.depth <= 2
      const wrapper = new BoxRenderable(renderer, {
        width: "100%", minWidth: 0, flexShrink: 0, flexDirection: "column", marginTop: 0,
        ...(prose ? { maxWidth: 96, alignSelf: "flex-start" } : {}),
        ...(section ? { border: ["bottom"], borderColor: border } : {}),
      })
      // Native top-level layout owns inter-block spacing and list indentation.
      wrapper.add(block)
      return wrapper
    }
    return renderBlock
  })

  return (
    <Show when={!props.plainText} fallback={
      <text
        content={props.content}
        fg={colors.text}
        bg={props.backgroundColor ?? colors.canvas}
        wrapMode="word"
        width="100%"
        maxWidth={96}
        minWidth={0}
        flexShrink={0}
      />
    }>
      <markdown
        content={content()}
        syntaxStyle={props.syntaxStyle}
        fg={colors.text}
        bg={props.backgroundColor ?? colors.canvas}
        conceal
        renderNode={renderNode()}
        // In our pinned OpenTUI version, this also preserves custom nodes on style refresh.
        internalBlockMode="top-level"
        tableOptions={tableOptions()}
        width="100%"
        minWidth={0}
        flexShrink={0}
      />
    </Show>
  )
}
