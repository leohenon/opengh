import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIssueCommentStorage, type IssueCommentAttempt } from "../src/github/issue-comments"

const attempt: IssueCommentAttempt = {
  input: { accountId: 7, repositoryId: 71, number: 42, body: "Exact stored comment" },
  commentIds: [1], nonce: "attempt-a",
}
const directories: string[] = []
const children: Bun.Subprocess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) { child.kill("SIGKILL"); await child.exited }
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "opengh-comment-storage-"))
  directories.push(directory)
  const storage = createIssueCommentStorage(directory)
  await storage.save(attempt)
  const path = join(directory, (await readdir(directory)).find(name => name.endsWith(".json"))!)
  return { directory, storage, path }
}

// Pause a real second process after remove has read A, before its unlink. This
// is the exact stale-read window that an in-process promise queue cannot guard.
async function pausedRemoval(directory: string, path: string) {
  const filesystem = new URL("../src/filesystem.ts", import.meta.url).pathname
  const comments = new URL("../src/github/issue-comments.ts", import.meta.url).pathname
  const script = `
    import { mock } from "bun:test"
    const filesystem = await import(${JSON.stringify(filesystem)})
    const originals = { ...filesystem }
    mock.module(${JSON.stringify(filesystem)}, () => ({
      ...originals,
      readPrivateJson: async (...args) => {
        const result = await originals.readPrivateJson(...args)
        if (args[0] === ${JSON.stringify(path)}) {
          console.log("read-attempt-a")
          await new Response(Bun.stdin.stream()).text()
        }
        return result
      },
    }))
    const { createIssueCommentStorage } = await import(${JSON.stringify(comments)})
    await createIssueCommentStorage(${JSON.stringify(directory)}).remove(${JSON.stringify(attempt)})
  `
  const child = Bun.spawn([process.execPath, "--eval", script], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  children.push(child)
  const errors = new Response(child.stderr).text()
  const output = child.stdout.getReader()
  const first = await output.read()
  expect(new TextDecoder().decode(first.value).trim()).toBe("read-attempt-a")
  output.releaseLock()
  return { child, errors }
}

test("cross-process locking protects a stale remove and exact updates from deleting a replacement attempt", async () => {
  const { directory, storage, path } = await fixture()
  const { child, errors } = await pausedRemoval(directory, path)
  const lock = `${path}.lock`, owner = join(lock, (await readdir(lock))[0]!)
  expect((await stat(lock)).mode & 0o777).toBe(0o700)
  expect((await stat(owner)).mode & 0o777).toBe(0o600)
  // Old timestamps must never justify stealing a live process's lock.
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
  await utimes(lock, old, old)
  await utimes(owner, old, old)
  const replacement = { ...attempt, nonce: "attempt-b" }
  await expect(storage.remove(attempt)).rejects.toThrow("storage is locked")
  await expect(storage.update(attempt, { ...attempt, phase: "rejected" })).rejects.toThrow("storage is locked")
  await expect(storage.save(replacement)).rejects.toThrow("storage is locked")
  expect(await storage.load(attempt.input)).toEqual(attempt)
  child.stdin.end()
  expect(await child.exited).toBe(0)
  expect(await errors).toBe("")
  await storage.save(replacement)
  await expect(storage.remove(attempt)).rejects.toThrow("changed")
  await expect(storage.update(attempt, { ...attempt, phase: "rejected" })).rejects.toThrow("changed")
  await expect(storage.update(replacement, { ...attempt, phase: "rejected" })).rejects.toThrow("preserve its identity")
  expect(await storage.load(attempt.input)).toEqual(replacement)
  expect((await readdir(directory)).filter(name => name.includes(".lock"))).toEqual([])
})

test("a crashed local owner is recovered without losing the exact marker or a subsequent live lock", async () => {
  const { directory, storage, path } = await fixture()
  const { child } = await pausedRemoval(directory, path)
  child.kill("SIGKILL")
  await child.exited
  expect((await readdir(`${path}.lock`)).length).toBe(1)
  expect(await storage.load(attempt.input)).toEqual(attempt)
  const rejected: IssueCommentAttempt = { ...attempt, phase: "rejected" }
  // update must recover the dead lock, compare A, atomically replace it, and
  // retain private permissions. A stale pending remove must not clear it.
  await storage.update(attempt, rejected)
  expect(await storage.load(attempt.input)).toEqual(rejected)
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  await expect(storage.remove(attempt)).rejects.toThrow("changed")
  await storage.remove(rejected)
  await storage.save(attempt)
  const next = await pausedRemoval(directory, path)
  await expect(storage.remove(attempt)).rejects.toThrow("storage is locked")
  next.child.stdin.end()
  expect(await next.child.exited).toBe(0)
  expect(await next.errors).toBe("")
  expect(await storage.load(attempt.input)).toBeUndefined()
  expect(await readdir(directory)).toEqual([])
})
