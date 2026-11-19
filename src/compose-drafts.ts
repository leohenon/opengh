import { createHash } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { createSignal, type Accessor } from "solid-js"
import { atomicPrivateWrite, readPrivateJson } from "./filesystem"
import { configDirectory } from "./paths"

export type ComposeDraft = { title: string; body: string }
export type ComposeDraftKey = { repositoryId: number; head?: string }

export type ComposeDraftStorage = {
  load(key: ComposeDraftKey): Promise<ComposeDraft | undefined>
  save(key: ComposeDraftKey, draft: ComposeDraft): Promise<void>
  remove(key: ComposeDraftKey): Promise<void>
}

export type ComposeDrafts = {
  load(key: ComposeDraftKey): Promise<ComposeDraft>
  set(key: ComposeDraftKey, draft: ComposeDraft): void
  flush(): Promise<void>
  error: Accessor<string | undefined>
}

const empty: ComposeDraft = { title: "", body: "" }
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const memoryKey = (key: ComposeDraftKey) => `${key.repositoryId}:${key.head ?? ""}`

export function createComposeDraftStorage(directory = join(configDirectory(), "new-issue-drafts")): ComposeDraftStorage {
  const pathFor = ({ repositoryId, head }: ComposeDraftKey) => {
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) throw new Error("Repository ID must be a positive safe integer.")
    if (head === undefined) return join(directory, `${repositoryId}.json`)
    if (!head) throw new Error("Branch name must not be blank.")
    return join(directory, `${repositoryId}-${createHash("sha256").update(head).digest("hex")}.json`)
  }
  return {
    async load(key) {
      let value: unknown
      try {
        value = await readPrivateJson(pathFor(key), { maxBytes: 1024 * 1024 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return
        throw error
      }
      const draft = value as Partial<ComposeDraft> | null
      if (!draft || typeof draft.title !== "string" || typeof draft.body !== "string") throw new Error("Invalid saved draft")
      return { title: draft.title, body: draft.body }
    },
    save: (key, draft) => atomicPrivateWrite(pathFor(key), JSON.stringify({ title: draft.title, body: draft.body }) + "\n"),
    remove: (key) => rm(pathFor(key), { force: true }),
  }
}

export function createComposeDrafts(options: { storage?: ComposeDraftStorage | false; delay?: number } = {}): ComposeDrafts {
  const storage = options.storage === undefined ? createComposeDraftStorage() : options.storage
  const delay = options.delay ?? 200
  const drafts = new Map<string, ComposeDraft>()
  const dirty = new Map<string, { key: ComposeDraftKey; draft: ComposeDraft }>()
  const [error, setError] = createSignal<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<void> = Promise.resolve()

  const write = async () => {
    if (!storage) return
    for (const [id, entry] of [...dirty]) {
      if (entry.draft.title || entry.draft.body) await storage.save(entry.key, entry.draft)
      else await storage.remove(entry.key)
      if (dirty.get(id) === entry) dirty.delete(id)
    }
  }
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    queue = queue
      .catch(() => {})
      .then(write)
      .then(
        () => setError(undefined),
        (cause) => {
          setError(`Draft was not saved; it is kept in memory: ${message(cause)}`)
          throw cause
        },
      )
    return queue
  }

  return {
    async load(key) {
      const id = memoryKey(key)
      const existing = drafts.get(id)
      if (existing || !storage) return existing ?? empty
      let draft = empty
      try {
        draft = (await storage.load(key)) ?? empty
      } catch (cause) {
        setError(`Draft could not be loaded: ${message(cause)}`)
      }
      return drafts.get(id) ?? (drafts.set(id, draft), draft)
    },
    set(key, draft) {
      const id = memoryKey(key)
      const next = { title: draft.title, body: draft.body }
      drafts.set(id, next)
      if (!storage) return
      dirty.set(id, { key: { ...key }, draft: next })
      clearTimeout(timer)
      timer = setTimeout(() => void flush().catch(() => {}), delay)
      timer.unref?.()
    },
    flush,
    error,
  }
}
