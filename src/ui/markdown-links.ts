import type { CodeRenderable, SimpleHighlight, TextChunk } from "@opentui/core"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"
import { visit } from "unist-util-visit"

const parser = unified().use(remarkParse).use(remarkGfm)

// Native table cells already have styled chunks, with a separate URL suffix.
export function compactLinkChunks(chunks: TextChunk[]) {
  const result: TextChunk[] = []
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!
    const url = chunk.link?.url
    if (url && chunk.text === " (" && chunks[index + 1]?.text === url
      && chunks[index + 1]?.link?.url === url && chunks[index + 2]?.text === ")"
      && chunks[index + 2]?.link?.url === url) {
      index += 2
    } else result.push(chunk)
  }
  return result
}

// Conceal destinations, not the links themselves: keep labels selectable and linked.
export function compactMarkdownLinks(block: CodeRenderable, options: { padInlineCode?: boolean } = {}) {
  let source = ""
  let links: Array<{ start: number; end: number; labelStart: number; labelEnd: number; url: string }> = []
  let inlineCode: Array<{ start: number; end: number }> = []
  block.onHighlight = (highlights, context) => {
    source = context.content
    inlineCode = []
    links = []
    const tree = parser.parse(source)
    const markers: SimpleHighlight[] = []
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
    const result = await linkify?.(chunks, context) ?? chunks
    let offset = 0
    for (const chunk of result) {
      if (!chunk.text) continue
      let index = source.indexOf(chunk.text, offset)
      // Don't match repeated text or spaces inside a concealed URL/title.
      let hidden = links.find((item) => index >= item.labelEnd && index < item.end)
      while (hidden) {
        index = source.indexOf(chunk.text, hidden.end)
        hidden = links.find((item) => index >= item.labelEnd && index < item.end)
      }
      if (index < 0) continue // Concealed markers and decoded entities aren't source text.
      const link = links.find((item) => index >= item.labelStart && index + chunk.text.length <= item.labelEnd)
      chunk.link = link ? { url: link.url } : undefined
      offset = index + chunk.text.length
    }
    return result.flatMap((chunk) => {
      const pad = padding.get(chunk)
      if (!pad) return [chunk]
      const space: TextChunk = { ...chunk, text: " " }
      return [...(pad.before ? [space] : []), chunk, ...(pad.after ? [{ ...space }] : [])]
    })
  }
}
