import { describe, expect, test } from "bun:test"
import type { CommitSummary } from "../src/models"
import type { RepositoryLoaders } from "../src/repository-session"
import { createRepositorySession } from "../src/repository-session"
import { githubDataFixture } from "./fixtures/github-data"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function loaders(overrides: Partial<RepositoryLoaders> = {}): RepositoryLoaders {
  return {
    metadata: async () => structuredClone(githubDataFixture.repo),
    readme: async () => githubDataFixture.readme.value!,
    contributing: async () => githubDataFixture.contributing.value,
    security: async () => githubDataFixture.security.value,
    license: async () => githubDataFixture.license.value,
    branches: async () => ({ items: structuredClone(githubDataFixture.branches.value!.items), hasMore: false }),
    commits: async () => ({ items: structuredClone(githubDataFixture.commits.value!.items), hasMore: false }),
    issues: async (_repository, state) => ({ items: structuredClone(githubDataFixture.issues[state].value!.items), hasMore: false }),
    pulls: async (_repository, state) => ({ items: structuredClone(githubDataFixture.pulls[state].value!.items), hasMore: false }),
    runs: async () => ({ items: structuredClone(githubDataFixture.runs.value!.items), hasMore: false }),
    ...overrides,
  }
}

function ready(session: ReturnType<typeof createRepositorySession>) {
  const state = session.state()
  if (state.status !== "ready") throw new Error(`Expected ready state, got ${state.status}`)
  return state
}

describe("repository session", () => {
  test("renders metadata before child resources settle", async () => {
    const pending = deferred<{ items: CommitSummary[]; hasMore: boolean }>()
    let metadataCalls = 0
    const session = createRepositorySession(loaders({
      metadata: async () => {
        metadataCalls++
        return structuredClone(githubDataFixture.repo)
      },
      commits: async () => pending.promise,
    }))

    const load = session.load("anomalyco/opentui")
    await Promise.resolve()
    await Promise.resolve()

    const state = ready(session)
    expect(state.data.repo.nameWithOwner).toBe("anomalyco/opentui")
    expect(state.data.commits.status).toBe("loading")
    expect(state.data.readme.status).toBe("ready")
    await session.refresh()
    expect(metadataCalls).toBe(1)

    pending.resolve({ items: [], hasMore: false })
    await load
    expect(ready(session).data.commits.status).toBe("ready")
  })

  test("keeps resource failures independent", async () => {
    const session = createRepositorySession(loaders({
      issues: async (_repository, state) => {
        if (state === "open") throw new Error("Open issues unavailable")
        return { items: [], hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    const state = ready(session)
    expect(state.data.issues.open.status).toBe("error")
    expect(state.data.issues.closed.status).toBe("ready")
    expect(state.data.commits.status).toBe("ready")
    expect(state.data.pulls.open.status).toBe("ready")
  })

  test("retries only the selected resource", async () => {
    let issueCalls = 0
    let runCalls = 0
    const session = createRepositorySession(loaders({
      issues: async (_repository, state) => {
        issueCalls++
        if (state === "open" && issueCalls === 1) throw new Error("Temporary failure")
        return { items: [], hasMore: false }
      },
      runs: async () => {
        runCalls++
        return { items: [], hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    const initialRuns = runCalls
    await session.retryResource({ kind: "issues", state: "open" })
    expect(ready(session).data.issues.open.status).toBe("ready")
    expect(runCalls).toBe(initialRuns)
  })

  test("ignores older repository resources", async () => {
    const firstCommits = deferred<{ items: CommitSummary[]; hasMore: boolean }>()
    const session = createRepositorySession(loaders({
      metadata: async (repository) => ({ ...githubDataFixture.repo, nameWithOwner: repository }),
      commits: async (repository) => repository === "first/repository"
        ? firstCommits.promise
        : { items: [], hasMore: false },
    }))

    const first = session.load("first/repository")
    await Promise.resolve()
    await session.load("second/repository")
    firstCommits.resolve({
      items: [{ sha: "stale", message: "stale", author: "ghost", date: "" }],
      hasMore: false,
    })
    await first

    const state = ready(session)
    expect(state.repository).toBe("second/repository")
    expect(state.data.commits.value?.items).toEqual([])
  })

  test("refresh retains stale values when one resource fails", async () => {
    let failRuns = false
    const session = createRepositorySession(loaders({
      runs: async () => {
        if (failRuns) throw new Error("Runs unavailable")
        return { items: structuredClone(githubDataFixture.runs.value!.items), hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    const oldRuns = ready(session).data.runs.value
    failRuns = true
    await session.refresh()

    const state = ready(session)
    expect(state.data.runs.status).toBe("error")
    expect(state.data.runs.value).toEqual(oldRuns)
    expect(state.data.commits.status).toBe("ready")
  })

  test("retries an initial branch failure from page one", async () => {
    const pages: number[] = []
    const session = createRepositorySession(loaders({
      branches: async (_repository, _fallback, page = 1) => {
        pages.push(page)
        if (pages.length === 1) throw new Error("Branches unavailable")
        return { items: ["main"], hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    const failed = ready(session).data.branches
    expect(failed.status).toBe("error")
    if (failed.status !== "error") throw new Error("Expected initial branch error")
    expect(failed.phase).toBe("load")

    await session.retryResource({ kind: "branches" })
    expect(pages).toEqual([1, 1])
    expect(ready(session).data.branches.value).toEqual({ items: ["main"], page: 1, hasMore: false })
  })

  test("paginates branches with deduplication and blocks duplicate requests", async () => {
    let calls = 0
    const pending = deferred<{ items: string[]; hasMore: boolean }>()
    const session = createRepositorySession(loaders({
      branches: async (_repository, _fallback, page) => {
        calls++
        return page === 2 ? pending.promise : { items: ["main", "shared"], hasMore: true }
      },
    }))

    await session.load("anomalyco/opentui")
    const pagination = session.loadMoreBranches()
    void session.loadMoreBranches()
    const loading = ready(session).data.branches
    expect(calls).toBe(2)
    expect(loading.status).toBe("loading")
    expect(loading.value?.items).toEqual(["main", "shared"])

    pending.resolve({ items: ["shared", "next", "next"], hasMore: false })
    await pagination

    const branches = ready(session).data.branches
    expect(branches.status).toBe("ready")
    expect(branches.value).toEqual({ items: ["main", "shared", "next"], page: 2, hasMore: false })
  })

  test("retries failed branch pagination without discarding loaded branches", async () => {
    let secondPageCalls = 0
    const session = createRepositorySession(loaders({
      branches: async (_repository, _fallback, page) => {
        if (page !== 2) return { items: ["main"], hasMore: true }
        secondPageCalls++
        if (secondPageCalls === 1) throw new Error("Branches unavailable")
        return { items: ["next"], hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    await session.loadMoreBranches()
    const failed = ready(session).data.branches
    expect(failed.status).toBe("error")
    if (failed.status !== "error") throw new Error("Expected branch pagination error")
    expect(failed.phase).toBe("pagination")
    expect(failed.value?.items).toEqual(["main"])

    await session.retryResource({ kind: "branches" })
    const branches = ready(session).data.branches
    expect(secondPageCalls).toBe(2)
    expect(branches.status).toBe("ready")
    expect(branches.value).toEqual({ items: ["main", "next"], page: 2, hasMore: false })
  })

  test("paginates with full-SHA deduplication and blocks duplicates", async () => {
    const first = structuredClone(githubDataFixture.commits.value!.items[0]!)
    let calls = 0
    const pending = deferred<{ items: CommitSummary[]; hasMore: boolean }>()
    const session = createRepositorySession(loaders({
      commits: async (_repository, _branch, page) => {
        calls++
        return page === 2 ? pending.promise : { items: [first], hasMore: true }
      },
    }))

    await session.load("anomalyco/opentui")
    const pagination = session.loadMoreCommits()
    void session.loadMoreCommits()
    expect(calls).toBe(2)
    pending.resolve({
      items: [first, { sha: "b".repeat(40), message: "next", author: "octocat", date: "" }],
      hasMore: false,
    })
    await pagination

    const commits = ready(session).data.commits.value!
    expect(commits.items).toHaveLength(2)
    expect(commits.items[0]?.sha).toHaveLength(40)
    expect(commits.page).toBe(2)
  })

  test("retries the failed pagination page without discarding loaded items", async () => {
    let secondPageCalls = 0
    const session = createRepositorySession(loaders({
      commits: async (_repository, _branch, page) => {
        if (page !== 2) return { items: [structuredClone(githubDataFixture.commits.value!.items[0]!)], hasMore: true }
        secondPageCalls++
        if (secondPageCalls === 1) throw new Error("Page unavailable")
        return {
          items: [{ sha: "c".repeat(40), message: "retried", author: "octocat", date: "" }],
          hasMore: false,
        }
      },
    }))

    await session.load("anomalyco/opentui")
    await session.loadMoreCommits()
    expect(ready(session).data.commits.status).toBe("error")
    await session.retryResource({ kind: "commits" })

    const commits = ready(session).data.commits
    expect(secondPageCalls).toBe(2)
    expect(commits.status).toBe("ready")
    expect(commits.value?.page).toBe(2)
    expect(commits.value?.items.map((commit) => commit.message)).toEqual(["fix: avoid duplicate key events", "retried"])
  })

  test("refreshes every page already loaded", async () => {
    const pages: number[] = []
    const session = createRepositorySession(loaders({
      commits: async (_repository, _branch, page = 1) => {
        pages.push(page)
        return {
          items: [{ sha: String(page).repeat(40), message: `page ${page}`, author: "octocat", date: "" }],
          hasMore: page === 1,
        }
      },
    }))

    await session.load("anomalyco/opentui")
    await session.loadMoreCommits()
    pages.length = 0
    await session.refresh()

    expect(pages).toEqual([1, 2])
    expect(ready(session).data.commits.value?.items.map((commit) => commit.message)).toEqual(["page 1", "page 2"])
    expect(ready(session).data.commits.value?.page).toBe(2)
  })

  test("ignores stale pagination after changing repositories", async () => {
    const pending = deferred<{ items: CommitSummary[]; hasMore: boolean }>()
    const session = createRepositorySession(loaders({
      metadata: async (repository) => ({ ...githubDataFixture.repo, nameWithOwner: repository }),
      commits: async (repository, _branch, page) => page === 2
        ? pending.promise
        : { items: [{ sha: repository.padEnd(40, "0"), message: repository, author: "octocat", date: "" }], hasMore: true },
    }))

    await session.load("first/repository")
    const pagination = session.loadMoreCommits()
    await session.load("second/repository")
    pending.reject(new Error("Old repository failed"))
    await pagination

    const state = ready(session)
    expect(state.repository).toBe("second/repository")
    expect(state.data.commits.status).toBe("ready")
    expect(state.data.commits.value?.items[0]?.message).toBe("second/repository")
  })

  test("does not switch branches while commit pagination is loading", async () => {
    const pending = deferred<{ items: CommitSummary[]; hasMore: boolean }>()
    let branchLoads = 0
    const session = createRepositorySession(loaders({
      commits: async (_repository, branch, page) => {
        if (page === 2) return pending.promise
        if (branch === "next") branchLoads++
        return { items: structuredClone(githubDataFixture.commits.value!.items), hasMore: true }
      },
    }))

    await session.load("anomalyco/opentui")
    expect(session.canSwitchBranch()).toBe(true)
    const pagination = session.loadMoreCommits()
    expect(session.canSwitchBranch()).toBe(false)
    await session.switchBranch("next")
    expect(branchLoads).toBe(0)
    pending.resolve({ items: [], hasMore: false })
    await pagination
    expect(ready(session).data.commits.status).toBe("ready")
    expect(session.canSwitchBranch()).toBe(true)
  })

  test("does not retry resources during refresh", async () => {
    const metadata = deferred<typeof githubDataFixture.repo>()
    let metadataCalls = 0
    let issueCalls = 0
    const session = createRepositorySession(loaders({
      metadata: async () => {
        metadataCalls++
        return metadataCalls === 1 ? structuredClone(githubDataFixture.repo) : metadata.promise
      },
      issues: async (_repository, state) => {
        if (state === "open") issueCalls++
        return { items: [], hasMore: false }
      },
    }))

    await session.load("anomalyco/opentui")
    const refresh = session.refresh()
    await session.retryResource({ kind: "issues", state: "open" })
    expect(issueCalls).toBe(1)
    metadata.resolve(structuredClone(githubDataFixture.repo))
    await refresh
    expect(issueCalls).toBe(2)
  })

  test("reloads optional documents without letting their failures block branch switching", async () => {
    const session = createRepositorySession(loaders({
      contributing: async (_repository, branch) => branch === "next" ? "next contributing" : "main contributing",
      security: async (_repository, branch) => {
        if (branch === "next") throw new Error("Security unavailable")
        return "main security"
      },
    }))

    await session.load("anomalyco/opentui")
    await session.switchBranch("next")
    const state = ready(session)
    expect(state.data.currentBranch).toBe("next")
    expect(state.data.contributing.value).toBe("next contributing")
    expect(state.data.security.status).toBe("error")
  })

  test("keeps branch switching atomic", async () => {
    const session = createRepositorySession(loaders({
      readme: async (_repository, branch) => {
        if (branch === "next") throw new Error("README unavailable")
        return "main readme"
      },
    }))

    await session.load("anomalyco/opentui")
    await session.switchBranch("next")
    const state = ready(session)
    expect(state.data.currentBranch).toBe("main")
    expect(state.operations.branch.status).toBe("error")
  })
})
