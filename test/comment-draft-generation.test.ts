import { afterEach, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDiskDraftStore } from "../src/drafts"
import { createIssueCommentStorage } from "../src/github/issue-comments"

const body = "  Same **persisted draft**\r\n`$(untouched)`\n"
const draftKey = "owner/repo@71#42:comment"
const input = { accountId: 7, repositoryId: 71, number: 42, body }
const directories: string[] = []
const children: Bun.Subprocess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
  }
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

// Both workers use real sessions, clients and disk stores. Only GitHub is fake;
// stdin/stdout gates define the interleaving without timing-dependent sleeps.
function worker(directory: string, role: "A" | "B", mode: "live owner" | "publication race") {
  const module = (path: string) => JSON.stringify(new URL(path, import.meta.url).pathname)
  const child = Bun.spawn([process.execPath, "--eval", `
    import { readFileSync, writeFileSync } from "node:fs"
    import { createInterface } from "node:readline"
    import { createDiskDraftStore } from ${module("../src/drafts.ts")}
    import { createGitHubClient } from ${module("../src/github/client.ts")}
    import { createIssueCommentStorage, issueComment } from ${module("../src/github/issue-comments.ts")}
    import { createRepositorySession } from ${module("../src/repository-session.ts")}
    import { githubDataFixture, issueDetailFixture, commitDetailFixture, pullContextFixture } from ${module("./fixtures/github-data.ts")}
    const directory = ${JSON.stringify(directory)}, role = ${JSON.stringify(role)}, mode = ${JSON.stringify(mode)}
    const body = ${JSON.stringify(body)}, draftKey = ${JSON.stringify(draftKey)}
    const commands = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
    const wait = async () => { if ((await commands.next()).done) throw new Error("Missing test command") }
    const emit = value => console.log(JSON.stringify(value))
    const disk = createDiskDraftStore(directory + "/drafts")
    const storage = createIssueCommentStorage(directory + "/attempts")
    const remote = () => JSON.parse(readFileSync(directory + "/remote.json", "utf8"))
    const repository = { ...githubDataFixture.repo, id: 71, nameWithOwner: "owner/repo" }
    const issue = () => ({ ...issueDetailFixture, number: 42, commentCount: remote().length })
    const transport = {
      async json(path) {
        if (path === "user") return { id: 7, login: "viewer" }
        if (path === "repositories/71/issues/42") return { number: 42, comments: remote().length }
        if (path === "repositories/71/issues/42/comments?per_page=100&page=1") return remote()
        throw new Error("Unexpected lookup: " + path)
      },
      async text() { throw new Error("Unexpected text request") },
      async mutate(path, method, payload) {
        if (path !== "repositories/71/issues/42/comments" || method !== "POST" || payload.body !== body)
          throw new Error("Unexpected mutation")
        const comments = remote()
        const posted = { id: comments.length + 1, user: { id: 7, login: "viewer" }, body: payload.body,
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }
        comments.push(posted)
        writeFileSync(directory + "/remote.json", JSON.stringify(comments))
        return posted
      },
    }
    const save = storage.save
    let pausePublication = role === "B" && mode === "publication race"
    storage.save = async (attempt, authorize) => {
      if (pausePublication) {
        pausePublication = false
        emit({ event: "publishing", generation: attempt.owner?.generation,
          baseline: attempt.commentIds, guarded: typeof authorize === "function" })
        await wait()
      }
      // Forward the guard, not just the attempt: it must execute inside the real
      // storage publication lock, after the pause and after A has retired G.
      await save(attempt, authorize)
    }
    const api = createGitHubClient(transport, storage)
    const loaders = {
      metadata: async () => repository, documents: async () => [], document: async () => "",
      workCounts: async () => ({ issues: 0, pulls: 0 }),
      branches: async () => ({ items: [], hasMore: false }), commits: async () => ({ items: [], hasMore: false }),
      commitCount: async () => 0, commit: async () => commitDetailFixture, issue: async () => issue(),
      issues: async () => ({ items: [], hasMore: false }), pulls: async () => ({ items: [], hasMore: false }),
      issueComments: async () => ({ items: remote().map(issueComment), hasMore: false }), issueReferences: async () => [],
      pullCommits: async () => [], pullContext: async () => pullContextFixture, runs: async () => ({ items: [], hasMore: false }),
      createIssueComment: (repository, number, text, onConfirmed, key, draft) => api.createIssueComment(
        repository, number, text, async (...confirmation) => {
          if (role === "A") {
            emit({ event: "pending", id: confirmation[0].id })
            await wait()
          }
          await onConfirmed(...confirmation)
        }, key, draft),
    }
    const session = createRepositorySession(loaders, disk)
    await session.load(repository.nameWithOwner, "detail")
    await session.loadIssue(42)
    session.prepareIssueAction(42, "comment")
    emit({ event: "ready", generation: disk.load(draftKey).generation, body: session.issueAction(42).body })
    await wait()
    const submit = async event => {
      try {
        const result = await session.submitIssueAction(42, "comment")
        emit({ event, id: result.comment?.id, body: session.issueAction(42).body })
      } catch (error) {
        emit({ event, error: error.message, body: session.issueAction(42).body })
      }
    }
    await submit("submitted")
    if (role === "A") process.exit(0)
    await wait()
    // Deliberately do NOT prepare/reload: retry exactly the cached generation.
    await submit("retried")
    session.updateIssueDraft(42, { body: body + "temporary local edit" })
    session.updateIssueDraft(42, { body })
    emit({ event: "autosave", flushed: session.flushDrafts(), error: session.draftSaveError() ?? null,
      body: session.issueAction(42).body, disk: disk.load(draftKey) })
    session.discardIssueDraft(42)
    emit({ event: "discarded", flushed: session.flushDrafts(), error: session.draftSaveError() ?? null,
      body: session.issueAction(42).body, disk: disk.load(draftKey) })
    await wait()
    // Same text is legal after an explicit new intent. Submission must flush it.
    session.updateIssueDraft(42, { body })
    await submit("new draft")
    process.exit(0)
  `], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  children.push(child)
  const timeout = setTimeout(() => child.kill("SIGKILL"), 12_000)
  void child.exited.then(() => clearTimeout(timeout))
  const errors = new Response(child.stderr).text()
  const output = child.stdout.getReader(), decoder = new TextDecoder()
  let buffer = ""
  return {
    child, errors,
    send() { child.stdin.write("continue\n"); child.stdin.flush() },
    async next() {
      while (!buffer.includes("\n")) {
        const chunk = await output.read()
        if (chunk.done) throw new Error(`Worker ${role} exited before reporting: ${await errors}`)
        buffer += decoder.decode(chunk.value, { stream: true })
      }
      const end = buffer.indexOf("\n"), line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      return JSON.parse(line)
    },
  }
}

for (const mode of ["live owner", "publication race"] as const) {
  test(`a retired cached comment generation cannot POST again (${mode})`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "opengh-draft-generation-"))
    directories.push(directory)
    await writeFile(join(directory, "remote.json"), "[]")
    const disk = createDiskDraftStore(join(directory, "drafts"))
    const storage = createIssueCommentStorage(join(directory, "attempts"))
    const generation = randomUUID()
    disk.save(draftKey, { generation, body, reason: "completed" }, undefined)
    const remote = async () => JSON.parse(await readFile(join(directory, "remote.json"), "utf8"))
    const a = worker(directory, "A", mode), b = worker(directory, "B", mode)
    for (const process of [a, b]) expect(await process.next()).toEqual({ event: "ready", generation, body })

    if (mode === "publication race") {
      // B has read the empty baseline but has not yet acquired the publication lock.
      b.send()
      expect(await b.next()).toEqual({ event: "publishing", generation, baseline: [], guarded: true })
    }
    a.send()
    expect(await a.next()).toEqual({ event: "pending", id: 1 })
    const pending = await storage.load(input)
    expect(pending).toMatchObject({ owner: { pid: a.child.pid, draftKey, generation } })
    expect(disk.load(draftKey)).toMatchObject({ generation, body })
    expect((await remote()).map((comment: { id: number }) => comment.id)).toEqual([1])

    if (mode === "live owner") {
      b.send()
      expect(await b.next()).toMatchObject({ event: "submitted", error: expect.stringContaining("originating process"), body })
      expect(await storage.load(input)).toEqual(pending)
    }
    a.send()
    expect(await a.next()).toEqual({ event: "submitted", id: 1, body: "" })
    expect(await a.child.exited).toBe(0)
    expect(await a.errors).toBe("")
    expect(await storage.load(input)).toBeUndefined()
    const retired = disk.load(draftKey)!
    expect(retired.body).toBe("")
    expect(retired.generation).not.toBe(generation)

    if (mode === "publication race") {
      b.send()
      expect(await b.next()).toMatchObject({ event: "submitted", error: expect.stringMatching(/draft.*changed/i), body })
      expect(await storage.load(input)).toBeUndefined()
    }
    // A has exited and the receipt is gone: only the persisted generation can
    // stop this explicit retry from becoming a second POST of the old intent.
    b.send()
    expect(await b.next()).toMatchObject({ event: "retried", error: expect.stringMatching(/draft.*changed/i), body })
    expect(await b.next()).toEqual({ event: "autosave", flushed: false,
      error: expect.stringMatching(/draft.*changed/i), body, disk: retired })
    expect(await b.next()).toEqual({ event: "discarded", flushed: true, error: null, body: "", disk: retired })
    expect((await remote()).map((comment: { id: number }) => comment.id)).toEqual([1])
    expect(await storage.load(input)).toBeUndefined()
    b.send()
    expect(await b.next()).toEqual({ event: "new draft", id: 2, body: "" })
    expect(await b.child.exited).toBe(0)
    expect(await b.errors).toBe("")
    expect((await remote()).map((comment: { id: number; body: string }) => ({ id: comment.id, body: comment.body })))
      .toEqual([{ id: 1, body }, { id: 2, body }])
    expect(await storage.load(input)).toBeUndefined()
    expect(disk.load(draftKey)?.body).toBe("")
    expect(disk.load(draftKey)?.generation).not.toBe(retired.generation)
  }, 20_000)
}
