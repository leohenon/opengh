import { GitHubApiError, GitHubRequestNotSentError } from "./errors"

const MAX_CONCURRENT_REQUESTS = 4
const MIN_BACKOFF_MS = 60_000

// Shared by REST, GraphQL, identity probes, and anonymous page fetches. Cooldowns
// reject locally rather than queueing stale polling reads or delayed writes.
export class GitHubRequestScheduler {
  private active = 0
  private queue: (() => void)[] = []
  private blockedUntil = 0
  private backoff = MIN_BACKOFF_MS

  assertAvailable(path: string, write: boolean) {
    if (Date.now() >= this.blockedUntil) return
    const message = `GitHub requests are paused until ${new Date(this.blockedUntil).toLocaleTimeString()} due to rate limiting`
    if (write) throw new GitHubRequestNotSentError(`${message}; wait before retrying. No changes were sent.`)
    throw new GitHubApiError(path, message, 429)
  }

  async run<T>(path: string, task: () => Promise<T>, signal?: AbortSignal, write = false): Promise<T> {
    let acquired = false
    try {
      // Only failures before task dispatch are known unsent. In particular,
      // a task's response-budget or cancellation error must pass through.
      try {
        signal?.throwIfAborted()
        this.assertAvailable(path, write)
        await new Promise<void>((resolve, reject) => {
          const start = () => {
            signal?.removeEventListener("abort", abort)
            try {
              signal?.throwIfAborted()
              this.assertAvailable(path, write)
              this.active++
              acquired = true
              resolve()
            } catch (error) { reject(error) }
          }
          const abort = () => {
            const index = this.queue.indexOf(start)
            if (index !== -1) this.queue.splice(index, 1)
            reject(signal?.reason)
          }
          if (this.active < MAX_CONCURRENT_REQUESTS) start()
          else {
            this.queue.push(start)
            signal?.addEventListener("abort", abort, { once: true })
          }
        })
        signal?.throwIfAborted()
        this.assertAvailable(path, write)
      } catch (error) {
        if (write) throw new GitHubRequestNotSentError(error instanceof Error ? error.message : "GitHub request cancelled; no changes were sent.")
        throw error
      }
      return await task()
    } finally {
      if (acquired) {
        this.active--
        while (this.active < MAX_CONCURRENT_REQUESTS && this.queue.length) this.queue.shift()!()
      }
    }
  }

  observe(headers: Headers, rateLimited: boolean) {
    const now = Date.now()
    const exhausted = headers.get("x-ratelimit-remaining") === "0"
    if (!rateLimited && !exhausted) {
      // An older, already in-flight success must not undo a new cooldown.
      if (now >= this.blockedUntil) this.backoff = MIN_BACKOFF_MS
      return
    }
    const retry = headers.get("retry-after")
    const retryAt = retry === null ? 0 : /^\d+(?:\.\d+)?$/.test(retry)
      ? now + Number(retry) * 1000 : Date.parse(retry)
    const reset = headers.get("x-ratelimit-reset")
    const resetAt = exhausted && reset !== null ? Number(reset) * 1000 + 1000 : 0
    const specified = Math.max(Number.isFinite(retryAt) ? retryAt : 0, Number.isFinite(resetAt) ? resetAt : 0)
    this.blockedUntil = Math.max(this.blockedUntil, specified > now ? specified : now + this.backoff)
    this.backoff = Math.min(this.backoff * 2, 15 * MIN_BACKOFF_MS)
  }
}

export const githubRequests = new GitHubRequestScheduler()
