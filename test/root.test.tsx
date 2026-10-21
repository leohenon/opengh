import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { defaultConfig, type Config } from "../src/config"
import type { RepositoryState } from "../src/repository-state"
import { Root } from "../src/root"
import { GitHubApiError } from "../src/github/transport"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

function readySession() {
  const [state] = createSignal<RepositoryState>({
    status: "ready",
    repository: "cli/cli",
    data: structuredClone(githubDataFixture),
    operations: structuredClone(repositoryOperationsFixture),
  })
  const idle = async () => {}
  return {
    state,
    runDetail: () => undefined,
    loadRun: idle,
    loadMoreRunJobs: idle,
    clearRun: () => {},
    commitDetail: () => undefined,
    loadCommit: idle,
    loadMoreCommitFiles: idle,
    clearCommit: () => {},
    issueDetail: () => undefined,
    loadIssue: idle,
    loadMoreIssueComments: idle,
    retryIssueReferences: idle,
    clearIssue: () => {},
    issueAction: () => ({ body: "", reason: "completed" as const, operation: { status: "idle" as const } }),
    prepareIssueAction: () => {},
    updateIssueDraft: () => {},
    discardIssueDraft: () => {},
    submitIssueAction: async () => ({}),
    pullDetail: () => undefined,
    loadPull: idle,
    loadMorePullComments: idle,
    retryPullReferences: idle,
    retryPullCommits: idle,
    retryPullContext: idle,
    clearPull: () => {},
    load: idle,
    refresh: idle,
    retryResource: idle,
    canSwitchBranch: () => true,
    switchBranch: idle,
    loadMoreBranches: idle,
    loadMoreCommits: idle,
    loadMoreRuns: idle,
    loadMoreIssues: idle,
    loadMorePulls: idle,
  }
}

describe("application root", () => {
  test("resolves startup services before showing the repository picker", async () => {
    const resolution = deferred<string | undefined>()
    let receivedArgument: string | undefined
    let receivedCwd = ""

    const view = await testRender(
      () => (
        <Root
          repositoryArgument="."
          cwd="/work/repository"
          services={{
            resolveRepository: (argument, cwd) => {
              receivedArgument = argument
              receivedCwd = cwd
              return resolution.promise
            },
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            loadRecentRepositories: async () => ["cli/cli"],
            loadConfig: async () => ({ ...defaultConfig }),
          }}
        />
      ),
      { width: 80, height: 24 },
    )
    active.push(view)
    await view.flush()

    expect(view.captureCharFrame()).toContain("opengh")
    expect(receivedArgument).toBe(".")
    expect(receivedCwd).toBe("/work/repository")

    resolution.resolve(undefined)
    await Bun.sleep(0)
    await view.flush()

    const picker = view.captureCharFrame()
    expect(picker).toContain("Open a GitHub repository")
    expect(picker).toContain("cli / cli")
    expect(picker).toContain("No GitHub repository found")

    view.mockInput.pressCtrlC()
    expect(view.renderer.isDestroyed).toBe(true)
  })

  test("shows repository discovery authentication errors instead of hanging or claiming no repository exists", async () => {
    const error = new GitHubApiError("repository discovery", "Bad credentials (HTTP 401)")
    const view = await testRender(
      () => <Root repositoryArgument="." cwd="/work/repository" services={{
        resolveRepository: async () => { throw error },
        resolveLocalRepository: async () => undefined,
        loadRepositoryTabs: async () => ({}),
        saveRepositoryTabs: async () => {},
        rememberRepository: async () => {},
        loadRecentRepositories: async () => ["cli/cli"],
        loadConfig: async () => ({ ...defaultConfig }),
        createRepositorySession: readySession,
      }} />,
      { width: 80, height: 24 },
    )
    active.push(view)
    await Bun.sleep(0)
    await view.flush()
    const frame = view.captureCharFrame()
    expect(frame).toContain("Open a GitHub repository")
    expect(frame).toContain("Bad credentials")
    expect(frame).toContain("cli / cli")
    expect(frame).not.toContain("No GitHub repository found")
    for (const word of error.message.split(/\s+/)) expect(frame).toContain(word)
  })

  test("warns and prevents overwriting config when loading fails", async () => {
    let saves = 0
    const view = await testRender(
      () => (
        <Root
          cwd="/work/repository"
          services={{
            resolveRepository: async () => undefined,
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            loadRecentRepositories: async () => [],
            loadConfig: async () => { throw new Error("Malformed config") },
            saveConfig: async () => { saves++ },
            rememberRepository: async () => {},
            createRepositorySession: readySession,
          }}
        />
      ),
      { width: 80, height: 24 },
    )
    active.push(view)
    await Bun.sleep(0)
    await view.flush()

    expect(view.captureCharFrame()).toContain("Open a GitHub repository")
    expect(view.captureCharFrame()).toContain("Malformed config")

    await view.mockInput.typeText("cli/cli")
    view.mockInput.pressEnter()
    await view.flush()
    view.mockInput.pressKey(",")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Malformed config")
    view.mockInput.pressArrow("down")
    view.mockInput.pressArrow("right")
    await view.flush()
    expect(saves).toBe(0)
    expect(view.captureCharFrame()).toContain("‹ off ›")
  })

  test("persists settings before applying them and blocks edits or cancellation while saving", async () => {
    const saved: Config[] = []
    const writes = [deferred<void>(), deferred<void>()]
    const idle = async () => {}
    const view = await testRender(
      () => (
        <Root
          repositoryArgument="cli/cli"
          cwd="/work/repository"
          services={{
            resolveRepository: async () => "cli/cli",
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            loadRecentRepositories: async () => [],
            rememberRepository: idle,
            loadConfig: async () => ({ showScrollbars: false, theme: "github", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }),
            saveConfig: async (config) => {
              saved.push(config)
              await writes[saved.length - 1]!.promise
            },
            createRepositorySession: readySession,
          }}
        />
      ),
      { width: 120, height: 32 },
    )
    active.push(view)
    await Bun.sleep(0)
    await view.flush()

    view.mockInput.pressKey(",")
    view.mockInput.pressArrow("down")
    view.mockInput.pressArrow("right")
    await Bun.sleep(0)
    await view.flush()

    expect(saved).toEqual([{ showScrollbars: true, theme: "github", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }])
    expect(view.captureCharFrame()).toContain("‹ off ›")
    expect(view.captureCharFrame()).not.toContain("Saving…")

    view.mockInput.pressEscape()
    await Bun.sleep(30)
    view.mockInput.pressArrow("up")
    view.mockInput.pressEnter()
    await view.flush()
    expect(view.captureCharFrame()).toContain("Settings")
    expect(view.captureCharFrame()).not.toContain("Search themes")
    expect(saved).toHaveLength(1)

    writes[0]!.resolve()
    await view.flush()
    expect(view.captureCharFrame()).toContain("‹ on ›")

    view.mockInput.pressArrow("up")
    view.mockInput.pressEnter()
    await view.flush()
    await view.mockInput.typeText("nord")
    view.mockInput.pressEnter()
    await view.flush()
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Themes")
    expect(view.captureCharFrame()).not.toContain("Saving…")
    expect(saved[1]).toEqual({ showScrollbars: true, theme: "nord", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" })

    writes[1]!.resolve()
    await view.flush()
    expect(view.captureCharFrame()).toContain("Settings")
    expect(view.captureCharFrame()).toContain("‹ nord ›")
    expect(view.captureCharFrame()).toContain("‹ on ›")
  })
})

test("always remembers a main tab per repository and restores it on direct open", async () => {
  const [state, setState] = createSignal<RepositoryState>({ status: "loading", repository: "cli/cli" })
  const session = { ...readySession(), state, load: async (repository: string) => {
    setState({ status: "ready", repository, data: {
      ...structuredClone(githubDataFixture), repo: { ...githubDataFixture.repo, nameWithOwner: repository },
    }, operations: structuredClone(repositoryOperationsFixture) })
  } }
  let saved: Record<string, import("../src/navigation").Page> = { "cli/cli": "issues", "owner/other": "pulls" }
  let writes = 0
  const firstSave = deferred<void>()
  const view = await testRender(() => <Root cwd="/work" repositoryArgument="cli/cli" services={{
    resolveRepository: async (argument) => argument,
    resolveLocalRepository: async () => undefined,
    loadRecentRepositories: async () => [], rememberRepository: async () => {},
    loadRepositoryTabs: async () => ({ ...saved }),
    saveRepositoryTabs: async (tabs) => {
      if (++writes === 1) await firstSave.promise
      saved = { ...saved, ...tabs }
    },
    loadConfig: async () => ({ ...defaultConfig, showStatusBarHints: true }), saveConfig: async () => {},
    createRepositorySession: () => session,
  }} />, { width: 120, height: 32 })
  const settle = async () => { await Bun.sleep(0); await view.flush() }
  const switchTo = async (repository: string) => {
    view.mockInput.pressKey("s")
    await settle()
    await view.mockInput.typeText(repository)
    view.mockInput.pressEnter()
    await settle()
  }
  try {
    await settle()
    expect(view.captureCharFrame()).toContain("ScrollBox loses focus") // Restored Issues, not Overview.
    view.mockInput.pressKey("2")
    await settle()
    await switchTo("owner/other")
    expect(view.captureCharFrame()).toContain("retain focused child") // Independent saved PR tab.
    await switchTo("CLI/CLI")
    expect(view.captureCharFrame()).toContain("cad92f4") // Restored Commits, case-insensitively.
    expect(writes).toBe(0) // Navigation saves are debounced.
    await Bun.sleep(280)
    expect(writes).toBe(1)
    // Changing away and back during an in-flight save must leave the newer update pending.
    view.mockInput.pressKey("3")
    await settle()
    view.mockInput.pressKey("2")
    await settle()
    firstSave.resolve()
    await Bun.sleep(280)
    expect(writes).toBe(2)
    expect(saved["cli/cli"]).toBe("commits")

    await switchTo("owner/new")
    expect(view.captureCharFrame()).toContain("About") // First visit starts on Overview.
    view.mockInput.pressKey("3")
    await settle()
    await switchTo("owner/other")
    expect(view.captureCharFrame()).toContain("retain focused child") // Other repo keeps its PR tab.
    await switchTo("owner/new")
    expect(view.captureCharFrame()).toContain("ScrollBox loses focus") // New repo now remembers Issues.

    await switchTo("cli/cli")
    expect(view.captureCharFrame()).toContain("cad92f4")
    view.mockInput.pressKey("3")
    await settle()
    view.mockInput.pressKey("q") // A quick exit flushes the last debounced tab.
    await Bun.sleep(0)
    expect(saved["cli/cli"]).toBe("issues")
    expect(view.renderer.isDestroyed).toBe(true)
  } finally { if (!view.renderer.isDestroyed) view.renderer.destroy() }
})

test("failed tab saves remain pending and are retried on exit without writing unchanged history", async () => {
  let attempts = 0
  const updates: unknown[] = []
  const view = await testRender(() => <Root cwd="/work" repositoryArgument="cli/cli" services={{
    resolveRepository: async () => "cli/cli", resolveLocalRepository: async () => undefined,
    loadRecentRepositories: async () => [], rememberRepository: async () => {},
    loadRepositoryTabs: async () => ({ "cli/cli": "issues", "owner/other": "pulls" }),
    saveRepositoryTabs: async (tabs) => {
      updates.push(tabs)
      if (++attempts === 1) throw new Error("Transient write failure")
    },
    loadConfig: async () => ({ ...defaultConfig }), saveConfig: async () => {},
    createRepositorySession: readySession,
  }} />, { width: 120, height: 32 })
  try {
    await Bun.sleep(0)
    await view.flush()
    view.mockInput.pressKey("2")
    await view.flush()
    await Bun.sleep(280)
    expect(attempts).toBe(1)
    expect(view.renderer.isDestroyed).toBe(false)
    view.mockInput.pressKey("q")
    await Bun.sleep(0)
    expect(attempts).toBe(2)
    expect(updates).toEqual([{ "cli/cli": "commits" }, { "cli/cli": "commits" }])
    expect(view.renderer.isDestroyed).toBe(true)
  } finally { if (!view.renderer.isDestroyed) view.renderer.destroy() }
})
