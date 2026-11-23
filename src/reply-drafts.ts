import { join } from "node:path"
import { createSignal, type Accessor } from "solid-js"
import { createComposeDrafts, createComposeDraftStorage, type ComposeDraftStorage } from "./compose-drafts"
import { configDirectory } from "./paths"

export type ReplyDraftKey = { repositoryId: number; number: number; threadId: string }
export const replyDraftId = (key: ReplyDraftKey) => `${key.repositoryId}:${key.number}:${key.threadId}`

export type ReplyDrafts = {
  body(key: ReplyDraftKey): string
  drafted: Accessor<ReadonlySet<string>>
  posting: Accessor<ReadonlySet<string>>
  set(key: ReplyDraftKey, body: string): void
  load(keys: readonly ReplyDraftKey[]): Promise<void>
  post<T>(key: ReplyDraftKey, send: () => Promise<T>): Promise<T>
  flush(): Promise<void>
}

export function createReplyDrafts(options: { storage?: ComposeDraftStorage | false; delay?: number } = {}): ReplyDrafts {
  const saved = createComposeDrafts({
    storage: options.storage ?? createComposeDraftStorage(join(configDirectory(), "review-reply-drafts")),
    delay: options.delay,
  })
  const bodies = new Map<string, string>()
  const [drafted, setDrafted] = createSignal<ReadonlySet<string>>(new Set())
  const [posting, setPosting] = createSignal<ReadonlySet<string>>(new Set())
  const without = (ids: ReadonlySet<string>, id: string) => new Set([...ids].filter((item) => item !== id))
  const remember = (id: string, body: string) => {
    if (body.trim()) bodies.set(id, body)
    else bodies.delete(id)
    if (drafted().has(id) !== bodies.has(id)) setDrafted((ids) => (bodies.has(id) ? new Set(ids).add(id) : without(ids, id)))
  }
  const stored = (key: ReplyDraftKey) => ({ repositoryId: key.repositoryId, head: `${key.number}:${key.threadId}` })
  const set = (key: ReplyDraftKey, body: string) => {
    remember(replyDraftId(key), body)
    saved.set(stored(key), { title: "", body: body.trim() ? body : "" })
  }
  return {
    body: (key) => bodies.get(replyDraftId(key)) ?? "",
    drafted,
    posting,
    set,
    async load(keys) {
      await Promise.all(keys.map(async (key) => remember(replyDraftId(key), (await saved.load(stored(key))).body)))
    },
    async post(key, send) {
      const id = replyDraftId(key)
      setPosting((ids) => new Set(ids).add(id))
      try {
        const result = await send()
        set(key, "")
        return result
      } finally {
        setPosting((ids) => without(ids, id))
      }
    },
    flush: saved.flush,
  }
}
