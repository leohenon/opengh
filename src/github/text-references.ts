import { unified } from "unified"
import remarkParse from "remark-parse"

export type TextReference = { repository: string } & (
  | { kind: "issue"; number: number }
  | { kind: "commit"; sha: string }
)

type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[] }

function markdownText(text: string): string {
  // Remove comments before parsing: comments can also occur inside link destinations.
  const tree = unified().use(remarkParse).parse(text.replace(/<!--[\s\S]*?(?:-->|$)/g, " "))
  const parts: string[] = []
  function visit(node: MarkdownNode) {
    if (node.type === "code" || node.type === "inlineCode") return
    if (node.value) parts.push(node.value)
    if (node.url) parts.push(node.url)
    node.children?.forEach(visit)
  }
  visit(tree)
  return parts.join("\n")
}

export function parseTextReferences(text: string, repository: string, markdown = false): TextReference[] {
  const input = markdown ? markdownText(text) : text
  const repo = "[a-z\\d_.-]+/[a-z\\d_.-]+"
  const sha = "[a-f\\d]{7,40}"
  // Consume qualified forms as a whole so their SHA/number is not also treated as local.
  const tokens = new RegExp(`(?<![\\w/@#.-])(?:https://github\\.com/${repo}/(?:issues/\\d+|pull/\\d+|commit/${sha})|${repo}(?:#\\d+|@${sha})|#\\d+|${sha})(?![\\w])`, "gi")
  const found = new Map<string, TextReference>()
  for (const match of input.matchAll(tokens)) {
    const token = match[0]
    let targetRepository = repository
    let entity: string
    let kind: "issue" | "commit"
    if (/^https:\/\//i.test(token)) {
      const [, owner, name, type, value] = token.slice("https://github.com".length).split("/")
      targetRepository = `${owner}/${name}`
      entity = value!
      kind = type === "commit" ? "commit" : "issue"
    } else if (token.includes("/")) {
      const separator = token.includes("#") ? "#" : "@"
      const [target, value] = token.split(separator)
      targetRepository = target!
      entity = value!
      kind = separator === "#" ? "issue" : "commit"
    } else if (token.startsWith("#")) {
      entity = token.slice(1)
      kind = "issue"
    } else {
      entity = token
      kind = "commit"
      if (entity.length !== 40 && !(/[a-f]/i.test(entity) && /\d/.test(entity))) continue
    }
    if (targetRepository.split("/").some(part => part === "." || part === "..")) continue
    targetRepository = targetRepository.toLowerCase()
    const reference: TextReference = kind === "issue"
      ? { kind, repository: targetRepository, number: Number(entity) }
      : { kind, repository: targetRepository, sha: entity.toLowerCase() }
    if (reference.kind === "issue" && (!Number.isSafeInteger(reference.number) || reference.number <= 0)) continue
    const key = `${targetRepository}:${kind}:${reference.kind === "issue" ? reference.number : reference.sha}`
    found.set(key, reference)
  }
  return [...found.values()]
}
