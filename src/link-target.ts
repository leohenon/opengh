import type { LaunchDetail } from "./launch-target"
import type { DiffTarget } from "./models"
import type { Page } from "./navigation"
import { normalizeRepository } from "./repository-name"

export type LinkTarget =
  | { kind: "page"; repository: string; page: Page }
  | { kind: "detail"; repository: string; detail: LaunchDetail; comment?: number }
  | { kind: "diff"; repository: string; target: DiffTarget }
  | { kind: "new-issue"; repository: string }
  | { kind: "new-pull"; repository: string; head: string }
  | { kind: "ref"; repository: string; name: string; view: "commit" | "commits" }
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

function decodedPath(segments: readonly string[]): string | undefined {
  try {
    return segments.map((segment) => decodeURIComponent(segment)).join("/")
  } catch {
    return undefined
  }
}

function branchName(segments: readonly string[]): string | undefined {
  const name = decodedPath(segments)
  return name === undefined ? undefined : validRef(name)
}

function validRef(name: string): string | undefined {
  if (
    !name ||
    /[\x00-\x20\x7f~^:?*[\\]/.test(name) ||
    name.includes("..") ||
    name.includes("@{") ||
    name.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock")) ||
    name.endsWith(".")
  )
    return undefined
  return name
}

const unsupportedSections: Record<string, readonly [label: string, plural: boolean]> = {
  blame: ["Files", true],
  blob: ["Files", true],
  branches: ["Branches", true],
  compare: ["Comparisons", true],
  deployments: ["Deployments", true],
  discussions: ["Discussions", true],
  forks: ["Forks", true],
  graphs: ["Insights", true],
  labels: ["Labels", true],
  milestone: ["Milestones", true],
  milestones: ["Milestones", true],
  network: ["Insights", true],
  packages: ["Packages", true],
  projects: ["Projects", true],
  pulse: ["Insights", true],
  releases: ["Releases", true],
  security: ["Security", false],
  settings: ["Settings", true],
  stargazers: ["Stargazers", true],
  tags: ["Tags", true],
  tree: ["Files", true],
  watchers: ["Watchers", true],
  wiki: ["The wiki", false],
}

export const TAGS_NOT_SUPPORTED = "Tags are not yet supported"

export function unsupportedPageTitle(value: string): string | undefined {
  const url = parseSafeUrl(value)
  if (!url || url.protocol === "mailto:" || url.hostname !== "github.com" || url.port) return undefined
  const [owner, name, section = ""] = url.pathname.replace(/^\/|\/$/g, "").split("/")
  const key = section.toLowerCase()
  const [label, plural] = owner && name && Object.hasOwn(unsupportedSections, key) ? unsupportedSections[key]! : ["This page", false]
  return `${label} ${plural ? "are" : "is"} not yet supported`
}

export const openingInBrowser = (title: string) => `${title}, opening in browser`

export function unsupportedLinkMessage(value: string): string | undefined {
  const title = unsupportedPageTitle(value)
  return title && openingInBrowser(title)
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
  if (route === "issues" && target === "new" && (path.length === 2 || (path.length === 3 && path[2] === "choose")))
    return { kind: "new-issue", repository }
  if (route === "pull" && target === "new") {
    const head = path.length > 2 ? branchName(path.slice(2)) : undefined
    return head ? { kind: "new-pull", repository, head } : external
  }
  const conversation = (route === "issues" || route === "pull") && path.length === 2
  if (url.search || (url.hash && !conversation)) return external
  if (!path.length) return { kind: "page", repository, page: "overview" }

  const pages: Record<string, Page> = { issues: "issues", pulls: "pulls", commits: "commits", actions: "actions" }
  if (path.length === 1 && Object.hasOwn(pages, route!)) return { kind: "page", repository, page: pages[route!]! }
  if (conversation) {
    if (route === "pull" && /^[1-9]\d*\.(?:diff|patch)$/.test(target!)) return external
    const number = positiveNumber(target!)
    if (number === undefined) return undefined
    const comment = positiveNumber(/^#issuecomment-(\d+)$/.exec(url.hash)?.[1] ?? "")
    return {
      kind: "detail",
      repository,
      detail: { kind: route === "issues" ? "number" : "pull", number },
      ...(comment === undefined ? {} : { comment }),
    }
  }
  if (route === "commit" && path.length > 1) {
    if (path.length === 2 && /^[a-f\d]{4,40}$/i.test(target!))
      return { kind: "detail", repository, detail: { kind: "commit", sha: target!.toLowerCase() } }
    if (/\.(?:diff|patch)$/i.test(path.at(-1)!)) return external
    const ref = branchName(path.slice(1))
    return ref ? { kind: "ref", repository, name: ref, view: "commit" } : external
  }
  if (route === "commits" && path.length > 1) {
    const ref = branchName(path.slice(1))
    return ref ? { kind: "ref", repository, name: ref, view: "commits" } : external
  }
  if (route === "compare" && path.length > 1) {
    if (/\.(?:diff|patch)$/i.test(path.at(-1)!)) return external
    const range = decodedPath(path.slice(1))
    const [base, head, ...rest] = range?.split("...") ?? []
    const sides = !rest.length && base && head ? [validRef(base), validRef(head)] : []
    return sides[0] && sides[1] ? { kind: "diff", repository, target: { kind: "compare", base: sides[0], head: sides[1] } } : external
  }
  if (path.length === 4 && route === "pull" && path[2] === "commits") {
    if (positiveNumber(target!) === undefined || !/^[a-f\d]{4,40}$/i.test(path[3]!)) return undefined
    return { kind: "detail", repository, detail: { kind: "commit", sha: path[3]!.toLowerCase() } }
  }
  if (route === "pull" && (path[2] === "files" || path[2] === "changes") && positiveNumber(target!) === undefined) return undefined
  return external
}
