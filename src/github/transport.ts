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

export type RequestOptions = { signal?: AbortSignal; maxBytes?: number; jq?: string }

export type GitHubTransport = {
  json<T>(path: string): Promise<T>
  mutate?<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>): Promise<T>
  graphql?<T>(query: string, variables: Record<string, string>): Promise<T>
  text(path: string, accept?: string, options?: RequestOptions): Promise<string>
  page?(url: string): Promise<string>
}

const REQUEST_TIMEOUT_MS = 20_000

function httpStatus(message: string) {
  const match = message.match(/HTTP\s+(\d{3})/i)
  return match ? Number(match[1]) : undefined
}

async function request(
  path: string,
  accept?: string,
  fields?: Record<string, string>,
  mutation?: { method: "POST" | "PATCH"; body: Record<string, unknown> },
  options?: RequestOptions,
) {
  options?.signal?.throwIfAborted()
  const args = ["api", path]
  if (accept) args.push("-H", `Accept: ${accept}`)
  if (options?.jq) args.push("--jq", options.jq)
  if (fields) for (const [key, value] of Object.entries(fields)) args.push("-f", `${key}=${value}`)
  if (mutation) args.push("--method", mutation.method, "--input", "-")
  const process = spawnGitHub(args, undefined, mutation ? JSON.stringify(mutation.body) : undefined)
  const abort = () => process.kill()
  options?.signal?.addEventListener("abort", abort, { once: true })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    process.kill()
  }, REQUEST_TIMEOUT_MS)

  try {
    const [output, error, code] = await Promise.all([
      options?.maxBytes ? readLimited(process.stdout, options.maxBytes, () => process.kill()) : new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    options?.signal?.throwIfAborted()
    if (timedOut) throw new GitHubApiError(path, "Request timed out")
    if (code !== 0) {
      const message = error.trim() || `gh api failed (${code})`
      throw new GitHubApiError(path, message, httpStatus(message))
    }
    return output
  } finally {
    clearTimeout(timeout)
    options?.signal?.removeEventListener("abort", abort)
  }
}

async function readLimited(stream: ReadableStream<Uint8Array>, maxBytes: number, kill: () => void) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        kill()
        await reader.cancel()
        throw new Error("Diff exceeds the 4 MiB viewing limit. Load the file list or open it on GitHub.")
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString("utf8")
  } finally {
    reader.releaseLock()
  }
}

export const githubTransport: GitHubTransport = {
  async json<T>(path: string) {
    return JSON.parse(await request(path)) as T
  },
  async mutate<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
    return JSON.parse(await request(path, undefined, undefined, { method, body })) as T
  },
  async graphql<T>(query: string, variables: Record<string, string>) {
    return JSON.parse(await request("graphql", undefined, { query, ...variables })) as T
  },
  text(path: string, accept?: string, options?: RequestOptions) {
    return request(path, accept, undefined, undefined, options)
  },
  async page(url: string) {
    // Web pages are anonymous: never forward the CLI's API credentials here.
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "opengh" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`GitHub page failed (HTTP ${response.status})`)
    return response.text()
  },
}
