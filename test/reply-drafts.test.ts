import { expect, test } from "bun:test"
import type { ComposeDraft } from "../src/compose-drafts"
import { createReplyDrafts, replyDraftId } from "../src/reply-drafts"

const key = { repositoryId: 7, number: 42, threadId: "thread" }
const id = replyDraftId(key)

function setup(initial: [string, ComposeDraft][] = []) {
  const stored = new Map(initial)
  const create = () =>
    createReplyDrafts({
      delay: 0,
      storage: {
        load: async (draft) => stored.get(draft.head!),
        save: async (draft, value) => void stored.set(draft.head!, value),
        remove: async (draft) => void stored.delete(draft.head!),
      },
    })
  return { stored, create }
}

test("a reply being posted, and its draft, are known to whoever reads the store, until the post settles", async () => {
  const { stored, create } = setup()
  const drafts = create()
  drafts.set(key, "On its way")
  let land!: () => void
  const posted = drafts.post(key, () => new Promise<void>((resolve) => (land = resolve)))
  expect([drafts.posting().has(id), drafts.drafted().has(id), drafts.body(key)]).toEqual([true, true, "On its way"])
  land()
  await posted
  expect([drafts.posting().has(id), drafts.drafted().has(id), drafts.body(key)]).toEqual([false, false, ""])
  await drafts.flush()
  expect(stored.size).toBe(0)

  drafts.set(key, "Not this time")
  await expect(drafts.post(key, () => Promise.reject(new Error("Offline")))).rejects.toThrow("Offline")
  expect([drafts.posting().has(id), drafts.drafted().has(id), drafts.body(key)]).toEqual([false, true, "Not this time"])
  await drafts.flush()
  expect(stored.get("42:thread")?.body).toBe("Not this time")
})

test("stored drafts load without overwriting newer text, and blank text is not a draft", async () => {
  const { stored, create } = setup([["42:thread", { title: "", body: "From last time" }]])
  const drafts = create()
  await drafts.load([key, { ...key, threadId: "other" }])
  expect([drafts.body(key), [...drafts.drafted()]]).toEqual(["From last time", [id]])
  drafts.set(key, "Typed since")
  await drafts.load([key])
  expect(drafts.body(key)).toBe("Typed since")
  drafts.set(key, "\n  ")
  expect([drafts.body(key), drafts.drafted().size]).toEqual(["", 0])
  await drafts.flush()
  expect(stored.size).toBe(0)
})
