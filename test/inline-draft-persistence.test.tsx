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
import type { PullContext, PullReviewThread } from "../src/models"
import type { ResourceState } from "../src/repository-state"
import type { InlineCommentInput, PostedInlineComment, PullReviewSession, ReviewSessionState } from "../src/review-types"
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

async function draftView(
  post: (input: InlineCommentInput) => Promise<PostedInlineComment> = async () => {
    throw new Error("Not posted in this test")
  },
  refreshContext?: (previous: PullContext) => ResourceState<PullContext>,
) {
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
  const initialContext = { ...pullContextFixture, readiness: { ...pullContextFixture.readiness, headSha }, threads: [] }
  const [context, setContext] = createSignal<ResourceState<PullContext>>({ status: "ready", value: initialContext })
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
            onPostInlineComment={post}
            onLoadPull={async (_number, options) => {
              if (!options?.force || !refreshContext) return
              const next = refreshContext(context().value ?? initialContext)
              setContext(next)
              if (next.status === "ready") return next.value
            }}
            onSwitchRepository={() => setMounted(false)}
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
              context: context(),
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
  const openComposer = async () => {
    const row = sourceRow(0)
    await setup.mockMouse.moveTo(row.x + 5, row.y)
    await settle()
    await setup.mockMouse.click(row.x + row.width - 2, row.y)
    await settle()
  }
  return {
    directory,
    setup,
    settle,
    openDiff,
    openComposer,
    composer,
    sourceRow,
    markers,
    resume,
    drafts,
    setDrafts,
    mounted,
    setMounted,
    setRemoteThreads: (threads: PullReviewThread[]) => setContext({ status: "ready", value: { ...initialContext, threads } }),
  }
}

test("inline comment drafts survive App remounts, as on repository switches, and restarts", async () => {
  const { directory, setup, settle, openDiff, openComposer, composer, sourceRow, markers, resume, drafts, setDrafts, setMounted } =
    await draftView()
  try {
    await settle()
    await openDiff()
    await openComposer()
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

test.each([true, false])(
  "deleted inline comments do not reappear (previously seen on GitHub: %s)",
  async (echoed) => {
    let serverThreads: PullReviewThread[] = []
    let failRefresh = false
    let refreshes = 0
    const { setup, settle, openDiff, openComposer, setRemoteThreads } = await draftView(
      async (input) => {
        const url = `https://github.com/${input.repository}/pull/${input.number}#discussion_r123`
        const timestamp = new Date().toISOString()
        if (echoed) {
          serverThreads = [
            {
              kind: "review-thread",
              id: "remote-thread",
              path: input.anchor.path,
              line: input.anchor.line,
              diffSide: input.anchor.side,
              isResolved: false,
              isOutdated: false,
              createdAt: timestamp,
              comments: [
                {
                  id: "remote-comment",
                  url,
                  author: "reviewer",
                  authorAssociation: "",
                  body: input.body,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                },
              ],
            },
          ]
        }
        return { id: 123, url, body: input.body, ...input.anchor }
      },
      (previous) => {
        refreshes++
        return failRefresh
          ? { status: "error", phase: "load", message: "Could not refresh review threads", value: previous }
          : { status: "ready", value: { ...previous, threads: serverThreads } }
      },
    )
    const card = (id: string) => setup.renderer.root.findDescendantById(`diff-comment-card:${id}`)
    const refresh = async () => {
      const before = refreshes
      setup.mockInput.pressKey("r")
      await settle()
      expect(refreshes).toBe(before + 1)
    }
    try {
      await settle()
      await openDiff()
      await openComposer()
      await setup.mockInput.typeText("Delete this inline comment")
      setup.mockInput.pressKey("s", { ctrl: true })
      await settle()
      await clickControl(setup, "inline-comment-confirm")
      await settle()
      expect(refreshes).toBe(1)
      const shown = echoed ? "remote-thread" : "posted-123"
      expect(card(shown)).toBeDefined()
      expect(card(echoed ? "posted-123" : "remote-thread")).toBeUndefined()

      failRefresh = true
      await refresh()
      expect(card(shown)).toBeDefined()

      failRefresh = false
      serverThreads = []
      if (echoed) {
        setRemoteThreads([])
        await settle()
        expect(card("posted-123")).toBeUndefined()
      }
      await refresh()
      expect(card("remote-thread")).toBeUndefined()
      expect(card("posted-123")).toBeUndefined()
    } finally {
      setup.renderer.destroy()
    }
  },
  15_000,
)

test.each([false, true])(
  "pending inline posts stay unavailable across repository switches (success: %s)",
  async (success) => {
    const pending = Promise.withResolvers<PostedInlineComment>()
    const posted = Promise.withResolvers<InlineCommentInput>()
    let submissions = 0
    const { setup, settle, openDiff, openComposer, composer, markers, resume, drafts, mounted, setMounted } = await draftView((input) => {
      submissions++
      posted.resolve(input)
      return pending.promise
    })
    try {
      await settle()
      await openDiff()
      await openComposer()
      await setup.mockInput.typeText("Posting across views")
      setup.mockInput.pressKey("s", { ctrl: true })
      await settle()
      await clickControl(setup, "inline-comment-confirm")
      const input = await posted.promise
      await settle()
      expect(composer()?.focused).toBe(false)

      // Use the actual repository-switch shortcut while the request is in flight.
      setup.mockInput.pressKey("S")
      await settle()
      expect(setup.captureCharFrame()).toContain("Switch repository")
      await setup.mockInput.typeText("other/repo")
      setup.mockInput.pressEnter()
      await settle()
      expect(mounted()).toBe(false)
      setMounted(true) // Returning to the original repository remounts App with the same store.
      await settle()
      await openDiff()
      expect(drafts().get(input)?.body).toBe(input.body)
      expect(markers()).toHaveLength(0)
      await openComposer()
      expect(composer()).toBeUndefined()
      expect(submissions).toBe(1)
      expect(setup.captureCharFrame()).toContain("Posting comment")

      if (success)
        pending.resolve({
          id: 123,
          url: `https://github.com/${input.repository}/pull/${input.number}#discussion_r123`,
          body: input.body,
          ...input.anchor,
        })
      else pending.reject(new Error("Posting failed"))
      await settle()
      expect(setup.captureCharFrame()).not.toContain("Posting comment")
      await drafts().flush()
      if (success) {
        expect(drafts().get(input)).toBeUndefined()
        expect(markers()).toHaveLength(0)
        await openComposer()
        expect(composer()?.plainText).toBe("")
      } else {
        expect(drafts().get(input)?.body).toBe(input.body)
        expect(markers()).toHaveLength(1)
        await resume()
        expect(composer()?.plainText).toBe(input.body)
      }
      expect(submissions).toBe(1)
    } finally {
      pending.reject(new Error("Test finished"))
      setup.renderer.destroy()
    }
  },
  15_000,
)
