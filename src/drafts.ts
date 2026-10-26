import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { IssueCloseReason } from "./models"
import { configDirectory } from "./paths"

export type DraftKind = "comment" | "close" | "reopen"
export type IssueDraft = { body: string; reason: IssueCloseReason; retry?: "close" | "reopen" }

// Keys include the normalized repository, subject type, number, and action kind.
// Stores throw on failure; the session retains dirty snapshots until a write succeeds.
export type DraftStore = {
  load(key: string): IssueDraft | undefined
  save(key: string, draft: IssueDraft): void
}

export function createDiskDraftStore(directory = join(configDirectory(), "drafts")): DraftStore {
  const pathFor = (key: string) => join(directory, `${createHash("sha256").update(key).digest("hex")}.json`)
  return {
    load(key) {
      let text: string
      try { text = readFileSync(pathFor(key), "utf8") } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return
        throw error
      }
      try {
        const value = JSON.parse(text)
        if (!value || typeof value.body !== "string"
          || !["completed", "not_planned"].includes(value.reason)
          || (value.retry !== undefined && value.retry !== "close" && value.retry !== "reopen"))
          throw new Error("Invalid saved draft")
        return { body: value.body, reason: value.reason, ...(value.retry ? { retry: value.retry } : {}) }
      } catch (cause) {
        throw new Error(`Cannot read saved draft at ${pathFor(key)}`, { cause })
      }
    },
    save(key, draft) {
      const destination = pathFor(key)
      if (!draft.body && !draft.retry && draft.reason === "completed") {
        rmSync(destination, { force: true })
        return
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const temporary = `${destination}.${randomUUID()}.tmp`
      try {
        writeFileSync(temporary, JSON.stringify(draft) + "\n", { flag: "wx", mode: 0o600 })
        renameSync(temporary, destination)
      } finally {
        rmSync(temporary, { force: true })
      }
    },
  }
}
