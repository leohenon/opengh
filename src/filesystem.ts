import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { constants, readFileSync, type Stats } from "node:fs"
import { userInfo } from "node:os"
import { lstat, mkdir, open, readlink, rename, rm } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, parse, sep } from "node:path"

export async function fileEntry(path: string) {
  return lstat(path).catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
}

function owned(uid: number) {
  return process.getuid === undefined || uid === process.getuid()
}

function directoryParts(path: string) {
  return process.platform === "win32" ? path.split(/[\\/]/) : path.split("/")
}

type DatabaseEntry = string[]
const parseDatabase = (text: string): DatabaseEntry[] =>
  text
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(":"))

// Like OpenSSH, accept a user private group (the umask 002 default on Fedora and RHEL):
// the owner's primary group, with no other member.
export function isPrivateGroup(
  gid: number,
  user: { uid: number; gid: number; username: string },
  groups: DatabaseEntry[],
  users: DatabaseEntry[],
) {
  if (gid !== user.gid) return false
  const group = groups.find((entry) => entry.length >= 3 && Number(entry[2]) === gid)
  if (!group) return false
  if ((group[3] ?? "").split(",").some((member) => member.trim() && member.trim() !== user.username)) return false
  return !users.some((entry) => entry.length >= 4 && Number(entry[3]) === gid && Number(entry[2]) !== user.uid)
}

function lookupDatabase(database: "group" | "passwd", key?: string): DatabaseEntry[] {
  // getent covers NSS sources such as LDAP; local files are the fallback.
  const result = spawnSync("getent", key === undefined ? [database] : [database, key], { encoding: "utf8", timeout: 2000 })
  if (!result.error && result.status === 0) return parseDatabase(result.stdout)
  if (!result.error && result.status === 2) return []
  try {
    return parseDatabase(readFileSync(`/etc/${database}`, "utf8"))
  } catch {
    return []
  }
}

const privateGroups = new Map<number, boolean>()
function privateGroup(gid: number) {
  if (process.getgid === undefined || gid !== process.getgid()) return false
  let result = privateGroups.get(gid)
  if (result === undefined) {
    try {
      const { uid, username } = userInfo()
      result = isPrivateGroup(gid, { uid, gid, username }, lookupDatabase("group", String(gid)), lookupDatabase("passwd"))
    } catch {
      result = false
    }
    privateGroups.set(gid, result)
  }
  return result
}

function checkDirectory(path: string, entry: Stats, destination: boolean) {
  if (!entry.isDirectory()) throw new Error(`Untrusted writable directory: ${path}`)
  // Windows uses ACLs, not meaningful POSIX uid/group-writable mode bits.
  if (process.getuid === undefined) return
  if (!owned(entry.uid) && !(entry.uid === 0 && !destination)) throw new Error(`Untrusted writable directory: ${path}`)
  if ((entry.mode & 0o022) === 0 || (!destination && entry.uid === 0 && (entry.mode & 0o1000) !== 0)) return
  if ((entry.mode & 0o002) === 0 && owned(entry.uid) && privateGroup(entry.gid)) return
  throw new Error(
    `Untrusted writable directory: ${path}. Other users can write to it; run \`chmod go-w ${JSON.stringify(path)}\` to restrict it.`,
  )
}

async function syncDirectory(path: string) {
  const directory = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0))
  try {
    checkDirectory(path, await directory.stat(), false)
    await directory.sync()
  } finally {
    await directory.close()
  }
}

// Resolve component by component so every intermediate symlink's parent is
// checked. realpath alone hides unsafe hops through attacker-writable locations.
async function trustedDirectory(path: string, create = true, durable = false): Promise<string> {
  const absolute = isAbsolute(path) ? path : `${process.cwd()}${sep}${path}`
  let current = parse(absolute).root
  let pending = directoryParts(absolute.slice(current.length))
  let hops = 0
  while (pending.length) {
    checkDirectory(current, await lstat(current), false)
    const part = pending.shift()!
    if (!part || part === ".") continue
    if (part === "..") {
      current = dirname(current)
      continue
    }
    const next = join(current, part)
    let entry = await fileEntry(next)
    if (!entry) {
      if (!create) throw Object.assign(new Error(`Directory does not exist: ${next}`), { code: "ENOENT" })
      await mkdir(next, { mode: 0o700 }).catch((error) => {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
      })
      entry = await lstat(next)
    }
    if (entry.isSymbolicLink()) {
      if ((!owned(entry.uid) && entry.uid !== 0) || ++hops > 40) throw new Error(`Untrusted directory symlink: ${next}`)
      if (durable) await syncDirectory(current)
      const target = await readlink(next)
      if (isAbsolute(target)) {
        current = parse(target).root
        pending = [...directoryParts(target.slice(current.length)), ...pending]
      } else pending = [...directoryParts(target), ...pending]
      continue
    }
    checkDirectory(next, entry, false)
    // Existing entries may come from an earlier attempt whose parent sync failed.
    if (durable) await syncDirectory(current)
    current = next
  }
  checkDirectory(current, await lstat(current), true)
  return current
}

export async function ensureTrustedDirectory(path: string, durable = false) {
  await trustedDirectory(path, true, durable)
}

export async function regularOwnedFile(path: string) {
  const entry = await fileEntry(path)
  if (entry && (!entry.isFile() || !owned(entry.uid))) throw new Error(`Expected an owner-controlled regular file: ${path}`)
  return entry
}

export async function trustedConfigDestination(path: string, createParents = true): Promise<string> {
  let destination = path
  let followed = false
  for (let hops = 0; hops <= 40; hops++) {
    const parent = await trustedDirectory(dirname(destination), createParents && !followed)
    destination = join(parent, basename(destination))
    const entry = await fileEntry(destination)
    if (!entry) {
      if (followed) {
        const error = new Error("Config symlink target does not exist")
        throw createParents ? error : Object.assign(error, { code: "ENOENT" })
      }
      return destination
    }
    if (!entry.isSymbolicLink()) {
      await regularOwnedFile(destination)
      return destination
    }
    if (!owned(entry.uid)) throw new Error("Config symlinks must be owner-controlled")
    const target = await readlink(destination)
    destination = isAbsolute(target) ? target : `${parent}${sep}${target}`
    followed = true
  }
  throw new Error("Too many config symlinks")
}

export async function trustedReadDirectory(path: string) {
  return trustedDirectory(path, false)
}

export async function readPrivateJson(path: string, options: { maxBytes: number; configSymlinks?: boolean }): Promise<unknown> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) throw new Error("JSON byte limit must be positive")
  const destination = options.configSymlinks
    ? await trustedConfigDestination(path, false)
    : join(await trustedDirectory(dirname(path), false), basename(path))
  await regularOwnedFile(destination)
  // NOFOLLOW closes the checked-leaf race; NONBLOCK prevents a swapped FIFO
  // from blocking open before the descriptor's type can be checked.
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  const file = await open(destination, flags)
  let text: string
  try {
    const entry = await file.stat()
    if (!entry.isFile() || !owned(entry.uid)) throw new Error(`Expected an owner-controlled regular file: ${path}`)
    if (entry.size > options.maxBytes) throw new Error(`JSON file exceeds the ${options.maxBytes} byte limit: ${path}`)
    const chunks: Buffer[] = []
    const buffer = Buffer.allocUnsafe(Math.min(options.maxBytes + 1, 64 * 1024))
    let size = 0
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, options.maxBytes - size + 1), null)
      if (!bytesRead) break
      size += bytesRead
      if (size > options.maxBytes) throw new Error(`JSON file exceeds the ${options.maxBytes} byte limit: ${path}`)
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
    }
    text = Buffer.concat(chunks, size).toString("utf8")
  } finally {
    await file.close()
  }
  // Match the previous JSON reader for editor-produced UTF-8 BOM files.
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (error) {
    // Parser diagnostics may echo file contents. Keep failures useful without
    // leaking a credential if a misconfigured link points at a sensitive file.
    if (error instanceof SyntaxError) throw new SyntaxError(`Invalid JSON file: ${path}`)
    throw error
  }
}

export async function atomicPrivateWrite(path: string, content: string, preserveMode = false) {
  const parent = await trustedDirectory(dirname(path))
  const destination = join(parent, basename(path))
  const existing = await regularOwnedFile(destination)
  const mode = preserveMode && existing ? existing.mode & 0o777 : 0o600
  const temporary = join(parent, `.${randomUUID()}.tmp`)
  const file = await open(temporary, "wx", 0o600)
  try {
    try {
      await file.writeFile(content)
      await file.chmod(mode)
    } finally {
      await file.close()
    }
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}
