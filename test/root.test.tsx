import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { defaultConfig, type Config } from "../src/config"
import type { RepositoryState } from "../src/repository-state"
import { Root } from "../src/root"
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
    commitDetail: () => undefined,
    loadCommit: idle,
    loadMoreCommitFiles: idle,
    clearCommit: () => {},
    issueDetail: () => undefined,
    loadIssue: idle,
    loadMoreIssueComments: idle,
    retryIssueReferences: idle,
    clearIssue: () => {},
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
            loadRecentRepositories: async () => ["cli/cli"],
            loadConfig: async () => ({ ...defaultConfig }),
          }}
        />
      ),
      { width: 80, height: 24, useThread: false },
    )
    active.push(view)
    await view.flush()

    expect(view.captureCharFrame()).toContain("openGH")
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

  test("warns and prevents overwriting config when loading fails", async () => {
    let saves = 0
    const view = await testRender(
      () => (
        <Root
          cwd="/work/repository"
          services={{
            resolveRepository: async () => undefined,
            loadRecentRepositories: async () => [],
            loadConfig: async () => { throw new Error("Malformed config") },
            saveConfig: async () => { saves++ },
            rememberRepository: async () => {},
            createRepositorySession: readySession,
          }}
        />
      ),
      { width: 80, height: 24, useThread: false },
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
            loadRecentRepositories: async () => [],
            rememberRepository: idle,
            loadConfig: async () => ({ showScrollbars: false, theme: "github", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }),
            saveConfig: async (config) => {
              saved.push(config)
              await writes[saved.length - 1]!.promise
            },
            createRepositorySession: readySession,
          }}
        />
      ),
      { width: 120, height: 32, useThread: false },
    )
    active.push(view)
    await Bun.sleep(0)
    await view.flush()

    view.mockInput.pressKey(",")
    view.mockInput.pressArrow("down")
    view.mockInput.pressArrow("right")
    await Bun.sleep(0)
    await view.flush()

    expect(saved).toEqual([{ showScrollbars: true, theme: "github", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }])
    expect(view.captureCharFrame()).toContain("‹ off ›")
    expect(view.captureCharFrame()).toContain("Saving…")

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
    expect(view.captureCharFrame()).toContain("Saving…")
    expect(saved[1]).toEqual({ showScrollbars: true, theme: "nord", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" })

    writes[1]!.resolve()
    await view.flush()
    expect(view.captureCharFrame()).toContain("Settings")
    expect(view.captureCharFrame()).toContain("‹ nord ›")
    expect(view.captureCharFrame()).toContain("‹ on ›")
  })
})
