import { posix } from "node:path"
import type { Element, ElementContent, Root, Text } from "hast"
import { toHtml } from "hast-util-to-html"
import { parseFragment } from "parse5"
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

const MAX_SOURCE_BYTES = 1024 * 1024
const MAX_SOURCE_LINES = 10_000
const MAX_TREE_DEPTH = 64
const MAX_TREE_NODES = 20_000

export class GitHubMarkdownError extends Error {}

function lineBreaks(value: string, remaining: number) {
  let count = 0
  for (const _ of value.matchAll(/\r\n|[\r\n]/g)) {
    if (++count > remaining) throw new GitHubMarkdownError("Markdown has too many lines (limit: 10,000)")
  }
  return count
}

export function assertGitHubMarkdownSource(value: string) {
  if (value.length > MAX_SOURCE_BYTES || Buffer.byteLength(value, "utf8") > MAX_SOURCE_BYTES)
    throw new GitHubMarkdownError("Markdown is too large (limit: 1 MiB)")
  lineBreaks(value, MAX_SOURCE_LINES - 1)
}

// Both unist and parse5 trees are checked iteratively, before recursive visitors
// or the parse5-to-HAST converter can see attacker-controlled nesting.
type BoundedNode = {
  type?: string; nodeName?: string; tagName?: string; value?: string; url?: string; title?: string | null
  properties?: Record<string, unknown>; attrs?: { name: string; value: string }[]
  children?: BoundedNode[]; childNodes?: BoundedNode[]; content?: BoundedNode
}
function assertBoundedTree(root: BoundedNode) {
  const pending = [{ node: root, depth: 0 }]
  let count = 1
  let bytes = 0
  let lines = 1
  const charge = (value: unknown) => {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item !== "string") continue
      if (item.length > MAX_SOURCE_BYTES) throw new GitHubMarkdownError("Markdown expansion exceeds the viewing limit")
      bytes += Buffer.byteLength(item, "utf8")
      if (bytes > MAX_SOURCE_BYTES) throw new GitHubMarkdownError("Markdown expansion exceeds the viewing limit")
      lines += lineBreaks(item, MAX_SOURCE_LINES - lines)
    }
  }
  while (pending.length) {
    const { node, depth } = pending.pop()!
    if (depth > MAX_TREE_DEPTH) throw new GitHubMarkdownError("Markdown is too complex")
    charge(node.value)
    charge(node.url)
    charge(node.title)
    charge(node.tagName ?? node.nodeName)
    for (const [name, value] of Object.entries(node.properties ?? {})) { charge(name); charge(value) }
    for (const attribute of node.attrs ?? []) { charge(attribute.name); charge(attribute.value) }
    const children = node.children ?? node.childNodes ?? []
    const additional = children.length + (node.content ? 1 : 0)
    count += additional
    if (count > MAX_TREE_NODES) throw new GitHubMarkdownError("Markdown is too complex")
    for (const child of children) pending.push({ node: child, depth: depth + 1 })
    // parse5 stores template contents outside childNodes.
    if (node.content) pending.push({ node: node.content, depth: depth + 1 })
  }
}

function boundedMarkdown() {
  return (tree: MarkdownRoot) => {
    assertBoundedTree(tree)
    let projectedNodes = 0
    // remark-rehype URI encoding must not hide controls from safeTarget.
    visit(tree, (node) => {
      projectedNodes++
      if (projectedNodes > MAX_TREE_NODES) throw new GitHubMarkdownError("Markdown is too complex (table expansion)")
      if (node.type === "table") {
        const rows = node.children.length
        const width = Math.max(node.align?.length ?? 0, node.children[0]?.children.length ?? 0)
        // table-row pads to align width BEFORE boundedHtml runs. Charge cells
        // and their newline separators, row wrappers/separators, and table /
        // thead / tbody wrappers. Retain the original nodes too: conservative,
        // and shared across ALL tables and the rest of this Markdown tree.
        // Divide before multiplying so even the projection stays bounded.
        if (width > MAX_TREE_NODES || rows > Math.floor((MAX_TREE_NODES - projectedNodes - 8) / (2 * width + 3)))
          throw new GitHubMarkdownError("Markdown is too complex (table expansion)")
        projectedNodes += rows * (2 * width + 3) + 8
      }
      if (node.type === "link" || node.type === "definition" || node.type === "image") node.url = safeTarget(node.url)
    })
  }
}

function boundedHtmlTables() {
  return (tree: Root) => {
    assertBoundedTree(tree)
    let projectedNodes = 0
    visit(tree, (node) => {
      if (++projectedNodes > MAX_TREE_NODES) throw new GitHubMarkdownError("Markdown is too complex (table expansion)")
      if (node.type !== "element" || node.tagName !== "table") return
      const rows: Element[][] = []
      const pending: ElementContent[] = [...node.children].reverse()
      let outside = 0
      while (pending.length) {
        const child = pending.pop()!
        if (child.type === "text" && !child.value.trim()) continue
        if (child.type === "element" && child.tagName === "table") continue
        if (child.type === "element" && child.tagName === "tr") {
          const cells: Element[] = []
          for (const cell of child.children) {
            if (cell.type === "text" && !cell.value.trim()) continue
            if (cell.type !== "element" || (cell.tagName !== "td" && cell.tagName !== "th"))
              throw new GitHubMarkdownError("Markdown is too complex (table expansion)")
            cells.push(cell)
          }
          rows.push(cells)
          continue
        }
        if (child.type !== "element" || !["thead", "tbody", "tfoot"].includes(child.tagName)) outside++
        if (child.type === "element") pending.push(...[...child.children].reverse())
      }
      let width = 0
      let spanning = 0
      for (let index = 0; index < rows.length; index++) {
        let rowWidth = 0
        for (const cell of rows[index]!) {
          const columns = Math.max(1, Number.parseInt(String(cell.properties.colSpan), 10) || 1)
          const span = Math.max(1, Number.parseInt(String(cell.properties.rowSpan), 10) || 1)
          // The converter ignores nonexistent target rows, but still loops over
          // them. Clamping preserves its output without allowing billion-step loops.
          const remaining = Math.min(span, rows.length - index)
          if (cell.properties.rowSpan !== undefined) cell.properties.rowSpan = remaining
          rowWidth += columns
          if (remaining > 1) spanning += columns
          if (rowWidth + spanning > MAX_TREE_NODES) throw new GitHubMarkdownError("Markdown is too complex (table expansion)")
        }
        width = Math.max(width, rowWidth)
      }
      // Include a possible generated header, straddling content, and every span
      // that could add columns to another row before rectangular padding.
      const rowCount = rows.length + outside + 1
      width = Math.max(1, width + spanning + outside)
      if (rowCount > Math.floor((MAX_TREE_NODES - projectedNodes - 8) / (2 * width + 3)))
        throw new GitHubMarkdownError("Markdown is too complex (table expansion)")
      projectedNodes += rowCount * (2 * width + 3) + 8
    })
  }
}

function boundedHtml() {
  return (tree: Root) => {
    assertBoundedTree(tree)
    // Serialize the whole HAST, not individual HTML strings: raw tags may span
    // Markdown blocks, and HTML's implied closing/adoption rules affect depth.
    const html = toHtml(tree, { allowDangerousHtml: true })
    if (html.length > MAX_SOURCE_BYTES || Buffer.byteLength(html, "utf8") > MAX_SOURCE_BYTES)
      throw new GitHubMarkdownError("Markdown expansion exceeds the viewing limit")
    assertBoundedTree(parseFragment(html))
  }
}

export function gitHubMarkdownFallback(value: string, error: unknown): string {
  const notice = error instanceof GitHubMarkdownError ? error.message : "Markdown conversion failed"
  // Never send rejected input back through a Markdown parser or terminal escapes.
  const preview = value.slice(0, 4096).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "�")
    .split("\n").slice(0, 40).join("\n")
  return `${notice}. Showing a plain-text preview.\n\n${preview}\n\n[Preview limited to 4096 characters / 40 lines]`
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
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return ""
  const target = value.trim()
  // Validate relative destinations against a harmless base too: malformed
  // authorities such as //[ must never reach contextual URL resolution.
  if (!target || !URL.canParse(target, "https://github.com/")) return ""
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

function readOnlyHtml() {
  return (tree: Root) => {
    assertBoundedTree(tree)
    visit(tree, "element", (element, index, parent) => {
      if (index === undefined || !parent) return
      const tag = element.tagName
      // Remove controls before rehype-remark builds elementById or dereferences
      // input lists. This renderer needs static content, not form projections.
      if (["base", "datalist", "select", "textarea", "option", "optgroup", "output"].includes(tag)
        || tag === "input" && !["checkbox", "radio"].includes(property(element, "type"))) {
        parent.children.splice(index, 1)
        return [SKIP, index]
      }
      if (tag === "input") {
        // Disabled GFM checkboxes still carry readable state. No IDs, list
        // lookups, URLs, or user-controlled values reach the input handler.
        element.properties = { type: property(element, "type"), checked: Boolean(element.properties.checked) }
      }
      if (tag === "form" || tag === "button") {
        parent.children.splice(index, 1, ...element.children)
        return [SKIP, index] // Visit the unwrapped children too, including controls.
      }
    })
  }
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
  let inserted = 0
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
    const children: PhrasingContent[] = []
    for (const chunk of chunks) {
      inserted += chunk.href ? 2 : 1
      if (inserted > MAX_TREE_NODES) throw new GitHubMarkdownError("Markdown is too complex")
      children.push(chunk.href
        ? { type: "link", url: chunk.href, children: [{ type: "text", value: chunk.text }] }
        : { type: "text", value: chunk.text })
    }
    // A text node's parent is a phrasing container, not a block-only container.
    const siblings = parent.children as PhrasingContent[]
    siblings.splice(index, 1, ...children)
    return index + children.length
  })
}

function boundedOutput() {
  return (tree: MarkdownRoot) => { assertBoundedTree(tree) }
}

function sanitizeDestinations(tree: MarkdownRoot) {
  // Run after ALL converter/context transforms, even without GitHub context.
  assertBoundedTree(tree)
  const removedDefinitions = new Set<string>()
  visit(tree, "definition", (node) => {
    if (!safeTarget(node.url)) removedDefinitions.add(node.identifier.toUpperCase())
  })
  visit(tree, (node, index, parent) => {
    if (index === undefined || !parent) return
    if (node.type === "link" || node.type === "image" || node.type === "definition") {
      const target = safeTarget(node.url)
      if (target) { node.url = target; return }
      if (node.type === "link") {
        parent.children.splice(index, 1, ...node.children)
      } else if (node.type === "image") {
        parent.children.splice(index, 1, { type: "text", value: node.alt ?? "" })
      } else {
        parent.children.splice(index, 1)
      }
      return [SKIP, index]
    }
    if ((node.type === "linkReference" || node.type === "imageReference")
      && removedDefinitions.has(node.identifier.toUpperCase())) {
      if (node.type === "linkReference") parent.children.splice(index, 1, ...node.children)
      else parent.children.splice(index, 1, { type: "text", value: node.alt ?? "" })
      return [SKIP, index]
    }
  })
  assertBoundedTree(tree)
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm, { tablePipeAlign: false })
  .use(boundedMarkdown)
  .use(sourcePositions)
  .use(githubAlerts)
  .use(() => boundedOutput()) // A distinct plugin: unified deduplicates attachers.
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(boundedHtml)
  .use(rehypeRaw)
  .use(readOnlyHtml)
  .use(terminalMedia)
  .use(documentAnchors)
  .use(boundedHtmlTables)
  .use(rehypeRemark)
  .use(boundedOutput)
  .use(remarkGfm, { tablePipeAlign: false })
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
  // Check before parsing; rejected sources also use the bounded plain-text preview.
  assertGitHubMarkdownSource(value)
  const selected = options.codePanels !== false
    ? options.preserveImages ? discussionPanelProcessor : panelProcessor
    : options.preserveImages ? discussionProcessor : processor
  const contextual = options.context?.repositoryUrl ? selected().use(githubLinks, options.context) : selected
  const file = { value, data: { documentAnchors: options.anchors, sourceMap: options.sourceMap } }
  const tree = contextual.runSync(contextual.parse(file), file)
  sanitizeDestinations(tree as MarkdownRoot)
  const markdown = String(contextual.stringify(tree, file))
  if (markdown.length > MAX_SOURCE_BYTES || Buffer.byteLength(markdown, "utf8") > MAX_SOURCE_BYTES)
    throw new GitHubMarkdownError("Markdown expansion exceeds the viewing limit")
  return markdown.trim()
}
