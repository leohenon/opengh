import type { DetailTarget, Page } from "./navigation"
import { normalizeRepository } from "./repository-name"

export type LaunchDetail = DetailTarget | { kind: "number"; number: number }

export type LaunchOptions = {
  repositoryArgument?: string
  initialPage?: Page
  initialDetail?: LaunchDetail
  standalone?: boolean
  inline?: boolean
  resume?: boolean
  help?: boolean
  version?: boolean
}

export const launchUsage = `Usage:
  opengh                              Open the repository picker
  opengh --resume                     Restore the last repository and page
  opengh <owner/repo|.>                Open a repository
  opengh <github-url>                  Open a repository, page, or detail
  opengh [owner/repo|.] <number|hash>   Open an issue, PR, or commit
  opengh [owner/repo|.] --commit <hash>
  opengh [owner/repo|.] --issue <number>
  opengh [owner/repo|.] --pr <number>

Without an explicit repository, identifiers use the current directory's GitHub repository.
Numbers automatically resolve to an issue or PR; use --commit for a digits-only hash.
Commit hashes may be abbreviated (4–40 hexadecimal characters).

Supported GitHub.com URLs:
  /owner/repo
  /owner/repo/issues, /pulls, /commits, /actions
  /owner/repo/issues/123
  /owner/repo/pull/123
  /owner/repo/commit/abc1234
  /owner/repo/actions/runs/123

URL query strings and anchors are ignored (no comment or line jumping).
Quote URLs containing shell metacharacters and identifiers such as '#123'.

Options:
  --resume                            Restore the last interactive page (no repository or target)
  --standalone                        Hide global navigation; Ctrl+O opens the full app
  --inline                            Print the complete page to stdout and exit
  -h, --help                          Show this help
  -v, --version                       Show version
`

function positiveNumber(value: string): number {
  const number = Number(value.replace(/^#/, ""))
  if (!/^#?\d+$/.test(value) || !Number.isSafeInteger(number) || number <= 0)
    throw new Error(`Invalid issue/PR or run number: “${value}”. Expected a positive safe integer.`)
  return number
}

function commitHash(value: string): string {
  if (!/^[a-f\d]{4,40}$/i.test(value))
    throw new Error(`Invalid commit hash: “${value}”. Expected 4–40 hexadecimal characters.`)
  return value.toLowerCase()
}

function identifier(value: string): LaunchDetail {
  if (/^#?\d+$/.test(value)) return { kind: "number", number: positiveNumber(value) }
  if (/^[a-f\d]{4,40}$/i.test(value)) return { kind: "commit", sha: commitHash(value) }
  throw new Error(`Invalid target: “${value}”. Expected an issue/PR number or a commit hash.`)
}

function repositoryLocation(value: string): LaunchOptions | undefined {
  if (value === ".") return { repositoryArgument: "." }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) || /^github\.com(?:[/?#]|$)/i.test(value)) {
    // Validate before WHATWG parsing can strip controls or change the selected path.
    const rawPath = value.replace(/^(?:[a-z][a-z\d+.-]*:\/\/)?[^/?#]*/i, "").split(/[?#]/, 1)[0]!
    if (/[\x00-\x1f\x7f\\]/.test(value) || rawPath.split("/").some((part) => /^(?:\.|%2e){1,2}$/i.test(part)))
      throw new Error("GitHub URLs must not contain control characters, backslashes, or dot path segments.")
    let url: URL
    try { url = new URL(/^github\.com/i.test(value) ? `https://${value}` : value) }
    catch { throw new Error(`Invalid GitHub URL: “${value}”.`) }
    if (!["https:", "http:"].includes(url.protocol) || url.hostname !== "github.com"
      || url.port || url.username || url.password)
      throw new Error("Only GitHub.com URLs without credentials or custom ports are supported.")
    const [owner, name, ...path] = url.pathname.replace(/^\/+|\/+$/g, "").split("/")
    const repository = owner && name && normalizeRepository(`${owner}/${name}`)
    if (!repository) throw new Error(`Invalid GitHub repository URL: “${value}”.`)
    const location: LaunchOptions = { repositoryArgument: repository }
    if (!path.length) return location
    const [route, target] = path
    const pages: Record<string, Page> = { issues: "issues", pulls: "pulls", commits: "commits", actions: "actions" }
    if (path.length === 1 && Object.hasOwn(pages, route!)) return { ...location, initialPage: pages[route!] }
    if (path.length === 2) {
      if (route === "issues") return { ...location, initialDetail: { kind: "number", number: positiveNumber(target!) } }
      if (route === "pull") return { ...location, initialDetail: { kind: "pull", number: positiveNumber(target!) } }
      if (route === "commit") return { ...location, initialDetail: { kind: "commit", sha: commitHash(target!) } }
    }
    if (path.length === 3 && route === "actions" && target === "runs")
      return { ...location, initialDetail: { kind: "run", id: positiveNumber(path[2]!) } }
    throw new Error(`Unsupported GitHub page: “${url.pathname}”. Run opengh --help for supported URLs.`)
  }
  const repository = normalizeRepository(value)
  return repository ? { repositoryArgument: repository } : undefined
}

export function parseLaunchArguments(args: readonly string[]): LaunchOptions {
  const positional: string[] = []
  let explicitDetail: LaunchDetail | undefined
  let standalone = false
  let inlineMode = false
  let resume = false
  let options = true
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (options && argument === "--") { options = false; continue }
    if (options && (argument === "--help" || argument === "-h")) return { help: true }
    if (options && (argument === "--version" || argument === "-v")) return { version: true }
    if (options && argument === "--standalone") { standalone = true; continue }
    if (options && argument === "--inline") { inlineMode = true; continue }
    if (options && argument === "--resume") { resume = true; continue }
    if (!options || !argument.startsWith("-")) { positional.push(argument.trim()); continue }
    const [option, inline] = argument.split(/=(.*)/s)
    if (!["--commit", "--issue", "--pr"].includes(option!))
      throw new Error(`Unknown option: “${option}”.`)
    if (explicitDetail) throw new Error("Specify only one of --commit, --issue, or --pr.")
    const value = inline ?? args[++index]
    if (!value || value.startsWith("-")) throw new Error(`${option} requires a ${option === "--commit" ? "commit hash" : "number"}.`)
    explicitDetail = option === "--commit" ? { kind: "commit", sha: commitHash(value) }
      : { kind: option === "--pr" ? "pull" : "issue", number: positiveNumber(value) }
  }
  if (resume && (positional.length || explicitDetail || inlineMode))
    throw new Error("--resume cannot be combined with a repository, target, or --inline.")
  const mode: LaunchOptions = {
    ...(standalone ? { standalone: true } : {}),
    ...(inlineMode ? { inline: true } : {}),
    ...(resume ? { resume: true } : {}),
  }
  if (positional.length > 2) throw new Error("Expected at most a repository and one target.")
  if (!positional.length) return explicitDetail ? { ...mode, repositoryArgument: ".", initialDetail: explicitDetail } : mode

  const location = repositoryLocation(positional[0]!)
  if (!location) {
    if (positional.length > 1 || explicitDetail) throw new Error(`Invalid repository: “${positional[0]}”. Expected owner/repo, a GitHub URL, or '.'.`)
    return { ...mode, repositoryArgument: ".", initialDetail: identifier(positional[0]!) }
  }
  if (positional[1] !== undefined && explicitDetail) throw new Error("Specify a target either positionally or with an option, not both.")
  const detail = explicitDetail ?? (positional[1] !== undefined ? identifier(positional[1]) : undefined)
  if (detail && (location.initialPage || location.initialDetail)) throw new Error("The URL already selects a page or detail; do not specify another target.")
  return detail ? { ...mode, ...location, initialDetail: detail } : { ...mode, ...location }
}
