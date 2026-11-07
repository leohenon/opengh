export const MAX_AUTOMATIC_PAGES = 20
export const MAX_DETAIL_REQUESTS = 100
export const MAX_DETAIL_ITEMS = 10_000
export const MAX_DETAIL_BYTES = 16 * 1024 * 1024
const DETAIL_TIMEOUT_MS = 60_000

export class RequestBudgetLimitError extends Error {
  constructor(reason: string) {
    super(`${reason}. Results are incomplete; open this item on GitHub for the full view.`)
    this.name = "RequestBudgetLimitError"
  }
}

export class ResponseLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ResponseLimitError"
  }
}

export type RequestBudget = {
  signal: AbortSignal
  takeRequest(): void
  consumeBytes(count: number): void
  consumeItems(count: number): void
  dispose(): void
}

export function createRequestBudget(parent?: AbortSignal): RequestBudget {
  const controller = new AbortController()
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal
  const fail = (reason: string): never => {
    const error = new RequestBudgetLimitError(reason)
    controller.abort(error)
    throw error
  }
  const timeout = setTimeout(() => controller.abort(new RequestBudgetLimitError("Detail loading exceeded the 60 second limit")), DETAIL_TIMEOUT_MS)
  timeout.unref?.()
  let requests = 0
  let bytes = 0
  let items = 0
  return {
    signal,
    takeRequest() {
      signal.throwIfAborted()
      if (++requests > MAX_DETAIL_REQUESTS) fail("Detail loading exceeded the request limit")
    },
    consumeBytes(count) {
      signal.throwIfAborted()
      bytes += count
      if (bytes > MAX_DETAIL_BYTES) fail("Detail loading exceeded the 16 MiB limit")
    },
    consumeItems(count) {
      signal.throwIfAborted()
      items += count
      if (items > MAX_DETAIL_ITEMS) fail("Detail loading exceeded the item limit")
    },
    dispose() {
      clearTimeout(timeout)
      controller.abort(new DOMException("Detail loading finished", "AbortError"))
    },
  }
}

export function isRequestInterrupted(error: unknown, options?: { signal?: AbortSignal; budget?: RequestBudget }) {
  return error instanceof RequestBudgetLimitError || error instanceof ResponseLimitError || options?.signal?.aborted === true || options?.budget?.signal.aborted === true
    || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
}
