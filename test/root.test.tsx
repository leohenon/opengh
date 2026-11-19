import { createTestReviewSession } from "./fixtures/reviews"
import { afterEach, describe, expect, test } from "bun:test"
import { render, testRender } from "@opentui/solid"
import { createTestRenderer } from "@opentui/core/testing"
import { initializeHunk } from "../src/ui/hunk-host"
import { resumeLocation, type ResumeLocation } from "../src/resume"
import type { DiffTarget, RepositoryDocument } from "../src/models"
import { waitForText } from "./fixtures/wait"
import { patchFixture } from "./fixtures/diff"
import { BoxRenderable, CodeRenderable, RGBA, type Renderable, type TextareaRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { defaultConfig, type Config } from "../src/config"
import { appColors, resolveTheme } from "../src/theme"
import type { CommitDetailState, DiffState, IssueDetailState, PullDetailState, RepositoryState } from "../src/repository-state"
import { parseLaunchArguments } from "../src/launch-target"
import { Root } from "../src/root"
import { createRepositorySession } from "../src/repository-session"
import { createPullReviewSession } from "../src/pull-review-session"
import { createInlineDrafts } from "../src/inline-drafts"
import { GitHubApiError } from "../src/github/transport"
import { createGitHubWrites } from "../src/github/writes"
import {
  githubDataFixture,
  repositoryOperationsFixture,
  issueDetailFixture,
  issuePullReferenceFixture,
  commitDetailFixture,
} from "./fixtures/github-data"

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
    mergePull: async () => {
      throw new Error("Merging is unavailable.")
    },
    updatePullDraft: async () => {
      throw new Error("Changing PR stage is unavailable.")
    },
    createIssue: async () => {
      throw new Error("Issue creation is unavailable.")
    },
    loadIssueTemplates: async () => [],
    comparePullBranches: async () => {
      throw new Error("Comparing branches is unavailable.")
    },
    createPull: async () => {
      throw new Error("Pull request creation is unavailable.")
    },
    loadPullRepositories: async () => {
      throw new Error("Pull request repositories are unavailable.")
    },
    loadPullBranches: async () => ({ items: [], hasMore: false }),
    loadPullTemplates: async () => [],
    loadPullMergeMessage: async () => {
      throw new Error("Merge messages are unavailable.")
    },
    loadMorePullComments: idle,
    retryPullReferences: idle,
    retryPullCommits: idle,
    retryPullContext: idle,
    clearPull: () => {},
    reactionAction: () => ({ operation: { status: "idle" as const } }),
    addReaction: async () => {
      throw new Error("Adding reactions is unavailable.")
    },
    removeReaction: async () => {
      throw new Error("Removing reactions is unavailable.")
    },
    load: idle,
    refresh: idle,
    openDocument: () => undefined,
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
  test("wires overview Markdown links to the session and navigates to its accepted document ID", async () => {
    const repository = githubDataFixture.repo.nameWithOwner
    const [state, setState] = createSignal<RepositoryState>({
      status: "ready",
      repository,
      operations: repositoryOperationsFixture,
      data: {
        ...githubDataFixture,
        documents: {
          status: "ready",
          value: [
            {
              id: "readme",
              label: "README",
              repository,
              ref: "main",
              path: "README.md",
              resource: { status: "ready", value: "# Root document\n\n[Open guide](docs/guide.md)" },
            },
          ],
        },
      },
    })
    const opened: RepositoryDocument[] = []
    const session = {
      ...readySession(),
      state,
      openDocument: (source: RepositoryDocument) => {
        opened.push(source)
        const id = "accepted-guide"
        setState((state) =>
          state.status !== "ready"
            ? state
            : {
                ...state,
                data: {
                  ...state.data,
                  linkedDocuments: [{ ...source, id, resource: { status: "ready", value: "# Root guide loaded" } }],
                },
              },
        )
        return id
      },
    }
    const view = await testRender(
      () => (
        <Root
          repositoryArgument={repository}
          cwd="/work"
          services={{
            createPullReviewSession: createTestReviewSession,
            resolveRepository: async () => repository,
            resolveLocalRepository: async () => undefined,
            loadRecentRepositories: async () => [],
            rememberRepository: async () => {},
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            loadConfig: async () => defaultConfig,
            createRepositorySession: () => session,
          }}
        />
      ),
      { width: 80, height: 24 },
    )
    active.push(view)
    await waitForText(view, "Root document")
    const url = `https://github.com/${repository}/blob/main/docs/guide.md`
    let cell: { x: number; y: number } | undefined
    for (let y = 0; y < view.renderer.height; y++)
      for (let x = 0; x < view.renderer.width; x++) if (view.renderer.getLinkAt(x, y) === url) cell = { x, y }
    expect(cell).toBeDefined()
    await view.mockMouse.click(cell!.x, cell!.y)
    await waitForText(view, "Root guide loaded")
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ repository, ref: "main", path: "docs/guide.md" })
  })

  test("a crashed repository view shows a retry instead of the developer console", async () => {
    let broken = true
    const session = {
      ...readySession(),
      canSwitchBranch: () => {
        if (broken) throw new Error("Render exploded")
        return true
      },
    }
    const [unexpected, setUnexpected] = createSignal<string>()
    const view = await testRender(
      () => (
        <Root
          repositoryArgument="cli/cli"
          cwd="/work"
          unexpectedError={unexpected}
          onDismissUnexpectedError={() => setUnexpected(undefined)}
          services={{
            createPullReviewSession: createTestReviewSession,
            resolveRepository: async () => "cli/cli",
            resolveLocalRepository: async () => undefined,
            loadRecentRepositories: async () => [],
            rememberRepository: async () => {},
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            loadConfig: async () => defaultConfig,
            createRepositorySession: () => session,
          }}
        />
      ),
      { width: 100, height: 30 },
    )
    active.push(view)
    await waitForText(view, "Something went wrong")
    expect(view.captureCharFrame()).toContain("Render exploded")
    broken = false
    view.mockInput.pressKey("r")
    await waitForText(view, githubDataFixture.repo.nameWithOwner)
    expect(view.captureCharFrame()).not.toContain("Render exploded")
    setUnexpected("Task failed")
    await waitForText(view, "Something went wrong: Task failed")
  })

  test("retains a resolved launch through metadata retry, then consumes it before repository switching", async () => {
    const [state, setState] = createSignal<RepositoryState>({ status: "loading", repository: "cli/cli" })
    const [pullDetail, setPullDetail] = createSignal<PullDetailState>()
    const loads: string[] = []
    const lookups: string[] = []
    const saved: Record<string, string> = {}
    let attempts = 0
    const session = {
      ...readySession(),
      state,
      pullDetail,
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
        setState({
          status: "ready",
          repository,
          data: {
            ...structuredClone(githubDataFixture),
            repo: { ...githubDataFixture.repo, nameWithOwner: repository },
          },
          operations: structuredClone(repositoryOperationsFixture),
        })
      },
    }
    const view = await testRender(
      () => (
        <Root
          {...parseLaunchArguments(["9999"])}
          cwd="/work"
          services={{
            createPullReviewSession: createTestReviewSession,
            resolveRepository: async (argument) => {
              expect(argument).toBe(".")
              return "cli/cli"
            },
            loadIssueKind: async (repository, number) => {
              lookups.push(`${repository}#${number}`)
              return "pull"
            },
            resolveLocalRepository: async () => undefined,
            loadRecentRepositories: async () => [],
            rememberRepository: async () => {},
            loadRepositoryTabs: async () => ({ "cli/cli": "actions" }),
            saveRepositoryTabs: async (tabs) => {
              Object.assign(saved, tabs)
            },
            loadConfig: async () => ({ ...defaultConfig }),
            createRepositorySession: () => session,
          }}
        />
      ),
      { width: 120, height: 32 },
    )
    active.push(view)
    const settle = async () => {
      await Bun.sleep(0)
      await view.flush()
    }
    await settle()
    expect(view.captureCharFrame()).toContain("Metadata unavailable")
    view.mockInput.pressKey("S")
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
      view.mockInput.pressKey("S")
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
    const view = await testRender(
      () => (
        <Root
          {...parseLaunchArguments(["cli/cli", "9999"])}
          cwd="/work"
          services={{
            createPullReviewSession: createTestReviewSession,
            resolveRepository: async () => "cli/cli",
            loadIssueKind: async () => {
              if (++lookups === 1) throw new GitHubApiError("repos/cli/cli/issues/9999", "Not Found (HTTP 404)")
              return "pull"
            },
            resolveLocalRepository: async () => undefined,
            loadRecentRepositories: async () => [],
            rememberRepository: async () => {},
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            loadConfig: async () => ({ ...defaultConfig, showStatusBarHints: true, keybindings: { "view.refresh": ["f6"] } }),
            createRepositorySession: () => ({
              ...readySession(),
              load: async () => {
                loads++
              },
              loadPull: async (number) => {
                pulls.push(number)
              },
            }),
          }}
        />
      ),
      { width: 120, height: 32 },
    )
    active.push(view)
    const settle = async () => {
      await Bun.sleep(0)
      await view.flush()
    }
    await settle()
    expect(view.captureCharFrame()).toContain("Could not open cli/cli#9999")
    expect(view.captureCharFrame()).toContain("Not Found (HTTP 404)")
    expect(view.captureCharFrame()).toContain("f6 retry")
    expect(loads).toBe(0)

    view.mockInput.pressKey("S")
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
      view.mockInput.pressKey("S")
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

  test("keeps the saved theme and one loading message from discovery through session loading", async () => {
    const resolution = deferred<string | undefined>()
    const config: Config = { ...defaultConfig, theme: "github", colorMode: "light" }
    let configLoads = 0
    const view = await testRender(
      () => (
        <Root
          cwd="/work"
          initialConfig={config}
          services={{
            createPullReviewSession: createTestReviewSession,
            createRepositorySession: () => ({ ...readySession(), state: () => ({ status: "loading" as const, repository: "cli/cli" }) }),
            resolveRepository: () => resolution.promise,
            resolveLocalRepository: async () => undefined,
            loadRecentRepositories: async () => [],
            loadRepositoryTabs: async () => ({}),
            loadConfig: async () => {
              configLoads++
              return defaultConfig
            },
          }}
        />
      ),
      { width: 80, height: 24 },
    )
    active.push(view)
    const boxes = (node: Renderable): BoxRenderable[] => [
      ...(node instanceof BoxRenderable ? [node] : []),
      ...node.getChildren().flatMap(boxes),
    ]
    const expected = RGBA.fromHex(appColors(resolveTheme("github", "light")).canvas)
    const checkBackground = () => {
      const screen = boxes(view.renderer.root).find((box) => box.width === 80 && box.height === 24 && box.backgroundColor.a > 0)
      expect(screen).toBeDefined()
      expect(screen!.backgroundColor).toEqual(expected)
    }
    // Check the background before the loading text's 200ms reveal delay.
    await view.flush()
    checkBackground()
    await Bun.sleep(250)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Loading repository")
    resolution.resolve("cli/cli")
    await Bun.sleep(0)
    await view.flush()
    // No new reveal delay: the same loading component remains mounted.
    expect(view.captureCharFrame()).toContain("Loading repository")
    expect(view.captureCharFrame()).not.toContain("Loading cli/cli")
    checkBackground()
    expect(configLoads).toBe(0)
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
          services={{
            createPullReviewSession: createTestReviewSession,
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

    expect(view.captureCharFrame().trim()).toBe("")
    for (let attempt = 0; attempt < 40 && !view.captureCharFrame().includes("Loading repository"); attempt++) {
      await Bun.sleep(25)
      await view.flush()
    }
    expect(view.captureCharFrame()).toContain("Loading repository")
    expect(view.captureCharFrame()).not.toContain("Open a GitHub repository")
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
    await Bun.sleep(0)
    expect(view.renderer.isDestroyed).toBe(true)
  })

  test("shows repository discovery authentication errors instead of hanging or claiming no repository exists", async () => {
    const error = new GitHubApiError("repository discovery", "Bad credentials (HTTP 401)")
    const view = await testRender(
      () => (
        <Root
          repositoryArgument="."
          cwd="/work/repository"
          services={{
            createPullReviewSession: createTestReviewSession,
            resolveRepository: async () => {
              throw error
            },
            resolveLocalRepository: async () => undefined,
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            rememberRepository: async () => {},
            loadRecentRepositories: async () => ["cli/cli"],
            loadConfig: async () => ({ ...defaultConfig }),
            createRepositorySession: readySession,
          }}
        />
      ),
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

  test.each([false, true])("warns and prevents overwriting config when loading fails (preloaded: %s)", async (preloaded) => {
    let saves = 0
    const view = await testRender(
      () => (
        <Root
          cwd="/work/repository"
          initialConfig={preloaded ? defaultConfig : undefined}
          initialConfigError={preloaded ? "Malformed config" : undefined}
          services={{
            createPullReviewSession: createTestReviewSession,
            resolveRepository: async () => undefined,
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            loadRecentRepositories: async () => [],
            loadConfig: async () => {
              throw new Error("Malformed config")
            },
            saveConfig: async () => {
              saves++
            },
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
          services={{
            createPullReviewSession: createTestReviewSession,
            resolveRepository: async () => "cli/cli",
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            loadRecentRepositories: async () => [],
            rememberRepository: idle,
            loadConfig: async () => ({
              showScrollbars: false,
              theme: "github",
              colorMode: "system",
              reducedMotion: false,
              markdownStyle: "rich",
              detailLayout: "centered",
              detailsPlacement: "auto",
              diffLayout: "auto",
              diffWrap: false,
              diffFullscreen: true,
              showStatusBarHints: true,
              showTabShortcuts: true,
              showTabCounts: true,
              hideDocumentsTab: false,
              compactHeader: false,
              iconStyle: "unicode",
            }),
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

    expect(saved).toEqual([
      {
        showScrollbars: true,
        theme: "github",
        colorMode: "system",
        reducedMotion: false,
        markdownStyle: "rich",
        detailLayout: "centered",
        detailsPlacement: "auto",
        diffLayout: "auto",
        diffWrap: false,
        diffFullscreen: true,
        showStatusBarHints: true,
        showTabShortcuts: true,
        showTabCounts: true,
        hideDocumentsTab: false,
        compactHeader: false,
        iconStyle: "unicode",
      },
    ])
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
    expect(saved[1]).toEqual({
      showScrollbars: true,
      theme: "nord",
      colorMode: "system",
      reducedMotion: false,
      markdownStyle: "rich",
      detailLayout: "centered",
      detailsPlacement: "auto",
      diffLayout: "auto",
      diffWrap: false,
      diffFullscreen: true,
      showStatusBarHints: true,
      showTabShortcuts: true,
      showTabCounts: true,
      hideDocumentsTab: false,
      compactHeader: false,
      iconStyle: "unicode",
    })

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
  const session = {
    ...readySession(),
    state,
    load: async (repository: string) => {
      setState({
        status: "ready",
        repository,
        data: {
          ...structuredClone(githubDataFixture),
          repo: { ...githubDataFixture.repo, nameWithOwner: repository },
        },
        operations: structuredClone(repositoryOperationsFixture),
      })
    },
  }
  let saved: Record<string, import("../src/navigation").Page> = { "cli/cli": "issues", "owner/other": "pulls" }
  let writes = 0
  const firstSave = deferred<void>()
  const view = await testRender(
    () => (
      <Root
        cwd="/work"
        repositoryArgument="cli/cli"
        services={{
          createPullReviewSession: createTestReviewSession,
          resolveRepository: async (argument) => argument,
          resolveLocalRepository: async () => undefined,
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({ ...saved }),
          saveRepositoryTabs: async (tabs) => {
            if (++writes === 1) await firstSave.promise
            saved = { ...saved, ...tabs }
          },
          loadConfig: async () => ({ ...defaultConfig, showStatusBarHints: true }),
          saveConfig: async () => {},
          createRepositorySession: () => session,
        }}
      />
    ),
    { width: 120, height: 32 },
  )
  const settle = async () => {
    await Bun.sleep(0)
    await view.flush()
  }
  const switchTo = async (repository: string) => {
    view.mockInput.pressKey("S")
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
    // Navigation saves are debounced. Checked straight after one navigation: the slower
    // repository switches below can outlast the debounce on a busy machine.
    expect(writes).toBe(0)
    await switchTo("owner/other")
    expect(view.captureCharFrame()).toContain("retain focused child") // Independent saved PR tab.
    await switchTo("CLI/CLI")
    expect(view.captureCharFrame()).toContain("cad92f4") // Restored Commits, case-insensitively.
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
  } finally {
    if (!view.renderer.isDestroyed) view.renderer.destroy()
  }
})

test("a teardown without quit, such as SIGTERM, hands pending tab and review saves to the host", async () => {
  const session = readySession()
  const save = deferred<void>()
  const saved: Record<string, string> = {}
  const shutdown: Promise<unknown>[] = []
  let reviewFlushes = 0
  const view = await testRender(
    () => (
      <Root
        cwd="/work"
        repositoryArgument="cli/cli"
        onShutdownWork={(work) => shutdown.push(work)}
        services={{
          createPullReviewSession: () => {
            const reviews = createTestReviewSession()
            return {
              ...reviews,
              flush: () => {
                reviewFlushes++
                return reviews.flush()
              },
            }
          },
          resolveRepository: async (argument) => argument,
          resolveLocalRepository: async () => undefined,
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async (tabs) => {
            await save.promise
            Object.assign(saved, tabs)
          },
          loadConfig: async () => defaultConfig,
          createRepositorySession: () => session,
        }}
      />
    ),
    { width: 120, height: 32 },
  )
  await waitForText(view, "Overview")
  view.mockInput.pressKey("2")
  await view.flush()
  // Destroyed inside the tab-save debounce.
  view.renderer.destroy()
  expect(shutdown).toHaveLength(1)
  expect(reviewFlushes).toBe(1)
  let settled = false
  void shutdown[0]!.then(() => (settled = true))
  await Bun.sleep(0)
  expect(settled).toBe(false)
  save.resolve()
  await shutdown[0]
  expect(saved["cli/cli"]).toBe("commits")
})

test("quit waits for changes being sent to GitHub, and quitting again stops waiting", async () => {
  for (const force of [false, true]) {
    const writes = createGitHubWrites()
    let abandoned = false
    const posting = Promise.withResolvers<void>()
    const view = await testRender(
      () => (
        <Root
          cwd="/work"
          repositoryArgument="cli/cli"
          services={{
            createPullReviewSession: createTestReviewSession,
            githubWrites: { ...writes, abandon: () => (abandoned = true) },
            resolveRepository: async (argument) => argument,
            resolveLocalRepository: async () => undefined,
            loadRecentRepositories: async () => [],
            rememberRepository: async () => {},
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            loadConfig: async () => defaultConfig,
            createRepositorySession: () => readySession(),
          }}
        />
      ),
      { width: 120, height: 32 },
    )
    active.push(view)
    await waitForText(view, "Overview")
    void writes.track(posting.promise)
    view.mockInput.pressKey("q")
    await waitForText(view, "Sending to GitHub")
    expect(view.renderer.isDestroyed).toBe(false)
    if (force) {
      view.mockInput.pressKey("q")
      await Bun.sleep(0)
      expect(abandoned).toBe(true)
      expect(view.renderer.isDestroyed).toBe(true)
      posting.resolve()
    } else {
      posting.resolve()
      for (let attempt = 0; attempt < 50 && !view.renderer.isDestroyed; attempt++) await Bun.sleep(10)
      expect(abandoned).toBe(false)
      expect(view.renderer.isDestroyed).toBe(true)
    }
  }
})

test("quit retains unsaved issue and PR drafts, then retries and waits for review and tab saves", async () => {
  let storageWritable = false
  const savedBodies: string[] = []
  // Use the real draft flush with injected storage; no repository requests are made.
  const drafts = createRepositorySession(undefined, {
    load: () => {
      throw new Error("Old optional draft load error")
    },
    withCurrent: async (_key, _generation, _body, publish) => {
      await publish()
    },
    save: (_key, draft) => {
      if (!storageWritable) throw new Error("Storage unavailable")
      savedBodies.push(draft.body)
    },
  })
  for (const parent of ["issue", "pull"] as const) {
    drafts.prepareIssueAction(42, "comment", parent)
    drafts.updateIssueDraft(42, { body: `${parent} draft` }, parent)
  }
  const tabs = deferred<void>()
  const review = deferred<void>()
  let reviewFlushes = 0
  let tabFlushes = 0
  const view = await testRender(
    () => (
      <Root
        cwd="/work"
        services={{
          resolveRepository: async () => "cli/cli",
          resolveLocalRepository: async () => undefined,
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async () => {
            tabFlushes++
            await tabs.promise
          },
          loadConfig: async () => ({ ...defaultConfig }),
          createRepositorySession: () => ({ ...readySession(), flushDrafts: drafts.flushDrafts, draftSaveError: drafts.draftSaveError }),
          createPullReviewSession: () => ({
            ...createTestReviewSession(),
            state: () => ({
              status: "ready",
              draft: {
                accountId: 1,
                repository: "cli/cli",
                number: 42,
                headSha: "head",
                body: "review draft",
                event: "COMMENT",
                comments: [],
              },
            }),
            flush: async () => {
              reviewFlushes++
              await review.promise
            },
          }),
        }}
      />
    ),
    { width: 120, height: 32 },
  )
  active.push(view)
  await Bun.sleep(0)
  await view.flush()
  view.mockInput.pressKey("2")
  await view.flush()
  view.mockInput.pressKey("q")
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(view.captureCharFrame()).toContain("Draft not saved — quit cancelled")
  expect(savedBodies).toEqual([])
  expect(drafts.issueAction(42).body).toBe("issue draft")
  expect(drafts.issueAction(42, "pull").body).toBe("pull draft")

  storageWritable = true
  view.mockInput.pressKey("q")
  await Bun.sleep(0)
  expect(savedBodies).toEqual(["issue draft", "pull draft"])
  // A historical load warning must not veto a successful save/quit retry.
  expect(drafts.draftSaveError!()).toContain("Old optional draft load error")
  expect(reviewFlushes).toBe(1)
  expect(tabFlushes).toBe(1)
  expect(view.renderer.isDestroyed).toBe(false)
  review.resolve()
  await Bun.sleep(0)
  expect(view.renderer.isDestroyed).toBe(false)
  // Editing remains possible during async saves; exit must check those new drafts too.
  storageWritable = false
  drafts.updateIssueDraft(42, { body: "Edited while quitting" }, "pull")
  tabs.resolve()
  await Bun.sleep(0)
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(view.captureCharFrame()).toContain("Draft not saved — quit cancelled")
  expect(savedBodies).toEqual(["issue draft", "pull draft"])
  expect(drafts.issueAction(42, "pull").body).toBe("Edited while quitting")
  storageWritable = true
  view.mockInput.pressKey("q")
  await Bun.sleep(0)
  expect(savedBodies).toEqual(["issue draft", "pull draft", "Edited while quitting"])
  expect(view.renderer.isDestroyed).toBe(true)
})

test.each([false, true])("quit drains late review edits after delayed tab saves (already open=%s)", async (alreadyOpen) => {
  const tabs = deferred<void>()
  const save = deferred<void>()
  const savedBodies: string[] = []
  let failSave = true
  let tabFlushes = 0
  const reviews = createPullReviewSession({
    transport: {
      async json<T>(path: string): Promise<T> {
        if (path === "user") return { id: 1, login: "viewer" } as T
        if (path === "repos/cli/cli") return { id: 71, private: true, permissions: { pull: true } } as T
        if (path === "repos/cli/cli/pulls/42")
          return { head: { sha: "a".repeat(40) }, base: { sha: "b".repeat(40) }, state: "open", user: { id: 2 } } as T
        if (path.includes("/reviews?")) return [] as T
        throw new Error(`Unexpected request: ${path}`)
      },
      async text() {
        throw new Error("Unexpected request")
      },
    },
    storage: {
      async load() {
        return undefined
      },
      async save(draft) {
        await save.promise
        if (failSave) throw new Error("Review storage unavailable")
        savedBodies.push(draft.body)
      },
      async remove() {},
    },
  })
  if (alreadyOpen) await reviews.open("cli/cli", 42)
  const view = await testRender(
    () => (
      <Root
        cwd="/work"
        services={{
          resolveRepository: async () => "cli/cli",
          resolveLocalRepository: async () => undefined,
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async () => {
            tabFlushes++
            await tabs.promise
          },
          loadConfig: async () => ({ ...defaultConfig }),
          createRepositorySession: readySession,
          createPullReviewSession: () => reviews,
        }}
      />
    ),
    { width: 120, height: 32 },
  )
  active.push(view)
  await Bun.sleep(0)
  await view.flush()
  view.mockInput.pressKey("2")
  view.mockInput.pressKey("q")
  await Bun.sleep(0)
  expect(tabFlushes).toBe(1)
  expect(view.renderer.isDestroyed).toBe(false)
  if (!alreadyOpen) await reviews.open("cli/cli", 42)
  reviews.setBody("Edited during tab save")
  tabs.resolve()
  await Bun.sleep(0)
  expect(view.renderer.isDestroyed).toBe(false)
  view.mockInput.pressKey("q") // Reentrant quit must not bypass the pending save.
  save.resolve()
  await Bun.sleep(0)
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(view.captureCharFrame()).toContain("Review storage unavailable")
  failSave = false
  reviews.setBody("Retried latest review")
  view.mockInput.pressKey("q")
  await Bun.sleep(0)
  expect(savedBodies).toEqual(["Retried latest review"])
  expect(view.renderer.isDestroyed).toBe(true)
})

test("quit waits for inline comment drafts and a failed save cancels it without losing the draft", async () => {
  const saved: string[][] = []
  let failSave = true
  const drafts = createInlineDrafts({
    storage: {
      async load() {
        return []
      },
      async save(_scope, values) {
        if (failSave) throw new Error("Inline storage unavailable")
        saved.push(values.map((value) => value.body))
      },
    },
  })
  const context = {
    accountId: 1,
    repositoryId: 71,
    repository: "cli/cli",
    number: 42,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    anchor: { path: "README.md", line: 1, side: "RIGHT" as const },
  }
  const view = await testRender(
    () => (
      <Root
        cwd="/work"
        services={{
          resolveRepository: async () => "cli/cli",
          resolveLocalRepository: async () => undefined,
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async () => {},
          loadConfig: async () => ({ ...defaultConfig }),
          createRepositorySession: readySession,
          createPullReviewSession: createTestReviewSession,
          createInlineDrafts: () => drafts,
        }}
      />
    ),
    { width: 120, height: 32 },
  )
  active.push(view)
  await Bun.sleep(0)
  await view.flush()
  drafts.set(context, "Unposted inline comment")
  view.mockInput.pressKey("q")
  await Bun.sleep(0)
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(view.captureCharFrame()).toContain("Inline draft not saved — quit cancelled")
  expect(view.captureCharFrame()).toContain("Inline storage unavailable")
  expect(drafts.get(context)?.body).toBe("Unposted inline comment")
  failSave = false
  view.mockInput.pressKey("q")
  await Bun.sleep(0)
  await Bun.sleep(0)
  expect(saved).toEqual([["Unposted inline comment"]])
  expect(view.renderer.isDestroyed).toBe(true)
})

test("failed tab saves remain pending and are retried on exit without writing unchanged history", async () => {
  let attempts = 0
  const updates: unknown[] = []
  const view = await testRender(
    () => (
      <Root
        cwd="/work"
        repositoryArgument="cli/cli"
        services={{
          createPullReviewSession: createTestReviewSession,
          resolveRepository: async () => "cli/cli",
          resolveLocalRepository: async () => undefined,
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({ "cli/cli": "issues", "owner/other": "pulls" }),
          saveRepositoryTabs: async (tabs) => {
            updates.push(tabs)
            if (++attempts === 1) throw new Error("Transient write failure")
          },
          loadConfig: async () => ({ ...defaultConfig }),
          saveConfig: async () => {},
          createRepositorySession: readySession,
        }}
      />
    ),
    { width: 120, height: 32 },
  )
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
  } finally {
    if (!view.renderer.isDestroyed) view.renderer.destroy()
  }
})

test.each(["c", "x"])("Ctrl+%s clears and dismisses picker/search inputs, then quits from the main screen", async (key) => {
  const view = await testRender(
    () => (
      <Root
        cwd="/unused"
        services={{
          createPullReviewSession: createTestReviewSession,
          resolveRepository: async () => "cli/cli",
          loadRecentRepositories: async () => ["cli/cli"],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async () => {},
          resolveLocalRepository: async () => undefined,
          createRepositorySession: readySession,
          loadConfig: async () => ({
            ...defaultConfig,
            keybindings: { "global.interrupt": [`ctrl+${key}`], "dialog.close": [] },
          }),
        }}
      />
    ),
    { width: 120, height: 32, exitOnCtrlC: false },
  )
  active.push(view)
  await Bun.sleep(0)
  await view.flush()
  view.mockInput.pressKey("S")
  await view.flush()
  const input = view.renderer.currentFocusedRenderable as TextareaRenderable
  await view.mockInput.typeText("query q")
  if (key === "x") {
    view.mockInput.pressCtrlC()
    expect(input.plainText).toBe("query q")
    expect(view.renderer.isDestroyed).toBe(false)
  }
  view.mockInput.pressKey(key, { ctrl: true })
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(input.plainText).toBe("")
  expect(view.captureCharFrame()).toContain("cli")
  expect(view.captureCharFrame()).not.toContain("No matching repositories")
  view.mockInput.pressKey("z", { ctrl: true })
  await view.flush()
  expect(input.plainText).toBe("query q")
  expect(view.captureCharFrame()).toContain("No matching repositories")
  view.mockInput.pressKey(key, { ctrl: true })
  await view.mockInput.typeText("   ")
  view.mockInput.pressKey(key, { ctrl: true })
  expect(input.plainText).toBe("")
  expect(view.renderer.isDestroyed).toBe(false)
  view.mockInput.pressKey(key, { ctrl: true })
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(view.renderer.root.findDescendantById("picker-query")).toBeUndefined()
  view.mockInput.pressKey("/")
  await view.flush()
  const searchInput = view.renderer.currentFocusedRenderable as TextareaRenderable
  await view.mockInput.typeText("search")
  view.mockInput.pressKey(key, { ctrl: true })
  await view.flush()
  expect(searchInput.plainText).toBe("")
  expect(view.renderer.isDestroyed).toBe(false)
  view.mockInput.pressKey(key, { ctrl: true })
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(view.renderer.currentFocusedRenderable).not.toBe(searchInput)
  view.mockInput.pressKey(key, { ctrl: true })
  await Bun.sleep(0)
  expect(view.renderer.isDestroyed).toBe(true)
})

test("Ctrl+C clears a comment draft undoably, dismisses only the active dialog, then quits", async () => {
  const [body, setBody] = createSignal("")
  const issueDetail: IssueDetailState = {
    number: issueDetailFixture.number,
    resource: { status: "ready", value: issueDetailFixture },
    comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
    references: { status: "ready", value: [] },
  }
  const view = await testRender(
    () => (
      <Root
        cwd="/unused"
        initialDetail={{ kind: "issue", number: issueDetailFixture.number }}
        services={{
          createPullReviewSession: createTestReviewSession,
          resolveRepository: async () => "cli/cli",
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async () => {},
          resolveLocalRepository: async () => undefined,
          loadConfig: async () => ({ ...defaultConfig }),
          createRepositorySession: () => ({
            ...readySession(),
            issueDetail: () => issueDetail,
            issueAction: () => ({ body: body(), reason: "completed" as const, operation: { status: "idle" as const } }),
            updateIssueDraft: (_number, draft) => setBody(draft.body ?? body()),
          }),
        }}
      />
    ),
    { width: 120, height: 32, exitOnCtrlC: false },
  )
  active.push(view)
  await Bun.sleep(0)
  await view.flush()
  view.mockInput.pressKey("c")
  await view.flush()
  const editor = view.renderer.currentFocusedRenderable as TextareaRenderable
  const text = "Comment draft\nsecond line"
  await view.mockInput.pasteBracketedText(text)
  expect(body()).toBe(text)
  view.mockInput.pressCtrlC()
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(editor.plainText).toBe("")
  expect(body()).toBe("")
  view.mockInput.pressKey("z", { ctrl: true })
  await view.flush()
  expect(editor.plainText).toBe(text)
  expect(body()).toBe(text)
  view.mockInput.pressKey("s", { ctrl: true })
  await view.flush()
  expect(view.captureCharFrame()).toContain("Post comment to")
  view.mockInput.pressCtrlC()
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(view.captureCharFrame()).not.toContain("Post comment to")
  expect(body()).toBe(text)
  view.mockInput.pressKey("d", { ctrl: true })
  await view.flush()
  expect(editor.plainText).toBe("")
  expect(body()).toBe("")
  view.mockInput.pressCtrlC()
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(view.renderer.currentFocusedRenderable).not.toBe(editor)
  view.mockInput.pressCtrlC()
  await Bun.sleep(0)
  expect(view.renderer.isDestroyed).toBe(true)
})

test("reloads bindings in place, keeps the last valid config on failure, and remaps interrupt in inputs", async () => {
  let next: Config = { ...defaultConfig, showStatusBarHints: true, keybindings: { "global.interrupt": ["ctrl+x"] } }
  let invalid = false
  const view = await testRender(
    () => (
      <Root
        cwd="/unused"
        services={{
          createPullReviewSession: createTestReviewSession,
          resolveRepository: async () => undefined,
          loadRecentRepositories: async () => ["cli/cli"],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async () => {},
          resolveLocalRepository: async () => undefined,
          createRepositorySession: readySession,
          loadConfig: async () => {
            if (invalid) throw new Error("Invalid binding")
            return next
          },
        }}
      />
    ),
    { width: 120, height: 32, exitOnCtrlC: false },
  )
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
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(view.captureCharFrame()).not.toContain("Help")
  view.mockInput.pressKey("x", { ctrl: true })
  await Bun.sleep(0)
  expect(view.renderer.isDestroyed).toBe(true)
})

test("references isolate Root quit while preserving remapped list actions and dismissal", async () => {
  let copied = ""
  const session = readySession()
  const issueDetail: IssueDetailState = {
    number: issueDetailFixture.number,
    resource: { status: "ready", value: issueDetailFixture },
    comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
    references: { status: "ready", value: [issuePullReferenceFixture] },
  }
  const view = await testRender(
    () => (
      <Root
        cwd="/unused"
        services={{
          createPullReviewSession: createTestReviewSession,
          resolveRepository: async () => "cli/cli",
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async () => {},
          resolveLocalRepository: async () => undefined,
          loadConfig: async () => ({ ...defaultConfig, keybindings: { "dialog.close": ["f4"], "item.copy": ["f3"] } }),
          createRepositorySession: () => ({ ...session, issueDetail: () => issueDetail }),
          copyToHostClipboard: async (value) => {
            copied = value
            return true
          },
        }}
      />
    ),
    { width: 120, height: 32 },
  )
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
  const view = await testRender(
    () => (
      <Root
        cwd="/unused"
        services={{
          createPullReviewSession: createTestReviewSession,
          resolveRepository: async () => "cli/cli",
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async () => {},
          resolveLocalRepository: async () => undefined,
          loadConfig: () => (++loads === 1 ? Promise.resolve({ ...defaultConfig }) : reload.promise),
          saveConfig: async (value) => {
            saved = value
          },
          createRepositorySession: readySession,
        }}
      />
    ),
    { width: 120, height: 32, exitOnCtrlC: false },
  )
  active.push(view)
  await Bun.sleep(0)
  await view.flush()
  view.mockInput.pressKey("r", { ctrl: true })
  view.mockInput.pressKey(",")
  view.mockInput.pressArrow("down")
  view.mockInput.pressEnter()
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  view.mockInput.pressCtrlC()
  await Bun.sleep(0)
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
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

test("remapped interrupt cancels commands first, dismisses completed output, then quits", async () => {
  const result = deferred<{ exitCode: number; cancelled: boolean }>()
  let cancelled = 0
  let copied = ""
  const view = await testRender(
    () => (
      <Root
        cwd="/unused"
        services={{
          createPullReviewSession: createTestReviewSession,
          resolveRepository: async () => "cli/cli",
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async () => {},
          resolveLocalRepository: async () => undefined,
          loadConfig: async () => ({
            ...defaultConfig,
            keybindings: {
              "global.interrupt": ["ctrl+x"],
              "command.clone": ["f2"],
              "dialog.confirm": ["f3"],
              "command.copyOutput": ["f5"],
            },
          }),
          runCommand: (_spec, output) => {
            output("command output\n")
            return {
              result: result.promise,
              cancel: () => {
                cancelled++
                result.resolve({ exitCode: 143, cancelled: true })
              },
            }
          },
          copyToHostClipboard: async (value) => {
            copied = value
            return true
          },
          createRepositorySession: readySession,
        }}
      />
    ),
    { width: 120, height: 32, exitOnCtrlC: false },
  )
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
  await view.flush()
  expect(view.renderer.isDestroyed).toBe(false)
  expect(view.captureCharFrame()).not.toContain("Cancelled (exit 143)")
  view.mockInput.pressKey("x", { ctrl: true })
  await Bun.sleep(0)
  expect(view.renderer.isDestroyed).toBe(true)
})

test("mouse hyperlinks resolve entities and preserve Back across repositories and linked lists", async () => {
  const source = "owner/source"
  const destination = "owner/other"
  const sourceUrl = `https://github.com/${source}`
  const pullUrl = `https://github.com/${destination}/issues/42`
  const commitUrl = `https://github.com/${destination}/commit/abc1234`
  const externalUrl = "https://example.com/guide#install"
  const missingUrl = "https://github.com/owner/missing/pull/99"
  const [state, setState] = createSignal<RepositoryState>({ status: "loading", repository: source })
  const [issue, setIssue] = createSignal<IssueDetailState>()
  const [pull, setPull] = createSignal<PullDetailState>()
  const [commit, setCommit] = createSignal<CommitDetailState>()
  const repositories: string[] = []
  const resolved: string[] = []
  const external: string[] = []
  const session = {
    ...readySession(),
    state,
    issueDetail: issue,
    pullDetail: pull,
    commitDetail: commit,
    clearIssue: () => setIssue(undefined),
    clearPull: () => setPull(undefined),
    clearCommit: () => setCommit(undefined),
    load: async (repository: string) => {
      repositories.push(repository)
      setState({ status: "loading", repository })
      await Promise.resolve()
      if (repository === "owner/missing") {
        setState({ status: "error", repository, message: "Repository unavailable" })
        return
      }
      setState({
        status: "ready",
        repository,
        data: {
          ...structuredClone(githubDataFixture),
          repo: { ...githubDataFixture.repo, nameWithOwner: repository, url: `https://github.com/${repository}` },
        },
        operations: structuredClone(repositoryOperationsFixture),
      })
    },
    loadIssue: async (number: number) => {
      setIssue({
        number,
        resource: {
          status: "ready",
          value: {
            ...issueDetailFixture,
            number,
            title: number === 1 ? "Source issue" : "Another issue",
            url: `${sourceUrl}/issues/${number}`,
            body: `[Other PR](${pullUrl}) · [External](${externalUrl}) · [Home](${sourceUrl}) · [List](${sourceUrl}/issues) · [Missing](${missingUrl})`,
          },
        },
        comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
        references: { status: "ready", value: [] },
      })
    },
    loadPull: async (number: number) => {
      setPull({
        number,
        resource: {
          status: "ready",
          value: {
            ...issueDetailFixture,
            number,
            title: "Destination PR",
            url: pullUrl.replace("/issues/", "/pull/"),
            body: `[Commit](${commitUrl})`,
            merged: false,
            draft: false,
            baseBranch: "main",
            headBranch: "feature",
            additions: 1,
            deletions: 0,
            changedFiles: 1,
            commitCount: 1,
            reviewers: [],
            mergeable: true,
          },
        },
        comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
        references: { status: "ready", value: [] },
        commits: { status: "ready", value: [] },
        context: { status: "loading", phase: "load" },
      })
    },
    loadCommit: async (sha: string) => {
      setCommit({
        sha,
        resource: {
          status: "ready",
          value: {
            ...commitDetailFixture,
            sha,
            message: "Target commit",
            fullMessage: "Target commit",
          },
        },
      })
    },
  }
  const view = await testRender(
    () => (
      <Root
        cwd="/unused"
        repositoryArgument={source}
        initialDetail={{ kind: "issue", number: 1 }}
        services={{
          createPullReviewSession: createTestReviewSession,
          createRepositorySession: () => session,
          resolveRepository: async () => source,
          resolveLocalRepository: async () => undefined,
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async () => {},
          loadConfig: async () => ({ ...defaultConfig }),
          loadIssueKind: async (repository, number) => {
            resolved.push(`${repository}#${number}`)
            return "pull"
          },
          openUrl: async (url) => {
            external.push(url)
          },
        }}
      />
    ),
    { width: 120, height: 32 },
  )
  active.push(view)
  const settle = async () => {
    await Bun.sleep(0)
    await view.flush()
  }
  const blocks = (node: Renderable): CodeRenderable[] => [
    ...(node instanceof CodeRenderable ? [node] : []),
    ...node.getChildren().flatMap(blocks),
  ]
  const click = async (url: string) => {
    for (let pass = 0; pass < 3; pass++) {
      await settle()
      await Promise.all(blocks(view.renderer.root).map((block) => block.highlightingDone))
      await view.flush()
      for (let y = 0; y < view.renderer.height; y++)
        for (let x = 0; x < view.renderer.width; x++) {
          if (view.renderer.getLinkAt(x, y) !== url) continue
          await view.mockMouse.click(x, y)
          await settle()
          return
        }
    }
    throw new Error(`Link was not painted: ${url}`)
  }
  const back = async () => {
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await settle()
  }
  await settle()
  expect(view.captureCharFrame()).toContain("Source issue")
  await click(externalUrl)
  expect(external).toEqual([externalUrl])
  expect(view.captureCharFrame()).toContain("Source issue")
  await click(pullUrl)
  expect(resolved).toEqual([`${destination}#42`])
  expect(view.captureCharFrame()).toContain("Destination PR")
  await click(commitUrl)
  expect(view.captureCharFrame()).toContain("Target commit")
  await back()
  expect(view.captureCharFrame()).toContain("Destination PR")
  expect(repositories).toEqual([source, destination])
  await back()
  expect(view.captureCharFrame()).toContain("Source issue")
  expect(repositories).toEqual([source, destination, source])
  await click(sourceUrl)
  expect(view.captureCharFrame()).not.toContain("Source issue")
  await back()
  expect(view.captureCharFrame()).toContain("Source issue")
  await click(`${sourceUrl}/issues`)
  view.mockInput.pressEnter()
  await settle()
  expect(view.captureCharFrame()).toContain("Another issue")
  await back()
  await back()
  expect(view.captureCharFrame()).toContain("Source issue")
  await click(missingUrl)
  expect(view.captureCharFrame()).toContain("Repository unavailable")
  await back()
  expect(view.captureCharFrame()).toContain("Source issue")
})

test.each(["issue", "diff"] as const)(
  "resumes the saved repository and %s without directory discovery, then reports navigation",
  async (kind) => {
    const repository = "owner/previous"
    const [state, setState] = createSignal<RepositoryState>({ status: "loading", repository })
    const [issue, setIssue] = createSignal<IssueDetailState>()
    const [diffs, setDiffs] = createSignal<Partial<Record<DiffTarget["kind"], DiffState>>>({})
    const locations: ResumeLocation[] = []
    const loaded: unknown[] = []
    const loadedPulls: number[] = []
    const reviewOpens: { repository: string; number: number }[] = []
    const saved = resumeLocation(
      repository,
      kind === "issue"
        ? { page: "issues", details: { issues: { kind: "issue", number: 42 } } }
        : { page: "pulls", diffs: { pulls: { kind: "pull", number: 42 } } },
    )
    const view = await createTestRenderer({ width: 120, height: 32 })
    initializeHunk(view.renderer)
    await render(
      () => (
        <Root
          cwd="/different/repository"
          resumeLocation={saved}
          onNavigationChange={(location) => locations.push(location)}
          services={{
            createPullReviewSession: () => ({
              ...createTestReviewSession(),
              open: async (repository, number) => {
                reviewOpens.push({ repository, number })
              },
            }),
            resolveRepository: async () => {
              throw new Error("Resume must not discover the current directory")
            },
            resolveLocalRepository: async () => undefined,
            loadRecentRepositories: async () => [],
            rememberRepository: async () => {},
            loadRepositoryTabs: async () => ({ [repository]: "actions" }),
            saveRepositoryTabs: async () => {},
            loadConfig: async () => ({ ...defaultConfig }),
            createRepositorySession: () => ({
              ...readySession(),
              state,
              issueDetail: issue,
              diffs,
              load: async (name) => {
                loaded.push(name)
                setState({
                  status: "ready",
                  repository: name,
                  data: { ...githubDataFixture, repo: { ...githubDataFixture.repo, nameWithOwner: name } },
                  operations: repositoryOperationsFixture,
                })
              },
              loadIssue: async (number) => {
                loaded.push(number)
                setIssue({
                  number,
                  resource: { status: "ready", value: { ...issueDetailFixture, number, title: "Resumed issue" } },
                  comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
                  references: { status: "ready", value: [] },
                })
              },
              loadPull: async (number) => {
                loadedPulls.push(number)
              },
              loadDiff: async (target) => {
                loaded.push(target)
                setDiffs({ [target.kind]: { target, resource: { status: "ready", value: { kind: "patch", patch: patchFixture } } } })
              },
              clearDiff: () => setDiffs({}),
            }),
          }}
        />
      ),
      view.renderer,
    )
    const settle = async () => {
      await Bun.sleep(0)
      await view.flush()
      await view.renderer.idle()
      await view.flush()
    }
    try {
      await settle()
      expect(view.captureCharFrame()).toContain(kind === "issue" ? "Resumed issue" : "newValue")
      expect(loaded).toEqual([repository, kind === "issue" ? 42 : { kind: "pull", number: 42 }])
      expect(loadedPulls).toEqual(kind === "diff" ? [42] : [])
      expect(reviewOpens).toEqual(kind === "diff" ? [{ repository, number: 42 }] : [])
      expect(locations.at(-1)).toEqual(saved)
      const count = locations.length
      view.mockInput.pressKey("?")
      await settle()
      expect(locations).toHaveLength(count)
      view.mockInput.pressEscape()
      await Bun.sleep(30)
      await settle()
      view.mockInput.pressEscape()
      await Bun.sleep(30)
      await settle()
      expect(locations.at(-1)).toEqual(resumeLocation(repository, { page: kind === "issue" ? "issues" : "pulls" }))
      view.mockInput.pressKey("2")
      await settle()
      expect(locations.at(-1)).toEqual(resumeLocation(repository, { page: "commits" }))
    } finally {
      view.renderer.destroy()
      await view.renderer.closed
    }
  },
)

test.each([false, true])(
  "async resume failures fall back only while the restored page is active (navigated away: %s)",
  async (navigatedAway) => {
    const [issue, setIssue] = createSignal<IssueDetailState>()
    const locations: ResumeLocation[] = []
    const failure = deferred<void>()
    const view = await testRender(
      () => (
        <Root
          cwd="/unused"
          resumeLocation={resumeLocation("cli/cli", { page: "issues", details: { issues: { kind: "issue", number: 42 } } })}
          onNavigationChange={(location) => locations.push(location)}
          services={{
            createPullReviewSession: createTestReviewSession,
            resolveLocalRepository: async () => undefined,
            loadRecentRepositories: async () => [],
            rememberRepository: async () => {},
            loadRepositoryTabs: async () => ({}),
            saveRepositoryTabs: async () => {},
            loadConfig: async () => ({ ...defaultConfig }),
            createRepositorySession: () => ({
              ...readySession(),
              issueDetail: issue,
              loadIssue: async (number) => {
                await failure.promise
                const resource = { status: "error", phase: "load", message: "Not Found (HTTP 404)" } as const
                setIssue({ number, resource, comments: resource, references: resource })
              },
            }),
          }}
        />
      ),
      { width: 120, height: 32 },
    )
    try {
      await Bun.sleep(0)
      await view.flush()
      expect(view.captureCharFrame()).toContain("Issue #42")
      if (navigatedAway) {
        view.mockInput.pressKey("2")
        await view.flush()
      }
      failure.resolve()
      await Bun.sleep(0)
      await view.flush()
      if (navigatedAway) expect(view.captureCharFrame()).not.toContain("Could not resume page")
      else {
        expect(view.captureCharFrame()).toContain("About")
        expect(view.captureCharFrame()).toContain("Could not resume page")
        expect(view.captureCharFrame()).toContain("Not Found")
      }
      expect(locations.at(-1)).toMatchObject({ repository: "cli/cli", state: { page: navigatedAway ? "commits" : "overview" } })
      expect(locations.at(-1)!.state.details).toBeUndefined()
      expect(locations.at(-1)!.state.diffs).toBeUndefined()
    } finally {
      view.renderer.destroy()
      await view.renderer.closed
    }
  },
)

test("resume keeps the selected overview document through async discovery and falls back only when missing", async () => {
  const documents = githubDataFixture.documents.value!
  const selected = documents[3]!
  const ready = { status: "ready", repository: "cli/cli", data: githubDataFixture, operations: repositoryOperationsFixture } as const
  const [state, setState] = createSignal<RepositoryState>({
    ...ready,
    data: { ...ready.data, documents: { status: "loading", phase: "load" } },
  })
  let location: ResumeLocation | undefined
  const view = await testRender(
    () => (
      <Root
        cwd="/unused"
        resumeLocation={resumeLocation("cli/cli", { page: "overview", document: selected.id })}
        onNavigationChange={(next) => {
          location = next
        }}
        services={{
          createPullReviewSession: createTestReviewSession,
          resolveLocalRepository: async () => undefined,
          loadRecentRepositories: async () => [],
          rememberRepository: async () => {},
          loadRepositoryTabs: async () => ({}),
          saveRepositoryTabs: async () => {},
          loadConfig: async () => ({ ...defaultConfig }),
          createRepositorySession: () => ({ ...readySession(), state }),
        }}
      />
    ),
    { width: 120, height: 32 },
  )
  const settle = async () => {
    await Bun.sleep(0)
    await view.flush()
    await view.renderer.idle()
    await view.flush()
  }
  try {
    await settle()
    expect(location?.state.document).toBe(selected.id)
    setState(ready)
    await settle()
    expect(location?.state.document).toBe(selected.id)
    expect(view.captureCharFrame()).toContain("Copyright OpenTUI contributors.")
    setState({
      ...ready,
      data: { ...ready.data, documents: { status: "ready", value: documents.filter((document) => document.id !== selected.id) } },
    })
    await settle()
    expect(location?.state.document).toBe(documents[0]!.id)
  } finally {
    view.renderer.destroy()
    await view.renderer.closed
  }
})
