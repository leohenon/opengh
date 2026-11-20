import { describe, expect, test } from "bun:test"
import { createComputed, createRoot } from "solid-js"
import type { PullRequestDetail, ReactionState, ReactionTarget, Repo } from "../src/models"
import { createRepositorySession, type RepositoryLoaders, type RepositorySession } from "../src/repository-session"
import {
  commitDetailFixture,
  githubDataFixture,
  issueCommentsFixture,
  issueDetailFixture,
  pullContextFixture,
} from "./fixtures/github-data"

const A = "owner/first"
const B = "owner/second"
const C = "owner/third"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function repository(nameWithOwner: string): Repo {
  const id = nameWithOwner === A ? 1 : nameWithOwner === B ? 2 : 3
  return {
    ...structuredClone(githubDataFixture.repo),
    id,
    nodeId: `R_${id}`,
    nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
  }
}

function pullFixture(number = 1): PullRequestDetail {
  return {
    ...structuredClone(githubDataFixture.pulls.open.value!.items[0]!),
    number,
    url: `https://github.com/${A}/pull/${number}`,
    body: "PR body",
    updatedAt: "2026-01-01T00:00:00Z",
    baseBranch: "main",
    headBranch: "next",
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    commitCount: 0,
    commentCount: 1,
    labels: [],
    assignees: [],
    reviewers: [],
    mergeable: true,
    permissions: { comment: true, close: true, reopen: true, assignees: true },
  }
}

function loaders(overrides: Partial<RepositoryLoaders> = {}): RepositoryLoaders {
  return {
    metadata: async (name) => repository(name),
    workCounts: async () => ({ issues: 0, pulls: 0 }),
    commitCount: async () => 4,
    documents: async () => [],
    document: async () => "",
    branches: async () => ({ items: ["main"], hasMore: false }),
    commits: async () => ({ items: [], hasMore: false }),
    commit: async () => structuredClone(commitDetailFixture),
    issue: async (_repository, number) => ({ ...structuredClone(issueDetailFixture), number }),
    issueComments: async () => ({ items: structuredClone(issueCommentsFixture), hasMore: false }),
    issueReferences: async () => [],
    issues: async () => ({ items: [], hasMore: false }),
    pulls: async () => ({ items: [], hasMore: false }),
    pull: async (_repository, number) => pullFixture(number),
    pullCommits: async () => [],
    pullContext: async () => structuredClone(pullContextFixture),
    runs: async () => ({ items: [], hasMore: false }),
    ...overrides,
  }
}

function ready(session: RepositorySession) {
  const state = session.state()
  if (state.status !== "ready") throw new Error(`Expected ready repository, got ${state.status}`)
  return state
}

// Resolve from a state-change event, not from sleeps or microtask polling.
function until(predicate: () => boolean) {
  const reached = deferred<void>()
  const dispose = createRoot((dispose) => {
    createComputed(() => {
      if (predicate()) reached.resolve()
    })
    return dispose
  })
  return reached.promise.finally(dispose)
}

// Freeze time so a refetch can only come from invalidation, never an expired TTL.
const cacheOptions = { freshMs: 60_000, now: () => 0 }

function heldOverviewReads() {
  const started = deferred<void>()
  const released = deferred<void>()
  let count = 0
  return {
    started: started.promise,
    release: () => released.resolve(),
    wait: async () => {
      if (++count === 3) started.resolve() // open list, closed list, counts
      await released.promise
    },
  }
}

describe("repository cache regressions", () => {
  test.each(["issue", "pull"] as const)("a pending %s detail read cannot undo a repository refresh", async (kind) => {
    const started = deferred<void>()
    const release = deferred<void>()
    const hold = () => {
      started.resolve()
      return release.promise
    }
    let title = "Before refresh"
    let reads = 0
    const readTitle = () => {
      reads++
      return title
    }
    const session = createRepositorySession(
      loaders({
        issue: async () => ({ ...issueDetailFixture, number: 1, title: readTitle() }),
        pull: async () => ({ ...pullFixture(), title: readTitle() }),
        issueReferences: async () => {
          if (kind === "issue") await hold()
          return []
        },
        pullContext: async () => {
          await hold()
          return structuredClone(pullContextFixture)
        },
      }),
      undefined,
      cacheOptions,
    )
    const open = () => (kind === "issue" ? session.loadIssue(1) : session.loadPull(1))
    const close = kind === "issue" ? session.clearIssue : session.clearPull
    const detail = kind === "issue" ? session.issueDetail : session.pullDetail
    await session.load(A)
    const pending = open()
    await started.promise
    expect(detail()?.resource.value?.title).toBe("Before refresh")
    title = "After refresh"
    await session.refresh()
    release.resolve()
    await pending
    close()
    await open()
    expect(reads).toBe(2)
    expect(detail()?.resource.value?.title).toBe(title)
    close()
    await open()
    expect(reads).toBe(2) // The post-refresh read is reusable.
  })

  test("an unrelated pending refresh resource cannot hide a pull created from another repository", async () => {
    const creationStarted = deferred<void>()
    const creation = deferred<void>()
    const refreshStarted = deferred<void>()
    const refreshTail = deferred<void>()
    let holdRefresh = false
    let created = false
    let listReads = 0
    let countReads = 0
    const pull = { ...pullFixture(903), title: "Created while target refresh was pending" }
    const session = createRepositorySession(
      loaders({
        pulls: async (repo, state) => {
          if (repo.nameWithOwner === A) listReads++
          return { items: repo.nameWithOwner === A && created && state === "open" ? [pull] : [], hasMore: false }
        },
        workCounts: async (repo) => {
          if (repo.nameWithOwner === A) countReads++
          return { issues: 0, pulls: repo.nameWithOwner === A && created ? 1 : 0 }
        },
        runs: async (repo) => {
          if (repo.nameWithOwner === A && holdRefresh) {
            refreshStarted.resolve()
            await refreshTail.promise
          }
          return { items: [], hasMore: false }
        },
        createPull: async (repo) => {
          expect(repo.id).toBe(repository(A).id)
          creationStarted.resolve()
          await creation.promise
          created = true
          return pull
        },
      }),
      undefined,
      cacheOptions,
    )
    await session.load(B)
    const creating = session.createPull(repository(A), { base: "main", head: "next", title: pull.title, body: pull.body })
    await creationStarted.promise
    await session.load(A)
    holdRefresh = true
    const refreshing = session.refresh()
    await refreshStarted.promise
    await until(() => {
      const { data } = ready(session)
      return data.pulls.open.status === "ready" && data.pulls.closed.status === "ready" && data.workCounts.status === "ready"
    })
    expect(ready(session).data.runs.status).toBe("loading")
    expect(ready(session).data.pulls.open.value?.items).toEqual([])
    expect(ready(session).data.workCounts.value?.pulls).toBe(0)
    const listsBeforeCreation = listReads
    const countsBeforeCreation = countReads

    creation.resolve()
    await creating
    // The write captured browsed repository B, so it cannot correct the now-active A overview.
    expect(listReads).toBe(listsBeforeCreation)
    expect(countReads).toBe(countsBeforeCreation)
    expect(ready(session).data.pulls.open.status).toBe("ready")
    expect(ready(session).data.workCounts.status).toBe("ready")
    holdRefresh = false
    refreshTail.resolve()
    await refreshing
    expect(ready(session).data.runs.status).toBe("ready")

    await session.load(B)
    await session.load(A)
    expect(listReads).toBe(listsBeforeCreation + 2)
    expect(countReads).toBe(countsBeforeCreation + 1)
    expect(ready(session).data.pulls.open).toMatchObject({ status: "ready", value: { items: [{ number: pull.number }] } })
    expect(ready(session).data.workCounts).toMatchObject({ status: "ready", value: { pulls: 1 } })
  })

  test("an unrelated pending refresh resource cannot hide pending post-create issue counts", async () => {
    const refreshStarted = deferred<void>()
    const refreshTail = deferred<void>()
    const countStarted = deferred<void>()
    const postCreateCount = deferred<void>()
    let holdRefresh = false
    let holdCounts = true
    let created = false
    let countReads = 0
    const issue = { ...structuredClone(issueDetailFixture), number: 904, title: "Created with pending counts" }
    const session = createRepositorySession(
      loaders({
        issues: async (repo, state) => ({
          items: repo.nameWithOwner === A && created && state === "open" ? [issue] : [],
          hasMore: false,
        }),
        workCounts: async (repo) => {
          if (repo.nameWithOwner === A) {
            countReads++
            if (created && holdCounts) {
              countStarted.resolve()
              await postCreateCount.promise
            }
          }
          return { issues: repo.nameWithOwner === A && created ? 1 : 0, pulls: 0 }
        },
        runs: async (repo) => {
          if (repo.nameWithOwner === A && holdRefresh) {
            refreshStarted.resolve()
            await refreshTail.promise
          }
          return { items: [], hasMore: false }
        },
        createIssue: async () => {
          created = true
          return issue
        },
      }),
      undefined,
      cacheOptions,
    )
    await session.load(A)
    holdRefresh = true
    const refreshing = session.refresh()
    await refreshStarted.promise
    await until(() => {
      const { data } = ready(session)
      return data.issues.open.status === "ready" && data.issues.closed.status === "ready" && data.workCounts.status === "ready"
    })
    expect(ready(session).data.workCounts.value?.issues).toBe(0)
    await session.createIssue(issue.title, issue.body)
    await countStarted.promise
    await until(() => {
      const resource = ready(session).data.issues.open
      return resource.status === "ready" && resource.value?.items.some((item) => item.number === issue.number) === true
    })
    // The post-create list has settled, but fetchWorkCounts leaves its old ready state while pending.
    expect(ready(session).data.workCounts).toMatchObject({ status: "ready", value: { issues: 0 } })
    expect(ready(session).data.runs.status).toBe("loading")
    holdRefresh = false
    refreshTail.resolve()
    await refreshing
    expect(ready(session).data.runs.status).toBe("ready")
    const countsBeforeReturn = countReads
    holdCounts = false
    try {
      await session.load(B)
      await session.load(A)
      expect(countReads).toBe(countsBeforeReturn + 1)
      expect(ready(session).data.workCounts).toMatchObject({ status: "ready", value: { issues: 1 } })
      expect(ready(session).data.issues.open).toMatchObject({ status: "ready", value: { items: [{ number: issue.number }] } })
    } finally {
      postCreateCount.resolve()
    }
  })

  test.each(["issue", "pull"] as const)(
    "an older refresh cannot freshen the overview while newer post-%s-close reads are pending",
    async (parent) => {
      const section = parent === "issue" ? "issues" : "pulls"
      const oldReads = heldOverviewReads()
      const postWriteReads = heldOverviewReads()
      let phase: "initial" | "refresh" | "post-write" | "return" = "initial"
      let closed = false
      let countReads = 0
      let listReads = 0
      const issue = { ...structuredClone(issueDetailFixture), number: 1 }
      const pull = pullFixture()
      const waitForRead = async (name: string) => {
        if (name !== A) return
        if (phase === "refresh") await oldReads.wait()
        if (phase === "post-write") await postWriteReads.wait()
      }
      const session = createRepositorySession(
        loaders({
          issue: async () => ({ ...issue, state: closed ? "closed" : "open" }),
          pull: async () => ({ ...pull, state: closed ? "closed" : "open" }),
          issues: async (repo, state) => {
            if (parent !== "issue") return { items: [], hasMore: false }
            const wasClosed = closed
            if (repo.nameWithOwner === A) listReads++
            await waitForRead(repo.nameWithOwner)
            return {
              items: repo.nameWithOwner === A && state === (wasClosed ? "closed" : "open") ? [{ ...issue, state }] : [],
              hasMore: false,
            }
          },
          pulls: async (repo, state) => {
            if (parent !== "pull") return { items: [], hasMore: false }
            const wasClosed = closed
            if (repo.nameWithOwner === A) listReads++
            await waitForRead(repo.nameWithOwner)
            return {
              items: repo.nameWithOwner === A && state === (wasClosed ? "closed" : "open") ? [{ ...pull, state }] : [],
              hasMore: false,
            }
          },
          workCounts: async (repo) => {
            const wasClosed = closed
            if (repo.nameWithOwner === A) countReads++
            await waitForRead(repo.nameWithOwner)
            return {
              issues: parent === "issue" && repo.nameWithOwner === A && !wasClosed ? 1 : 0,
              pulls: parent === "pull" && repo.nameWithOwner === A && !wasClosed ? 1 : 0,
            }
          },
          updateIssueState: async () => {
            closed = true
            return { ...issue, state: "closed" }
          },
          updatePullState: async () => {
            closed = true
            return { ...pull, state: "closed" }
          },
        }),
        undefined,
        cacheOptions,
      )
      await session.load(A)
      if (parent === "issue") await session.loadIssue(1)
      else await session.loadPull(1)
      expect(ready(session).data.workCounts.value?.[section]).toBe(1)

      phase = "refresh"
      const refreshing = session.refresh()
      await oldReads.started
      phase = "post-write"
      await session.submitIssueAction(1, "close", parent)
      await postWriteReads.started
      expect(ready(session).data.workCounts.status).toBe("loading")

      // The older refresh finishes, but none of the confirmed write's reads has finished.
      phase = "return"
      oldReads.release()
      await refreshing
      const countsBeforeReturn = countReads
      const listsBeforeReturn = listReads
      try {
        await session.load(B)
        await session.load(A)
        expect(countReads).toBe(countsBeforeReturn + 1)
        expect(listReads).toBe(listsBeforeReturn + 2)
        expect(ready(session).data.workCounts).toMatchObject({ status: "ready", value: { [section]: 0 } })
        expect(ready(session).data[section].open.value?.items).toEqual([])
        expect(ready(session).data[section].closed.value?.items).toMatchObject([{ number: 1, state: "closed" }])
      } finally {
        postWriteReads.release()
      }
    },
  )

  test.each([
    ["issue", "browsed"],
    ["pull", "browsed"],
    ["pull", "other"],
  ] as const)("a deferred create %s for the %s repository invalidates its offscreen overview", async (parent, target) => {
    const section = parent === "issue" ? "issues" : "pulls"
    const pending = deferred<void>()
    let created = false
    const writes: string[] = []
    const reads: Record<string, number> = {}
    const count = (name: string, resource: string) => {
      const key = `${name}:${resource}`
      reads[key] = (reads[key] ?? 0) + 1
    }
    const issue = { ...structuredClone(issueDetailFixture), number: 901, title: "Created issue" }
    const pull = { ...pullFixture(902), title: "Created pull" }
    const session = createRepositorySession(
      loaders({
        metadata: async (name) => {
          count(name, "metadata")
          return repository(name)
        },
        issues: async (repo, state) => {
          count(repo.nameWithOwner, `issues:${state}`)
          return { items: parent === "issue" && repo.nameWithOwner === A && created && state === "open" ? [issue] : [], hasMore: false }
        },
        pulls: async (repo, state) => {
          count(repo.nameWithOwner, `pulls:${state}`)
          return { items: parent === "pull" && repo.nameWithOwner === A && created && state === "open" ? [pull] : [], hasMore: false }
        },
        workCounts: async (repo) => {
          count(repo.nameWithOwner, "counts")
          return {
            issues: parent === "issue" && repo.nameWithOwner === A && created ? 1 : 0,
            pulls: parent === "pull" && repo.nameWithOwner === A && created ? 1 : 0,
          }
        },
        createIssue: async (repo) => {
          writes.push(repo.nameWithOwner)
          await pending.promise
          created = true
          return issue
        },
        createPull: async (repo) => {
          writes.push(repo.nameWithOwner)
          await pending.promise
          created = true
          return pull
        },
      }),
      undefined,
      cacheOptions,
    )
    await session.load(A)
    if (target === "other") await session.load(B)
    const creating =
      parent === "issue"
        ? session.createIssue(issue.title, issue.body)
        : session.createPull(repository(A), { base: "main", head: "next", title: pull.title, body: pull.body })
    expect(writes).toEqual([A])
    const away = target === "other" ? C : B
    await session.load(away)
    const offscreen = session.state()
    const before = { ...reads }
    pending.resolve()
    await creating
    expect(session.state()).toBe(offscreen)

    await session.load(A)
    for (const resource of [`${section}:open`, `${section}:closed`, "counts"]) {
      expect(reads[`${A}:${resource}`]).toBe(before[`${A}:${resource}`]! + 1)
    }
    expect(ready(session).data[section].open.value?.items).toMatchObject([
      { number: parent === "issue" ? issue.number : pull.number, title: parent === "issue" ? issue.title : pull.title },
    ])
    expect(ready(session).data.workCounts).toMatchObject({ status: "ready", value: { [section]: 1 } })
    // Neither the repository browsed during creation nor the one active at confirmation was written to.
    await session.load(B)
    if (target === "other") await session.load(C)
    for (const name of [B, ...(target === "other" ? [C] : [])]) {
      for (const resource of ["metadata", "counts", `${section}:open`, `${section}:closed`]) {
        expect(reads[`${name}:${resource}`]).toBe(before[`${name}:${resource}`])
      }
    }
  })
})

describe("reaction cache regressions", () => {
  test.each(
    (["issue", "pull"] as const).flatMap((parent) =>
      (["resource", "comment"] as const).flatMap((subject) =>
        (["before", "after"] as const).map((finish) => [parent, subject, finish] as const),
      ),
    ),
  )("%s %s reactions revalidate when the returning reload finishes %s confirmation", async (parent, subject, finish) => {
    const pending = deferred<void>()
    const started = deferred<void>()
    const tailStarted = deferred<void>()
    const tailRead = deferred<void>()
    let holdTail = false
    let reacted = false
    let detailReads = 0
    const reactionState = (): ReactionState => ({
      reactions: reacted ? { heart: 1 } : {},
      viewerReactions: reacted ? ["heart"] : [],
      canReact: true,
    })
    const session = createRepositorySession(
      loaders({
        issue: async (_repo, number) => {
          detailReads++
          return { ...structuredClone(issueDetailFixture), number, nodeId: "I_1", ...reactionState() }
        },
        pull: async (_repo, number) => {
          detailReads++
          return { ...pullFixture(number), nodeId: "PR_1", ...reactionState() }
        },
        issueComments: async () => ({
          items: [{ ...structuredClone(issueCommentsFixture[0]!), nodeId: "IC_101", ...reactionState() }],
          hasMore: false,
        }),
        issueReferences: async () => {
          if (parent === "issue" && holdTail) {
            tailStarted.resolve()
            await tailRead.promise
          }
          return []
        },
        pullContext: async () => {
          if (parent === "pull" && holdTail) {
            tailStarted.resolve()
            await tailRead.promise
          }
          return structuredClone(pullContextFixture)
        },
        addReaction: async () => {
          started.resolve()
          await pending.promise
          reacted = true
          return reactionState()
        },
      }),
      undefined,
      cacheOptions,
    )
    const load = () => (parent === "issue" ? session.loadIssue(1) : session.loadPull(1))
    const clear = () => (parent === "issue" ? session.clearIssue() : session.clearPull())
    const detail = () => (parent === "issue" ? session.issueDetail() : session.pullDetail())
    const reactions = () => (subject === "resource" ? detail()?.resource.value?.reactions : detail()?.comments.value?.items[0]?.reactions)
    const target: ReactionTarget = subject === "resource" ? { kind: parent, number: 1 } : { kind: "comment", parent, number: 1, id: 101 }
    await session.load(A)
    await load()
    const reacting = session.addReaction(target, "heart")
    await started.promise
    await session.load(B)
    await session.load(A)
    holdTail = finish === "after"
    const reloading = load()
    if (holdTail) {
      // Detail metadata is already published, but references/context prevent retention from finishing.
      await tailStarted.promise
      expect(detail()?.resource.status).toBe("ready")
      expect(parent === "issue" ? session.issueDetail()?.references.status : session.pullDetail()?.context.status).toBe("loading")
    } else {
      await reloading
    }
    expect(detailReads).toBe(2)
    expect(reactions()).toEqual({})
    pending.resolve()
    await reacting
    holdTail = false
    tailRead.resolve()
    await reloading
    clear()
    await load()
    expect(detailReads).toBe(3)
    expect(reactions()).toEqual({ heart: 1 })
  })
})

function auxiliaryValues(version: number) {
  const repo = { ...repository(A), defaultBranch: `branch-${version}` }
  return {
    issueTemplates: [{ name: `Issue ${version}`, about: "Regression", title: `Title ${version}`, body: `Body ${version}` }],
    pullTemplates: [{ filename: `PULL_REQUEST_TEMPLATE_${version}.md`, body: `Body ${version}` }],
    pullRepositories: { bases: [repo], heads: [repo] },
  }
}

type AuxiliaryKind = keyof ReturnType<typeof auxiliaryValues>

function auxiliarySession(kind: AuxiliaryKind, wait: (call: number) => Promise<void> = async () => {}) {
  const source = { version: 1, calls: 0 }
  const read = async <K extends AuxiliaryKind>(key: K) => {
    const version = source.version
    await wait(++source.calls)
    return auxiliaryValues(version)[key]
  }
  const session = createRepositorySession(
    loaders({
      issueTemplates: () => read("issueTemplates"),
      pullTemplates: () => read("pullTemplates"),
      pullRepositories: () => read("pullRepositories"),
    }),
    undefined,
    cacheOptions,
  )
  const load = () => {
    if (kind === "issueTemplates") return session.loadIssueTemplates()
    if (kind === "pullTemplates") return session.loadPullTemplates(repository(A))
    return session.loadPullRepositories()
  }
  return { session, source, load }
}

describe("auxiliary repository cache regressions", () => {
  test.each(["issueTemplates", "pullTemplates", "pullRepositories"] as const)("refresh invalidates cached %s", async (kind) => {
    const { session, source, load } = auxiliarySession(kind)
    await session.load(A)
    expect(await load()).toEqual(auxiliaryValues(1)[kind])
    expect(await load()).toEqual(auxiliaryValues(1)[kind])
    expect(source.calls).toBe(1)
    source.version = 2
    await session.refresh()
    expect(await load()).toEqual(auxiliaryValues(2)[kind])
    expect(source.calls).toBe(2)
  })

  test.each(["issueTemplates", "pullTemplates", "pullRepositories"] as const)(
    "a rejected pre-refresh %s promise cannot evict its newer pending replacement",
    async (kind) => {
      const oldRead = deferred<void>()
      const newRead = deferred<void>()
      const { session, source, load } = auxiliarySession(kind, async (call) => {
        if (call === 1) await oldRead.promise
        if (call === 2) await newRead.promise
      })
      await session.load(A)
      const old = load()
      const failure = new Error("Retired auxiliary read")
      const rejected = old.catch((error: unknown) => error)
      source.version = 2
      await session.refresh()
      const newer = load()
      const result = newer.catch(() => undefined)
      const callsAfterRefresh = source.calls
      oldRead.reject(failure)
      expect(await rejected).toBe(failure)
      // Reuse must happen while the replacement is still pending, not after it has resolved.
      const reused = load()
      const callsAfterRejection = source.calls
      newRead.resolve()
      const value = await result
      await reused
      expect(callsAfterRefresh).toBe(2)
      expect(reused).toBe(newer)
      expect(callsAfterRejection).toBe(2)
      expect(value).toEqual(auxiliaryValues(2)[kind])
    },
  )
})
