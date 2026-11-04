import type { LaunchDetail } from "./launch-target"
import type { DiffTarget } from "./models"
import type { Page } from "./navigation"
import { normalizeRepository } from "./repository-name"

export type LinkTarget =
  | { kind: "page"; repository: string; page: Page }
  | { kind: "detail"; repository: string; detail: LaunchDetail }
  | { kind: "diff"; repository: string; target: DiffTarget }
  | { kind: "external"; url: string }

// Check the original spelling before URL parsing can strip controls or normalize paths.
// Shared with the OS opener so external URLs have the same safety boundary.
export function parseSafeUrl(value: string): URL | undefined {
  if (!/^(?:https?:\/\/|mailto:)/i.test(value)
    || /[\s\x00-\x1f\x7f\\]/.test(value)
    || /%(?![a-f\d]{2})|%(?:0[a-f\d]|1[a-f\d]|7f)/i.test(value)) return undefined
  try {
    const url = new URL(value)
    if (url.username || url.password) return undefined
    if (url.protocol === "mailto:") {
      if (!url.pathname || url.pathname.startsWith("//")) return undefined
    } else {
      const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0]!
      if (!authority || authority.includes("@") || !url.hostname) return undefined
      const rawPath = value.slice(value.indexOf("://") + 3 + authority.length).split(/[?#]/, 1)[0]!
      if (rawPath.split("/").some((part) => /^(?:\.|%2e){1,2}$/i.test(part))) return undefined
    }
    return url
  } catch {
    return undefined
  }
}

function positiveNumber(value: string): number | undefined {
  const number = Number(value)
  return /^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0 ? number : undefined
}

export function resolveLinkTarget(value: string): LinkTarget | undefined {
  const url = parseSafeUrl(value)
  if (!url) return undefined
  const external: LinkTarget = { kind: "external", url: value }
  // Internal routes cannot honor filters, comment/line anchors, or alternate hosts/ports.
  if (url.protocol === "mailto:" || url.hostname !== "github.com" || url.port || url.search || url.hash)
    return external

  const [owner, name, ...path] = url.pathname.replace(/^\/|\/$/g, "").split("/")
  if (owner && ["apps", "orgs", "users", "settings", "sponsors", "marketplace", "topics", "collections", "features", "site"].includes(owner.toLowerCase())) return external
  const repository = owner && name && normalizeRepository(`${owner}/${name}`)
  if (!repository) return external
  if (!path.length) return { kind: "page", repository, page: "overview" }

  const [route, target] = path
  const pages: Record<string, Page> = { issues: "issues", pulls: "pulls", commits: "commits", actions: "actions" }
  if (path.length === 1 && Object.hasOwn(pages, route!))
    return { kind: "page", repository, page: pages[route!]! }
  if (path.length === 2) {
    if (route === "issues" || route === "pull") {
      if (route === "pull" && /^[1-9]\d*\.(?:diff|patch)$/.test(target!)) return external
      const number = positiveNumber(target!)
      return number === undefined ? undefined : {
        kind: "detail", repository, detail: { kind: route === "issues" ? "number" : "pull", number },
      }
    }
    if (route === "commit") {
      if (/^[a-f\d]{4,40}\.(?:diff|patch)$/i.test(target!)) return external
      if (!/^[a-f\d]{4,40}$/i.test(target!)) return undefined
      return { kind: "detail", repository, detail: { kind: "commit", sha: target!.toLowerCase() } }
    }
  }
  if (path.length === 4 && route === "pull" && path[2] === "commits") {
    if (positiveNumber(target!) === undefined || !/^[a-f\d]{4,40}$/i.test(path[3]!)) return undefined
    return { kind: "detail", repository, detail: { kind: "commit", sha: path[3]!.toLowerCase() } }
  }
  if (path.length === 3 && route === "actions" && target === "runs") {
    const id = positiveNumber(path[2]!)
    return id === undefined ? undefined : { kind: "detail", repository, detail: { kind: "run", id } }
  }
  if (path.length === 3 && route === "pull" && path[2] === "files") {
    const number = positiveNumber(target!)
    return number === undefined ? undefined : { kind: "diff", repository, target: { kind: "pull", number } }
  }
  // A commit URL selects its detail; anchors and .diff/.patch downloads stay external.
  return external
}
