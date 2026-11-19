import { rm } from "node:fs/promises"
import { join } from "node:path"
import { createSignal, type Accessor } from "solid-js"
import { atomicPrivateWrite, readPrivateJson } from "./filesystem"
import { configDirectory } from "./paths"

export type NewIssueDraft = { title: string; body: string }

export type NewIssueDraftStorage = {
  load(repositoryId: number): Promise<NewIssueDraft | undefined>
  save(repositoryId: number, draft: NewIssueDraft): Promise<void>
  remove(repositoryId: number): Promise<void>
}

export type NewIssueDrafts = {
  load(repositoryId: number): Promise<NewIssueDraft>
  set(repositoryId: number, draft: NewIssueDraft): void
  flush(): Promise<void>
  error: Accessor<string | undefined>
}

const empty: NewIssueDraft = { title: "", body: "" }
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createNewIssueDraftStorage(directory = join(configDirectory(), "new-issue-drafts")): NewIssueDraftStorage {
  const pathFor = (repositoryId: number) => {
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) throw new Error("Repository ID must be a positive safe integer.")
    return join(directory, `${repositoryId}.json`)
  }
  return {
    async load(repositoryId) {
      let value: unknown
      try {
        value = await readPrivateJson(pathFor(repositoryId), { maxBytes: 1024 * 1024 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return
        throw error
      }
      const draft = value as Partial<NewIssueDraft> | null
      if (!draft || typeof draft.title !== "string" || typeof draft.body !== "string") throw new Error("Invalid saved issue draft")
      return { title: draft.title, body: draft.body }
    },
    save: (repositoryId, draft) =>
      atomicPrivateWrite(pathFor(repositoryId), JSON.stringify({ title: draft.title, body: draft.body }) + "\n"),
    remove: (repositoryId) => rm(pathFor(repositoryId), { force: true }),
  }
}

export function createNewIssueDrafts(options: { storage?: NewIssueDraftStorage | false; delay?: number } = {}): NewIssueDrafts {
  const storage = options.storage === undefined ? createNewIssueDraftStorage() : options.storage
  const delay = options.delay ?? 200
  const drafts = new Map<number, NewIssueDraft>()
  const dirty = new Map<number, NewIssueDraft>()
  const [error, setError] = createSignal<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<void> = Promise.resolve()

  const write = async () => {
    if (!storage) return
    for (const [repositoryId, draft] of [...dirty]) {
      if (draft.title || draft.body) await storage.save(repositoryId, draft)
      else await storage.remove(repositoryId)
      if (dirty.get(repositoryId) === draft) dirty.delete(repositoryId)
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
          setError(`Issue draft was not saved; it is kept in memory: ${message(cause)}`)
          throw cause
        },
      )
    return queue
  }

  return {
    async load(repositoryId) {
      const existing = drafts.get(repositoryId)
      if (existing || !storage) return existing ?? empty
      let draft = empty
      try {
        draft = (await storage.load(repositoryId)) ?? empty
      } catch (cause) {
        setError(`Issue draft could not be loaded: ${message(cause)}`)
      }
      return drafts.get(repositoryId) ?? (drafts.set(repositoryId, draft), draft)
    },
    set(repositoryId, draft) {
      const next = { title: draft.title, body: draft.body }
      drafts.set(repositoryId, next)
      if (!storage) return
      dirty.set(repositoryId, next)
      clearTimeout(timer)
      timer = setTimeout(() => void flush().catch(() => {}), delay)
      timer.unref?.()
    },
    flush,
    error,
  }
}
