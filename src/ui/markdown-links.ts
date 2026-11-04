import { TextAttributes, type CodeRenderable, type SimpleHighlight, type TextChunk, type RGBA } from "@opentui/core"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"
import { visit } from "unist-util-visit"
import { anchorMarkers, type MarkdownAnchorPosition } from "./markdown-anchors"

const parser = unified().use(remarkParse).use(remarkGfm)

// Native table cells already have styled chunks, with a separate URL suffix.
export function compactLinkChunks(chunks: TextChunk[], options: { linkColor?: RGBA; onAnchor?: (id: string, position: MarkdownAnchorPosition) => void } = {}) {
  const result: TextChunk[] = []
  let line = 0
  let column = 0
  const advance = (text: string) => {
    const lines = text.split("\n")
    line += lines.length - 1
    column = lines.length > 1 ? Bun.stringWidth(lines.at(-1)!) : column + Bun.stringWidth(text)
  }
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!
    const url = chunk.link?.url
    if (url && chunk.text === " (" && chunks[index + 1]?.text === url
      && chunks[index + 1]?.link?.url === url && chunks[index + 2]?.text === ")"
      && chunks[index + 2]?.link?.url === url) {
      index += 2
    } else {
      let text = ""
      let offset = 0
      for (const marker of anchorMarkers(chunk.text)) {
        const prefix = chunk.text.slice(offset, marker.start)
        text += prefix
        advance(prefix)
        options.onAnchor?.(marker.id, { line, column })
        offset = marker.end
      }
      const suffix = chunk.text.slice(offset)
      text += suffix
      advance(suffix)
      if (text) result.push({ ...chunk, text, ...(chunk.link && options.linkColor ? { fg: options.linkColor } : {}) })
    }
  }
  return result
}

// Conceal destinations, not the links themselves: keep labels selectable and linked.
export function compactMarkdownLinks(block: CodeRenderable, options: { padInlineCode?: boolean; onAnchors?: (anchors: Map<string, MarkdownAnchorPosition>) => void } = {}) {
  let source = ""
  let links: Array<{ start: number; end: number; labelStart: number; labelEnd: number; url: string }> = []
  let inlineCode: Array<{ start: number; end: number }> = []
  let deleted: Array<{ start: number; end: number }> = []
  let anchors: ReturnType<typeof anchorMarkers> = []
  block.onHighlight = (highlights, context) => {
    source = context.content
    inlineCode = []
    links = []
    deleted = []
    anchors = anchorMarkers(source)
    const tree = parser.parse(source)
    const markers: SimpleHighlight[] = anchors.map((anchor) => [anchor.start, anchor.end, "conceal", { conceal: "", isInjection: true }])
    visit(tree, "text", (node) => {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) return
      const text = source.slice(start, end)
      for (const match of text.matchAll(/▧/g))
        markers.push([start + match.index!, start + match.index! + 1, "markup.image.marker"])
      // Tree-sitter leaves backslash escapes visible in prose. Parse text nodes
      // only, so inline code and fenced examples keep their literal backslashes.
      for (const match of text.matchAll(/\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/g))
        markers.push([start + match.index!, start + match.index! + 1, "conceal", { conceal: "", isInjection: true }])
    })
    visit(tree, "delete", (node) => {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) deleted.push({ start, end })
    })
    if (options.padInlineCode) visit(tree, "inlineCode", (node) => {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) return
      const ticks = source.slice(start, end).match(/^`+/)?.[0].length ?? 1
      inlineCode.push({ start: start + ticks, end: end - ticks })
    })
    visit(tree, "link", (node) => {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      const labelEnd = node.children.at(-1)?.position?.end.offset
      if (start === undefined || end === undefined || labelEnd === undefined) return
      const labelStart = source[start] === "[" || source[start] === "<" ? start + 1 : start
      links.push({ start, end, labelStart, labelEnd, url: node.url })
    })
    if (!links.length) return markers.length ? [...highlights, ...markers] : highlights
    // Remove existing conceal replacements inside the destination (notably the
    // closing bracket's space), then conceal the entire suffix including titles.
    const result = highlights.filter(([start, end, , meta]) => !(
      meta?.conceal !== undefined && links.some((link) => start >= link.labelEnd && end <= link.end)
    ))
    for (const link of links) {
      const meta = { conceal: "", isInjection: true }
      result.push([link.start, link.labelStart, "conceal", meta] satisfies SimpleHighlight)
      result.push([link.labelEnd, link.end, "conceal", meta] satisfies SimpleHighlight)
    }
    return [...result, ...markers]
  }
  const linkify = block.onChunks
  block.onChunks = async (chunks, context) => {
    const padding = new Map<TextChunk, { before: boolean; after: boolean }>()
    for (const code of inlineCode) {
      const inside = chunks.filter((_chunk, index) => {
        const range = context.sourceRanges?.[index]
        return range && range.start >= code.start && range.end <= code.end
      })
      if (inside.length) {
        padding.set(inside[0]!, { before: true, after: inside.length === 1 })
        if (inside.length > 1) padding.set(inside.at(-1)!, { before: false, after: true })
      }
    }
    // SyntaxStyle in OpenTUI 0.6.6 cannot represent strikethrough attributes.
    chunks.forEach((chunk, index) => {
      const range = context.sourceRanges?.[index]
      if (range && deleted.some((span) => range.start >= span.start && range.end <= span.end))
        chunk.attributes = (chunk.attributes ?? 0) | TextAttributes.STRIKETHROUGH
    })
    const result = await linkify?.(chunks, context) ?? chunks
    let offset = 0
    const sourceIndices = new Map<TextChunk, number>()
    for (const chunk of result) {
      if (!chunk.text) continue
      let index = source.indexOf(chunk.text, offset)
      // Don't match repeated text or spaces inside a concealed URL/title.
      let hidden = links.find((item) => index >= item.labelEnd && index < item.end)
        ?? anchors.find((item) => index >= item.start && index < item.end)
      while (hidden) {
        index = source.indexOf(chunk.text, hidden.end)
        hidden = links.find((item) => index >= item.labelEnd && index < item.end)
          ?? anchors.find((item) => index >= item.start && index < item.end)
      }
      if (index < 0) continue // Concealed markers and decoded entities aren't source text.
      const link = links.find((item) => index >= item.labelStart && index + chunk.text.length <= item.labelEnd)
      chunk.link = link ? { url: link.url } : undefined
      if (link) chunk.fg = block.syntaxStyle.mergeStyles("markup.link").fg ?? chunk.fg
      sourceIndices.set(chunk, index)
      offset = index + chunk.text.length
    }
    const output = result.flatMap((chunk) => {
      const pad = padding.get(chunk)
      if (!pad) return [chunk]
      const space: TextChunk = { ...chunk, text: " " }
      const sourceIndex = sourceIndices.get(chunk)
      if (sourceIndex !== undefined) sourceIndices.set(space, sourceIndex)
      return [...(pad.before ? [space] : []), chunk, ...(pad.after ? [space] : [])]
    })
    if (options.onAnchors) {
      const positions = new Map<string, MarkdownAnchorPosition>()
      let column = 0
      let next = 0
      const record = (index: number) => {
        while (anchors[next] && anchors[next]!.end <= index) {
          const anchor = anchors[next++]!
          positions.set(anchor.id, { line: source.slice(0, anchor.start).split("\n").length - 1, column })
        }
      }
      for (const chunk of output) {
        const index = sourceIndices.get(chunk)
        if (index !== undefined) record(index)
        const lines = chunk.text.split("\n")
        column = lines.length > 1 ? Bun.stringWidth(lines.at(-1)!) : column + Bun.stringWidth(chunk.text)
      }
      record(source.length)
      options.onAnchors(positions)
    }
    return output
  }
}
