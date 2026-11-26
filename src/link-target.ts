import type { LaunchDetail } from "./launch-target"
import type { DiffTarget } from "./models"
import type { Page } from "./navigation"
import { normalizeRepository } from "./repository-name"

export type LinkTarget =
  | { kind: "page"; repository: string; page: Page }
  | { kind: "detail"; repository: string; detail: LaunchDetail }
  | { kind: "diff"; repository: string; target: DiffTarget }
  | { kind: "external"; url: string }

// Validate before URL parsing strips controls or normalizes paths.
export function parseSafeUrl(value: string): URL | undefined {
  if (
    !/^(?:https?:\/\/|mailto:)/i.test(value) ||
    /[\s\x00-\x1f\x7f\\]/.test(value) ||
    /%(?![a-f\d]{2})|%(?:0[a-f\d]|1[a-f\d]|7f)/i.test(value)
  )
    return undefined
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

export function githubDiffTarget(path: readonly string[], fragment: string): DiffTarget | undefined {
  const fileHash = /^#diff-([a-f\d]{64})(?:[LR]\d+(?:-[LR]\d+)?)?$/i.exec(fragment)?.[1]?.toLowerCase()
  const anchor = fileHash ? { fileHash } : {}
  const [route, target, tab, range] = path
  if (route === "commit" && path.length === 2 && fileHash && /^[a-f\d]{4,40}$/i.test(target!))
    return { kind: "commit", sha: target!.toLowerCase(), ...anchor }
  if (route !== "pull") return
  const number = positiveNumber(target ?? "")
  if (number === undefined) return
  if (path.length === 3 && (tab === "files" || tab === "changes")) return { kind: "pull", number, ...anchor }
  if (path.length !== 4 || (tab !== "changes" && tab !== "files")) return
  const commits = /^(BASE|[a-f\d]{40})\.\.([a-f\d]{40})$/i.exec(range!)
  if (!commits) return
  return {
    kind: "compare",
    base: commits[1]!.toUpperCase() === "BASE" ? "BASE" : commits[1]!.toLowerCase(),
    head: commits[2]!.toLowerCase(),
    pullNumber: number,
    ...anchor,
  }
}

export function resolveLinkTarget(value: string): LinkTarget | undefined {
  const url = parseSafeUrl(value)
  if (!url) return undefined
  const external: LinkTarget = { kind: "external", url: value }
  if (url.protocol === "mailto:" || url.hostname !== "github.com" || url.port) return external

  const [owner, name, ...path] = url.pathname.replace(/^\/|\/$/g, "").split("/")
  if (
    owner &&
    ["apps", "orgs", "users", "settings", "sponsors", "marketplace", "topics", "collections", "features", "site"].includes(
      owner.toLowerCase(),
    )
  )
    return external
  const repository = owner && name && normalizeRepository(`${owner}/${name}`)
  if (!repository) return external
  const [route, target] = path
  if (route === "actions" && target === "runs" && (path.length === 3 || (path.length === 5 && path[3] === "job"))) {
    // Job and step links open their parent run.
    if (
      [...url.searchParams].some(([key, value]) =>
        key === "pr" ? positiveNumber(value) === undefined : key !== "check_suite_focus" || !["true", "false"].includes(value),
      ) ||
      (url.hash && !/^#step:\d+:\d+$/.test(url.hash))
    )
      return external
    const id = positiveNumber(path[2]!)
    if (id === undefined || (path.length === 5 && positiveNumber(path[4]!) === undefined)) return undefined
    return { kind: "detail", repository, detail: { kind: "run", id } }
  }
  if (!url.search) {
    const target = githubDiffTarget(path, url.hash)
    if (target && (!url.hash || target.fileHash)) return { kind: "diff", repository, target }
  }
  if (url.search || url.hash) return external
  if (!path.length) return { kind: "page", repository, page: "overview" }

  const pages: Record<string, Page> = { issues: "issues", pulls: "pulls", commits: "commits", actions: "actions" }
  if (path.length === 1 && Object.hasOwn(pages, route!)) return { kind: "page", repository, page: pages[route!]! }
  if (path.length === 2) {
    if (route === "issues" || route === "pull") {
      if (route === "pull" && /^[1-9]\d*\.(?:diff|patch)$/.test(target!)) return external
      const number = positiveNumber(target!)
      return number === undefined
        ? undefined
        : {
            kind: "detail",
            repository,
            detail: { kind: route === "issues" ? "number" : "pull", number },
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
  if (route === "pull" && (path[2] === "files" || path[2] === "changes") && positiveNumber(target!) === undefined) return undefined
  return external
}
