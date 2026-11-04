import { spawnGitHub } from "./process"
import { GitHubApiError, GitHubRequestNotSentError } from "./errors"
import { GitHubRequestScheduler, githubRequests } from "./request-scheduler"

export { GitHubApiError, GitHubRequestNotSentError } from "./errors"

export type RequestOptions = { signal?: AbortSignal; maxBytes?: number; jq?: string }

export type GitHubTransport = {
  json<T>(path: string): Promise<T>
  mutate?<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>): Promise<T>
  graphql?<T>(query: string, variables: Record<string, string>): Promise<T>
  text(path: string, accept?: string, options?: RequestOptions): Promise<string>
  page?(url: string): Promise<string>
}

type RequestArguments = [
  path: string,
  accept?: string,
  fields?: Record<string, string>,
  mutation?: { method: "POST" | "PATCH"; body: Record<string, unknown> },
  options?: RequestOptions,
]

const REQUEST_TIMEOUT_MS = 20_000
const HEADER_ALLOWANCE_BYTES = 64 * 1024
const DIFF_LIMIT_MESSAGE = "Diff exceeds the 4 MiB viewing limit. Load the file list or open it on GitHub."
const RATE_LIMIT_MESSAGE = /rate.?limit|abuse detection|submitted too quickly/i

// Conservative: unfamiliar documents (including leading comments) still get an
// account check. A query containing another mutation operation is not read-only.
function readOnlyGraphQL(query: string) {
  return /^\s*(?:query\b|\{)/.test(query) && !/\bmutation\b/.test(query)
}

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

function responseParts(output: string) {
  const status = /^HTTP\/[\d.]+\s+(\d{3})[^\r\n]*\r?\n/.exec(output)
  const separator = status && /\r?\n\r?\n/.exec(output)
  const headers = new Headers()
  if (!status || !separator) return { body: output, headers, status: undefined }
  for (const line of output.slice(status[0].length, separator.index).split(/\r?\n/)) {
    const colon = line.indexOf(":")
    if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim())
  }
  return { body: output.slice(separator.index + separator[0].length), headers, status: Number(status[1]) }
}

async function request(scheduler: GitHubRequestScheduler, ...[path, accept, fields, mutation, options]: RequestArguments) {
  validateEndpoint(path)
  const write = Boolean(mutation || (fields && !readOnlyGraphQL(fields.query ?? "")))
  options?.signal?.throwIfAborted()
  scheduler.assertAvailable(path, write)
  const args = ["api", "--hostname", "github.com", path, "--include"]
  if (accept) args.push("-H", `Accept: ${accept}`)
  if (options?.jq) args.push("--jq", options.jq)
  if (fields) for (const [key, value] of Object.entries(fields)) args.push("-f", `${key}=${value}`)
  if (mutation) args.push("--method", mutation.method, "--input", "-")
  const process = spawnGitHub(args, undefined, mutation ? JSON.stringify(mutation.body) : undefined)
  let finished = false
  const exited = process.exited.finally(() => { finished = true })
  const abort = () => process.kill()
  options?.signal?.addEventListener("abort", abort, { once: true })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    process.kill()
  }, REQUEST_TIMEOUT_MS)

  try {
    const [output, error, code] = await Promise.all([
      options?.maxBytes ? readLimited(process.stdout, options.maxBytes + HEADER_ALLOWANCE_BYTES, () => process.kill()) : new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      exited,
    ])
    options?.signal?.throwIfAborted()
    if (timedOut) throw new GitHubApiError(path, "Request timed out")
    const { body, headers, status: responseStatus } = responseParts(output)
    const status = responseStatus ?? (code === 4 ? 401 : Number(error.match(/HTTP\s+(\d{3})/i)?.[1]) || undefined)
    let message = error.trim()
    let graphqlLimited = false
    if (path === "graphql" || (status !== undefined && status >= 400)) {
      try {
        const value = JSON.parse(body)
        if (!message && typeof value.message === "string") message = value.message
        if (path === "graphql" && Array.isArray(value.errors)) {
          const limit = value.errors.find((item: { type?: string; message?: string } | null) =>
            item?.type === "RATE_LIMITED" || (typeof item?.message === "string" && RATE_LIMIT_MESSAGE.test(item.message)))
          if (limit) { graphqlLimited = true; message ||= limit.message || "GraphQL rate limit exceeded" }
        }
      } catch { /* Non-JSON API errors still have status/headers and gh stderr. */ }
    }
    const limited = graphqlLimited || status === 429
      || ((status === 403 || code !== 0) && (RATE_LIMIT_MESSAGE.test(message)
        || headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after")))
    scheduler.observe(headers, limited)
    if (code !== 0 || (status !== undefined && status >= 400) || limited)
      throw new GitHubApiError(path, message || (limited ? "GitHub rate limit exceeded" : `gh api failed (${code})`), limited ? (status === 403 ? 403 : 429) : status)
    if (options?.maxBytes && Buffer.byteLength(body) > options.maxBytes) throw new Error(DIFF_LIMIT_MESSAGE)
    return body
  } finally {
    clearTimeout(timeout)
    options?.signal?.removeEventListener("abort", abort)
    // Stream reads can fail before gh exits. Kill it and retain the slot until
    // termination, so oversized/failed responses cannot leak live processes.
    if (!finished) {
      process.kill("SIGKILL")
      await exited
    }
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
        throw new Error(DIFF_LIMIT_MESSAGE)
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

export function createGitHubTransport(scheduler: GitHubRequestScheduler = githubRequests): GitHubTransport {
  const direct = (...args: RequestArguments) => request(scheduler, ...args)
  const send = (...args: RequestArguments) => scheduler.run(args[0], () => direct(...args), args[4]?.signal)
  type Viewer = { id: number; login: string }
  let initialViewer: Promise<Viewer> | undefined
  async function viewer(load = send): Promise<Viewer> {
    const value = JSON.parse(await load("user"))
    if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 || typeof value.login !== "string" || !value.login.trim())
      throw new Error("GitHub account could not be verified; no changes were sent.")
    return { id: value.id, login: value.login }
  }
  async function authenticatedRequest(...args: RequestArguments) {
    const [path, , fields, mutation, options] = args
    validateEndpoint(path)
    options?.signal?.throwIfAborted()
    const write = Boolean(mutation || (fields && !readOnlyGraphQL(fields.query ?? "")))
    let expected: Viewer
    try {
      // Remember the account that loaded this session, not its credentials. A failed
      // initial login remains retryable after authenticating outside the app.
      initialViewer ??= viewer().catch((error) => { initialViewer = undefined; throw error })
      // Cancel this caller's wait, not the shared probe needed by other requests.
      expected = await awaitWithAbort(initialViewer, options?.signal)
    } catch (error) {
      if (write) throw new GitHubRequestNotSentError(error instanceof Error ? error.message : "GitHub account could not be verified; no changes were sent.")
      throw error
    }
    if (!write) return send(...args)
    return scheduler.run(path, async () => {
      // Reserve one slot for the probe and write together: never verify the
      // account and then leave the write waiting in the request queue.
      try {
        const actual = await viewer(direct)
        if (actual.id !== expected.id)
          throw new Error(`GitHub account changed from @${expected.login} to @${actual.login}. Restart opengh before continuing; no changes were sent.`)
      } catch (error) {
        throw new GitHubRequestNotSentError(error instanceof Error ? error.message : "GitHub account could not be verified; no changes were sent.")
      }
      return direct(...args)
    }, options?.signal, true)
  }

  return {
    async json<T>(path: string) {
      return JSON.parse(await authenticatedRequest(path)) as T
    },
    async mutate<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
      return JSON.parse(await authenticatedRequest(path, undefined, undefined, { method, body })) as T
    },
    async graphql<T>(query: string, variables: Record<string, string>) {
      return JSON.parse(await authenticatedRequest("graphql", undefined, { ...variables, query })) as T
    },
    text(path: string, accept?: string, options?: RequestOptions) {
      return authenticatedRequest(path, accept, undefined, undefined, options)
    },
    async page(url: string) {
      // Restrict anonymous fetches too: no arbitrary destinations or redirects.
      const target = new URL(url)
      if (target.origin !== "https://github.com" || target.username || target.password)
        throw new Error("Only anonymous GitHub.com pages are supported")
      return scheduler.run(url, async () => {
        const response = await fetch(target, {
          headers: { Accept: "text/html", "User-Agent": "opengh" },
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        })
        const limited = response.status === 429 || (response.status === 403 && response.headers.has("retry-after"))
        scheduler.observe(response.headers, limited)
        if (!response.ok) throw new GitHubApiError(url, `GitHub page failed (HTTP ${response.status})`)
        return response.text()
      })
    },
  }
}

export const githubTransport = createGitHubTransport()
