import type { Element, ElementContent, Root } from "hast"
import type { Root as MarkdownRoot } from "mdast"
import rehypeRaw from "rehype-raw"
import rehypeRemark from "rehype-remark"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import remarkStringify from "remark-stringify"
import { unified } from "unified"
import { SKIP, visit } from "unist-util-visit"

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
          if (!options.preserveImages && (/\blogo\b/i.test(label) || isBadgeImage(image, label))) {
            parent.children[index] = { type: "text", value: "" }
            return SKIP
          }
          const link = replacement(label, href || property(image, "src"))
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
        if (!options.preserveImages && (/\blogo\b/i.test(label) || isBadgeImage(element, label))) {
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
        parent.children[index] = replacement(`Image: ${label}`, target)
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

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
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

export function normalizeGitHubMarkdown(value: string, options: { preserveImages?: boolean; codePanels?: boolean } = {}) {
  const selected = options.codePanels
    ? options.preserveImages ? discussionPanelProcessor : panelProcessor
    : options.preserveImages ? discussionProcessor : processor
  return String(selected.processSync(value)).trim()
}
