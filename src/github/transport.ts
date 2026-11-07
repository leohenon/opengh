import { spawnGitHub } from "./process"
import { GitHubApiError, GitHubRequestNotSentError } from "./errors"
import { GitHubRequestScheduler, githubRequests } from "./request-scheduler"
import { ResponseLimitError, type RequestBudget } from "./request-budget"

export { GitHubApiError, GitHubRequestNotSentError } from "./errors"

export type RequestOptions = { signal?: AbortSignal; maxBytes?: number; limitMessage?: string; jq?: string; budget?: RequestBudget }

export type GitHubTransport = {
  json<T>(path: string, options?: RequestOptions): Promise<T>
  mutate?<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>, options?: RequestOptions): Promise<T>
  graphql?<T>(query: string, variables: Record<string, string>, options?: RequestOptions): Promise<T>
  text(path: string, accept?: string, options?: RequestOptions): Promise<string>
  page?(url: string, options?: RequestOptions): Promise<string>
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
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_DIAGNOSTIC_BYTES = 64 * 1024
const RATE_LIMIT_MESSAGE = /rate.?limit|abuse detection|submitted too quickly/i

// Conservative: unfamiliar documents (including leading comments) still get an
// account check. A query containing another mutation operation is not read-only.
function readOnlyGraphQL(query: string) {
  return /^\s*(?:query\b|\{)/.test(query) && !/\bmutation\b/.test(query)
}

function requestSignal(options?: RequestOptions) {
  return options?.signal && options.budget
    ? AbortSignal.any([options.signal, options.budget.signal])
    : options?.signal ?? options?.budget?.signal
}

function writeRequest([path, , fields, mutation]: RequestArguments) {
  const query = path === "graphql" ? fields?.query ?? mutation?.body.query : undefined
  return query === undefined ? Boolean(fields || mutation) : typeof query !== "string" || !readOnlyGraphQL(query)
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
  const write = writeRequest([path, accept, fields, mutation, options])
  const signal = requestSignal(options)
  signal?.throwIfAborted()
  scheduler.assertAvailable(path, write)
  options?.budget?.takeRequest()
  const args = ["api", "--hostname", "github.com", path, "--include"]
  if (accept) args.push("-H", `Accept: ${accept}`)
  if (options?.jq) args.push("--jq", options.jq)
  if (fields) for (const [key, value] of Object.entries(fields)) args.push("-f", `${key}=${value}`)
  if (mutation) args.push("--method", mutation.method, "--input", "-")
  const process = spawnGitHub(args, undefined, mutation ? JSON.stringify(mutation.body) : undefined)
  let finished = false
  const exited = process.exited.finally(() => { finished = true })
  const abort = () => process.kill()
  signal?.addEventListener("abort", abort, { once: true })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    process.kill()
  }, REQUEST_TIMEOUT_MS)

  try {
    const [output, error, code] = await Promise.all([
      readLimited(process.stdout, (options?.maxBytes ?? MAX_RESPONSE_BYTES) + HEADER_ALLOWANCE_BYTES, abort,
        options?.limitMessage ?? "GitHub response exceeds the viewing limit. Open it on GitHub.", options?.budget),
      readLimited(process.stderr, MAX_DIAGNOSTIC_BYTES, abort, "GitHub diagnostic output exceeds the viewing limit.", options?.budget),
      exited,
    ])
    signal?.throwIfAborted()
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
    if (Buffer.byteLength(body) > (options?.maxBytes ?? MAX_RESPONSE_BYTES)) {
      abort()
      throw new ResponseLimitError(options?.limitMessage ?? "GitHub response exceeds the viewing limit. Open it on GitHub.")
    }
    return body
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abort)
    // Stream reads can fail before gh exits. Kill it and retain the slot until
    // termination, so oversized/failed responses cannot leak live processes.
    if (!finished) {
      process.kill("SIGKILL")
      await exited
    }
  }
}

async function readLimited(stream: ReadableStream<Uint8Array>, maxBytes: number, kill: () => void, message: string, budget?: RequestBudget) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new ResponseLimitError(message)
      budget?.consumeBytes(value.byteLength)
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString("utf8")
  } catch (error) {
    kill()
    await reader.cancel().catch(() => {})
    throw error
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
  const send = (...args: RequestArguments) => scheduler.run(args[0], () => direct(...args), requestSignal(args[4]))
  type Viewer = { id: number; login: string }
  let initialViewer: Promise<Viewer> | undefined
  async function viewer(load = send, options?: RequestOptions): Promise<Viewer> {
    const value = JSON.parse(await load("user", undefined, undefined, undefined, {
      ...options, jq: undefined, maxBytes: MAX_DIAGNOSTIC_BYTES,
      limitMessage: "GitHub account response exceeds the verification limit.",
    }))
    if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 || typeof value.login !== "string" || !value.login.trim())
      throw new Error("GitHub account could not be verified; no changes were sent.")
    return { id: value.id, login: value.login }
  }
  async function authenticatedRequest(...args: RequestArguments) {
    const [path, , , , options] = args
    validateEndpoint(path)
    const signal = requestSignal(options)
    signal?.throwIfAborted()
    const write = writeRequest(args)
    let expected: Viewer
    try {
      // Remember the account that loaded this session, not its credentials. A failed
      // initial login remains retryable after authenticating outside the app.
      initialViewer ??= viewer().catch((error) => { initialViewer = undefined; throw error })
      // Cancel this caller's wait, not the shared probe needed by other requests.
      expected = await awaitWithAbort(initialViewer, signal)
    } catch (error) {
      if (write) throw new GitHubRequestNotSentError(error instanceof Error ? error.message : "GitHub account could not be verified; no changes were sent.")
      throw error
    }
    if (!write) return send(...args)
    return scheduler.run(path, async () => {
      // Reserve one slot for the probe and write together: never verify the
      // account and then leave the write waiting in the request queue.
      try {
        const actual = await viewer(direct, options)
        if (actual.id !== expected.id)
          throw new Error(`GitHub account changed from @${expected.login} to @${actual.login}. Restart opengh before continuing; no changes were sent.`)
      } catch (error) {
        throw new GitHubRequestNotSentError(error instanceof Error ? error.message : "GitHub account could not be verified; no changes were sent.")
      }
      return direct(...args)
    }, signal, true)
  }

  return {
    async json<T>(path: string, options?: RequestOptions) {
      return JSON.parse(await authenticatedRequest(path, undefined, undefined, undefined, options)) as T
    },
    async mutate<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>, options?: RequestOptions) {
      return JSON.parse(await authenticatedRequest(path, undefined, undefined, { method, body }, options)) as T
    },
    async graphql<T>(query: string, variables: Record<string, string>, options?: RequestOptions) {
      // Do not expose query variables or mutation bodies in process listings.
      return JSON.parse(await authenticatedRequest("graphql", undefined, undefined, { method: "POST", body: { query, variables } }, options)) as T
    },
    text(path: string, accept?: string, options?: RequestOptions) {
      return authenticatedRequest(path, accept, undefined, undefined, options)
    },
    async page(url: string, options?: RequestOptions) {
      // Restrict anonymous fetches too: no arbitrary destinations or redirects.
      const target = new URL(url)
      if (target.origin !== "https://github.com" || target.username || target.password)
        throw new Error("Only anonymous GitHub.com pages are supported")
      const signal = requestSignal(options)
      return scheduler.run(url, async () => {
        signal?.throwIfAborted()
        options?.budget?.takeRequest()
        const controller = new AbortController()
        const response = await fetch(target, {
          headers: { Accept: "text/html", "User-Agent": "opengh" },
          redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
        })
        const limited = response.status === 429 || (response.status === 403 && response.headers.has("retry-after"))
        scheduler.observe(response.headers, limited)
        if (!response.ok) {
          await response.body?.cancel()
          throw new GitHubApiError(url, `GitHub page failed (HTTP ${response.status})`)
        }
        return response.body ? readLimited(response.body, 2 * 1024 * 1024, () => controller.abort(), "GitHub page exceeds the viewing limit.", options?.budget) : ""
      }, signal)
    },
  }
}

export const githubTransport = createGitHubTransport()
