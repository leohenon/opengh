import { BoxRenderable, CodeRenderable, MarkdownRenderable, TextRenderable, TextTableRenderable, Yoga, type MarkdownOptions, type Renderable, type SyntaxStyle } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createMemo, onCleanup, onMount, Show } from "solid-js"
import { assertGitHubMarkdownSource, gitHubMarkdownFallback, normalizeGitHubMarkdown, type GitHubMarkdownContext } from "../github-markdown"
import { compactLinkChunks, compactMarkdownLinks } from "../markdown-links"
import "../markdown-parsers"
import { useTheme } from "../theme"
import { READING_WIDTH } from "../detail-layout"
import { useMarkdownPreference } from "../markdown-preferences"
import { useHyperlinkMouse } from "../hyperlinks"
import { LinkedText } from "./linked-text"
import { anchorMarkers, stripAnchorMarkers, anchorVisualRow, tableAnchorRow, sourceLineAnchor, type MarkdownCodeSource, type MarkdownSourceMap, type MarkdownRenderedAnchor, type MarkdownAnchorResolver } from "../markdown-anchors"

// One prose renderer for repository documents, issue descriptions, and comments.
export function GitHubMarkdown(props: { content: string; syntaxStyle: SyntaxStyle; preserveImages?: boolean; codePanels?: boolean; backgroundColor?: string; context?: GitHubMarkdownContext; plainText?: boolean; wide?: boolean; anchorRef?: (resolver: MarkdownAnchorResolver | undefined) => void }) {
  const renderer = useRenderer()
  const links = useHyperlinkMouse()
  const { colors, theme } = useTheme()
  const preference = useMarkdownPreference()
  const minimal = () => preference() === "minimal"
  const prepared = createMemo(() => {
    try {
      // Bound input before allocating a source map, including plain-text documents.
      assertGitHubMarkdownSource(props.content)
      const sourceMap: MarkdownSourceMap | undefined = props.anchorRef
        ? { lineCount: props.content.split(/\r\n?|\n/).length, code: [] } : undefined
      return { sourceMap, markdown: !props.plainText, content: props.plainText ? props.content : normalizeGitHubMarkdown(props.content, {
        preserveImages: props.preserveImages, codePanels: props.codePanels, context: props.context, anchors: !!props.anchorRef, sourceMap,
      }) }
    } catch (error) {
      return { sourceMap: undefined, content: gitHubMarkdownFallback(props.content, error), markdown: false }
    }
  })
  const content = () => prepared().content
  let markdown: MarkdownRenderable | undefined
  let plain: TextRenderable | undefined
  const codeNodes = (node: Renderable | undefined = markdown): CodeRenderable[] => node && !node.isDestroyed ? [
    ...(node instanceof CodeRenderable && !node.conceal && !node.isDestroyed ? [node] : []),
    ...node.getChildren().flatMap((child) => codeNodes(child)),
  ] : []
  let targets = new Map<string, MarkdownRenderedAnchor>()
  let prose = new Set<CodeRenderable>()
  let disposed = false
  const resolveAnchor: MarkdownAnchorResolver = async (fragment) => {
    const document = prepared()
    await Promise.all([...prose, ...codeNodes()].filter((node) => !node.isDestroyed).map((node) => node.highlightingDone))
    await renderer.idle()
    if (disposed || document !== prepared()) return
    const rawId = fragment.replace(/^#/, "")
    let id: string
    try { id = decodeURIComponent(rawId) } catch { return }
    const sourceMap = prepared().sourceMap
    const range = id.match(/^L([1-9]\d*)(?:-L([1-9]\d*))?$/i)
    let target: MarkdownRenderedAnchor | undefined
    if (range && sourceMap) {
      const first = Number(range[1])
      const last = Number(range[2] ?? range[1])
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) return
      let line = Math.min(first, sourceMap.lineCount)
      if (props.plainText && plain) target = { node: plain, position: { line: line - 1, column: 0 } }
      else {
        const available = [...new Set([
          ...[...targets.keys()].flatMap((key) => /^opengh-source-L([1-9]\d*)$/.exec(key)?.slice(1).map(Number) ?? []),
          ...sourceMap.code.flatMap((code) => [code.start, code.end]),
        ])].sort((left, right) => left - right)
        let code = sourceMap.code.find((code) => line >= code.start && line <= code.end)
        if (!code && !targets.has(sourceLineAnchor(line))) {
          line = available.find((candidate) => candidate >= line) ?? available.at(-1) ?? line
          code = sourceMap.code.find((code) => line >= code.start && line <= code.end)
        }
        if (code) {
          const sameCode = (entry: MarkdownCodeSource) => entry.content === code!.content
          const occurrence = sourceMap.code.filter(sameCode).indexOf(code)
          const node = codeNodes().filter((node) => node.content.replace(/\n+$/, "") === code!.content)[occurrence]
          if (node) target = { node, position: { line: Math.max(0, Math.min(line - code.bodyStart, node.content.split("\n").length - 1)), column: 0 } }
        } else target = targets.get(sourceLineAnchor(line))
      }
    } else {
      target = targets.get(rawId) ?? targets.get(id)
        ?? targets.get(id.replace(/^user-content-/, "")) ?? targets.get(`user-content-${id}`)
      if (!target && sourceMap) {
        const code = sourceMap.code.find((code) => code.anchors.includes(id))
        if (code) {
          const occurrence = sourceMap.code.filter((entry) => entry.content === code.content).indexOf(code)
          const node = codeNodes().filter((node) => node.content.replace(/\n+$/, "") === code.content)[occurrence]
          if (node) target = { node, position: { line: 0, column: 0 } }
        }
      }
    }
    if (!target || target.node.isDestroyed) return
    let row = 0
    if ((target.node instanceof CodeRenderable || target.node instanceof TextRenderable) && target.position) row = anchorVisualRow(target.node.lineInfo, target.position)
    if (target.node instanceof TextTableRenderable && target.cell && target.position) {
      const cellRow = tableAnchorRow(target.node, target.cell, target.position)
      if (cellRow === undefined) return
      row = cellRow
    }
    return { node: target.node, row }
  }
  onMount(() => props.anchorRef?.(resolveAnchor))
  onCleanup(() => { disposed = true; props.anchorRef?.(undefined) })
  const tableOptions = createMemo<MarkdownOptions["tableOptions"]>(() => ({
    style: minimal() ? "columns" : "grid",
    widthMode: "full",
    columnFitter: "balanced",
    wrapMode: "word",
    cellPaddingX: 1,
    borderColor: colors.border,
  }))
  const renderNode = createMemo<MarkdownOptions["renderNode"]>(() => {
    content()
    targets = new Map<string, MarkdownRenderedAnchor>()
    prose = new Set<CodeRenderable>()
    const anchorTargets = targets
    const proseNodes = prose
    const simple = minimal()
    const contentWidth = props.wide ? "100%" : READING_WIDTH
    const background = colors.panel
    const canvas = props.backgroundColor ?? colors.canvas
    const muted = colors.muted
    const foreground = colors.text
    const codePadding = simple || renderer.width < 80 ? 1 : 2
    const panels = props.codePanels !== false
    const syntaxStyle = props.syntaxStyle
    const border = colors.border
    const yellow = theme.markdownWarning ?? colors.yellow
    const red = theme.markdownError ?? colors.red
    const green = theme.markdownSuccess ?? colors.green
    const blue = theme.markdownInfo ?? colors.blue
    const tables = tableOptions()
    const codePanels = new WeakSet<Renderable>()
    const headings = new WeakSet<Renderable>()
    const paragraphs = new WeakSet<Renderable>()
    const codePanel = (source: CodeRenderable, language = source.filetype ?? "text") => {
      const short = !source.content.trimEnd().includes("\n")
      const parent = source.parent
      const index = parent?.getChildren().indexOf(source)
      const panel = new BoxRenderable(renderer, {
        width: "100%", minWidth: 0, flexShrink: 0, flexDirection: "column",
        paddingX: codePadding, paddingY: simple || short ? 0 : 1, backgroundColor: background,
      })
      // Preserve authored margins, including percentages and auto, before reparenting.
      for (const [edge, property] of [
        [Yoga.Edge.Top, "marginTop"], [Yoga.Edge.Right, "marginRight"],
        [Yoga.Edge.Bottom, "marginBottom"], [Yoga.Edge.Left, "marginLeft"],
      ] as const) {
        const margin = source.getMargin(edge)
        panel[property] = margin.unit === Yoga.Unit.Auto ? "auto"
          : margin.unit === Yoga.Unit.Percent ? `${margin.value}%`
          : margin.unit === Yoga.Unit.Point ? margin.value : 0
      }
      source.marginTop = 0
      source.marginRight = 0
      source.marginBottom = 0
      source.marginLeft = 0
      panel.onSizeChange = () => {
        const padding = simple || panel.width < 80 ? 1 : 2
        if (panel.paddingLeft !== padding) {
          panel.paddingLeft = padding
          panel.paddingRight = padding
        }
      }
      source.syntaxStyle = syntaxStyle
      source.bg = background
      source.fg = foreground
      source.wrapMode = "word"
      if (!simple && !short) panel.add(new TextRenderable(renderer, {
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
      const alert = stripAnchorMarkers(text).trimStart().match(/^\*\*(Note|Tip|Important|Warning|Caution)\*\*(?:\s|$)/)?.[1]
      return alert === "Warning" ? yellow : alert === "Caution" ? red
        : alert === "Tip" ? green : alert === "Important" ? colors.purple : alert ? blue : border
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
        if (node.filetype === "markdown" && node.conceal) {
          proseNodes.add(node)
          compactMarkdownLinks(node, { padInlineCode: !simple, onAnchors: (positions) => {
            for (const [id, target] of anchorTargets) if (target.node === node) anchorTargets.delete(id)
            for (const [id, position] of positions) anchorTargets.set(id, { node, position })
          } })
        }
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
          if (simple) node.border = []
          else node.borderColor = quoteColor(text)
          source.destroyRecursively()
          node.add(quoteContent(text))
          return
        }
      }
      if (node instanceof TextTableRenderable)
        node.content = node.content.map((row, rowIndex) => row.map((cell, column) => cell ? compactLinkChunks(cell, {
          linkColor: syntaxStyle.mergeStyles("markup.link").fg,
          onAnchor: (id, position) => anchorTargets.set(id, { node, position, cell: { row: rowIndex, column } }),
        }) : cell))
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
      const markers = anchorMarkers(token.raw)
      if (markers.length && !stripAnchorMarkers(token.raw).trim()) {
        const marker = new BoxRenderable(renderer, { width: "100%", height: 0, flexShrink: 0 })
        for (const { id } of markers) anchorTargets.set(id, { node: marker })
        return marker
      }
      if (token.type === "blockquote") {
        const quote = new BoxRenderable(renderer, {
          width: "100%", minWidth: 0, flexShrink: 0, flexDirection: "column",
          border: simple ? [] : ["left"], borderColor: quoteColor(token.text), paddingLeft: 1,
        })
        quote.add(quoteContent(token.text))
        block = quote
      } else {
        block = context.defaultRender()
      }
      if (!block) return undefined
      if (token.type === "list") {
        // Core 0.6.6 skips checkbox tokens and always draws a normal list marker.
        const decorateTasks = (list: Extract<typeof token, { type: "list" }>, node: Renderable): void => {
          list.items.forEach((item, index) => {
            const row = node.getChildren()[index]
            if (!row) return
            const [marker, content] = row.getChildren()
            if (typeof item.checked === "boolean" && marker instanceof TextRenderable) {
              const scope = item.checked ? "markup.list.checked" : "markup.list.unchecked"
              const style = syntaxStyle.mergeStyles(scope)
              marker.content = item.checked ? "☑ " : "☐ "
              marker.fg = style.fg ?? foreground
              marker.attributes = style.attributes
            }
            const children = item.tokens.filter((child) => child.type !== "checkbox" && child.type !== "space")
            children.forEach((child, childIndex) => {
              const nested = content?.getChildren()[childIndex]
              if (child.type === "list" && nested) decorateTasks(child as Extract<typeof child, { type: "list" }>, nested)
            })
          })
        }
        decorateTasks(token as Extract<typeof token, { type: "list" }>, block)
      }
      if (token.type === "heading" && block instanceof CodeRenderable)
        block.baseHighlight = `markup.heading.${token.depth}`
      block.marginTop = 0
      block.marginBottom = 0
      if (token.type === "code" && panels && block instanceof CodeRenderable) block = codePanel(block, token.lang ?? "text")
      // Do not interpret markdown-language fence contents as prose.
      if (token.type !== "code") decorateProse(block, token.type === "list")
      const readable = token.type !== "table" && token.type !== "hr"
      const section = token.type === "heading" && token.depth === 1
      const wrapper = new BoxRenderable(renderer, {
        width: "100%", minWidth: 0, flexShrink: 0, flexDirection: "column", marginTop: 0,
        ...(readable ? { maxWidth: contentWidth, alignSelf: "flex-start" } : {}),
        ...(section && !simple ? { border: ["bottom"], borderColor: border } : {}),
      })
      if (token.type === "heading") headings.add(wrapper)
      if (token.type === "paragraph") {
        paragraphs.add(wrapper)
        wrapper.onLifecyclePass = () => {
          // Core applies margins after renderNode. Settle the whole parent once,
          // then unregister every paragraph hook (including hidden paragraphs).
          // A content/style change replaces renderNode and recreates these blocks.
          if (!wrapper.parent) return
          let previous: Renderable | undefined
          for (const sibling of wrapper.parent.getChildren()) {
            if (paragraphs.has(sibling)) {
              if (previous && headings.has(previous)) sibling.marginTop = 0
              sibling.onLifecyclePass = null
            }
            previous = sibling
          }
        }
      }
      wrapper.add(block)
      return wrapper
    }
    return renderBlock
  })

  return (
    <Show when={prepared().markdown} fallback={
      <text
        ref={(value) => { plain = value }}
        {...links}
        fg={colors.text}
        bg={props.backgroundColor ?? colors.canvas}
        wrapMode="word"
        width="100%"
        maxWidth={props.wide ? "100%" : READING_WIDTH}
        minWidth={0}
        flexShrink={0}
      ><LinkedText text={content()} repositoryUrl={props.context?.repositoryUrl} /></text>
    }>
      <markdown
        ref={(value) => { markdown = value }}
        {...links}
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
