import { describe, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGitHubReviews } from "../src/github/reviews"
import { createPullReviewSession, createReviewDraftStorage, type ReviewDraftStorage } from "../src/pull-review-session"
import { createGitHubTransport, GitHubApiError, GitHubRequestNotSentError, type GitHubTransport, type RequestOptions } from "../src/github/transport"
import type { ReviewDraft } from "../src/review-types"

const sha = "a".repeat(40)
const baseSha = "c".repeat(40)
function fixture() {
  const data = { repositoryId: 71 as unknown, draft: false, archived: false, state: "open", accountId: 7, head: sha, base: baseSha as string | undefined, author: 8, private: true, pull: true, collaborator: false, triage: false, locked: false, push: false, collaboratorChecks: 0, reviews: [] as any[], comments: [] as any[], posts: [] as any[], failPost: false, recordPost: true }
  const transport: GitHubTransport = {
    async json<T>(path: string): Promise<T> {
      if (path === "user") return { id: data.accountId, login: "viewer" } as T
      if (path === "repos/o/r") return { id: data.repositoryId, archived: data.archived, private: data.private, permissions: { pull: data.pull, triage: data.triage, push: data.push } } as T
      if (path === "repos/o/r/pulls/1") return { head: { sha: data.head }, ...(data.base === undefined ? {} : { base: { sha: data.base } }), state: data.state, draft: data.draft, locked: data.locked, user: { id: data.author } } as T
      if (path.includes("/files?")) return [{ filename: "a.ts", patch: "@@ -1,2 +1,2 @@\n old\n-new\n+new" }] as T
      if (path.includes("/comments?")) return data.comments as T
      if (path.includes("/reviews?")) return data.reviews as T
      throw new Error(`Unexpected path ${path}`)
    },
    async graphql<T>(): Promise<T> { throw new Error("Reviews must not query GraphQL permissions") },
    async text(path) {
      if (path !== "repos/o/r/collaborators/viewer") throw new Error(`Unexpected text ${path}`)
      data.collaboratorChecks++
      if (!data.collaborator) throw new GitHubApiError(path, "Not Found", 404)
      return ""
    },
    async mutate<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
      data.posts.push({ path, method, body })
      const review = { id: 100, user: { id: data.accountId }, state: { COMMENT: "COMMENTED", APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED" }[body.event as string],
        body: body.body, commit_id: body.commit_id, submitted_at: new Date().toISOString() }
      if (data.recordPost) { data.reviews.push(review); data.comments = body.comments as any[] }
      if (data.failPost) throw new Error("connection lost")
      return review as T
    },
  }
  return { data, transport }
}
function memory(): ReviewDraftStorage {
  const values = new Map<string, ReviewDraft>()
  const key = (d: { accountId: number; repository: string; number: number }) => `${d.accountId}/${d.repository}/${d.number}`
  return { async load(scope) { return structuredClone(values.get(key(scope))) }, async save(draft) { values.set(key(draft), structuredClone(draft)) },
    async remove(draft) { if (JSON.stringify(values.get(key(draft))) !== JSON.stringify(draft)) throw new Error("changed draft"); values.delete(key(draft)) } }
}
const draft = (): ReviewDraft => ({ accountId: 7, repository: "o/r", number: 1, headSha: sha, baseSha, body: "Review", event: "COMMENT", comments: [] })

describe("pull reviews", () => {
  test("draft bursts coalesce and a slow save retains only the latest edit", async () => {
    const saved: string[] = []
    const gate = Promise.withResolvers<void>()
    const storage = memory()
    const session = createPullReviewSession({ transport: fixture().transport, storage: { ...storage,
      async save(draft) {
        saved.push(draft.body)
        if (saved.length === 1) await gate.promise
        await storage.save(draft)
      },
    } })
    await session.open("o/r", 1)
    for (let i = 0; i < 100; i++) session.setBody(`first ${i}`)
    expect(saved).toEqual([])
    const flushing = session.flush()
    expect(saved).toEqual(["first 99"])
    for (let i = 0; i < 100; i++) session.setBody(`latest ${i}`)
    gate.resolve()
    await flushing
    expect(saved).toEqual(["first 99", "latest 99"])
    expect((await storage.load(draft()) as ReviewDraft).body).toBe("latest 99")
  })

  test.each([false, true])("flush drains edits queued during a save and preserves failure/retry (fail=%s)", async (fail) => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const secondStarted = Promise.withResolvers<void>()
    const storage = memory()
    const session = createPullReviewSession({ transport: fixture().transport, storage: { ...storage,
      async save(draft) {
        if (draft.body === "first") await first.promise
        else {
          secondStarted.resolve()
          await second.promise
          if (fail) throw new Error("disk full")
        }
        await storage.save(draft)
      },
    } })
    await session.open("o/r", 1)
    session.setBody("first")
    let settled = false
    const flushing = session.flush().then(() => { settled = true }, error => { settled = true; throw error })
    session.setBody("latest")
    first.resolve()
    await secondStarted.promise
    await Bun.sleep(0)
    expect(settled).toBe(false)
    second.resolve()
    if (fail) await expect(flushing).rejects.toThrow("disk full")
    else await flushing
    if (fail) {
      fail = false
      session.setBody("latest")
      await session.flush()
    }
    expect((await storage.load(draft()) as ReviewDraft).body).toBe("latest")
  })

  test("opening another review cancels obsolete eligibility reads", async () => {
    const { transport } = fixture()
    const started = Promise.withResolvers<AbortSignal>()
    const session = createPullReviewSession({ storage: memory(), transport: { ...transport,
      async json<T>(path: string, options?: RequestOptions): Promise<T> {
        if (path === "repos/o/r/pulls/1") {
          const signal = options!.budget!.signal
          started.resolve(signal)
          return new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true })
          })
        }
        return transport.json<T>(path.replace("/pulls/2", "/pulls/1"), options)
      },
    } })
    const first = session.open("o/r", 1)
    const signal = await started.promise
    await session.open("o/r", 2)
    await first
    expect(signal.aborted).toBe(true)
    expect(session.state().draft?.number).toBe(2)
    expect(session.state().status).toBe("ready")
  })

  test("budget expiry while storing the submission marker unlocks a known-unsent review", async () => {
    const { transport } = fixture()
    const storage = memory()
    const real = createGitHubTransport()
    let options: RequestOptions | undefined
    let attempts = 0
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("No gh request should be spawned") })
    const session = createPullReviewSession({ storage: { ...storage,
      async save(draft) {
        await storage.save(draft)
        if (draft.submission) {
          // Expire the actual shared budget during the awaited marker save.
          try { options!.budget!.consumeBytes(17 * 1024 * 1024) } catch {}
        }
      },
    }, transport: { ...transport,
      async json<T>(path: string, requestOptions?: RequestOptions): Promise<T> {
        options = requestOptions
        return transport.json<T>(path, requestOptions)
      },
      async mutate<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>, requestOptions?: RequestOptions): Promise<T> {
        attempts++
        return real.mutate!<T>(path, method, body, requestOptions)
      },
    } })
    try {
      await session.open("o/r", 1)
      session.setBody("Review")
      for (let attempt = 1; attempt <= 2; attempt++) {
        expect(await session.submit()).toBe(false)
        expect(attempts).toBe(attempt)
        expect(session.state().uncertain).toBe(false)
        expect(session.state().draft?.submission).toBeUndefined()
        expect((await storage.load(draft()) as ReviewDraft).submission).toBeUndefined()
      }
      expect(spawn).not.toHaveBeenCalled()
    } finally { spawn.mockRestore() }
  })

  test("a response budget failure after POST preserves the marker and reconciles without reposting", async () => {
    const { data, transport } = fixture()
    const storage = memory()
    const session = createPullReviewSession({ storage, transport: { ...transport,
      async mutate<T>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>, options?: RequestOptions): Promise<T> {
        const response = await transport.mutate!<T>(path, method, body, options)
        options!.budget!.consumeBytes(17 * 1024 * 1024)
        return response
      },
    } })
    await session.open("o/r", 1)
    session.setBody("Review")
    expect(await session.submit()).toBe(false)
    expect(session.state().uncertain).toBe(true)
    expect((await storage.load(draft()) as ReviewDraft).submission).toBeDefined()
    expect(data.posts).toHaveLength(1)
    expect(await session.submit()).toBe(true)
    expect(data.posts).toHaveLength(1)
    expect(await storage.load(draft())).toBeUndefined()
  })

  test("preloaded reviews share in-flight requests and reopen immediately without losing drafts", async () => {
    const { data, transport } = fixture()
    const gate = Promise.withResolvers<void>()
    let requests = 0
    const session = createPullReviewSession({ storage: memory(), transport: { ...transport,
      async json<T>(path: string): Promise<T> {
        requests++
        await gate.promise
        return transport.json<T>(path)
      },
    } })
    const first = session.open("o/r", 1)
    const second = session.open("o/r", 1)
    expect(second).toBe(first)
    gate.resolve()
    await first
    session.setBody("Keep this draft")
    const draft = session.state().draft
    const loadedRequests = requests
    await session.open("o/r", 1)
    expect(session.state().status).toBe("ready")
    expect(session.state().draft).toBe(draft)
    expect(requests).toBe(loadedRequests)
    data.head = "b".repeat(40)
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    expect(session.state().draft?.body).toBe("Keep this draft")
  })

  test("explicit permission, author exclusion, locked access, pending review, and exact REST payload", async () => {
    const { data, transport } = fixture()
    const api = createGitHubReviews(transport)
    expect((await api.eligibility("o/r", 1)).canApprove).toBe(true)
    expect(data.collaboratorChecks).toBe(0) // Private READ needs no collaborator/write permission.
    data.author = 7
    expect((await api.eligibility("o/r", 1)).canApprove).toBe(false)
    data.author = 8; data.private = false
    expect((await api.eligibility("o/r", 1)).canRequestChanges).toBe(false)
    expect((await api.eligibility("o/r", 1)).reason).toBe("Approval permission cannot be verified; use GitHub.")
    data.collaborator = true
    expect((await api.eligibility("o/r", 1)).canApprove).toBe(true)
    data.collaborator = false
    data.triage = true
    expect((await api.eligibility("o/r", 1)).canApprove).toBe(true)
    data.triage = false
    data.locked = true
    expect((await api.eligibility("o/r", 1)).canComment).toBe(false)
    data.push = true
    expect((await api.eligibility("o/r", 1)).canComment).toBe(true)
    data.reviews = [{ id: 1, user: { id: 7 }, state: "PENDING" }]
    expect((await api.eligibility("o/r", 1)).pendingReviewUrl).toContain("pending-review")
    data.reviews = []
    data.push = false; data.locked = false
    const unavailable = createGitHubReviews({ ...transport, async text() { throw new Error("Cannot verify collaborator access") } })
    expect((await unavailable.eligibility("o/r", 1)).canApprove).toBe(false)
    expect((await unavailable.eligibility("o/r", 1)).canComment).toBe(true)
    const value = { ...draft(), comments: [{ id: "local", path: "a.ts", line: 2, side: "RIGHT" as const, startLine: 1, startSide: "RIGHT" as const, body: "Inline" }] }
    await api.validateAnchors(value)
    await api.post(value)
    expect(data.posts[0]).toEqual({ path: "repos/o/r/pulls/1/reviews", method: "POST", body: { commit_id: sha, event: "COMMENT", body: "Review", comments: [{ path: "a.ts", line: 2, side: "RIGHT", start_line: 1, start_side: "RIGHT", body: "Inline" }] } })
  })
  test("draft PRs allow COMMENT submission but retain decision, access, state, and pending review gates", async () => {
    const { data, transport } = fixture()
    data.draft = true
    const api = createGitHubReviews(transport)
    expect(await api.eligibility("o/r", 1)).toMatchObject({ canComment: true, canInlineComment: true,
      canApprove: false, canRequestChanges: false, reason: "Approval and request changes require a non-draft pull request." })
    const session = createPullReviewSession({ transport, storage: memory() })
    await session.open("o/r", 1)
    session.setBody("Draft feedback")
    for (const event of ["APPROVE", "REQUEST_CHANGES"] as const) {
      session.setEvent(event)
      expect(await session.submit()).toBe(false)
    }
    session.setEvent("COMMENT")
    for (const change of [{ archived: true }, { state: "closed" }, { locked: true }, { pull: false }]) {
      Object.assign(data, change)
      expect(await api.eligibility("o/r", 1)).toMatchObject({ canComment: false, canInlineComment: false })
      expect(await session.submit()).toBe(false)
      Object.assign(data, { archived: false, state: "open", locked: false, pull: true })
    }
    data.reviews = [{ id: 1, user: { id: 7 }, state: "PENDING" }]
    expect(await api.eligibility("o/r", 1)).toMatchObject({ canComment: false, canInlineComment: true })
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    data.reviews = []
    expect(await session.submit()).toBe(true)
    expect(data.posts).toHaveLength(1)
    expect(data.posts[0].body).toMatchObject({ event: "COMMENT", body: "Draft feedback", commit_id: sha })
  })
  test("null historical reviewers allow submission, but pending viewer reviews and malformed authors fail closed", async () => {
    const { data, transport } = fixture()
    const api = createGitHubReviews(transport)
    const historical = { id: 1, user: null, state: "COMMENTED" }
    data.reviews = [historical]
    expect(await api.eligibility("o/r", 1)).toMatchObject({ canComment: true, canApprove: true, canRequestChanges: true })
    const session = createPullReviewSession({ transport, storage: memory() })
    await session.open("o/r", 1)
    session.setBody("Review")
    for (const malformed of [
      { id: 2, state: "COMMENTED" },
      ...[{}, [], "viewer", { id: "7" }, { id: 0 }, { id: -1 }, { id: 1.5 }].map(user => ({ id: 2, user, state: "COMMENTED" })),
      null, [], "review", { ...historical, id: 0 }, { ...historical, id: "2" }, { ...historical, state: null }, { ...historical, state: "UNKNOWN" },
    ]) {
      data.reviews = [historical, malformed]
      await expect(api.eligibility("o/r", 1)).rejects.toThrow("Cannot verify existing GitHub reviews")
      expect(await session.submit()).toBe(false)
      expect(data.posts).toHaveLength(0)
    }
    data.reviews = [historical, { id: 2, user: { id: 7 }, state: "PENDING" }]
    expect(await api.eligibility("o/r", 1)).toMatchObject({ canComment: false, canApprove: false, canRequestChanges: false })
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    data.reviews = [historical]
    expect(await session.submit()).toBe(true)
    expect(data.posts).toHaveLength(1)
    expect(api.confirmedResponse(draft(), { ...data.reviews[1], user: null })).toBe(false)
  })
  test("public outsider approvals never POST, while verified private READ can approve", async () => {
    const { data, transport } = fixture()
    data.private = false
    const session = createPullReviewSession({ transport, storage: memory() })
    await session.open("o/r", 1)
    session.setEvent("APPROVE")
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    data.private = true
    data.recordPost = false // A successful POST is authoritative even before the review listing catches up.
    expect(await session.submit()).toBe(true)
    expect(data.posts).toHaveLength(1)
    data.pull = false
    expect((await createGitHubReviews(transport).eligibility("o/r", 1)).canApprove).toBe(false)
  })
  test("same-head base changes preserve LEFT drafts; unknown bases block inline but not whole reviews", async () => {
    const { data, transport } = fixture(), storage = memory()
    const session = createPullReviewSession({ transport, storage })
    await session.open("o/r", 1)
    session.addComment({ path: "a.ts", line: 2, side: "LEFT" }, "Old base line")
    await session.flush()
    expect((await storage.load(draft()) as ReviewDraft).baseSha).toBe(baseSha)
    data.base = "d".repeat(40)
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    expect(session.state().draft?.baseSha).toBe(baseSha)
    expect(session.state().draft?.comments[0]?.body).toBe("Old base line")
    expect(session.state().message).toContain("base changed")
    expect(() => session.useCurrentHead()).toThrow("Remove inline comments")
    session.removeComment(session.state().draft!.comments[0]!.id)
    session.useCurrentHead()
    expect(session.state().draft?.baseSha).toBe(data.base)
    data.base = undefined
    await session.discard()
    await session.open("o/r", 1)
    session.addComment({ path: "a.ts", line: 2, side: "RIGHT" }, "Unknown base")
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    session.removeComment(session.state().draft!.comments[0]!.id)
    session.setBody("Whole review does not require base")
    expect(await session.submit()).toBe(true)
    data.base = "invalid"
    await expect(createGitHubReviews(transport).eligibility("o/r", 1)).rejects.toThrow("base")
  })
  test("changed head preserves draft and only explicit acknowledgement without inline comments enables submission", async () => {
    const { data, transport } = fixture()
    const session = createPullReviewSession({ transport, storage: memory() })
    await session.open("o/r", 1)
    session.setBody("Keep me")
    session.addComment({ path: "a.ts", line: 2, side: "RIGHT" }, "inline")
    data.head = "b".repeat(40)
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    expect(() => session.useCurrentHead()).toThrow("Remove inline comments")
    expect(session.state().draft?.headSha).toBe(sha)
    session.removeComment(session.state().draft!.comments[0]!.id)
    session.useCurrentHead()
    expect(session.state().draft?.body).toBe("Keep me")
    expect(await session.submit()).toBe(true)
    expect(data.posts).toHaveLength(1)
  })
  test("ambiguous write survives reopening and never reposts; exact reconciliation confirms lost response", async () => {
    const { data, transport } = fixture(), storage = memory()
    let session = createPullReviewSession({ transport, storage })
    await session.open("o/r", 1)
    session.setBody("Never duplicate")
    data.failPost = true; data.recordPost = false
    expect(await session.submit()).toBe(false)
    session = createPullReviewSession({ transport, storage })
    await session.open("o/r", 1)
    expect(session.state().uncertain).toBe(true)
    expect(() => session.setBody("Cannot overwrite marker")).toThrow("automatic retry is blocked")
    expect(session.state().draft?.body).toBe("Never duplicate")
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(1)
    data.reviews.push({ id: 100, user: { id: 7 }, state: "COMMENTED", body: "Never duplicate", commit_id: sha, submitted_at: new Date().toISOString() })
    expect(await session.submit()).toBe(true)
    expect(data.posts).toHaveLength(1)
  })
  test("definitive rejection releases only its matching marker and permits corrected empty approval", async () => {
    const { data, transport } = fixture()
    const post = transport.mutate!
    transport.mutate = async (path) => { throw new GitHubApiError(path, "Validation failed", 422) }
    const session = createPullReviewSession({ transport, storage: memory() })
    await session.open("o/r", 1)
    session.setEvent("APPROVE")
    expect(await session.submit()).toBe(false)
    expect(session.state().uncertain).toBe(false)
    expect(session.state().draft?.submission).toBeUndefined()
    transport.mutate = post
    expect(await session.submit()).toBe(true)
    expect(data.posts).toHaveLength(1)
  })
  test("known-unsent account guard and missing mutation release the marker without losing the body", async () => {
    for (const missing of [false, true]) {
      const { data, transport } = fixture(), storage = memory()
      if (missing) delete transport.mutate
      else transport.mutate = async () => { throw new GitHubRequestNotSentError("Account guard: no changes were sent") }
      const session = createPullReviewSession({ transport, storage })
      await session.open("o/r", 1)
      session.setBody("Keep this review")
      expect(await session.submit()).toBe(false)
      expect(session.state().uncertain).toBe(false)
      expect(session.state().message).toContain(missing ? "unavailable" : "Account guard")
      expect(await storage.load(draft())).toMatchObject({ body: "Keep this review" })
      expect((await storage.load(draft()) as ReviewDraft).submission).toBeUndefined()
      session.setBody("Editable after local rejection")
      await session.flush()
      expect(data.posts).toHaveLength(0)
    }
  })
  test("failed marker persistence keeps an editable draft and recovers after a subsequent save", async () => {
    const { data, transport } = fixture(), storage = memory()
    const save = storage.save
    let failMarker = true
    storage.save = async (value, rejected) => {
      if (value.submission && failMarker) throw new Error("marker disk full")
      await save(value, rejected)
    }
    const session = createPullReviewSession({ transport, storage })
    await session.open("o/r", 1)
    session.setBody("Durable original")
    await session.flush()
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    expect(session.state().draft?.submission).toBeUndefined()
    expect(session.state().uncertain).toBe(false)
    expect((await storage.load(draft()) as ReviewDraft).body).toBe("Durable original")
    failMarker = false
    session.setBody("Recovered draft")
    await session.flush()
    expect(await session.submit()).toBe(true)
    expect(data.posts).toHaveLength(1)
  })
  test("exclusive disk markers preserve underlying drafts, reject second owners and support legacy cleanup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opengh-review-markers-"))
    try {
      const a = createReviewDraftStorage(directory), b = createReviewDraftStorage(directory), value = draft()
      await a.save(value)
      const path = join(directory, (await readdir(directory))[0]!)
      const marked = { ...value, submission: { startedAt: new Date().toISOString(), reviewIds: [] } }
      const results = await Promise.allSettled([a.save(marked), b.save(marked)])
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(value)
      expect(await b.load(value)).toEqual(marked)
      await expect(b.save(value)).rejects.toThrow("unresolved")
      await expect(b.remove({ ...marked, body: "Not owned" })).rejects.toThrow("changed")
      await b.save(value, marked)
      expect(await a.load(value)).toEqual(value)
      expect(await readdir(directory)).toHaveLength(1)
      await a.save(marked)
      // Simulate a draft write already in flight in another process.
      const concurrent = { ...value, body: "Concurrent draft" }
      await writeFile(path, JSON.stringify(concurrent))
      await a.remove(marked)
      expect(await a.load(value)).toEqual(concurrent)
      await expect(a.save(marked)).rejects.toThrow("changed")
      await a.save(value)
      await a.save(marked)
      await b.remove(marked)
      expect(await b.load(value)).toBeUndefined()
      await expect(a.save(marked)).rejects.toThrow("changed") // Cannot submit an already-cleared draft.
      // Legacy marked files are still reconciled and can be released on rejection.
      await writeFile(path, JSON.stringify(marked))
      expect(await a.load(value)).toEqual(marked)
      await a.save(value, marked)
      expect(await a.load(value)).toEqual(value)
      await writeFile(path, JSON.stringify(marked))
      await b.remove(marked)
      expect(await readdir(directory)).toEqual([])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  test("account changes block writes; reopening restores isolated drafts", async () => {
    const { data, transport } = fixture()
    const session = createPullReviewSession({ transport, storage: memory() })
    await session.open("o/r", 1)
    session.setBody("Account seven")
    await session.open("o/r", 1)
    expect(session.state().draft?.body).toBe("Account seven")
    data.accountId = 9
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    await session.open("o/r", 1)
    expect(session.state().draft?.body).toBe("")
    session.setBody("Account nine")
    data.accountId = 7
    expect(await session.submit()).toBe(false) // Cached drafts retain their original account; submission revalidates.
    expect(data.posts).toHaveLength(0)
    await session.open("o/r", 1)
    expect(session.state().draft?.body).toBe("Account seven")
  })
  test("a same-name replacement repository never receives a preserved draft", async () => {
    const { data, transport } = fixture(), storage = memory()
    const session = createPullReviewSession({ transport, storage })
    await session.open("o/r", 1)
    session.setBody("For the original repository")
    await session.flush()
    const stored = await storage.load(draft())
    expect(stored).toEqual({ ...draft(), repositoryId: 71, body: "For the original repository" })
    data.repositoryId = 72 // Same name, account, PR number, head and base: only the immutable ID differs.
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    expect(session.state().message).toBe("Repository changed; draft preserved. Reopen the pull request.")
    expect(session.state().draft).toEqual(stored as ReviewDraft)
    expect(await storage.load(draft())).toEqual(stored)
    // Acknowledging the current head must not rebind the draft to the replacement repository.
    expect(() => session.useCurrentHead()).toThrow("different repository")
    expect(await session.submit()).toBe(false)
    const reopened = createPullReviewSession({ transport, storage })
    await reopened.open("o/r", 1)
    expect(reopened.state()).toMatchObject({ status: "ready", uncertain: false, eligibility: { repositoryId: 72 }, draft: stored as ReviewDraft })
    expect(reopened.state().message).toBe("This draft was written for a different repository that previously used this name. It was not changed; clear it to start a new review.")
    expect(await storage.load(draft())).toEqual(stored)
    expect(await reopened.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    expect(await storage.load(draft())).toEqual(stored)
    // Only an explicit discard releases the name: the next review belongs to the replacement repository.
    await reopened.discard()
    expect(await storage.load(draft())).toBeUndefined()
    expect(reopened.state().draft).toMatchObject({ body: "", repositoryId: 72 })
    reopened.setBody("For the replacement repository")
    expect(await reopened.submit()).toBe(true)
    expect(data.posts.map(post => post.body.body)).toEqual(["For the replacement repository"])
  })
  test("a replacement repository neither reconciles nor deletes a pending submission marker", async () => {
    const { data, transport } = fixture(), storage = memory()
    const session = createPullReviewSession({ transport, storage })
    await session.open("o/r", 1)
    session.setBody("Sent to the original repository")
    data.failPost = true; data.recordPost = false
    expect(await session.submit()).toBe(false)
    const marked = await storage.load(draft()) as ReviewDraft
    expect(marked).toMatchObject({ repositoryId: 71, submission: { reviewIds: [] } })
    // The replacement holds an identical review, which reconciliation would confirm before deleting the draft.
    data.repositoryId = 72
    data.reviews.push({ id: 100, user: { id: 7 }, state: "COMMENTED", body: marked.body, commit_id: sha, submitted_at: new Date().toISOString() })
    expect(await session.submit()).toBe(false)
    expect(session.state()).toMatchObject({ uncertain: true, draft: marked, message: "Repository changed; draft preserved. Reopen the pull request." })
    expect(await storage.load(draft())).toEqual(marked)
    const reopened = createPullReviewSession({ transport, storage })
    await reopened.open("o/r", 1)
    expect(reopened.state()).toMatchObject({ status: "ready", uncertain: true, draft: marked })
    expect(reopened.state().message).toContain("different repository")
    expect(await storage.load(draft())).toEqual(marked)
    expect(await reopened.submit()).toBe(false)
    expect(await storage.load(draft())).toEqual(marked)
    expect(data.posts).toHaveLength(1)
    data.repositoryId = 71
    expect(await reopened.submit()).toBe(true)
    expect(await storage.load(draft())).toBeUndefined()
    expect(data.posts).toHaveLength(1)
  })
  test("a legacy draft without a repository ID is bound once and can then be submitted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opengh-review-legacy-"))
    try {
      const { data, transport } = fixture(), storage = createReviewDraftStorage(directory)
      const legacy = { ...draft(), body: "Written by an earlier build" }
      const path = join(directory, `${createHash("sha256").update("7/o/r/1").digest("hex")}.json`)
      await writeFile(path, JSON.stringify(legacy))
      const session = createPullReviewSession({ transport, storage })
      await session.open("o/r", 1)
      expect(session.state()).toMatchObject({ status: "ready", uncertain: false, draft: { ...legacy, repositoryId: 71 } })
      expect(session.state().message).toBeUndefined()
      await session.flush()
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ...legacy, repositoryId: 71 })
      // Once bound, a later replacement repository cannot adopt the draft again.
      data.repositoryId = 72
      const replaced = createPullReviewSession({ transport, storage })
      await replaced.open("o/r", 1)
      expect(replaced.state().message).toContain("different repository")
      expect(await replaced.submit()).toBe(false)
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ...legacy, repositoryId: 71 })
      data.repositoryId = 71
      expect(await session.submit()).toBe(true)
      expect(data.posts.map(post => post.body.body)).toEqual([legacy.body])
      expect(await readdir(directory)).toEqual([])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  test("a legacy pending submission without a repository ID is left unbound and still reconciles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opengh-review-legacy-marker-"))
    try {
      const { data, transport } = fixture(), storage = createReviewDraftStorage(directory)
      const legacy = { ...draft(), body: "Sent by an earlier build" }
      const marked = { ...legacy, submission: { startedAt: new Date().toISOString(), reviewIds: [] } }
      await storage.save(legacy)
      await storage.save(marked)
      const session = createPullReviewSession({ transport, storage })
      await session.open("o/r", 1)
      expect(session.state()).toMatchObject({ uncertain: true, draft: marked })
      expect(session.state().draft?.repositoryId).toBeUndefined()
      expect(await storage.load(legacy)).toEqual(marked)
      data.reviews.push({ id: 100, user: { id: 7 }, state: "COMMENTED", body: legacy.body, commit_id: sha, submitted_at: new Date().toISOString() })
      expect(await session.submit()).toBe(true)
      expect(data.posts).toHaveLength(0)
      expect(await readdir(directory)).toEqual([])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  test("an unverifiable repository ID blocks eligibility, and stored drafts persist only a valid one", async () => {
    const { data, transport } = fixture()
    const session = createPullReviewSession({ transport, storage: memory() })
    await session.open("o/r", 1)
    session.setBody("Review")
    for (const id of [undefined, null, "71", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      data.repositoryId = id
      await expect(createGitHubReviews(transport).eligibility("o/r", 1)).rejects.toThrow("Cannot verify the repository.")
      expect(await session.submit()).toBe(false)
      expect(data.posts).toHaveLength(0)
    }
    data.repositoryId = 71
    expect(await createGitHubReviews(transport).eligibility("o/r", 1)).toMatchObject({ repositoryId: 71 })
    const directory = await mkdtemp(join(tmpdir(), "opengh-review-repository-id-"))
    try {
      const storage = createReviewDraftStorage(directory), value = { ...draft(), repositoryId: 71 }
      await storage.save({ ...value, token: "not persisted" } as ReviewDraft)
      expect(await storage.load(value)).toEqual(value)
      const path = join(directory, (await readdir(directory))[0]!)
      expect(path).toEndWith(`${createHash("sha256").update("7/o/r/1").digest("hex")}.json`) // The storage scope is unchanged.
      for (const repositoryId of [0, -1, 1.5, "71", null]) {
        await expect(storage.save({ ...value, repositoryId } as ReviewDraft)).rejects.toThrow("Invalid review draft")
        await writeFile(path, JSON.stringify({ ...value, repositoryId }))
        await expect(storage.load(value)).rejects.toThrow("Cannot read review draft")
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  test("failed persistence blocks POST and unreadable drafts cannot be replaced by editing", async () => {
    const { data, transport } = fixture()
    const storage = memory()
    storage.save = async () => { throw new Error("disk full") }
    const session = createPullReviewSession({ transport, storage })
    await session.open("o/r", 1)
    session.setBody("Must be durable")
    await expect(session.flush()).rejects.toThrow("disk full")
    expect(await session.submit()).toBe(false)
    expect(data.posts).toHaveLength(0)
    const unreadable = createPullReviewSession({ transport, storage: { ...memory(), async load() { return { invalid: true } } } })
    await unreadable.open("o/r", 1)
    expect(() => unreadable.setBody("Cannot replace corrupt draft")).toThrow("not available")
    expect(unreadable.state().draft).toBeUndefined()
    expect(await unreadable.submit()).toBe(false)
  })
  test("empty disk reviews are removed without losing selected events or unresolved submissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opengh-empty-review-"))
    try {
      const storage = createReviewDraftStorage(directory), value = draft()
      const empty = { ...value, body: "" }
      await storage.save(empty)
      expect(await storage.load(value)).toBeUndefined()
      await storage.save(value)
      await storage.save(empty)
      expect(await readdir(directory)).toEqual([])
      const approval = { ...empty, event: "APPROVE" as const }
      await storage.save(approval)
      expect(await storage.load(value)).toEqual(approval)
      const marked = { ...approval, submission: { startedAt: new Date().toISOString(), reviewIds: [] } }
      await storage.save(marked)
      await expect(storage.save(empty)).rejects.toThrow("unresolved")
      expect(await storage.load(value)).toEqual(marked)
      await storage.remove(marked)
      const { transport } = fixture()
      const session = createPullReviewSession({ transport, storage })
      await session.open("o/r", 1)
      session.setEvent("APPROVE")
      expect(await session.submit()).toBe(true)
      expect(await readdir(directory)).toEqual([])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  test("private atomic serialized disk storage, scope isolation and unreadable-file protection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opengh-review-test-"))
    try {
      const storage = createReviewDraftStorage(directory), value = draft()
      await Promise.all([storage.save(value), storage.save({ ...value, body: "latest" })])
      expect((await storage.load(value) as ReviewDraft).body).toBe("latest")
      expect((await storage.load(value) as ReviewDraft).baseSha).toBe(baseSha)
      expect(await storage.load({ ...value, accountId: 99 })).toBeUndefined()
      expect(await storage.load({ ...value, repository: "other/repo" })).toBeUndefined()
      const files = await readdir(directory)
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/)
      const path = join(directory, files[0]!)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      const marked = { ...value, submission: { startedAt: new Date().toISOString(), reviewIds: [] } }
      await storage.save(value)
      await storage.save(marked)
      await expect(storage.save(value)).rejects.toThrow("unresolved")
      await storage.save(value, marked)
      expect((await storage.load(value) as ReviewDraft).submission).toBeUndefined()
      expect((await storage.load(value) as ReviewDraft).body).toBe(value.body)
      await writeFile(path, "unreadable")
      await expect(storage.save(value)).rejects.toThrow("will not be overwritten")
      expect(await readFile(path, "utf8")).toBe("unreadable")
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
