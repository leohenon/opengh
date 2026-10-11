import { spawnGitHub } from "./process"

export class GitHubApiError extends Error {
  readonly path: string
  readonly status?: number

  constructor(path: string, message: string, status?: number) {
    super(message)
    this.name = "GitHubApiError"
    this.path = path
    this.status = status
  }
}

export type GitHubTransport = {
  json<T>(path: string): Promise<T>
  text(path: string, accept?: string): Promise<string>
  page?(url: string): Promise<string>
}

const REQUEST_TIMEOUT_MS = 20_000

function httpStatus(message: string) {
  const match = message.match(/HTTP\s+(\d{3})/i)
  return match ? Number(match[1]) : undefined
}

async function request(path: string, accept?: string) {
  const args = ["api", path]
  if (accept) args.push("-H", `Accept: ${accept}`)
  const process = spawnGitHub(args)
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    process.kill()
  }, REQUEST_TIMEOUT_MS)

  try {
    const [output, error, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    if (timedOut) throw new GitHubApiError(path, "Request timed out")
    if (code !== 0) {
      const message = error.trim() || `gh api failed (${code})`
      throw new GitHubApiError(path, message, httpStatus(message))
    }
    return output
  } finally {
    clearTimeout(timeout)
  }
}

export const githubTransport: GitHubTransport = {
  async json<T>(path: string) {
    return JSON.parse(await request(path)) as T
  },
  text(path: string, accept?: string) {
    return request(path, accept)
  },
  async page(url: string) {
    // Web pages are anonymous: never forward the CLI's API credentials here.
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "openGH" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`GitHub page failed (HTTP ${response.status})`)
    return response.text()
  },
}
