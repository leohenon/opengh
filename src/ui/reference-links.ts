export type LinkedTextChunk = { text: string; href?: string }

const owner = "[a-z\\d](?:[a-z\\d-]{0,37}[a-z\\d])?"
const repository = `${owner}/[a-z\\d_.-]+`
const sha = "[a-f\\d]{7,40}"

export function normalizeRepositoryUrl(value?: string) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password
      || !new RegExp(`^/${repository}/?$`, "i").test(url.pathname)) return undefined
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`
  } catch { return undefined }
}

export function repositoryUrlFromCommitUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password) return undefined
    const match = url.pathname.match(new RegExp(`^/(${repository})/(?:commit|pull/[1-9]\\d*/commits)/(${sha})/?$`, "i"))
    return match ? `${url.origin}/${match[1]}` : undefined
  } catch { return undefined }
}

function httpTarget(value: string) {
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) && !/[\u0000-\u0020\u007f]/.test(value) ? value : undefined
  } catch { return undefined }
}

export function referenceLinkChunks(text: string, repositoryUrl?: string): LinkedTextChunk[] {
  const base = normalizeRepositoryUrl(repositoryUrl)
  const origin = base?.split("/").slice(0, 3).join("/") ?? "https://github.com"
  const tokens = new RegExp(`<!--[\\s\\S]*?(?:-->|$)|(\x60+)[\\s\\S]*?\\1(?!\x60)|\\[[^\\]\\n]+\\]\\(https?:\\/\\/[^\\s<>]+?\\)|https?:\\/\\/[^\\s<>\"\x60]+|${repository}(?:#[1-9]\\d*|@${sha})|#[1-9]\\d*|${sha}|@${owner}`, "gi")
  const chunks: LinkedTextChunk[] = []
  let offset = 0
  const append = (value: string, href?: string) => {
    if (!value) return
    const previous = chunks[chunks.length - 1]
    if (!href && previous && !previous.href) previous.text += value
    else chunks.push(href ? { text: value, href } : { text: value })
  }
  for (const match of text.matchAll(tokens)) {
    const start = match.index!
    append(text.slice(offset, start))
    const label = match[0]
    offset = start + label.length
    if (label.startsWith("<!--") || label.startsWith("`")) { append(label); continue }
    const markdown = label.match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+)\)$/i)
    if (markdown && httpTarget(markdown[2]!)) {
      append("["); append(markdown[1]!, markdown[2]); append("]("); append(markdown[2]!, markdown[2]); append(")")
      continue
    }
    const before = text[start - 1] ?? ""
    const after = text[offset] ?? ""
    if (/[\p{L}\p{N}_/@#.-]/u.test(before)) { append(label); continue }
    if (/^https?:\/\//i.test(label)) {
      let target = label.replace(/[.,;:!?]+$/, "")
      while (target.endsWith(")") && (target.match(/\)/g)?.length ?? 0) > (target.match(/\(/g)?.length ?? 0)) target = target.slice(0, -1)
      target = target.replace(/[\]}]+$/, "")
      append(target, httpTarget(target)); append(label.slice(target.length))
      continue
    }
    if (/[\p{L}\p{N}_/@#-]/u.test(after) || after === "." && /[\p{L}\p{N}_]/u.test(text[offset + 1] ?? "")) { append(label); continue }
    const qualified = label.match(/^(.+\/[^#@]+)([#@])(.+)$/)
    let href: string | undefined
    if (qualified) href = `${origin}/${qualified[1]}/${qualified[2] === "#" ? "issues" : "commit"}/${qualified[3]}`
    else if (label.startsWith("#")) href = base ? `${base}/issues/${label.slice(1)}` : undefined
    else if (label.startsWith("@") && !label.includes("--")) href = `${origin}/${label.slice(1)}`
    else if (base && /^[a-f\d]{7,40}$/i.test(label) && (label.length === 40 || /[a-f]/i.test(label) && /\d/.test(label))) href = `${base}/commit/${label}`
    append(label, href)
  }
  append(text.slice(offset))
  return chunks
}
