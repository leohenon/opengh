import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { CommitDetailState } from "../src/repository-state"
import { defaultConfig } from "../src/config"
import { App } from "../src/ui/app"
import { commitDetailFixture, githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const view of active.splice(0)) if (!view.renderer.isDestroyed) view.renderer.destroy()
})

test("commit tabs retain detail state and Escape restores the list after resizing", async () => {
  const commits = Array.from({ length: 35 }, (_, index) => ({
    ...commitDetailFixture,
    sha: index.toString(16).padStart(40, "0"),
    message: `Commit ${index}`,
  }))
  const files = Array.from({ length: 30 }, (_, index) => ({
    path: `src/module-${index}.ts`, status: "modified", additions: 1, deletions: 0,
  }))
  const [detail, setDetail] = createSignal<CommitDetailState>()
  const opened: string[] = []
  let refreshes = 0
  let moreFiles = 0
  const copies: string[] = []
  const view = await testRender(() => (
    <App
      config={{ ...defaultConfig, showStatusBarHints: true }}
      data={{ ...githubDataFixture, commits: { status: "ready", value: { items: commits, page: 1, hasMore: false } } }}
      operations={repositoryOperationsFixture}
      commitDetail={detail()}
      onLoadCommit={async (sha) => {
        opened.push(sha)
        const commit = commits.find((item) => item.sha === sha)!
        setDetail({ sha, resource: { status: "ready", value: {
          ...commit, fullMessage: `${commit.message}\n\nA full commit message body.`,
          files: { items: files, page: 1, hasMore: false },
        } } })
      }}
      onCloseCommit={() => setDetail(undefined)}
      onRefresh={() => { refreshes++ }}
      onLoadMoreCommitFiles={async () => { moreFiles++ }}
    />
  ), { width: 120, height: 28, useThread: false })
  active.push(view)
  view.renderer.copyToClipboardOSC52 = (value) => { copies.push(value); return true }
  await view.flush()
  view.mockInput.pressKey("2")
  await view.flush()
  for (let i = 0; i < 18; i++) view.mockInput.pressKey("j")
  await view.flush()
  const listFrame = view.captureCharFrame()

  view.mockInput.pressEnter()
  await view.flush()
  expect(opened).toEqual([commits[18]!.sha])
  expect(view.captureCharFrame()).toContain("A full commit message body.")
  expect(view.captureCharFrame()).toContain("max committed")
  expect(view.captureCharFrame()).not.toContain("2026-04-14 06:41:00 UTC")
  expect(view.captureCharFrame()).toContain("Committer web-flow")
  expect(view.captureCharFrame()).toContain("Files changed · 30 files")

  view.mockInput.pressKey("G")
  await view.flush()
  expect(view.captureCharFrame()).toContain("src/module-29.ts")
  expect(view.captureCharFrame()).not.toContain("Commit 18")
  view.mockInput.pressKey("?")
  view.mockInput.pressKey("g")
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  await view.flush()
  expect(view.captureCharFrame()).toContain("src/module-29.ts")
  view.mockInput.pressTab()
  await view.flush()
  expect(view.captureCharFrame()).not.toContain("Switch branch")

  view.resize(40, 22)
  view.mockInput.pressKey("g")
  await view.flush()
  expect(view.captureCharFrame()).toContain("esc back · o GitHub · y SHA")
  expect(view.captureCharFrame()).toContain("Commit 18")
  view.resize(120, 28)
  await view.flush()
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  await view.flush()
  expect(view.captureCharFrame()).toBe(listFrame)
  view.mockInput.pressEnter()
  await view.flush()
  expect(opened).toEqual([commits[18]!.sha, commits[18]!.sha])
  view.mockInput.pressKey("G")
  await view.flush()
  const detailFrame = view.captureCharFrame()
  const retained = detail()
  view.mockInput.pressKey("4")
  await view.flush()
  expect(view.captureCharFrame()).toContain("Open (3)")
  expect(view.captureCharFrame()).not.toContain("o GitHub · y SHA")
  expect(view.captureCharFrame()).not.toContain("src/module-29.ts")
  view.mockInput.pressKey("g")
  view.mockInput.pressKey("y")
  view.mockInput.pressEnter()
  view.mockInput.pressKey("r")
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  await view.flush()
  expect(detail()).toBe(retained)
  expect(refreshes).toBe(0) // The active PR detail owns refresh; it must not refresh the hidden commit/repository.
  expect(copies).toEqual([`${githubDataFixture.repo.url}/pull/421`])
  expect(moreFiles).toBe(0)
  view.mockInput.pressKey("2")
  await view.flush()
  expect(view.captureCharFrame()).toBe(detailFrame)
  expect(opened).toHaveLength(2)
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  await view.flush()
  expect(detail()).toBeUndefined()
  expect(view.captureCharFrame()).toBe(listFrame)
})

test("overview, commit, and PR shortcuts open GitHub and copy the active URL or SHA", async () => {
  const sha = commitDetailFixture.sha
  const [detail, setDetail] = createSignal<CommitDetailState>()
  let loads = 0
  let more = 0
  let browserSha: string | number | undefined = ""
  let browserFails = false
  let copiedSha = ""
  let nativeClipboard = true
  let copyFails = false
  let terminalCopies = 0
  const view = await testRender(() => (
    <App
      config={{ ...defaultConfig, showStatusBarHints: true }}
      data={githubDataFixture}
      operations={repositoryOperationsFixture}
      commitDetail={detail()}
      onLoadCommit={async () => {
        loads++
        setDetail({ sha, resource: loads === 1
          ? { status: "loading", phase: "load" }
          : { status: "ready", value: { ...commitDetailFixture, files: { ...commitDetailFixture.files, hasMore: true } } },
        })
      }}
      onLoadMoreCommitFiles={async () => { more++ }}
      onOpenInBrowser={async (value) => {
        if (browserFails) throw new Error("Browser unavailable")
        browserSha = value
      }}
      onCloseCommit={() => setDetail(undefined)}
      onCopyToClipboard={async (value) => {
        if (copyFails) throw new Error("Native clipboard unavailable")
        if (!nativeClipboard) return false
        copiedSha = value
        return true
      }}
    />
  ), { width: 100, height: 28, useThread: false })
  active.push(view)
  view.renderer.copyToClipboardOSC52 = (value) => { terminalCopies++; copiedSha = value; return true }
  await view.flush()
  view.mockInput.pressKey("y")
  await view.flush()
  expect(copiedSha).toBe(githubDataFixture.repo.url)
  expect(view.captureCharFrame()).toContain("URL copied to clipboard")
  expect(terminalCopies).toBe(0)
  view.mockInput.pressKey("o")
  await view.flush()
  expect(browserSha).toBeUndefined()
  expect(view.captureCharFrame()).toContain("README")
  expect(view.captureCharFrame()).toContain("Opened on GitHub")

  view.mockInput.pressKey("2")
  await view.flush()
  expect(view.captureCharFrame()).toContain("enter open · o GitHub · y SHA")
  expect(view.captureCharFrame()).toContain("? help")
  view.mockInput.pressKey("j")
  view.mockInput.pressKey("y")
  await view.flush()
  expect(copiedSha).toBe(githubDataFixture.commits.value!.items[1]!.sha)
  expect(view.captureCharFrame()).toContain("SHA copied to clipboard")
  view.mockInput.pressKey("o")
  await view.flush()
  expect(browserSha).toBe(githubDataFixture.commits.value!.items[1]!.sha)
  expect(loads).toBe(0)
  expect(detail()).toBeUndefined()
  expect(view.captureCharFrame()).toContain("4 commits")
  expect(view.captureCharFrame()).toContain("Opened on GitHub")
  browserFails = true
  view.mockInput.pressKey("o")
  await view.flush()
  expect(view.captureCharFrame()).toContain("Browser unavailable")
  browserFails = false
  browserSha = ""
  copiedSha = ""
  view.mockInput.pressKey("?")
  view.mockInput.pressKey("o")
  view.mockInput.pressKey("y")
  await view.flush()
  expect(browserSha).toBe("")
  expect(copiedSha).toBe("")
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  view.mockInput.pressKey("4")
  view.mockInput.pressKey("o")
  view.mockInput.pressKey("y")
  await view.flush()
  expect<string | number | undefined>(browserSha).toBe(421)
  expect(copiedSha).toBe(`${githubDataFixture.repo.url}/pull/421`)
  view.mockInput.pressKey("2")
  view.mockInput.pressKey("g")
  view.mockInput.pressEnter()
  await Bun.sleep(210)
  await view.flush()
  expect(view.captureCharFrame()).toContain("Loading…")
  expect(view.captureCharFrame()).toContain("o GitHub · y SHA")
  setDetail({ sha, resource: { status: "error", phase: "load", message: "Commit unavailable" } })
  await view.flush()
  expect(view.captureCharFrame()).toContain("Commit unavailable")
  expect(view.captureCharFrame()).toContain("r to retry")
  view.mockInput.pressKey("r")
  await view.flush()
  expect(loads).toBe(2)
  expect(view.captureCharFrame()).toContain("2 files loaded")
  expect(view.captureCharFrame()).toContain("test/keys.test.ts → test/input.test.ts")
  expect(view.captureCharFrame()).toContain("+18")
  expect(view.captureCharFrame()).toContain("−7")
  view.mockInput.pressEnter()
  expect(more).toBe(1)

  view.mockInput.pressKey("y")
  await view.flush()
  expect(copiedSha).toBe(sha)
  expect(view.captureCharFrame()).toContain("SHA copied to clipboard")
  view.mockInput.pressKey("o")
  await view.flush()
  expect(browserSha).toBe(sha)
  expect(view.captureCharFrame()).toContain("Opened on GitHub")
  browserFails = true
  view.mockInput.pressKey("o")
  await view.flush()
  expect(view.captureCharFrame()).toContain("Browser unavailable")

  copyFails = true
  view.mockInput.pressKey("y")
  await view.flush()
  expect(view.captureCharFrame()).toContain("Native clipboard")
  expect(view.captureCharFrame()).toContain("unavailable")
  expect(terminalCopies).toBe(0)
  copyFails = false
  nativeClipboard = false
  view.mockInput.pressKey("y")
  await view.flush()
  expect(terminalCopies).toBe(1)
  expect(copiedSha).toBe(sha)
  expect(view.captureCharFrame()).toContain("SHA sent to terminal")
  expect(view.captureCharFrame()).not.toContain("copied to clipboard")
  view.renderer.copyToClipboardOSC52 = () => false
  view.mockInput.pressKey("y")
  await view.flush()
  expect(view.captureCharFrame()).toContain("Could not copy SHA")
})
