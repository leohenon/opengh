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
}

function httpStatus(message: string) {
  const match = message.match(/HTTP\s+(\d{3})/i)
  return match ? Number(match[1]) : undefined
}

async function request(path: string, accept?: string) {
  const args = ["gh", "api", path]
  if (accept) args.push("-H", `Accept: ${accept}`)
  const process = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  const [output, error, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (code !== 0) {
    const message = error.trim() || `gh api failed (${code})`
    throw new GitHubApiError(path, message, httpStatus(message))
  }
  return output
}

export const githubTransport: GitHubTransport = {
  async json<T>(path: string) {
    return JSON.parse(await request(path)) as T
  },
  text(path: string, accept?: string) {
    return request(path, accept)
  },
}
