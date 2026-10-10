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

  test("continues startup with defaults when config loading fails", async () => {
    const view = await testRender(
      () => (
        <Root
          cwd="/work/repository"
          services={{
            resolveRepository: async () => undefined,
            loadRecentRepositories: async () => [],
            loadConfig: async () => { throw new Error("Malformed config") },
          }}
        />
      ),
      { width: 80, height: 24, useThread: false },
    )
    active.push(view)
    await Bun.sleep(0)
    await view.flush()

    expect(view.captureCharFrame()).toContain("Open a GitHub repository")
  })

  test("persists settings before applying them", async () => {
    const [state] = createSignal<RepositoryState>({
      status: "ready",
      repository: "cli/cli",
      data: structuredClone(githubDataFixture),
      operations: structuredClone(repositoryOperationsFixture),
    })
    let saved: Config | undefined
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
            loadConfig: async () => ({ showScrollbars: false, theme: "github", aboutSidebar: "auto" }),
            saveConfig: async (config) => { saved = config },
            createRepositorySession: () => ({
              state,
              load: idle,
              refresh: idle,
              retryResource: idle,
              switchBranch: idle,
              loadMoreBranches: idle,
              loadMoreCommits: idle,
              loadMoreRuns: idle,
              loadMoreIssues: idle,
              loadMorePulls: idle,
            }),
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

    expect(saved).toEqual({ showScrollbars: true, theme: "github", aboutSidebar: "auto" })
    expect(view.captureCharFrame()).toContain("‹ on ›")
  })
})
