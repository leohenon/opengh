import { posix } from "node:path"
import type { Element, ElementContent, Root } from "hast"
import type { PhrasingContent, Root as MarkdownRoot } from "mdast"
import rehypeRaw from "rehype-raw"
import rehypeRemark from "rehype-remark"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import remarkStringify from "remark-stringify"
import { unified } from "unified"
import { SKIP, visit } from "unist-util-visit"

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
            parent.children[index] = { type: "text", value: "" }
            return SKIP
          }
          const link = imageCaption(label, href || property(image, "src"))
          parent.children[index] = parent.type === "element" && presentationGroups.has(parent)
            ? { type: "element", tagName: "p", properties: {}, children: [link] }
            : link
          return SKIP
        }
        if (href) element.properties.href = href
        else {
          parent.children[index] = { type: "text", value: textContent(element) }
          return
        }
      }

      if (tag === "img") {
        const label = property(element, "alt") || property(element, "title") || "image"
        if (!options.preserveImages && isDecorativeImage(element, label)) {
          parent.children[index] = { type: "text", value: "" }
          return
        }
        const pictureSource = parent.type === "element" && parent.tagName === "picture"
          ? firstDescendant(parent, "source")
          : undefined
        const target = property(element, "src")
          || property(pictureSource ?? element, "src")
          || property(pictureSource ?? element, "srcSet").split(/[ ,]/)[0]
          || ""
        parent.children[index] = imageCaption(label, target)
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
        parent.children[index] = replacement(`${kind}: ${label}`, target)
        return
      }

      if (tag === "svg") {
        const title = element.children.find((child): child is Element => child.type === "element" && child.tagName === "title")
        parent.children[index] = replacement(`Graphic: ${title ? textContent(title).trim() : "image"}`)
      }
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
    if (node.type === "code" || node.type === "inlineCode" || node.type === "image") return SKIP
    if (node.type !== "text" || index === undefined || !parent || !("children" in parent)) return
    const matches = [...node.value.matchAll(/(^|[^\w/])((?:[a-z\d_.-]+\/[a-z\d_.-]+)?#([1-9]\d*))(?!\w)/gi)]
    if (!matches.length) return
    const children: PhrasingContent[] = []
    let offset = 0
    for (const match of matches) {
      const start = match.index! + match[1]!.length
      if (start > offset) children.push({ type: "text", value: node.value.slice(offset, start) })
      const label = match[2]!
      const repository = label.slice(0, label.indexOf("#"))
      const url = repository
        ? new URL(`/${repository}/issues/${match[3]}`, context.repositoryUrl).href
        : `${context.repositoryUrl.replace(/\/+$/, "")}/issues/${match[3]}`
      children.push({ type: "link", url, children: [{ type: "text", value: label }] })
      offset = start + label.length
    }
    if (offset < node.value.length) children.push({ type: "text", value: node.value.slice(offset) })
    // A text node's parent is a phrasing container, not a block-only container.
    const siblings = parent.children as PhrasingContent[]
    siblings.splice(index, 1, ...children)
    return index + children.length
  })
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(githubAlerts)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(terminalMedia)
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

export function normalizeGitHubMarkdown(value: string, options: { preserveImages?: boolean; codePanels?: boolean; context?: GitHubMarkdownContext } = {}) {
  const selected = options.codePanels !== false
    ? options.preserveImages ? discussionPanelProcessor : panelProcessor
    : options.preserveImages ? discussionProcessor : processor
  const contextual = options.context?.repositoryUrl ? selected().use(githubLinks, options.context) : selected
  return String(contextual.processSync(value)).trim()
}
