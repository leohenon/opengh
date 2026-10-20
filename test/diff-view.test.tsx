import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import type { BoxRenderable } from "@opentui/core"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { DiffContent, DiffTarget } from "../src/models"
import type { CommitDetailState, DiffState, PullDetailState, ResourceState } from "../src/repository-state"
import { App } from "../src/ui/app"
import { initializeHunk } from "../src/ui/hunk-host"
import { DiffScreen } from "../src/ui/pages/diff"
import { commitDetailFixture, githubDataFixture, pullContextFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { patchFixture } from "./fixtures/diff"

test("commit diffs render when the response arrives after the loading frame", async () => {
  const setup = await createTestRenderer({ width: 120, height: 32 })
  initializeHunk(setup.renderer)
  const [resource, setResource] = createSignal<ResourceState<DiffContent>>({ status: "loading", phase: "load" })
  await render(() => <box width="100%" height="100%"><DiffScreen target={{ kind: "commit", sha: "abc" }}
    resource={resource()} interactive showScrollbar onLoadFiles={() => {}} /></box>, setup.renderer)
  try {
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("Loading diff")
    setResource({ status: "ready", value: { kind: "patch", patch: patchFixture } })
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("example.ts")
    expect(setup.captureCharFrame()).toContain("newValue")
    expect(setup.captureCharFrame()).toContain("oldValue")
    setResource({ status: "loading", phase: "load" })
    await setup.flush()
    setResource({ status: "ready", value: { kind: "patch", patch: patchFixture } })
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("newValue")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("hunk navigation follows native layout and metadata-only selection removes the old body", async () => {
  const setup = await createTestRenderer({ width: 100, height: 18 })
  initializeHunk(setup.renderer)
  const patch = `diff --git a/long.ts b/long.ts\n--- a/long.ts\n+++ b/long.ts\n@@ -1,40 +1,40 @@\n`
    + Array.from({ length: 40 }, (_, i) => `-old-row-${i}\n`).join("")
    + Array.from({ length: 40 }, (_, i) => `+new-row-${i}\n`).join("")
    + `@@ -100 +100 @@\n-last-old\n+last-new\ndiff --git a/image.png b/image.png\nindex 1111111..2222222 100644\nBinary files a/image.png and b/image.png differ\n`
  await render(() => <box width="100%" height="100%"><DiffScreen target={{ kind: "commit", sha: "abc" }}
    resource={{ status: "ready", value: { kind: "patch", patch } }} interactive showScrollbar onLoadFiles={() => {}} /></box>, setup.renderer)
  const settle = async () => { await setup.flush(); await setup.renderer.idle(); await setup.flush() }
  const pane = (kind: "files" | "diff") => setup.renderer.root.findDescendantById(kind === "files" ? "diff-files-pane" : "diff-content-pane") as BoxRenderable
  const focusColor = pane("files").borderColor
  const expectFocus = (kind: "files" | "diff") => expect(pane(kind).borderColor).toEqual(focusColor)
  try {
    await settle()
    expect(setup.captureCharFrame()).toContain("new-row-0")
    expect(setup.captureCharFrame()).not.toContain("Diff ·")
    expectFocus("files")
    const bodyWidth = () => setup.renderer.root.findDescendantById("embedded-diff-host")!.width
    const withSidebar = bodyWidth()
    setup.mockInput.pressKey("b")
    await settle()
    expect(setup.captureCharFrame()).not.toContain("Files (2)")
    expectFocus("diff")
    expect(bodyWidth()).toBeGreaterThan(withSidebar)
    setup.mockInput.pressKey("b")
    await settle()
    expectFocus("files")
    expect(bodyWidth()).toBe(withSidebar)
    setup.mockInput.pressKey("b")
    setup.mockInput.pressTab() // Tab restores the hidden list as well.
    await settle()
    expectFocus("files")
    setup.mockInput.pressKey("]") // Hunk navigation also works from the file list.
    await settle()
    expect(setup.captureCharFrame()).toContain("last-new")
    expectFocus("diff")
    expect(setup.captureCharFrame()).not.toContain("new-row-0")
    setup.mockInput.pressKey("[")
    await settle()
    expect(setup.captureCharFrame()).toContain("new-row-0")
    setup.mockInput.pressTab()
    await settle()
    expectFocus("files")
    setup.mockInput.pressTab()
    await settle()
    expectFocus("diff")
    setup.mockInput.pressKey("w")
    setup.mockInput.pressKey("t")
    await settle()
    setup.mockInput.pressKey("]")
    await settle()
    expect(setup.captureCharFrame()).toContain("last-new")
    setup.mockInput.pressTab()
    setup.mockInput.pressKey("j")
    await settle()
    expect(setup.captureCharFrame()).toContain("Binary file")
    expect(setup.captureCharFrame()).not.toContain("last-new")
    expect(setup.captureCharFrame()).not.toContain("No file selected")
  } finally { setup.renderer.destroy(); await setup.renderer.closed }
})

test("D embeds diffs from commit and PR lists/details without losing their origin or keyboard ownership", async () => {
  const setup = await createTestRenderer({ width: 120, height: 40 })
  const { renderer, mockInput: input } = setup
  initializeHunk(renderer)
  const [diff, setDiff] = createSignal<DiffState>()
  const [commit, setCommit] = createSignal<CommitDetailState>()
  const [pull, setPull] = createSignal<PullDetailState>()
  const requested: DiffTarget[] = []
  const opened: Array<{ target?: string | number; view?: "diff" }> = []
  const secondCommit = githubDataFixture.commits.value!.items[1]!
  const secondPull = githubDataFixture.pulls.open.value!.items[1]!
  let fail = false
  await render(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    diff={diff()} commitDetail={commit()} pullDetail={pull()}
    onLoadDiff={async (target, filesOnly) => {
      requested.push(target)
      setDiff({ target, resource: fail && !filesOnly ? { status: "error", phase: "load", message: "Diff unavailable" }
        : { status: "ready", value: filesOnly ? { kind: "files", files: [], truncated: false } : { kind: "patch", patch: patchFixture } } })
    }}
    onCloseDiff={() => setDiff(undefined)}
    onLoadCommit={async (sha) => { setCommit({ sha, resource: { status: "ready", value: { ...commitDetailFixture, sha } } }) }}
    onCloseCommit={() => setCommit(undefined)}
    onLoadPull={async (number) => { setPull({ number,
      resource: { status: "ready", value: { ...secondPull, number, url: `https://github.com/anomalyco/opentui/pull/${number}`,
        body: "PR description", updatedAt: secondPull.createdAt, baseBranch: "main", headBranch: "feature",
        additions: 1, deletions: 1, changedFiles: 1, commitCount: 0, commentCount: 0, reviewCommentCount: 0,
        labels: [], assignees: [], reviewers: [], mergeable: true, mergeableState: "clean" } },
      comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
      references: { status: "ready", value: [] }, commits: { status: "ready", value: [] },
      context: { status: "ready", value: pullContextFixture },
    }) }}
    onClosePull={() => setPull(undefined)}
    onOpenInBrowser={async (target, _repository, view) => { opened.push({ target, view }) }}
  />, renderer)
  const settle = () => setup.flush()
  const escape = async () => { input.pressEscape(); await Bun.sleep(30); await settle() }
  try {
    input.pressKey("2")
    input.pressKey("j")
    input.pressKey("D")
    await settle()
    expect(requested.at(-1)).toEqual({ kind: "commit", sha: secondCommit.sha })
    expect(setup.captureCharFrame()).toContain("newValue")
    expect(setup.captureCharFrame()).toContain("example.ts")
    input.pressKey("h") // Scroll horizontally, never switch the app tab.
    input.pressKey("t")
    input.pressKey("w")
    await settle()
    expect(diff()?.target.kind).toBe("commit")
    expect(setup.captureCharFrame()).toContain("newValue")
    input.pressKey("?")
    await settle()
    expect(setup.captureCharFrame()).toContain("previous / next hunk")
    await escape()
    await escape()
    await settle()
    expect(diff()).toBeUndefined()
    expect(setup.captureCharFrame()).toContain(secondCommit.message)
    input.pressEnter()
    await settle()
    expect(commit()?.sha).toBe(secondCommit.sha)
    input.pressKey("D")
    await settle()
    expect(setup.captureCharFrame()).toContain("newValue")
    await escape()
    await settle()
    expect(commit()?.sha).toBe(secondCommit.sha) // Closing diff does not close detail.
    expect(setup.captureCharFrame()).toContain("Keep one owner")

    input.pressKey("4")
    input.pressKey("j")
    input.pressKey("D")
    await settle()
    expect(requested.at(-1)).toEqual({ kind: "pull", number: secondPull.number })
    input.pressKey("o")
    await settle()
    expect(opened.at(-1)).toEqual({ target: secondPull.number, view: "diff" })
    await escape()
    input.pressEnter()
    await settle()
    expect(pull()?.number).toBe(secondPull.number)
    input.pressKey("D")
    await settle()
    expect(setup.captureCharFrame()).toContain("newValue")
    setup.resize(48, 28)
    await settle()
    input.pressTab()
    input.pressTab()
    await settle()
    expect(setup.captureCharFrame()).toContain("example.ts")
    await escape()
    await settle()
    expect(pull()?.number).toBe(secondPull.number)
    expect(setup.captureCharFrame()).toContain("PR description")
    input.pressKey("D")
    await settle()
    fail = true
    input.pressKey("r")
    await settle()
    expect(setup.captureCharFrame()).toContain("Diff unavailable")
    input.pressEnter()
    await settle()
    expect(diff()?.resource.value?.kind).toBe("files")
    expect(setup.captureCharFrame()).toContain("File list only")
    await escape()
    await settle()
  } finally {
    renderer.destroy()
    await renderer.closed
  }
})
