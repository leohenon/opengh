import { randomUUID } from "node:crypto"
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"

const code = (error: unknown) => (error as NodeJS.ErrnoException).code
const locked = () => new Error("Local storage is locked by a live or unverifiable owner. Retry after the other opengh process exits; do not delete its lock.")

// Never recursively remove the published directory: a delayed release/recovery
// may encounter a new owner. Its unique file is untouched and rmdir fails safely.
function release(path: string, ownerFile: string) {
  try { unlinkSync(join(path, ownerFile)) } catch {}
  try { rmdirSync(path) } catch {}
}

function recover(path: string) {
  let entry
  try { entry = lstatSync(path) }
  catch (error) { if (code(error) === "ENOENT") return; throw error }
  if (!entry.isDirectory() || (process.getuid !== undefined && (entry.uid !== process.getuid() || (entry.mode & 0o077) !== 0)))
    throw locked()
  let names: string[]
  try { names = readdirSync(path) }
  catch (error) { if (code(error) === "ENOENT") return; throw error }
  // An empty directory (a crash during release) can be replaced by rename.
  if (!names.length) return
  const name = names[0]!
  if (names.length !== 1 || !/^[a-f0-9-]{36}\.owner\.json$/.test(name)) throw locked()
  let value: unknown
  try {
    const fd = openSync(join(path, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > 4096 || (process.getuid !== undefined && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)))
        throw locked()
      const buffer = Buffer.alloc(4097)
      let size = 0
      while (size < buffer.length) {
        const count = readSync(fd, buffer, size, buffer.length - size, null)
        if (!count) break
        size += count
      }
      if (size > 4096) throw locked()
      value = JSON.parse(buffer.subarray(0, size).toString("utf8"))
    } finally { closeSync(fd) }
  } catch (error) { if (code(error) === "ENOENT") return; throw locked() }
  const owner = value as { pid?: number; hostname?: string; nonce?: string } | null
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid! <= 0 || owner.hostname !== hostname()
    || typeof owner.nonce !== "string" || `${owner.nonce}.owner.json` !== name) throw locked()
  try { process.kill(owner.pid!, 0) }
  catch (error) {
    if (code(error) === "ESRCH") { release(path, name); return }
    throw locked()
  }
  // Age is not evidence of death; a live/reused PID or unknown host stays locked.
  throw locked()
}

function acquire(path: string): () => void {
  const lock = `${path}.lock`, nonce = randomUUID(), ownerFile = `${nonce}.owner.json`
  const temporary = `${lock}.${nonce}.tmp`
  mkdirSync(temporary, { mode: 0o700 })
  let published = false
  try {
    const owner = openSync(join(temporary, ownerFile), "wx", 0o600)
    try { writeFileSync(owner, JSON.stringify({ pid: process.pid, hostname: hostname(), nonce })); fsyncSync(owner) }
    finally { closeSync(owner) }
    for (let tries = 0; tries < 3; tries++) {
      try { renameSync(temporary, lock); published = true; break }
      catch (error) {
        if (code(error) !== "EEXIST" && code(error) !== "ENOTEMPTY") throw error
        recover(lock)
      }
    }
    if (!published) throw locked()
    return () => release(lock, ownerFile)
  } catch (error) {
    release(published ? lock : temporary, ownerFile)
    throw error
  }
}

// The caller checks/creates the trusted parent. Contention fails immediately;
// synchronous writers must never wait for an async owner on the same event loop.
export function withFileLockSync<T>(path: string, run: () => T): T {
  const release = acquire(path)
  try { return run() } finally { release() }
}

// Only local filesystem work belongs in run, never network requests.
export async function withFileLock<T>(path: string, run: () => Promise<T>): Promise<T> {
  const release = acquire(path)
  try { return await run() } finally { release() }
}
