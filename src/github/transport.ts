import { spawnGitHub } from "./process"
import { GitHubApiError } from "./errors"

export { GitHubApiError } from "./errors"

export type RequestOptions = { signal?: AbortSignal; maxBytes?: number; jq?: string }

export type GitHubTransport = {
  json<T>(path: string): Promise<T>
  mutate?<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>): Promise<T>
  graphql?<T>(query: string, variables: Record<string, string>): Promise<T>
  text(path: string, accept?: string, options?: RequestOptions): Promise<string>
  page?(url: string): Promise<string>
}

const REQUEST_TIMEOUT_MS = 20_000

function validateEndpoint(path: string) {
  // --hostname does not constrain absolute gh api URLs. Only accept relative
  // endpoints, without path traversal or CLI-option/URL interpretation.
  let route: string
  try { route = decodeURIComponent(path.split("?")[0]!) } catch { throw new Error("Invalid GitHub API endpoint") }
  if (!/^[a-z\d]/i.test(path) || /^[a-z][a-z\d+.-]*:/i.test(path)
    || /[\\\s#\x00-\x1f\x7f]/.test(path) || /[\\\x00-\x1f\x7f]/.test(route)
    || route.split("/").some((part) => part === "." || part === ".."))
    throw new Error("Only relative GitHub API endpoints without path traversal are allowed")
}

async function request(
  path: string,
  accept?: string,
  fields?: Record<string, string>,
  mutation?: { method: "POST" | "PATCH"; body: Record<string, unknown> },
  options?: RequestOptions,
) {
  validateEndpoint(path)
  options?.signal?.throwIfAborted()
  const args = ["api", "--hostname", "github.com", path]
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
      throw new GitHubApiError(path, message, code === 4 ? 401 : undefined)
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

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value) },
      (error) => { signal.removeEventListener("abort", abort); reject(error) },
    )
    if (signal.aborted) abort()
  })
}

export function createGitHubTransport(): GitHubTransport {
  type Viewer = { id: number; login: string }
  let initialViewer: Promise<Viewer> | undefined
  async function viewer(): Promise<Viewer> {
    const value = JSON.parse(await request("user"))
    if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 || typeof value.login !== "string" || !value.login.trim())
      throw new Error("GitHub account could not be verified; no changes were sent.")
    return { id: value.id, login: value.login }
  }
  async function authenticatedRequest(...args: Parameters<typeof request>) {
    const [path, , fields, mutation, options] = args
    validateEndpoint(path)
    options?.signal?.throwIfAborted()
    // Remember the account that loaded this session, not its credentials. A failed
    // initial login remains retryable after authenticating outside the app.
    initialViewer ??= viewer().catch((error) => { initialViewer = undefined; throw error })
    // Cancel this caller's wait, not the shared probe needed by other requests.
    const expected = await awaitWithAbort(initialViewer, options?.signal)
    if (fields || mutation) {
      const actual = await viewer()
      if (actual.id !== expected.id)
        throw new Error(`GitHub account changed from @${expected.login} to @${actual.login}. Restart opengh before continuing; no changes were sent.`)
    }
    return request(...args)
  }

  return {
    async json<T>(path: string) {
      return JSON.parse(await authenticatedRequest(path)) as T
    },
    async mutate<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
      return JSON.parse(await authenticatedRequest(path, undefined, undefined, { method, body })) as T
    },
    async graphql<T>(query: string, variables: Record<string, string>) {
      return JSON.parse(await authenticatedRequest("graphql", undefined, { query, ...variables })) as T
    },
    text(path: string, accept?: string, options?: RequestOptions) {
      return authenticatedRequest(path, accept, undefined, undefined, options)
    },
    async page(url: string) {
      // Restrict anonymous fetches too: no arbitrary destinations or redirects.
      const target = new URL(url)
      if (target.origin !== "https://github.com" || target.username || target.password)
        throw new Error("Only anonymous GitHub.com pages are supported")
      const response = await fetch(target, {
        headers: { Accept: "text/html", "User-Agent": "opengh" },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`GitHub page failed (HTTP ${response.status})`)
      return response.text()
    },
  }
}

export const githubTransport = createGitHubTransport()
