import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { open, rename, unlink } from "node:fs/promises"
import { join } from "node:path"
import { createSignal } from "solid-js"
import { configDirectory } from "./paths"
import { cleanupDraftTemporaryFiles } from "./draft-cleanup"
import { ensureTrustedDirectory, readPrivateJson } from "./filesystem"
import { validateReviewDraft } from "./github/reviews"
import type { InlineCommentInput } from "./review-types"

// Unposted inline review comments: one file per account and pull request, keyed by diff revision and anchor.
export type InlineDraftContext = Omit<InlineCommentInput, "body">
export type InlineDraftScope = Pick<InlineCommentInput, "accountId" | "repository" | "number">
export type InlineDraftStorage = {
  load(scope: InlineDraftScope): Promise<InlineCommentInput[]>
  // Replaces the scope's drafts; an empty list removes its file.
  save(scope: InlineDraftScope, drafts: InlineCommentInput[]): Promise<void>
}

const VERSION = 1
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_DRAFTS = 1000
const scopeKey = (scope: InlineDraftScope) => `${scope.accountId}/${scope.repository.toLowerCase()}/${scope.number}`
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function canonical(context: InlineDraftContext): InlineDraftContext {
  const anchor = context.anchor
  return {
    accountId: context.accountId,
    repositoryId: context.repositoryId,
    repository: context.repository,
    number: context.number,
    headSha: context.headSha,
    baseSha: context.baseSha,
    anchor: {
      path: anchor.path,
      line: anchor.line,
      side: anchor.side,
      ...(anchor.startLine === undefined ? {} : { startLine: anchor.startLine, startSide: anchor.startSide }),
    },
  }
}

// Independent of property order.
export function inlineDraftKey(context: InlineDraftContext) {
  return JSON.stringify(canonical(context))
}

// Unpostable drafts are rejected, not repaired.
export function parseInlineDraft(value: unknown, scope: InlineDraftScope): InlineCommentInput {
  const draft = value as InlineCommentInput | null
  if (!draft || typeof draft !== "object" || Array.isArray(draft) || !draft.anchor || typeof draft.anchor !== "object")
    throw new Error("Invalid inline comment draft.")
  if (
    typeof draft.repository !== "string" ||
    !Number.isSafeInteger(draft.repositoryId) ||
    draft.repositoryId <= 0 ||
    typeof draft.baseSha !== "string" ||
    !/^[a-f0-9]{40,64}$/i.test(draft.baseSha) ||
    scopeKey(draft) !== scopeKey(scope)
  )
    throw new Error("Invalid inline comment draft.")
  const clean: InlineCommentInput = { ...canonical(draft), repository: scope.repository, body: draft.body }
  validateReviewDraft({ ...clean, event: "COMMENT", body: "", comments: [{ ...clean.anchor, id: "inline", body: clean.body }] }, true)
  return clean
}

function parseFile(value: unknown, scope: InlineDraftScope): InlineCommentInput[] {
  const file = value as { version?: unknown; accountId?: unknown; repository?: unknown; number?: unknown; drafts?: unknown } | null
  if (
    !file ||
    typeof file !== "object" ||
    Array.isArray(file) ||
    file.version !== VERSION ||
    typeof file.repository !== "string" ||
    scopeKey({ accountId: file.accountId as number, repository: file.repository, number: file.number as number }) !== scopeKey(scope) ||
    !Array.isArray(file.drafts) ||
    file.drafts.length > MAX_DRAFTS
  )
    throw new Error("Unrecognized inline comment draft file.")
  const drafts = file.drafts.map((draft) => parseInlineDraft(draft, scope))
  if (new Set(drafts.map(inlineDraftKey)).size !== drafts.length) throw new Error("Duplicate inline comment drafts.")
  return drafts
}

// Serializes writes per path, across storage instances.
const diskQueues = new Map<string, Promise<unknown>>()
export function createInlineDraftStorage(directory = join(configDirectory(), "inline-drafts")): InlineDraftStorage {
  cleanupDraftTemporaryFiles(directory)
  const pathFor = (scope: InlineDraftScope) => join(directory, `${createHash("sha256").update(scopeKey(scope)).digest("hex")}.json`)
  function serialized<T>(scope: InlineDraftScope, operation: () => Promise<T>): Promise<T> {
    const path = pathFor(scope)
    const next = (diskQueues.get(path) ?? Promise.resolve()).catch(() => {}).then(operation)
    diskQueues.set(path, next)
    void next
      .finally(() => {
        if (diskQueues.get(path) === next) diskQueues.delete(path)
      })
      .catch(() => {})
    return next
  }
  async function read(scope: InlineDraftScope) {
    try {
      return parseFile(await readPrivateJson(pathFor(scope), { maxBytes: MAX_FILE_BYTES }), scope)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw new Error(`Cannot read saved inline comment drafts; the file will not be overwritten: ${message(error)}`)
    }
  }
  async function syncDirectory() {
    const handle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0))
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
  async function publish(path: string, text: string) {
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      const file = await open(temp, "wx", 0o600)
      try {
        await file.writeFile(text)
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temp, path)
      await syncDirectory()
    } finally {
      await unlink(temp).catch(() => {})
    }
  }
  return {
    load: (scope) => serialized(scope, async () => (await read(scope)) ?? []),
    save: (scope, drafts) =>
      serialized(scope, async () => {
        const clean = drafts.map((draft) => parseInlineDraft(draft, scope))
        if (clean.length > MAX_DRAFTS) throw new Error(`At most ${MAX_DRAFTS} inline comment drafts can be saved per pull request.`)
        if (new Set(clean.map(inlineDraftKey)).size !== clean.length) throw new Error("Duplicate inline comment drafts.")
        const existing = await read(scope) // Never overwrite or delete an unreadable file.
        if (!clean.length) {
          if (existing) {
            await unlink(pathFor(scope)).catch((error) => {
              if (error.code !== "ENOENT") throw error
            })
            await syncDirectory()
          }
          return
        }
        const text = JSON.stringify({
          version: VERSION,
          accountId: scope.accountId,
          repository: scope.repository,
          number: scope.number,
          drafts: clean,
        })
        if (text.length > MAX_FILE_BYTES) throw new Error("Inline comment drafts are too large to save.")
        await ensureTrustedDirectory(directory, true)
        await publish(pathFor(scope), text)
      }),
  }
}

export type InlineDrafts = {
  drafts(): ReadonlyMap<string, InlineCommentInput>
  get(context: InlineDraftContext): InlineCommentInput | undefined
  set(context: InlineDraftContext, body: string): void
  remove(context: InlineDraftContext): void
  posting(): readonly InlineCommentInput[]
  // Posting state is memory-only; success removes only the submitted draft revision.
  trackPost<T>(context: InlineDraftContext, send: () => Promise<T>): Promise<T>
  // In-memory edits and removals win over stored drafts.
  load(scope: InlineDraftScope): Promise<void>
  // Rejects if any change remains unsaved.
  flush(): Promise<void>
  // The latest unresolved load or save failure.
  error(): string | undefined
}

// `storage: false` keeps drafts in memory only.
export function createInlineDrafts(options: { storage?: InlineDraftStorage | false; delay?: number } = {}): InlineDrafts {
  const storage = options.storage === undefined ? createInlineDraftStorage() : options.storage
  const delay = options.delay ?? 200
  const [drafts, setDrafts] = createSignal<ReadonlyMap<string, InlineCommentInput>>(new Map())
  const [posting, setPosting] = createSignal<readonly InlineCommentInput[]>([])
  const [error, setError] = createSignal<string>()
  // Never replaced by a later load.
  const touched = new Set<string>()
  const loads = new Map<string, Promise<void>>()
  const pending = new Map<string, InlineDraftScope>()
  const failed = new Map<string, InlineDraftScope>()
  const loadErrors = new Map<string, string>()
  const saveErrors = new Map<string, unknown>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<void> = Promise.resolve()
  let draining = false
  const refreshError = () => {
    const saving = [...saveErrors.values()].at(-1)
    const loading = [...loadErrors.values()].at(-1)
    setError(
      saving !== undefined
        ? `Inline comment draft was not saved; it is kept in memory: ${message(saving)}`
        : loading !== undefined
          ? loading
          : undefined,
    )
  }
  function ensureLoaded(scope: InlineDraftScope): Promise<void> {
    if (!storage) return Promise.resolve()
    const key = scopeKey(scope)
    const existing = loads.get(key)
    if (existing) return existing
    const promise = storage.load(scope).then(
      (stored) => {
        loadErrors.delete(key)
        refreshError()
        const additions = stored.filter((draft) => !touched.has(inlineDraftKey(draft)))
        if (!additions.length) return
        setDrafts((current) => {
          const next = new Map(current)
          for (const draft of additions) {
            const id = inlineDraftKey(draft)
            if (!next.has(id)) next.set(id, draft)
          }
          return next
        })
      },
      (error) => {
        // Retried later; saves wait for it, so unread drafts are never dropped.
        loads.delete(key)
        loadErrors.set(key, message(error))
        refreshError()
        throw error
      },
    )
    loads.set(key, promise)
    return promise
  }
  function drain(): Promise<void> {
    clearTimeout(timer)
    timer = undefined
    if (!storage || draining || !pending.size) return queue
    draining = true
    queue = (async () => {
      while (pending.size) {
        const [key, scope] = pending.entries().next().value!
        pending.delete(key)
        try {
          await ensureLoaded(scope)
          const snapshot = [...drafts().values()].filter((draft) => scopeKey(draft) === key && draft.body.trim())
          await storage.save(scope, snapshot)
          saveErrors.delete(key)
          failed.delete(key)
        } catch (error) {
          saveErrors.set(key, error)
          failed.set(key, scope)
        }
        refreshError()
      }
    })().finally(() => {
      draining = false
    })
    return queue
  }
  function schedule(context: InlineDraftContext) {
    if (!storage) return
    pending.set(scopeKey(context), { accountId: context.accountId, repository: context.repository, number: context.number })
    clearTimeout(timer)
    timer = setTimeout(() => {
      void drain()
    }, delay)
    timer.unref?.()
  }
  function remove(context: InlineDraftContext) {
    const id = inlineDraftKey(context)
    touched.add(id)
    if (!drafts().has(id)) return
    setDrafts((current) => {
      const next = new Map(current)
      next.delete(id)
      return next
    })
    schedule(context)
  }
  return {
    drafts,
    error,
    posting,
    async trackPost(context, send) {
      const id = inlineDraftKey(context)
      const draft = drafts().get(id)
      if (!draft) throw new Error("Inline comment draft is unavailable.")
      if (posting().some((pending) => scopeKey(pending) === scopeKey(context)))
        throw new Error("An inline comment is already being posted to this pull request.")
      setPosting((current) => [...current, draft])
      try {
        const result = await send()
        if (drafts().get(id) === draft) remove(context)
        return result
      } finally {
        setPosting((current) => current.filter((pending) => pending !== draft))
      }
    },
    get: (context) => drafts().get(inlineDraftKey(context)),
    set(context, body) {
      const id = inlineDraftKey(context)
      touched.add(id)
      if (drafts().get(id)?.body === body) return
      setDrafts((current) => new Map(current).set(id, { ...canonical(context), body }))
      schedule(context)
    },
    remove,
    load: (scope) => ensureLoaded(scope).catch(() => {}),
    async flush() {
      for (const [key, scope] of failed) if (!pending.has(key)) pending.set(key, scope)
      let current: Promise<void>
      do {
        current = drain()
        await current
      } while (pending.size || current !== queue)
      const failure = [...saveErrors.values()].at(-1)
      if (failure !== undefined) throw failure
    },
  }
}
