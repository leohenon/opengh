import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "../src/config"
import { createRepositorySession, type RepositoryLoaders } from "../src/repository-session"
import { Root } from "../src/root"
import type { CommandResult } from "../src/command-actions"
import { clickControl } from "./fixtures/mouse"
import { commitDetailFixture, githubDataFixture, issueDetailFixture, pullContextFixture } from "./fixtures/github-data"

// Exercise the real Root, session, focused input, and mounted repository pages without GitHub or disk writes.
test("repository switch popup isolates input, preserves cancelled navigation, and resets confirmed switches", async () => {
  const loads: string[] = []
  const branchLoads: string[] = []
  let missingFails = true
  let recent = ["anomalyco/opentui", ...Array.from({ length: 98 }, (_, index) => `owner/repo-${index}`), "owner/qrshly"]
  let recentReads = 0
  let saves = 0
  let browser = 0
  let finishCommand!: (result: CommandResult) => void
  let finishMetadata!: () => void
  const pendingMetadata = new Promise<void>((resolve) => { finishMetadata = resolve })
  const loaders: RepositoryLoaders = {
    workCounts: async () => ({ issues: 61, pulls: 24 }),
    commitCount: async () => 4,
    metadata: async (repository) => {
      loads.push(repository)
      if (repository === "owner/missing" && missingFails) throw new Error("Repository not found")
      if (repository === "owner/pending") await pendingMetadata
      return { ...githubDataFixture.repo, nameWithOwner: repository, url: `https://github.com/${repository}` }
    },
    documents: async (repo, branch) => [{ id: `${repo.nameWithOwner}:README.md`, repository: repo.nameWithOwner, ref: branch, path: "README.md", label: "README" }],
    document: async () => Array.from({ length: 100 }, (_, index) => `Line ${index} of documentation\n`).join("\n"),
    branches: async () => ({ items: ["main", "next"], hasMore: false }),
    commits: async (repository, branch) => { branchLoads.push(`${repository}:${branch}`); return { items: githubDataFixture.commits.value!.items, hasMore: false } },
    commit: async (_repository, sha) => ({ ...commitDetailFixture, sha }),
    issue: async () => issueDetailFixture,
    issueComments: async () => ({ items: [], hasMore: false }),
    issueReferences: async () => [],
    issues: async (_repository, state) => ({ items: githubDataFixture.issues[state].value!.items, hasMore: false }),
    pulls: async (_repository, state) => ({ items: githubDataFixture.pulls[state].value!.items, hasMore: false }),
    pullCommits: async () => githubDataFixture.commits.value!.items,
    pullContext: async () => pullContextFixture,
    runs: async () => ({ items: githubDataFixture.runs.value!.items, hasMore: false }),
  }
  const view = await testRender(() => <Root cwd="/work" repositoryArgument="anomalyco/opentui" services={{
    resolveRepository: async () => "anomalyco/opentui",
    resolveLocalRepository: async () => undefined,
    loadRepositoryTabs: async () => ({}),
    saveRepositoryTabs: async () => {},
    loadRecentRepositories: async () => { recentReads++; return [...recent] },
    rememberRepository: async (repository) => { recent = [repository, ...recent.filter((item) => item !== repository)] },
    loadConfig: async () => ({ ...defaultConfig, theme: "nord", showStatusBarHints: true }),
    saveConfig: async () => { saves++ },
    createRepositorySession: () => createRepositorySession(loaders),
    openGitHub: async () => { browser++ },
    runCommand: () => ({ cancel: () => finishCommand({ exitCode: 143, cancelled: true }), result: new Promise<CommandResult>((resolve) => { finishCommand = resolve }) }),
  }} />, { width: 120, height: 32, exitOnCtrlC: false })
  const settle = async () => { await Bun.sleep(0); await view.flush() }
  const escape = async () => { view.mockInput.pressEscape(); await Bun.sleep(30); await view.flush() }
  const switchPage = async (mouse = false) => {
    if (mouse) await clickControl(view, "repository-dropdown")
    else view.mockInput.pressKey("s")
    await settle()
    expect(view.captureCharFrame()).toContain("Switch repository")
    expect(view.renderer.root.findDescendantById("picker-submit")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("picker-back")).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("s switch repo")
  }
  try {
    await settle()
    expect(loads).toEqual(["anomalyco/opentui"])
    expect(recent[0]).toBe("anomalyco/opentui")
    view.mockInput.pressKey("2")
    await settle()
    for (const branch of ["next", "main"]) {
      await clickControl(view, "branch-dropdown")
      await clickControl(view, "picker-row-1")
      await settle()
      expect(view.captureCharFrame()).toContain(`${branch} ▾`)
      expect(branchLoads.at(-1)).toBe(`anomalyco/opentui:${branch}`)
      const before = branchLoads.length
      await clickControl(view, "branch-dropdown")
      await clickControl(view, "picker-row-0")
      expect(branchLoads).toHaveLength(before)
    }
    expect(branchLoads).toEqual(["anomalyco/opentui:main", "anomalyco/opentui:next", "anomalyco/opentui:main"])
    expect(loads).toEqual(["anomalyco/opentui"])
    view.mockInput.pressKey("1")
    await settle()
    view.mockInput.pressKey("s", { ctrl: true })
    await settle()
    expect(view.captureCharFrame()).not.toContain("Switch repository")
    await Bun.sleep(80) // Markdown rendering is scheduled independently of the repository loader.
    view.mockInput.pressKey("d")
    await settle()
    expect(view.captureCharFrame()).toContain("Line 5 of documentation")
    const scrolled = view.captureCharFrame()
    await switchPage(true)
    await view.mockInput.typeText("qrshly?,123")
    await settle()
    expect(view.captureCharFrame()).toContain("qrshly?,123")
    expect(browser).toBe(0)
    expect(view.renderer.isDestroyed).toBe(false)
    expect(loads).toHaveLength(1)
    view.mockInput.pressEnter()
    await settle()
    expect(view.captureCharFrame()).toContain("Enter owner/repository or a GitHub URL")
    expect(loads).toHaveLength(1)
    await escape()
    expect(view.captureCharFrame()).toBe(scrolled)

    // List selection and detail both survive cancellation.
    view.mockInput.pressKey("2")
    view.mockInput.pressArrow("down")
    await settle()
    const selected = view.captureCharFrame()
    await switchPage()
    await escape()
    expect(view.captureCharFrame()).toBe(selected)
    view.mockInput.pressEnter()
    await settle()
    const detail = view.captureCharFrame()
    expect(detail).toContain("cad92f4")
    recent = recent.filter((repository) => repository !== "anomalyco/opentui")
    await switchPage(true)
    expect(view.captureCharFrame()).toContain("✓ current")
    await clickControl(view, "picker-row-0") // Current is pinned even when absent from recent history.
    await settle()
    expect(loads).toHaveLength(1)
    expect(view.captureCharFrame()).toBe(detail)

    // All existing overlay modes block the new shortcut, including a running clone.
    view.mockInput.pressKey("?")
    view.mockInput.pressKey("s")
    await settle()
    expect(view.captureCharFrame()).toContain("Help")
    expect(view.captureCharFrame()).toContain("switch repository")
    expect(view.captureCharFrame()).not.toContain("Switch repository")
    await escape()
    view.mockInput.pressKey(",")
    view.mockInput.pressKey("s")
    await settle()
    expect(view.captureCharFrame()).toContain("Settings")
    await escape()
    await escape() // back to commits
    view.mockInput.pressTab()
    view.mockInput.pressKey("s")
    await settle()
    expect(view.captureCharFrame()).not.toContain("Switch repository")
    await escape()
    view.mockInput.pressKey("1")
    view.mockInput.pressKey("x")
    view.mockInput.pressKey("s")
    await settle()
    expect(view.captureCharFrame()).toContain("Clone anomalyco/opentui?")
    view.mockInput.pressEnter()
    await settle()
    view.mockInput.pressKey("s")
    await settle()
    expect(view.captureCharFrame()).toContain("Running")
    expect(view.captureCharFrame()).not.toContain("Switch repository")
    finishCommand({ exitCode: 0, cancelled: false })
    await settle()
    await escape()

    view.mockInput.pressKey("2")
    view.mockInput.pressEnter()
    await settle()
    const readsBefore = recentReads
    await switchPage(true)
    await view.mockInput.typeText("qrshly") // partial query must choose the filtered recent
    await settle()
    await clickControl(view, "picker-row-0")
    await settle()
    expect(loads).toEqual(["anomalyco/opentui", "owner/qrshly"])
    expect(view.captureCharFrame()).toContain("owner/qrshly")
    expect(view.captureCharFrame()).toContain("About")
    expect(view.captureCharFrame()).not.toContain("cad92f4")
    expect(recentReads).toBeGreaterThan(readsBefore)

    await switchPage()
    expect(view.captureCharFrame().indexOf("› owner / qrshly")).toBeGreaterThan(-1)
    await view.mockInput.typeText("https://github.com/owner/missing")
    view.mockInput.pressEnter()
    await settle()
    await settle()
    expect(loads.at(-1)).toBe("owner/missing")
    expect(view.captureCharFrame()).toContain("Repository not found")
    expect(recent).not.toContain("owner/missing")
    expect(recent[0]).toBe("owner/qrshly")
    await view.mockMouse.click(0, 0)
    await settle()
    expect(view.captureCharFrame()).toContain("Switch repository")
    await escape()
    expect(view.captureCharFrame()).toContain("Repository not found")
    missingFails = false
    view.mockInput.pressKey("r")
    await settle()
    expect(view.captureCharFrame()).toContain("About")
    expect(recent[0]).toBe("owner/missing")
    await switchPage()
    await view.mockInput.typeText("https://github.com/cli/cli.git")
    view.mockInput.pressEnter()
    await settle()
    expect(loads.at(-1)).toBe("cli/cli")
    expect(view.captureCharFrame()).toContain("About")
    expect(saves).toBe(0)
    await switchPage()
    expect(view.captureCharFrame()).toContain("› cli / cli")
    await view.mockInput.typeText("owner/pending")
    view.mockInput.pressEnter()
    await settle()
    expect(view.captureCharFrame()).toContain("owner/pending")
    expect(recent).not.toContain("owner/pending")
    await switchPage() // A slow load is escapable; an obsolete response must not replace the chosen repo.
    await view.mockInput.typeText("cli/cli")
    view.mockInput.pressEnter()
    await settle()
    finishMetadata()
    await settle()
    expect(view.captureCharFrame()).toContain("cli/cli")
    expect(view.captureCharFrame()).not.toContain("owner/pending")
    expect(recent).not.toContain("owner/pending")
    expect(recent[0]).toBe("cli/cli")
    view.mockInput.pressKey(",")
    await settle()
    expect(view.captureCharFrame()).toContain("nord")
  } finally { view.renderer.destroy() }
})
