import { posix } from "node:path"
import type { Element, ElementContent, Root, Text } from "hast"
import type { PhrasingContent, Root as MarkdownRoot } from "mdast"
import rehypeRaw from "rehype-raw"
import rehypeRemark from "rehype-remark"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import remarkStringify from "remark-stringify"
import { unified } from "unified"
import { SKIP, visit } from "unist-util-visit"
import { referenceLinkChunks } from "./reference-links"
import { anchorMarker, sourceLineAnchor, type MarkdownCodeSource, type MarkdownSourceMap } from "./markdown-anchors"

export type GitHubMarkdownContext = {
  repositoryUrl: string
  ref?: string
  path?: string
  sourceUrl?: string
}

function property(element: Element, name: string) {
  const value = element.properties[name]
  return Array.isArray(value) ? value.join(" ") : value == null ? "" : String(value)
}

function textContent(node: ElementContent): string {
  if (node.type === "text") return node.value
  if ("children" in node) return node.children.map((child) => textContent(child as ElementContent)).join("")
  return ""
}

function firstDescendant(element: Element, tagName: string): Element | undefined {
  for (const child of element.children) {
    if (child.type !== "element") continue
    if (child.tagName === tagName) return child
    const nested = firstDescendant(child, tagName)
    if (nested) return nested
  }
  return undefined
}

function isBadgeImage(element: Element, label: string) {
  const source = property(element, "src")
  return /(?:img\.shields\.io|badge\.fury\.io|badgen\.net|codecov\.io|coveralls\.io|\/badge(?:\.svg|\/))/i.test(source)
    || /\b(?:build status|coverage|npm version|package version|downloads? badge)\b/i.test(label)
}

function isDecorativeImage(element: Element, label: string) {
  const sourcePath = property(element, "src").split(/[?#]/)[0] ?? ""
  return /\blogo\b/i.test(label) || /(?:^|\/)logo(?:[-_.]|$)/i.test(sourcePath) || isBadgeImage(element, label)
}

function safeTarget(value: string) {
  const target = value.trim()
  if (!target || /[\u0000-\u001f\u007f]/.test(target)) return ""
  if (target.startsWith("#") || target.startsWith("/") || target.startsWith("./") || target.startsWith("../") || target.startsWith("?"))
    return target
  const scheme = target.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase()
  return !scheme || scheme === "http" || scheme === "https" || scheme === "mailto" ? target : ""
}

function replacement(label: string, target?: string): ElementContent {
  const safe = safeTarget(target ?? "")
  if (!safe) return { type: "text", value: label }
  return {
    type: "element",
    tagName: "a",
    properties: { href: safe },
    children: [{ type: "text", value: label }],
  }
}

function imageCaption(label: string, target?: string): ElementContent {
  return {
    type: "element", tagName: "span", properties: {},
    children: [{ type: "text", value: "▧ " }, replacement(label, target)],
  }
}

function isImageLink(node: ElementContent): node is Element {
  return node.type === "element" && node.tagName === "a" && firstDescendant(node, "img") !== undefined
}

function isPresentationGroup(element: Element) {
  if (!["div", "center", "p"].includes(element.tagName)) return false
  const links = element.children.filter(isImageLink)
  return links.length > 1 && element.children.every((child) =>
    child.type === "element" && child.tagName === "br"
    || isImageLink(child)
    || child.type === "text" && child.value.trim() === "")
}

function terminalMedia(options: { preserveImages?: boolean } = {}) {
  return (tree: Root) => {
    visit(tree, "comment", (_node, index, parent) => {
      if (index === undefined || !parent) return
      parent.children.splice(index, 1)
      return index
    })
    const presentationGroups = new WeakSet<Element>()
    visit(tree, "element", (element) => {
      if (!isPresentationGroup(element)) return
      presentationGroups.add(element)
      if (element.tagName === "p") element.tagName = "div"
    })

    visit(tree, "element", (element, index, parent) => {
      if (index === undefined || !parent) return
      const tag = element.tagName

      if (["script", "style", "template", "noscript"].includes(tag)) {
        parent.children.splice(index, 1)
        return index
      }

      if (tag === "a") {
        const href = safeTarget(property(element, "href"))
        const image = firstDescendant(element, "img")
        if (image) {
          const label = property(image, "alt") || property(image, "title") || "image"
          if (!options.preserveImages && isDecorativeImage(image, label)) {
            parent.children[index] = { type: "text", value: "", position: element.position }
            return SKIP
          }
          const link = { ...imageCaption(label, href || property(image, "src")), position: element.position }
          parent.children[index] = parent.type === "element" && presentationGroups.has(parent)
            ? { type: "element", tagName: "p", properties: {}, children: [link], position: element.position }
            : link
          return SKIP
        }
        if (href) element.properties.href = href
        else if (property(element, "id") || property(element, "name")) {
          // Empty named anchors must not become []() links.
          element.properties.id = property(element, "id") || property(element, "name")
          element.tagName = "span"
        } else {
          parent.children[index] = { type: "text", value: textContent(element), position: element.position }
          return
        }
      }

      if (tag === "img") {
        const label = property(element, "alt") || property(element, "title") || "image"
        if (!options.preserveImages && isDecorativeImage(element, label)) {
          parent.children[index] = { type: "text", value: "", position: element.position }
          return
        }
        const pictureSource = parent.type === "element" && parent.tagName === "picture"
          ? firstDescendant(parent, "source")
          : undefined
        const target = property(element, "src")
          || property(pictureSource ?? element, "src")
          || property(pictureSource ?? element, "srcSet").split(/[ ,]/)[0]
          || ""
        parent.children[index] = { ...imageCaption(label, target), position: element.position }
        return
      }

      if (["video", "audio", "iframe", "embed", "object"].includes(tag)) {
        const kind = tag === "video" ? "Video" : tag === "audio" ? "Audio" : "Embedded content"
        const label = property(element, "title") || textContent(element).trim() || kind.toLowerCase()
        const source = firstDescendant(element, "source")
        const target = property(element, "src")
          || property(element, "data")
          || property(source ?? element, "src")
          || property(source ?? element, "srcSet").split(/[ ,]/)[0]
          || ""
        parent.children[index] = { ...replacement(`${kind}: ${label}`, target), position: element.position }
        return
      }

      if (tag === "svg") {
        const title = element.children.find((child): child is Element => child.type === "element" && child.tagName === "title")
        parent.children[index] = { ...replacement(`Graphic: ${title ? textContent(title).trim() : "image"}`), position: element.position }
      }
    })
  }
}

// Capture source positions before HTML conversion moves footnotes.
function sourcePositions() {
  return (tree: MarkdownRoot, file: { value: unknown; data: Record<string, unknown> }) => {
    if (!file.data.documentAnchors || !file.data.sourceMap) return
    const source = String(file.value)
    const code: MarkdownCodeSource[] = []
    visit(tree, "code", (node) => {
      if (!node.position) return
      const start = node.position.start.line
      const raw = source.slice(node.position.start.offset, node.position.end.offset)
      code.push({ content: node.value.replace(/\n+$/, ""), start, end: node.position.end.line,
        bodyStart: start + (/^ {0,3}(?:`{3,}|~{3,})/.test(raw) ? 1 : 0), anchors: [] })
    })
    file.data.sourceCode = code
  }
}

function documentAnchors() {
  return (tree: Root, file: { value: unknown; data: Record<string, unknown> }) => {
    if (!file.data.documentAnchors) return
    visit(tree, (node) => {
      const position = node.position
      if (position && (!position.start || !position.end
        || !Number.isSafeInteger(position.start.line) || !Number.isSafeInteger(position.end.line)
        || position.start.line < 1 || position.end.line < position.start.line)) delete node.position
    })
    const source = String(file.value)
    const sourceMap = file.data.sourceMap as MarkdownSourceMap | undefined
    const originalCode = file.data.sourceCode as MarkdownCodeSource[] | undefined
    if (sourceMap) sourceMap.code = []
    const used = new Set<string>()
    const inserts = new Map<Text, Map<number, string[]>>()
    const before = new Map<Element, string[]>()
    type Site = { text?: Text; element?: Element; index: number; offset: number }
    const lines = new Map<number, Site>()
    const firstText = (element: Element): Text | undefined => {
      for (const child of element.children) {
        if (child.type === "text" && child.value.trim()) return child
        if (child.type === "element") {
          const nested = firstText(child)
          if (nested) return nested
        }
      }
    }
    const firstSite = (element: Element): Site | undefined => {
      if (element.tagName === "code" || element.tagName === "pre") return { element, index: 0, offset: element.position?.start.offset ?? Infinity }
      for (const child of element.children) {
        if (child.type === "text" && child.value.trim()) return { text: child, index: 0, offset: child.position?.start.offset ?? Infinity }
        if (child.type === "element") {
          const nested = firstSite(child)
          if (nested) return nested
        }
      }
    }
    const site = (element: Element): Site => {
      const target = firstSite(element)
      if (target) return { ...target, offset: element.position?.start.offset ?? target.offset }
      const text: Text = { type: "text", value: "" }
      element.children.unshift(text)
      return { text, index: 0, offset: element.position?.start.offset ?? Infinity }
    }
    const insert = (target: Site, id: string) => {
      if (target.element) {
        before.set(target.element, [...(before.get(target.element) ?? []), anchorMarker(id)])
      } else if (target.text) {
        const positions = inserts.get(target.text) ?? new Map<number, string[]>()
        positions.set(target.index, [...(positions.get(target.index) ?? []), anchorMarker(id)])
        inserts.set(target.text, positions)
      }
    }
    const lineSite = (line: number, target: Site) => {
      if (!lines.has(line) || target.offset < lines.get(line)!.offset) lines.set(line, target)
    }
    const walk = (node: Root | ElementContent) => {
      if (node.type === "element") {
        if (node.tagName === "pre") {
          const position = node.position
          if (sourceMap && position) {
            const original = originalCode?.find((code) => code.start === position.start.line && code.end === position.end.line)
            const code = firstDescendant(node, "code")
            const anchors = [property(node, "id"), code ? property(code, "id") : ""].filter(Boolean)
            sourceMap.code.push(original ? { ...original, anchors } : {
              content: textContent(node).replace(/\n+$/, ""), start: position.start.line, end: position.end.line,
              bodyStart: firstText(node)?.position?.start.line ?? position.start.line, anchors,
            })
          }
          return
        }
        let id = property(node, "id") || (node.tagName === "a" ? property(node, "name") : "")
        if (!id && /^h[1-6]$/.test(node.tagName)) {
          const slug = textContent(node).toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, "").replace(/\s/g, "-")
          id = slug
          let suffix = 0
          while (used.has(id)) id = `${slug}-${++suffix}`
        }
        if (id) { used.add(id); insert(site(node), id) }
        if (sourceMap && node.position) {
          const target = site(node)
          lineSite(node.position.start.line, target)
          if (/^h[1-6]$/.test(node.tagName) || node.tagName === "code") {
            for (let line = node.position.start.line; line <= node.position.end.line; line++) lineSite(line, target)
          }
          if (node.tagName === "table") lineSite(node.position.start.line + 1, target)
        }
        if (node.tagName === "code") return // Inline code must remain literal too.
      }
      if (sourceMap && node.type === "text" && node.value.trim() && node.position) {
        const raw = source.slice(node.position.start.offset, node.position.end.offset)
        const parts = node.value.split("\n")
        const split = parts.length === node.position.end.line - node.position.start.line + 1 && !/&#(?:x0*a|0*10);/i.test(raw)
        if (split) {
          let index = 0
          parts.forEach((part, offset) => {
            if (part.trim()) lineSite(node.position!.start.line + offset, { text: node, index, offset: (node.position!.start.offset ?? 0) + index })
            index += part.length + 1
          })
        } else for (let line = node.position.start.line; line <= node.position.end.line; line++)
          lineSite(line, { text: node, index: 0, offset: node.position.start.offset ?? 0 })
      }
      if ("children" in node) node.children.forEach((child) => walk(child as ElementContent))
    }
    walk(tree)
    for (const [line, target] of lines) insert(target, sourceLineAnchor(line))
    for (const [text, positions] of inserts) {
      for (const [index, markers] of [...positions].sort(([left], [right]) => right - left))
        text.value = text.value.slice(0, index) + markers.join("") + text.value.slice(index)
    }
    if (before.size) visit(tree, "element", (element, index, parent) => {
      const markers = before.get(element)
      if (!markers || index === undefined || !parent) return
      parent.children.splice(index, 0, { type: "text", value: markers.join("") })
      return index + 2
    })
  }
}

function githubAlerts() {
  return (tree: MarkdownRoot) => visit(tree, "blockquote", (node) => {
    const paragraph = node.children[0]
    const first = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined
    if (first?.type !== "text") return
    const marker = first.value.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s|$)/)
    if (!marker) return
    first.value = first.value.slice(marker[0].length).trimStart()
    const name = marker[1]!.toLowerCase()
    node.children.unshift({ type: "paragraph", children: [
      { type: "strong", children: [{ type: "text", value: name[0]!.toUpperCase() + name.slice(1) }] },
    ] })
    if (paragraph?.type === "paragraph" && paragraph.children.every((child) => child.type === "text" && !child.value))
      node.children.splice(1, 1)
  })
}

function resolveTarget(value: string, context: GitHubMarkdownContext) {
  const target = safeTarget(value)
  if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) return target
  const repositoryUrl = context.repositoryUrl.replace(/\/+$/, "")
  const ref = encodeURIComponent(context.ref ?? "HEAD")
  const documentUrl = context.sourceUrl ?? (context.path
    ? `${repositoryUrl}/blob/${ref}/${context.path.split("/").map(encodeURIComponent).join("/")}`
    : `${repositoryUrl}/`)
  if (target.startsWith("#") || target.startsWith("?") || target.startsWith("//"))
    return new URL(target, documentUrl).href
  const suffixAt = target.search(/[?#]/)
  const path = suffixAt < 0 ? target : target.slice(0, suffixAt)
  const suffix = suffixAt < 0 ? "" : target.slice(suffixAt)
  const resolved = posix.resolve("/", posix.dirname(context.path ?? ""), path)
  return new URL(`${repositoryUrl}/blob/${ref}${resolved}${suffix}`).href
}

function githubLinks(context: GitHubMarkdownContext) {
  return (tree: MarkdownRoot) => visit(tree, (node, index, parent) => {
    if (node.type === "link" || node.type === "definition") {
      node.url = resolveTarget(node.url, context)
      return SKIP
    }
    if (node.type === "code" || node.type === "inlineCode" || node.type === "image" || node.type === "linkReference" || node.type === "imageReference") return SKIP
    if (node.type !== "text" || index === undefined || !parent || !("children" in parent)) return
    const chunks = node.value.split(/(\uE000[^\uE001]*\uE001)/g).flatMap((part) => part.startsWith("\uE000")
      ? [{ text: part }] : referenceLinkChunks(part, context.repositoryUrl))
    if (!chunks.some((chunk) => chunk.href)) return
    const children: PhrasingContent[] = chunks.map((chunk) => chunk.href
      ? { type: "link", url: chunk.href, children: [{ type: "text", value: chunk.text }] }
      : { type: "text", value: chunk.text })
    // A text node's parent is a phrasing container, not a block-only container.
    const siblings = parent.children as PhrasingContent[]
    siblings.splice(index, 1, ...children)
    return index + children.length
  })
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(sourcePositions)
  .use(githubAlerts)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(terminalMedia)
  .use(documentAnchors)
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: "-",
    fences: true,
    listItemIndent: "one",
  })

// Issue attachments are evidence, even when their labels look like README branding.
const discussionProcessor = processor().use(terminalMedia, { preserveImages: true })
function plainCodeFences() {
  return (tree: MarkdownRoot) => visit(tree, "code", (node) => { node.lang ||= "text" })
}
const panelProcessor = processor().use(plainCodeFences)
const discussionPanelProcessor = discussionProcessor().use(plainCodeFences)

export function normalizeGitHubMarkdown(value: string, options: { preserveImages?: boolean; codePanels?: boolean; context?: GitHubMarkdownContext; anchors?: boolean; sourceMap?: MarkdownSourceMap } = {}) {
  const selected = options.codePanels !== false
    ? options.preserveImages ? discussionPanelProcessor : panelProcessor
    : options.preserveImages ? discussionProcessor : processor
  const contextual = options.context?.repositoryUrl ? selected().use(githubLinks, options.context) : selected
  return String(contextual.processSync({ value, data: { documentAnchors: options.anchors, sourceMap: options.sourceMap } })).trim()
}
