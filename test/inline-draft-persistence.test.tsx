import { afterEach, expect, test } from "bun:test"
import type { Renderable, TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultConfig } from "../src/config"
import { createInlineDrafts, createInlineDraftStorage, type InlineDrafts } from "../src/inline-drafts"
import type { PullReviewSession, ReviewSessionState } from "../src/review-types"
import { App } from "../src/ui/app"
import { initializeHunk } from "../src/ui/hunk-host"
import { parseDiff } from "../src/ui/diff-model"
import { reviewRows } from "../src/ui/review-lines"
import { clickControl } from "./fixtures/mouse"
import { githubDataFixture, repositoryOperationsFixture, pullContextFixture } from "./fixtures/github-data"
import { patchFixture } from "./fixtures/diff"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test("inline comment drafts survive App remounts, as on repository switches, and restarts", async () => {
  const directory = join(mkdtempSync(join(tmpdir(), "opengh-inline-draft-ui-")), "inline-drafts")
  directories.push(join(directory, ".."))
  const number = githubDataFixture.pulls.open.value!.items[0]!.number
  const repository = githubDataFixture.repo.nameWithOwner
  const headSha = "a".repeat(40),
    baseSha = "b".repeat(40)
  const patch = patchFixture.replace("@@ -1 +1 @@", "@@ -1,2 +1,2 @@") + " const stable = 3\n"
  // Root-owned: state survives App remounts.
  const [state, setState] = createSignal<ReviewSessionState>({ status: "idle" })
  const reviews: PullReviewSession = {
    state,
    open: async () => {
      setState({
        status: "ready",
        eligibility: {
          accountId: 1,
          login: "reviewer",
          repositoryId: 71,
          repository,
          number,
          headSha,
          baseSha,
          url: `${githubDataFixture.repo.url}/pull/${number}`,
          canComment: true,
          canInlineComment: true,
          canApprove: true,
          canRequestChanges: true,
        },
        draft: { accountId: 1, repository, number, headSha, baseSha, event: "COMMENT", body: "", comments: [] },
      })
    },
    setBody: () => {},
    setEvent: () => {},
    addComment: () => {},
    updateComment: () => {},
    removeComment: () => {},
    useCurrentHead: () => {},
    discard: async () => {},
    flush: async () => {},
    submit: async () => false,
  }
  const summary = githubDataFixture.pulls.open.value!.items[0]!
  const [drafts, setDrafts] = createSignal<InlineDrafts>(createInlineDrafts({ storage: createInlineDraftStorage(directory) }))
  const [mounted, setMounted] = createSignal(true)
  const setup = await createTestRenderer({ width: 110, height: 34 })
  initializeHunk(setup.renderer)
  await render(
    () => (
      <Show when={mounted() && drafts()} keyed>
        {(store) => (
          <App
            data={githubDataFixture}
            operations={repositoryOperationsFixture}
            reviews={reviews}
            inlineDrafts={store}
            onPostInlineComment={async () => {
              throw new Error("Not posted in this test")
            }}
            config={defaultConfig}
            initialNavigation={{ detail: { kind: "pull", number } }}
            diffs={{
              pull: { target: { kind: "pull", number }, resource: { status: "ready", value: { kind: "patch", patch, headSha, baseSha } } },
            }}
            pullDetail={{
              number,
              resource: {
                status: "ready",
                value: {
                  ...summary,
                  draft: false,
                  merged: false,
                  body: "PR body",
                  url: `${githubDataFixture.repo.url}/pull/${number}`,
                  updatedAt: summary.createdAt,
                  baseBranch: "main",
                  headBranch: "feature",
                  headSha,
                  additions: 1,
                  deletions: 1,
                  changedFiles: 1,
                  commitCount: 1,
                  commentCount: 0,
                  labels: [],
                  assignees: [],
                  reviewers: [],
                  mergeable: null,
                  permissions: { comment: true },
                },
              },
              comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
              commits: { status: "ready", value: [] },
              references: { status: "ready", value: [] },
              context: {
                status: "ready",
                value: { ...pullContextFixture, readiness: { ...pullContextFixture.readiness, headSha }, threads: [] },
              },
            }}
          />
        )}
      </Show>
    ),
    setup.renderer,
  )
  const settle = async () => {
    await Bun.sleep(40)
    await setup.flush()
    await setup.renderer.idle()
    await setup.flush()
  }
  const file = parseDiff({ kind: "patch", patch }).files[0]!.body!
  const composer = () => setup.renderer.root.findDescendantById("inline-comment-editor") as TextareaRenderable | undefined
  const sourceRow = (index: number) => setup.renderer.root.findDescendantById(reviewRows(file, "split")[index]!.id)!
  const markers = (node: Renderable = setup.renderer.root): Renderable[] => [
    ...(node.id.startsWith("diff-comment-card:draft:") ? [node] : []),
    ...node.getChildren().flatMap((child) => markers(child)),
  ]
  const openDiff = async () => {
    setup.mockInput.pressKey("D")
    await settle()
  }
  const resume = async () => {
    const control = markers()[0]!
      .getChildren()[0]!
      .getChildren()
      .find((child) => child.id.startsWith("inline-draft-resume:"))!
    await clickControl(setup, control.id)
    await settle()
  }
  try {
    await settle()
    await openDiff()
    const row = sourceRow(0)
    await setup.mockMouse.moveTo(row.x + 5, row.y)
    await settle()
    await setup.mockMouse.click(row.x + row.width - 2, row.y)
    await settle()
    expect(composer()?.focused).toBe(true)
    await setup.mockInput.typeText("Keep me across views")
    await settle()
    setup.mockInput.pressEscape()
    await settle()
    expect(markers()).toHaveLength(1)

    // A repository switch remounts App; the store keeps the draft.
    setMounted(false)
    await settle()
    setMounted(true)
    await settle()
    await openDiff()
    expect(markers()).toHaveLength(1)
    expect(markers()[0]!.parent).toBe(sourceRow(0))

    // Quit flushes; a new process reads the draft from disk.
    await drafts().flush()
    expect(readdirSync(directory).filter((name) => name.endsWith(".json"))).toHaveLength(1)
    setMounted(false)
    await settle()
    setDrafts(createInlineDrafts({ storage: createInlineDraftStorage(directory) }))
    setMounted(true)
    await settle()
    await openDiff()
    expect(markers()).toHaveLength(1)
    await resume()
    expect(composer()?.plainText).toBe("Keep me across views")

    // Clearing the draft removes its file.
    setup.mockInput.pressKey("d", { ctrl: true })
    await settle()
    setup.mockInput.pressEscape()
    await settle()
    await drafts().flush()
    expect(readdirSync(directory).filter((name) => name.endsWith(".json"))).toEqual([])
  } finally {
    setup.renderer.destroy()
  }
}, 15_000)
