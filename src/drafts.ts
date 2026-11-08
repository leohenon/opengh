import { createHash, randomUUID } from "node:crypto"
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { IssueCloseReason } from "./models"
import { configDirectory } from "./paths"
import { cleanupDraftTemporaryFiles } from "./draft-cleanup"
import { withFileLock, withFileLockSync } from "./file-lock"
import { ensureTrustedDirectory } from "./filesystem"

export type DraftKind = "comment" | "close" | "reopen"
export type IssueDraft = { generation: string; body: string; reason: IssueCloseReason; retry?: "close" | "reopen" }
type StoredDraft = Omit<IssueDraft, "generation"> & { generation?: string }

export class DraftConflictError extends Error {
  constructor() {
    super("Saved draft changed in another session. Reload the draft before editing or submitting it.")
    this.name = "DraftConflictError"
  }
}

// Keys include the normalized repository, subject type, number, and action kind.
// Stores throw on failure; the session retains dirty snapshots until a write succeeds.
export type DraftStore = {
  load(key: string): IssueDraft | undefined
  save(key: string, next: IssueDraft, expectedGeneration: string | undefined): void
  withCurrent(key: string, generation: string, body: string, publish: () => Promise<void>): Promise<void>
}

function parseDraft(value: unknown): StoredDraft {
  const draft = value as StoredDraft | null
  if (!draft || Array.isArray(draft) || typeof draft.body !== "string"
    || !["completed", "not_planned"].includes(draft.reason)
    || (draft.retry !== undefined && draft.retry !== "close" && draft.retry !== "reopen")
    || (draft.generation !== undefined && (typeof draft.generation !== "string" || !draft.generation.trim())))
    throw new Error("Invalid saved draft")
  return { ...(draft.generation === undefined ? {} : { generation: draft.generation }),
    body: draft.body, reason: draft.reason, ...(draft.retry ? { retry: draft.retry } : {}) }
}

function openDraft(path: string) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || (process.getuid !== undefined && (stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0)))
      throw new Error(`Expected an owner-controlled regular draft: ${path}`)
    return fd
  } catch (error) { closeSync(fd); throw error }
}

export function createDiskDraftStore(directory = join(configDirectory(), "drafts")): DraftStore {
  cleanupDraftTemporaryFiles(directory)
  const pathFor = (key: string) => join(directory, `${createHash("sha256").update(key).digest("hex")}.json`)
  const ensureDirectory = () => {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const entry = lstatSync(directory)
    if (!entry.isDirectory() || (process.getuid !== undefined && (entry.uid !== process.getuid() || (entry.mode & 0o022) !== 0)))
      throw new Error(`Untrusted draft directory: ${directory}`)
  }
  const syncDirectory = () => {
    const fd = openSync(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0))
    try { fsyncSync(fd) } finally { closeSync(fd) }
  }
  const syncPublished = (path: string) => {
    const fd = openDraft(path)
    try { fsyncSync(fd) } finally { closeSync(fd) }
    syncDirectory()
  }
  const read = (path: string): StoredDraft | undefined => {
    let fd: number
    try { fd = openDraft(path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
    try { return parseDraft(JSON.parse(readFileSync(fd, "utf8"))) }
    catch (cause) { throw new Error(`Cannot read saved draft at ${path}`, { cause }) }
    finally { closeSync(fd) }
  }
  const write = (destination: string, draft: IssueDraft) => {
    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      const fd = openSync(temporary, "wx", 0o600)
      try {
        writeFileSync(fd, JSON.stringify(draft) + "\n")
        fsyncSync(fd)
      } finally { closeSync(fd) }
      renameSync(temporary, destination)
      syncDirectory()
    } finally {
      try { unlinkSync(temporary) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
    }
  }
  // Called only under the slot lock. A legacy record becomes one shared identity,
  // not a different identity for each session that happens to restore it.
  const current = (path: string): IssueDraft | undefined => {
    const draft = read(path)
    if (!draft) return
    if (draft.generation !== undefined) return draft as IssueDraft
    const migrated = { ...draft, generation: randomUUID() }
    write(path, migrated)
    return migrated
  }
  return {
    load(key) {
      const path = pathFor(key), draft = read(path)
      if (!draft) return
      if (draft.generation !== undefined) return draft as IssueDraft
      ensureDirectory()
      return withFileLockSync(path, () => {
        const migrated = current(path)
        // Also repair a competing migration that renamed successfully but failed
        // its durability sync before we acquired the lock.
        if (migrated) syncPublished(path)
        return migrated
      })
    },
    save(key, next, expectedGeneration) {
      const draft = parseDraft(next)
      if (draft.generation === undefined) throw new Error("A saved draft must have a generation")
      ensureDirectory()
      const path = pathFor(key)
      withFileLockSync(path, () => {
        const previous = current(path)
        const identical = previous !== undefined && previous.generation === draft.generation && previous.body === draft.body
          && previous.reason === draft.reason && previous.retry === draft.retry
        if (identical) {
          // A prior rename may have succeeded even though directory fsync failed.
          syncPublished(path)
          return
        }
        if (previous?.generation !== expectedGeneration || previous?.generation === draft.generation)
          throw new DraftConflictError()
        // Empty drafts are versioned tombstones, never deleted: cached generations
        // must remain retired after receipts and their associated comments settle.
        write(path, draft as IssueDraft)
      })
    },
    async withCurrent(key, generation, body, publish) {
      await ensureTrustedDirectory(directory, true)
      const path = pathFor(key)
      await withFileLock(path, async () => {
        const draft = read(path)
        if (!draft || draft.generation !== generation || draft.body !== body) throw new DraftConflictError()
        syncPublished(path)
        // publish includes the marker's fsync, and must never perform a request.
        await publish()
      })
    },
  }
}
