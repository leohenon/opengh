import { createTestReviewSession } from "./fixtures/reviews"
import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { defaultConfig, type Config } from "../src/config"
import type { IssueDetailState, PullDetailState, RepositoryState } from "../src/repository-state"
import { parseLaunchArguments } from "../src/launch-target"
import { Root } from "../src/root"
import { GitHubApiError } from "../src/github/transport"
import { githubDataFixture, repositoryOperationsFixture, issueDetailFixture, issuePullReferenceFixture } from "./fixtures/github-data"

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
    mergePull: async () => { throw new Error("Merging is unavailable.") },
    updatePullDraft: async () => { throw new Error("Changing PR stage is unavailable.") },
    loadPullMergeMessage: async () => { throw new Error("Merge messages are unavailable.") },
    loadMorePullComments: idle,
    retryPullReferences: idle,
    retryPullCommits: idle,
    retryPullContext: idle,
    clearPull: () => {},
    reactionAction: () => ({ operation: { status: "idle" as const } }),
    addReaction: async () => { throw new Error("Adding reactions is unavailable.") },
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
  test("retains a resolved launch through metadata retry, then consumes it before repository switching", async () => {
    const [state, setState] = createSignal<RepositoryState>({ status: "loading", repository: "cli/cli" })
    const [pullDetail, setPullDetail] = createSignal<PullDetailState>()
    const loads: string[] = []
    const lookups: string[] = []
    const saved: Record<string, string> = {}
    let attempts = 0
    const session = { ...readySession(), state, pullDetail,
      clearPull: () => setPullDetail(undefined),
      loadPull: async (number: number) => {
        const current = state()
        if (current.status !== "ready") throw new Error("Detail loaded before metadata")
        loads.push(`${current.repository}#${number}`)
        const resource = { status: "error" as const, phase: "load" as const, message: "Direct PR unavailable" }
        setPullDetail({ number, resource, comments: resource, references: resource, commits: resource, context: resource })
      },
      load: async (repository: string) => {
        setState({ status: "loading", repository })
        if (++attempts === 1) {
          setState({ status: "error", repository, message: "Metadata unavailable" })
          return
        }
        setState({ status: "ready", repository, data: {
          ...structuredClone(githubDataFixture), repo: { ...githubDataFixture.repo, nameWithOwner: repository },
        }, operations: structuredClone(repositoryOperationsFixture) })
      },
    }
    const view = await testRender(() => <Root {...parseLaunchArguments(["9999"])} cwd="/work" services={{ createPullReviewSession: createTestReviewSession,
      resolveRepository: async (argument) => { expect(argument).toBe("."); return "cli/cli" },
      loadIssueKind: async (repository, number) => { lookups.push(`${repository}#${number}`); return "pull" },
      resolveLocalRepository: async () => undefined,
      loadRecentRepositories: async () => [], rememberRepository: async () => {},
      loadRepositoryTabs: async () => ({ "cli/cli": "actions" }),
      saveRepositoryTabs: async (tabs) => { Object.assign(saved, tabs) },
      loadConfig: async () => ({ ...defaultConfig }),
      createRepositorySession: () => session,
    }} />, { width: 120, height: 32 })
    active.push(view)
    const settle = async () => { await Bun.sleep(0); await view.flush() }
    await settle()
    expect(view.captureCharFrame()).toContain("Metadata unavailable")
    view.mockInput.pressKey("s")
    await settle()
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()
    expect(view.captureCharFrame()).toContain("Metadata unavailable")
    view.mockInput.pressKey("r")
    await settle()
    expect(view.captureCharFrame()).toContain("Direct PR unavailable")
    expect(lookups).toEqual(["cli/cli#9999"])
    expect(loads).toEqual(["cli/cli#9999"])
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()
    expect(view.captureCharFrame()).toContain("retain focused child")

    for (const repository of ["owner/other", "CLI/CLI"]) {
      view.mockInput.pressKey("s")
      await settle()
      await view.mockInput.typeText(repository)
      view.mockInput.pressEnter()
      await settle()
    }
    expect(view.captureCharFrame()).toContain("retain focused child")
    expect(loads).toEqual(["cli/cli#9999"])
    expect(lookups).toEqual(["cli/cli#9999"])
    view.mockInput.pressKey("q")
    await Bun.sleep(0)
    expect(saved["cli/cli"]).toBe("pulls")
  })

  test.each(["retry", "select"])("keeps failed number launches retryable and clears them on explicit selection (%s)", async (action) => {
    let loads = 0
    let lookups = 0
    const pulls: number[] = []
    const view = await testRender(() => <Root {...parseLaunchArguments(["cli/cli", "9999"])} cwd="/work" services={{ createPullReviewSession: createTestReviewSession,
      resolveRepository: async () => "cli/cli",
      loadIssueKind: async () => {
        if (++lookups === 1) throw new GitHubApiError("repos/cli/cli/issues/9999", "Not Found (HTTP 404)")
        return "pull"
      },
      resolveLocalRepository: async () => undefined,
      loadRecentRepositories: async () => [], rememberRepository: async () => {},
      loadRepositoryTabs: async () => ({}), saveRepositoryTabs: async () => {},
      loadConfig: async () => ({ ...defaultConfig, showStatusBarHints: true, keybindings: { "view.refresh": ["f6"] } }),
      createRepositorySession: () => ({ ...readySession(),
        load: async () => { loads++ }, loadPull: async (number) => { pulls.push(number) },
      }),
    }} />, { width: 120, height: 32 })
    active.push(view)
    const settle = async () => { await Bun.sleep(0); await view.flush() }
    await settle()
    expect(view.captureCharFrame()).toContain("Could not open cli/cli#9999")
    expect(view.captureCharFrame()).toContain("Not Found (HTTP 404)")
    expect(view.captureCharFrame()).toContain("f6 retry")
    expect(loads).toBe(0)

    view.mockInput.pressKey("s")
    await settle()
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()
    expect(view.captureCharFrame()).toContain("Could not open cli/cli#9999")
    if (action === "retry") {
      view.mockInput.pressKey("F6")
      await settle()
      expect(view.captureCharFrame()).toContain("Pull request #9999")
      expect(lookups).toBe(2)
      expect(pulls).toEqual([9999])
    } else {
      view.mockInput.pressKey("s")
      await settle()
      await view.mockInput.typeText("cli/cli")
      view.mockInput.pressEnter()
      await settle()
      expect(view.captureCharFrame()).toContain("About")
      expect(lookups).toBe(1)
      expect(pulls).toEqual([])
    }
    expect(loads).toBe(1)
  })

  test("resolves startup services before showing the repository picker", async () => {
    const resolution = deferred<string | undefined>()
    let receivedArgument: string | undefined
    let receivedCwd = ""

    const view = await testRender(
      () => (
        <Root
          repositoryArgument="."
          cwd="/work/repository"
          services={{ createPullReviewSession: createTestReviewSession,
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
      () => <Root repositoryArgument="." cwd="/work/repository" services={{ createPullReviewSession: createTestReviewSession,
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
          services={{ createPullReviewSession: createTestReviewSession,
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
    for (let i = 0; i < 10; i++) view.mockInput.pressArrow("down")
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
          services={{ createPullReviewSession: createTestReviewSession,
            resolveRepository: async () => "cli/cli",
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            loadRecentRepositories: async () => [],
            rememberRepository: idle,
            loadConfig: async () => ({ showScrollbars: false, theme: "github", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", showStatusBarHints: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }),
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
    for (let i = 0; i < 10; i++) view.mockInput.pressArrow("down")
    view.mockInput.pressArrow("right")
    await Bun.sleep(0)
    await view.flush()

    expect(saved).toEqual([{ showScrollbars: true, theme: "github", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", showStatusBarHints: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }])
    expect(view.captureCharFrame()).toContain("‹ off ›")
    expect(view.captureCharFrame()).not.toContain("Saving…")

    view.mockInput.pressEscape()
    await Bun.sleep(30)
    for (let i = 0; i < 10; i++) view.mockInput.pressArrow("up")
    view.mockInput.pressEnter()
    await view.flush()
    expect(view.captureCharFrame()).toContain("Settings")
    expect(view.captureCharFrame()).not.toContain("Search themes")
    await view.mockMouse.click(0, 0)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Settings")
    expect(saved).toHaveLength(1)

    writes[0]!.resolve()
    await view.flush()
    expect(view.captureCharFrame()).toContain("‹ on ›")

    for (let i = 0; i < 10; i++) view.mockInput.pressArrow("up")
    view.mockInput.pressEnter()
    await view.flush()
    await view.mockInput.typeText("nord")
    view.mockInput.pressEnter()
    await view.flush()
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Themes")
    await view.mockMouse.click(0, 0)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Themes")
    expect(view.captureCharFrame()).not.toContain("Saving…")
    expect(saved[1]).toEqual({ showScrollbars: true, theme: "nord", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", showStatusBarHints: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" })

    writes[1]!.resolve()
    await view.flush()
    expect(view.captureCharFrame()).toContain("Settings")
    expect(view.captureCharFrame()).toContain("‹ nord ›")
    for (let i = 0; i < 10; i++) view.mockInput.pressArrow("down")
    await view.flush()
    expect(view.captureCharFrame()).toContain("› Scrollbars")
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
  const view = await testRender(() => <Root cwd="/work" repositoryArgument="cli/cli" services={{ createPullReviewSession: createTestReviewSession,
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
  const view = await testRender(() => <Root cwd="/work" repositoryArgument="cli/cli" services={{ createPullReviewSession: createTestReviewSession,
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

test("reloads bindings in place, keeps the last valid config on failure, and remaps interrupt in inputs", async () => {
  let next: Config = { ...defaultConfig, showStatusBarHints: true, keybindings: { "global.interrupt": ["ctrl+x"] } }
  let invalid = false
  const view = await testRender(() => <Root cwd="/unused" services={{ createPullReviewSession: createTestReviewSession,
    resolveRepository: async () => undefined,
    loadRecentRepositories: async () => ["cli/cli"],
    rememberRepository: async () => {},
    loadRepositoryTabs: async () => ({}), saveRepositoryTabs: async () => {},
    resolveLocalRepository: async () => undefined,
    createRepositorySession: readySession,
    loadConfig: async () => { if (invalid) throw new Error("Invalid binding"); return next },
  }} />, { width: 120, height: 32, exitOnCtrlC: false })
  active.push(view)
  await Bun.sleep(0)
  await view.flush()
  view.mockInput.pressCtrlC()
  expect(view.renderer.isDestroyed).toBe(false)
  view.mockInput.pressKey("r", { ctrl: true })
  await Bun.sleep(0)
  await view.flush()
  expect(view.captureCharFrame()).toContain("Config reloaded")
  next = { ...next, keybindings: { ...next.keybindings, "picker.accept": ["f2"], "global.help": ["f1"] } }
  view.mockInput.pressKey("r", { ctrl: true })
  await Bun.sleep(0)
  await view.flush()
  expect(view.captureCharFrame()).toContain("Config reloaded")
  view.mockInput.pressEnter()
  await view.flush()
  expect(view.captureCharFrame()).toContain("Open a GitHub repository")
  view.mockInput.pressKey("F2")
  await Bun.sleep(0)
  await view.flush()
  expect(view.captureCharFrame()).toContain("f1 help")
  invalid = true
  view.mockInput.pressKey("r", { ctrl: true })
  await Bun.sleep(0)
  await view.flush()
  expect(view.captureCharFrame()).toContain("Config reload failed")
  expect(view.captureCharFrame()).not.toContain("Invalid binding")
  expect(view.captureCharFrame()).not.toContain("Config reloaded")
  expect(view.captureCharFrame()).toContain("f1 help")
  view.mockInput.pressKey("F1")
  await view.flush()
  expect(view.captureCharFrame()).toContain("Help")
  view.mockInput.pressKey("x", { ctrl: true })
  expect(view.renderer.isDestroyed).toBe(true)
})


test("references isolate Root quit while preserving remapped list actions and dismissal", async () => {
  let copied = ""
  const session = readySession()
  const issueDetail: IssueDetailState = {
    number: issueDetailFixture.number, resource: { status: "ready", value: issueDetailFixture },
    comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
    references: { status: "ready", value: [issuePullReferenceFixture] },
  }
  const view = await testRender(() => <Root cwd="/unused" services={{ createPullReviewSession: createTestReviewSession,
    resolveRepository: async () => "cli/cli", loadRecentRepositories: async () => [], rememberRepository: async () => {},
    loadRepositoryTabs: async () => ({}), saveRepositoryTabs: async () => {}, resolveLocalRepository: async () => undefined,
    loadConfig: async () => ({ ...defaultConfig, keybindings: { "dialog.close": ["f4"], "item.copy": ["f3"] } }),
    createRepositorySession: () => ({ ...session, issueDetail: () => issueDetail }),
    copyToHostClipboard: async (value) => { copied = value; return true },
  }} />, { width: 120, height: 32 })
  active.push(view)
  await Bun.sleep(0)
  await view.flush()
  view.mockInput.pressKey("3")
  view.mockInput.pressEnter()
  view.mockInput.pressKey("p")
  await view.flush()
  expect(view.captureCharFrame()).toContain("References")
  view.mockInput.pressKey("q")
  expect(view.renderer.isDestroyed).toBe(false)
  view.mockInput.pressKey("F3")
  await Bun.sleep(0)
  expect(copied).toBe(issuePullReferenceFixture.url)
  view.mockInput.pressKey("p")
  await view.flush()
  view.mockInput.pressKey("F4")
  await view.flush()
  expect(view.captureCharFrame()).not.toContain("PRs (1)")
  view.mockInput.pressKey("q")
  await Bun.sleep(0)
  expect(view.renderer.isDestroyed).toBe(true)
})

test("settings cannot save or dismiss during a deferred config reload", async () => {
  const reload = deferred<Config>()
  let loads = 0
  let saved: Config | undefined
  const view = await testRender(() => <Root cwd="/unused" services={{ createPullReviewSession: createTestReviewSession,
    resolveRepository: async () => "cli/cli", loadRecentRepositories: async () => [], rememberRepository: async () => {},
    loadRepositoryTabs: async () => ({}), saveRepositoryTabs: async () => {}, resolveLocalRepository: async () => undefined,
    loadConfig: () => ++loads === 1 ? Promise.resolve({ ...defaultConfig }) : reload.promise,
    saveConfig: async (value) => { saved = value }, createRepositorySession: readySession,
  }} />, { width: 120, height: 32 })
  active.push(view)
  await Bun.sleep(0)
  await view.flush()
  view.mockInput.pressKey("r", { ctrl: true })
  view.mockInput.pressKey(",")
  view.mockInput.pressArrow("down")
  view.mockInput.pressEnter()
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  await view.flush()
  expect(saved).toBeUndefined()
  expect(view.captureCharFrame()).toContain("Settings")
  expect(view.captureCharFrame()).not.toContain("Search themes")
  reload.resolve({ ...defaultConfig, keybindings: { "global.help": ["f1"] } })
  await Bun.sleep(0)
  await view.flush()
  expect(view.captureCharFrame()).toContain("Config reloaded")
  view.mockInput.pressArrow("down")
  view.mockInput.pressEnter()
  await Bun.sleep(0)
  expect(saved?.colorMode).toBe("dark")
  expect(saved?.keybindings).toEqual({ "global.help": ["f1"] })
})

test("remapped interrupt cancels commands without quitting, then quits after command completion", async () => {
  const result = deferred<{ exitCode: number; cancelled: boolean }>()
  let cancelled = 0
  let copied = ""
  const view = await testRender(() => <Root cwd="/unused" services={{ createPullReviewSession: createTestReviewSession,
    resolveRepository: async () => "cli/cli", loadRecentRepositories: async () => [], rememberRepository: async () => {},
    loadRepositoryTabs: async () => ({}), saveRepositoryTabs: async () => {}, resolveLocalRepository: async () => undefined,
    loadConfig: async () => ({ ...defaultConfig, keybindings: {
      "global.interrupt": ["ctrl+x"], "command.clone": ["f2"], "dialog.confirm": ["f3"], "command.copyOutput": ["f5"],
    } }),
    runCommand: (_spec, output) => {
      output("command output\n")
      return { result: result.promise, cancel: () => { cancelled++; result.resolve({ exitCode: 143, cancelled: true }) } }
    },
    copyToHostClipboard: async (value) => { copied = value; return true }, createRepositorySession: readySession,
  }} />, { width: 120, height: 32, exitOnCtrlC: false })
  active.push(view)
  await Bun.sleep(0)
  await view.flush()
  view.mockInput.pressKey("F2")
  view.mockInput.pressKey("F3")
  await Bun.sleep(0)
  await view.flush()
  expect(view.captureCharFrame()).toContain("Running")
  view.mockInput.pressCtrlC()
  expect(cancelled).toBe(0)
  view.mockInput.pressKey("x", { ctrl: true })
  await Bun.sleep(0)
  await view.flush()
  expect(cancelled).toBe(1)
  expect(view.renderer.isDestroyed).toBe(false)
  expect(view.captureCharFrame()).toContain("Cancelled (exit 143)")
  view.mockInput.pressKey("F5")
  await Bun.sleep(0)
  expect(copied).toBe("command output\n")
  view.mockInput.pressKey("x", { ctrl: true })
  expect(view.renderer.isDestroyed).toBe(true)
})
