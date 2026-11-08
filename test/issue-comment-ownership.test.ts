import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { createIssueComments, createIssueCommentStorage, type IssueCommentAttempt } from "../src/github/issue-comments"
import type { GitHubTransport } from "../src/github/transport"

const repository = { id: 71, nodeId: "R_71", nameWithOwner: "owner/repo" }
const input = { accountId: 7, repositoryId: 71, number: 42, body: "Exact shared comment" }
const draftKey = "owner/repo@71#42:comment", otherDraft = "owner/repo@71#42:close"
const directories: string[] = []
const children: Bun.Subprocess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
  }
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "opengh-comment-owner-"))
  directories.push(directory)
  return { directory, storage: createIssueCommentStorage(directory) }
}

function worker(directory: string, script: string, alreadyPosted = false) {
  const module = new URL("../src/github/issue-comments.ts", import.meta.url).pathname
  const child = Bun.spawn([process.execPath, "--eval", `
    import { createInterface } from "node:readline"
    import { createIssueComments, createIssueCommentStorage } from ${JSON.stringify(module)}
    const commands = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
    const wait = async () => { if ((await commands.next()).done) throw new Error("Missing test command") }
    const emit = value => console.log(JSON.stringify(value))
    const repository = ${JSON.stringify(repository)}, input = ${JSON.stringify(input)}, draftKey = ${JSON.stringify(draftKey)}
    const storage = createIssueCommentStorage(${JSON.stringify(directory)})
    const posted = { id: 10, user: { id: 7, login: "viewer" }, body: input.body,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }
    const state = { posts: 0, reads: 0, callbacks: 0, comments: ${alreadyPosted ? "[posted]" : "[]"} }
    const transport = {
      async json(path) {
        if (path === "user") return { id: 7 }
        state.reads++
        const marker = await storage.load(input)
        if (marker && marker.owner?.pid !== process.pid) throw new Error("Recovery read before durable claim")
        if (path === "repositories/71/issues/42") return { number: 42, comments: state.comments.length }
        if (path === "repositories/71/issues/42/comments?per_page=100&page=1") return state.comments
        throw new Error("Unexpected lookup: " + path)
      },
      async text() { throw new Error("Unexpected text request") },
      async mutate() {
        state.posts++
        state.comments.push(posted)
        return posted
      },
    }
    const create = createIssueComments(transport, storage)
    ${script}
  `], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  children.push(child)
  const errors = new Response(child.stderr).text()
  const output = child.stdout.getReader(), decoder = new TextDecoder()
  let buffer = ""
  return {
    child, errors,
    send() { child.stdin.write("continue\n"); child.stdin.flush() },
    async next() {
      while (!buffer.includes("\n")) {
        const chunk = await output.read()
        if (chunk.done) throw new Error(`Worker exited before reporting: ${await errors}`)
        buffer += decoder.decode(chunk.value, { stream: true })
      }
      const end = buffer.indexOf("\n"), line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      return JSON.parse(line)
    },
  }
}

function blockedClient(directory: string) {
  const requests: string[] = []
  const transport: GitHubTransport = {
    async json<T>(path: string): Promise<T> {
      requests.push(path)
      if (path === "user") return { id: 7 } as T
      throw new Error("Recovery must not start before ownership is claimed")
    },
    async text() { throw new Error("Unexpected text request") },
    async mutate() { requests.push("POST"); throw new Error("Unexpected POST") },
  }
  return { requests, create: createIssueComments(transport, createIssueCommentStorage(directory)) }
}

test("a live owner's pending acknowledgement blocks both drafts and a failed callback retries without another POST", async () => {
  const { directory, storage } = await fixture()
  const origin = worker(directory, `
    try {
      await create(repository, 42, input.body, async () => {
        state.callbacks++
        emit({ event: "pending" })
        await wait()
        throw new Error("Draft settlement failed")
      }, draftKey)
    } catch (error) { emit({ event: "failed", error: error.message, posts: state.posts, marker: await storage.load(input) }) }
    await wait()
    let recovered
    const result = await create(repository, 42, input.body, (_comment, recovery) => { state.callbacks++; recovered = recovery }, draftKey)
    emit({ event: "retried", id: result.id, recovered, posts: state.posts, callbacks: state.callbacks, marker: await storage.load(input) ?? null })
    process.exit(0)
  `)
  expect(await origin.next()).toEqual({ event: "pending" })
  const attempt = await storage.load(input) as IssueCommentAttempt
  expect(attempt.owner).toEqual({ pid: origin.child.pid, hostname: hostname(), draftKey })
  const contender = blockedClient(directory)
  let callbacks = 0
  await expect(contender.create(repository, 42, input.body, () => { callbacks++ }, draftKey)).rejects.toThrow("originating process")
  await expect(contender.create(repository, 42, input.body, () => { callbacks++ }, otherDraft)).rejects.toThrow("another draft")
  await expect(storage.remove(attempt)).rejects.toThrow("originating process")
  await expect(storage.update(attempt, { ...attempt, phase: "rejected" })).rejects.toThrow("originating process")
  expect(contender.requests).toEqual(["user", "user"])
  expect(callbacks).toBe(0)
  expect(await storage.load(input)).toEqual(attempt)

  origin.send()
  expect(await origin.next()).toEqual({ event: "failed", error: "Draft settlement failed", posts: 1, marker: attempt })
  expect(await storage.load(input)).toEqual(attempt)
  origin.send()
  expect(await origin.next()).toEqual({ event: "retried", id: 10, recovered: true, posts: 1, callbacks: 2, marker: null })
  expect(await origin.child.exited).toBe(0)
  expect(await origin.errors).toBe("")
  expect(await storage.load(input)).toBeUndefined()
}, 10_000)

test("after owner exit only the original draft can recover, and competing subprocesses cannot both claim its receipt", async () => {
  const { directory, storage } = await fixture()
  const origin = worker(directory, `
    await create(repository, 42, input.body, undefined, draftKey)
    emit({ event: "posted", posts: state.posts })
    process.exit(0)
  `)
  expect(await origin.next()).toEqual({ event: "posted", posts: 1 })
  expect(await origin.child.exited).toBe(0)
  expect(await origin.errors).toBe("")
  const attempt = await storage.load(input) as IssueCommentAttempt
  const contender = blockedClient(directory)
  let callbacks = 0
  await expect(contender.create(repository, 42, input.body, () => { callbacks++ }, otherDraft)).rejects.toThrow("another draft")
  await expect(contender.create(repository, 42, input.body, () => { callbacks++ })).rejects.toThrow("another draft")
  await expect(storage.remove(attempt)).rejects.toThrow("originating process")
  await expect(storage.update(attempt, { ...attempt, phase: "rejected" })).rejects.toThrow("originating process")
  expect(contender.requests).toEqual(["user", "user"])
  expect(callbacks).toBe(0)
  expect(await storage.load(input)).toEqual(attempt)

  const recover = `
    const expected = await storage.load(input)
    emit({ event: "ready" })
    await wait()
    try {
      const claimed = await storage.claim(expected, draftKey)
      emit({ event: "claimed", attempt: claimed })
    } catch (error) {
      emit({ event: "blocked", error: error.message, posts: state.posts, reads: state.reads, callbacks: state.callbacks })
      process.exit(0)
    }
    const result = await create(repository, 42, input.body, async (comment, recovered, count) => {
      state.callbacks++
      emit({ event: "recovering", id: comment.id, recovered, count })
      await wait()
    }, draftKey)
    emit({ event: "recovered", id: result.id, posts: state.posts, callbacks: state.callbacks, marker: await storage.load(input) ?? null })
    process.exit(0)
  `
  const candidates = [worker(directory, recover, true), worker(directory, recover, true)]
  for (const candidate of candidates) expect(await candidate.next()).toEqual({ event: "ready" })
  for (const candidate of candidates) candidate.send()
  const results = await Promise.all(candidates.map(candidate => candidate.next()))
  expect(results.map(result => result.event).sort()).toEqual(["blocked", "claimed"])
  const winnerIndex = results.findIndex(result => result.event === "claimed"), winner = candidates[winnerIndex]!
  const claimed = results[winnerIndex].attempt as IssueCommentAttempt
  expect(claimed).toEqual({ ...attempt, owner: { pid: winner.child.pid, hostname: hostname(), draftKey } })
  expect(results.find(result => result.event === "blocked")).toMatchObject({ posts: 0, reads: 0, callbacks: 0 })
  expect(await winner.next()).toEqual({ event: "recovering", id: 10, recovered: true, count: 1 })
  expect(await storage.load(input)).toEqual(claimed)
  await expect(storage.claim(attempt, draftKey)).rejects.toThrow("changed")
  await expect(storage.claim(claimed, draftKey)).rejects.toThrow("originating process")
  await expect(storage.claim(claimed, otherDraft)).rejects.toThrow("another draft")
  winner.send()
  expect(await winner.next()).toEqual({ event: "recovered", id: 10, posts: 0, callbacks: 1, marker: null })
  for (const candidate of candidates) {
    expect(await candidate.child.exited).toBe(0)
    expect(await candidate.errors).toBe("")
  }
  expect(await storage.load(input)).toBeUndefined()
}, 10_000)
