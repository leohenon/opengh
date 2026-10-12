import { BoxRenderable, CodeRenderable, TextRenderable, createMarkdownCodeBlockRenderer, infoStringToFiletype, type MarkdownCodeBlockRenderer, type SyntaxStyle } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createMemo } from "solid-js"
import { normalizeGitHubMarkdown } from "../github-markdown"
import { useTheme } from "../theme"

// One prose renderer for repository documents, issue descriptions, and comments.
export function GitHubMarkdown(props: { content: string; syntaxStyle: SyntaxStyle; preserveImages?: boolean; codePanels?: boolean; backgroundColor?: string }) {
  const renderer = useRenderer()
  const { colors } = useTheme()
  const content = createMemo(() => normalizeGitHubMarkdown(props.content, { preserveImages: props.preserveImages, codePanels: props.codePanels }))
  const renderNode = createMemo(() => {
    if (!props.codePanels) return undefined
    const background = colors.panel
    const muted = colors.muted
    const foreground = colors.text
    const syntaxStyle = props.syntaxStyle
    const panelRenderer: MarkdownCodeBlockRenderer = (token, context) => {
      const block = context.defaultRender()
      if (!block) return undefined
      block.marginBottom = 0
      if (block instanceof CodeRenderable) {
        block.bg = background
        block.fg = foreground
        block.syntaxStyle = syntaxStyle
        block.wrapMode = "word"
      }
      const panel = new BoxRenderable(renderer, { width: "100%", minWidth: 0, flexShrink: 0, marginBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: background })
      panel.add(new TextRenderable(renderer, { content: token.lang?.split(/\s+/)[0] || "code", height: 1, fg: muted, bg: background }))
      panel.add(block)
      return panel
    }
    // The public code-block adapter keeps normal prose coalescing and paragraph spacing intact.
    const renderers = new Map<string, MarkdownCodeBlockRenderer>()
    for (const match of content().matchAll(/^[ \t]*`{3,}([^\n]*)$/gm)) {
      const language = infoStringToFiletype(match[1]!.trim())
      if (language) renderers.set(language, panelRenderer)
    }
    return createMarkdownCodeBlockRenderer(renderers)
  })

  return (
    <markdown
      content={content()}
      syntaxStyle={props.syntaxStyle}
      fg={colors.text}
      bg={props.backgroundColor ?? colors.canvas}
      conceal
      renderNode={renderNode()}
      tableOptions={{
        style: "grid",
        widthMode: "full",
        wrapMode: "word",
        cellPaddingX: 1,
        borderColor: colors.border,
      }}
      width="100%"
      minWidth={0}
      flexShrink={0}
    />
  )
}
