import { diffLocation, type DetailTarget, type InitialNavigation, type Page } from "./navigation"
import { githubDiffTarget, resolveLinkTarget, unsupportedPageTitle, type LinkTarget } from "./link-target"
import type { DiffTarget } from "./models"
import { normalizeRepository } from "./repository-name"
import { isRepositoryPath } from "./repository-path"

export type LaunchDetail = DetailTarget | { kind: "number"; number: number }

export type LaunchRef = { name: string; view: "commit" | "commits"; url: string }

export type UnsupportedLaunch = { url: string; title: string; closest: LaunchLocation }

export type LaunchLocation = {
  repositoryArgument?: string
  initialPage?: Page
  initialDetail?: LaunchDetail
  initialDiff?: DiffTarget
  initialComment?: number
  initialCreate?: InitialNavigation["create"]
  initialRef?: LaunchRef
  unsupported?: UnsupportedLaunch
}

export type LaunchOptions = LaunchLocation & {
  focus?: boolean
  inline?: boolean
  diff?: boolean
  file?: string
  resume?: boolean
  interactive?: boolean
  update?: boolean
  help?: boolean
  version?: boolean
}

export const launchUsage = `Usage:
  opengh                                  Open the repository picker
  opengh --resume                         Restore the last repository and page
  opengh update                           Update using your installation method
  opengh <owner/repo|path>                Open a repository
  opengh issues|pulls|actions             Open a repository page (current directory)
  opengh issues --repo <owner/repo|path>  Open a page in an explicit repository
  opengh <github-url>                     Open a repository, page, or detail
  opengh [repo|path] <number|hash>        Open an issue, PR, or commit
  opengh [repo|path] --commit <hash>      Open a commit
  opengh [repo|path] --issue <number>     Open an issue
  opengh [repo|path] --pr <number>        Open a pull request

Local paths: ., .., /path/to/repo, ./repo, ../repo, or ~/repo.
Use ./owner/repo to open a local path instead of the GitHub name owner/repo.

Without an explicit repository, pages and identifiers use the current directory's GitHub repository.
Numbers automatically resolve to an issue or PR; use --commit for a digits-only hash.
Commit hashes may be abbreviated (4–40 hexadecimal characters).

Supported GitHub.com URLs:
  /owner/repo
  /owner/repo/issues, /pulls, /commits, /actions
  /owner/repo/issues/123
  /owner/repo/pull/123
  /owner/repo/pull/123/files or /changes
  /owner/repo/pull/123/changes/BASE..<commit-sha>
  /owner/repo/commit/<sha, branch, or tag>
  /owner/repo/commits/<branch>
  /owner/repo/compare/<base>...<head>
  /owner/repo/issues/new, /owner/repo/pull/new/<branch>
  /owner/repo/actions/runs/123

Other GitHub pages offer to open on GitHub or the closest page opengh supports.
URLs also work without https://github.com/, e.g. owner/repo/pull/123.

Comment anchors (#issuecomment-…) scroll to the comment, and diff file anchors (#diff-…)
select a file. Query strings and other anchors are ignored.
Quote URLs containing shell metacharacters and identifiers such as '#123'.

Options:
  --repo <owner/repo|path>                Select a repository
  -i, --interactive                       Choose a page before opening the app
  --resume                                Restore the last interactive page (no repository or target)
  -f, --focus                             Hide global navigation; Ctrl+O opens the full app
  --inline                                Print a bounded page snapshot to stdout and exit
  --diff                                  Add the patch to --inline (PR or commit)
  --file <path>                           Limit --diff to one changed file
  -h, --help                              Show this help
  -v, --version                           Show version
`

export const updateUsage = `Usage:
  opengh update                           Update using your installation method

Standalone binaries update to the latest stable release. Managed installs update
through Homebrew, global npm, or an unpinned Nix profile. If the owning install
cannot be verified, or it needs a manual update, opengh prints instructions.

Options:
  -h, --help                              Show this help
`

function positiveNumber(value: string): number {
  const number = Number(value.replace(/^#/, ""))
  if (!/^#?\d+$/.test(value) || !Number.isSafeInteger(number) || number <= 0)
    throw new Error(`Invalid issue/PR or run number: “${value}”. Expected a positive safe integer.`)
  return number
}

function commitHash(value: string): string {
  if (!/^[a-f\d]{4,40}$/i.test(value)) throw new Error(`Invalid commit hash: “${value}”. Expected 4–40 hexadecimal characters.`)
  return value.toLowerCase()
}

function identifier(value: string): LaunchDetail {
  if (/^#?\d+$/.test(value)) return { kind: "number", number: positiveNumber(value) }
  if (/^[a-f\d]{4,40}$/i.test(value)) return { kind: "commit", sha: commitHash(value) }
  throw new Error(`Invalid target: “${value}”. Expected an issue/PR number or a commit hash.`)
}

function withGitHubHost(value: string): string {
  return /^[a-z\d][a-z\d-]*\/[\w.-]+\/[^/?#]/i.test(value) ? `github.com/${value}` : value
}

function repositoryLocation(value: string): LaunchOptions | undefined {
  if (isRepositoryPath(value)) return { repositoryArgument: value }
  const link = withGitHubHost(value)
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(link) || /^github\.com(?:[/?#]|$)/i.test(link)) {
    // Validate before WHATWG parsing can strip controls or change the selected path.
    const rawPath = link.replace(/^(?:[a-z][a-z\d+.-]*:\/\/)?[^/?#]*/i, "").split(/[?#]/, 1)[0]!
    if (/[\x00-\x1f\x7f\\]/.test(link) || rawPath.split("/").some((part) => /^(?:\.|%2e){1,2}$/i.test(part)))
      throw new Error("GitHub URLs must not contain control characters, backslashes, or dot path segments.")
    let url: URL
    try {
      url = new URL(/^github\.com/i.test(link) ? `https://${link}` : link)
    } catch {
      throw new Error(`Invalid GitHub URL: “${value}”.`)
    }
    if (!["https:", "http:"].includes(url.protocol) || url.hostname !== "github.com" || url.port || url.username || url.password)
      throw new Error("Only GitHub.com URLs without credentials or custom ports are supported.")
    const [owner, name, ...path] = url.pathname.replace(/^\/+|\/+$/g, "").split("/")
    const repository = owner && name && normalizeRepository(`${owner}/${name}`)
    if (!repository) throw new Error(`Invalid GitHub repository URL: “${value}”.`)
    const location: LaunchOptions = { repositoryArgument: repository }
    if (!path.length) return location
    return githubLinkLocation(location, path, url) ?? strictLocation(location, path, url)
  }
  const repository = normalizeRepository(value)
  return repository ? { repositoryArgument: repository } : undefined
}

function selectsTarget(location: LaunchLocation) {
  return !!(
    location.initialPage ||
    location.initialDetail ||
    location.initialDiff ||
    location.initialCreate ||
    location.initialRef ||
    location.unsupported
  )
}

function inlineLocation(launch: LaunchLocation) {
  const unsupported = (url: string) => {
    let page = url
    try {
      page = new URL(url).pathname
    } catch {}
    return new Error(`Unsupported GitHub page: “${page}”. Run opengh --help for supported URLs.`)
  }
  if (launch.unsupported) throw unsupported(launch.unsupported.url)
  if (launch.initialRef) throw unsupported(launch.initialRef.url)
  if (launch.initialCreate) throw new Error("--inline only reads GitHub; it can't start a new issue or pull request.")
  if (launch.initialDiff?.kind === "compare")
    throw new Error(
      launch.initialDiff.pullNumber === undefined
        ? "Comparison URLs require the interactive diff viewer; omit --inline."
        : "PR revision range URLs require the interactive diff viewer; omit --inline.",
    )
}

export function parseGitHubLink(value: string): LaunchLocation | undefined {
  const link = value.trim()
  if (!/^(?:https?:\/\/)?github\.com(?:[/?#]|$)/i.test(withGitHubHost(link))) return undefined
  return repositoryLocation(link)
}

function githubLinkLocation(location: LaunchLocation, path: string[], url: URL): LaunchLocation | undefined {
  const repository = location.repositoryArgument!
  const [route, , tab, range] = path
  if (route === "pull" && (tab === "files" || tab === "changes") && range?.includes("..") && !githubDiffTarget(path, ""))
    throw new Error(`Invalid PR revision range: “${range}”. Expected BASE..<sha> or <sha>..<sha> with full commit SHAs.`)
  const hash = /^#(?:diff-[a-f\d]{64}(?:[LR]\d+(?:-[LR]\d+)?)?|issuecomment-\d+)$/i.test(url.hash) ? url.hash : ""
  const href = `https://github.com/${repository}/${path.join("/")}${hash}`
  const target = resolveLinkTarget(href)
  if (!target) return undefined
  if (target.kind === "external")
    return {
      ...location,
      unsupported: {
        url: url.href,
        title: unsupportedPageTitle(href) ?? "This page is not yet supported",
        closest: closestLocation(location, path),
      },
    }
  if (target.kind === "ref") return { ...location, initialRef: { name: target.name, view: target.view, url: url.href } }
  return linkLocation(location, target)
}

function linkLocation(location: LaunchLocation, target: LinkTarget): LaunchLocation | undefined {
  if (target.kind === "page") return target.page === "overview" ? location : { ...location, initialPage: target.page }
  if (target.kind === "detail")
    return { ...location, initialDetail: target.detail, ...(target.comment === undefined ? {} : { initialComment: target.comment }) }
  if (target.kind === "diff") {
    const detail = diffLocation(target.target).detail
    return detail
      ? { ...location, initialDetail: detail, initialDiff: target.target }
      : { ...location, initialPage: "commits", initialDiff: target.target }
  }
  if (target.kind === "new-issue") return { ...location, initialPage: "issues", initialCreate: { kind: "issue" } }
  if (target.kind === "new-pull") return { ...location, initialPage: "pulls", initialCreate: { kind: "pull", head: target.head } }
  return undefined
}

function closestLocation(location: LaunchLocation, path: readonly string[]): LaunchLocation {
  for (let length = path.length - 1; length > 0; length--) {
    const target = resolveLinkTarget(`https://github.com/${location.repositoryArgument}/${path.slice(0, length).join("/")}`)
    if (target?.kind === "page" || target?.kind === "detail" || target?.kind === "diff") return linkLocation(location, target)!
  }
  return location
}

function strictLocation(location: LaunchOptions, path: string[], url: URL): LaunchOptions {
  {
    const initialDiff = githubDiffTarget(path, url.hash)
    if (initialDiff) return { ...location, initialDetail: diffLocation(initialDiff).detail, initialDiff }
    const [route, target] = path
    const pages: Record<string, Page> = { issues: "issues", pulls: "pulls", commits: "commits", actions: "actions" }
    if (path.length === 1 && Object.hasOwn(pages, route!)) return { ...location, initialPage: pages[route!] }
    if (path.length === 2) {
      const comment = /^#issuecomment-([1-9]\d*)$/.exec(url.hash)?.[1]
      const anchor = comment && Number.isSafeInteger(Number(comment)) ? { initialComment: Number(comment) } : {}
      if (route === "issues") return { ...location, initialDetail: { kind: "number", number: positiveNumber(target!) }, ...anchor }
      if (route === "pull") return { ...location, initialDetail: { kind: "pull", number: positiveNumber(target!) }, ...anchor }
      if (route === "commit") return { ...location, initialDetail: { kind: "commit", sha: commitHash(target!) } }
    }
    if (path.length === 3 && route === "actions" && target === "runs")
      return { ...location, initialDetail: { kind: "run", id: positiveNumber(path[2]!) } }
    throw new Error(`Unsupported GitHub page: “${url.pathname}”. Run opengh --help for supported URLs.`)
  }
}

export function parseLaunchArguments(args: readonly string[]): LaunchOptions {
  if (args[0] === "update") {
    if (args.length === 1) return { update: true }
    if (args.length === 2 && (args[1] === "--help" || args[1] === "-h")) return { update: true, help: true }
    throw new Error("opengh update accepts no arguments other than --help or -h.")
  }
  const positional: string[] = []
  let explicitDetail: LaunchDetail | undefined
  let explicitRepository: string | undefined
  let focus = false
  let inlineMode = false
  let diff = false
  let file: string | undefined
  let resume = false
  let interactive = false
  let options = true
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (options && argument === "--") {
      options = false
      continue
    }
    if (options && (argument === "--help" || argument === "-h")) return { help: true }
    if (options && (argument === "--version" || argument === "-v")) return { version: true }
    if (options && (argument === "--focus" || argument === "-f" || argument === "--standalone")) {
      focus = true
      continue
    }
    if (options && argument === "--inline") {
      inlineMode = true
      continue
    }
    if (options && argument === "--diff") {
      diff = true
      continue
    }
    if (options && argument === "--resume") {
      resume = true
      continue
    }
    if (options && (argument === "-i" || argument === "--interactive")) {
      interactive = true
      continue
    }
    if (options && /^-[if]{2,}$/.test(argument)) {
      focus ||= argument.includes("f")
      interactive ||= argument.includes("i")
      continue
    }
    if (!options || !argument.startsWith("-")) {
      positional.push(argument.trim())
      continue
    }
    const [option, inline] = argument.split(/=(.*)/s)
    if (option === "--repo") {
      if (explicitRepository !== undefined) throw new Error("Specify --repo only once.")
      const value = inline ?? args[++index]
      if (!value || value.startsWith("-")) throw new Error("--repo requires owner/repo or a local path.")
      const repository = isRepositoryPath(value) ? value : normalizeRepository(value)
      if (!repository) throw new Error(`Invalid repository: “${value}”. Expected owner/repo or a local path.`)
      explicitRepository = repository
      continue
    }
    if (option === "--file") {
      if (file !== undefined) throw new Error("Specify --file only once.")
      const value = inline ?? args[++index]
      if (!value || (inline === undefined && value.startsWith("-")))
        throw new Error("--file requires a repository-relative path; use --file=<path> for paths starting with -.")
      file = value
      continue
    }
    if (!["--commit", "--issue", "--pr"].includes(option!)) throw new Error(`Unknown option: “${option}”.`)
    if (explicitDetail) throw new Error("Specify only one of --commit, --issue, or --pr.")
    const value = inline ?? args[++index]
    if (!value || value.startsWith("-")) throw new Error(`${option} requires a ${option === "--commit" ? "commit hash" : "number"}.`)
    explicitDetail =
      option === "--commit"
        ? { kind: "commit", sha: commitHash(value) }
        : { kind: option === "--pr" ? "pull" : "issue", number: positiveNumber(value) }
  }
  if (interactive && (resume || inlineMode || explicitDetail))
    throw new Error("--interactive cannot be combined with --resume, --inline, or a detail target.")
  if (resume && (positional.length || explicitRepository || explicitDetail || inlineMode))
    throw new Error("--resume cannot be combined with a repository, target, or --inline.")
  const mode: LaunchOptions = {
    ...(focus ? { focus: true } : {}),
    ...(inlineMode ? { inline: true } : {}),
    ...(diff ? { diff: true } : {}),
    ...(file !== undefined ? { file } : {}),
    ...(resume ? { resume: true } : {}),
    ...(interactive ? { interactive: true } : {}),
  }
  const finish = (launch: LaunchOptions): LaunchOptions => {
    if (diff && !inlineMode) throw new Error("--diff requires --inline.")
    if (inlineMode) inlineLocation(launch)
    if (file !== undefined && !diff) throw new Error("--file requires --diff.")
    if (diff && !["pull", "commit", "number"].includes(launch.initialDetail?.kind ?? ""))
      throw new Error("--diff requires a PR or commit target.")
    return launch
  }
  const page = positional[0]
  if (page === "issues" || page === "pulls" || page === "actions") {
    if (interactive) throw new Error("--interactive cannot be combined with an explicit page.")
    if (positional.length > 1 || explicitDetail)
      throw new Error(`opengh ${page} selects a page; use --repo to select a repository and do not specify a target.`)
    return finish({ ...mode, repositoryArgument: explicitRepository ?? ".", initialPage: page })
  }
  if (explicitRepository !== undefined) {
    if (positional.some((value) => repositoryLocation(value)))
      throw new Error("Specify a repository either positionally or with --repo, not both.")
    positional.unshift(explicitRepository)
  }
  if (positional.length > 2) throw new Error("Expected at most a repository and one target.")
  if (interactive) {
    if (positional.length > 1) throw new Error("--interactive accepts only a repository, not a target.")
    const location = positional.length ? repositoryLocation(positional[0]!) : { repositoryArgument: "." }
    if (!location || selectsTarget(location)) throw new Error("--interactive accepts only a repository, not a page or detail target.")
    return finish({ ...mode, ...location })
  }
  if (!positional.length) return finish(explicitDetail ? { ...mode, repositoryArgument: ".", initialDetail: explicitDetail } : mode)

  const location = repositoryLocation(positional[0]!)
  if (!location) {
    if (positional.length > 1 || explicitDetail)
      throw new Error(`Invalid repository: “${positional[0]}”. Expected owner/repo, a GitHub URL, or a local path.`)
    return finish({ ...mode, repositoryArgument: ".", initialDetail: identifier(positional[0]!) })
  }
  if (positional[1] !== undefined && explicitDetail) throw new Error("Specify a target either positionally or with an option, not both.")
  const detail = explicitDetail ?? (positional[1] !== undefined ? identifier(positional[1]) : undefined)
  if (detail && selectsTarget(location)) throw new Error("The URL already selects a page or detail; do not specify another target.")
  return finish(detail ? { ...mode, ...location, initialDetail: detail } : { ...mode, ...location })
}
