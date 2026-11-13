import { expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import type { Renderable, TextareaRenderable } from "@opentui/core"
import { defaultConfig } from "../src/config"
import { createDiskDraftStore } from "../src/drafts"
import { createRepositorySession, type RepositoryLoaders, type RepositorySession } from "../src/repository-session"
import { Root } from "../src/root"
import { App } from "../src/ui/app"
import { createSignal } from "solid-js"
import type { IssueActionState } from "../src/repository-state"
import { commitDetailFixture, githubDataFixture, issueCommentsFixture, issueDetailFixture, pullContextFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { clickControl } from "./fixtures/mouse"
import { createTestReviewSession } from "./fixtures/reviews"
import { waitForText } from "./fixtures/wait"

const repository = githubDataFixture.repo.nameWithOwner
const number = issueDetailFixture.number
function loaders(overrides: Partial<RepositoryLoaders> = {}, canComment = true): RepositoryLoaders {
  return {
    metadata: async (name) => ({ ...githubDataFixture.repo, nameWithOwner: name }),
    workCounts: async () => ({ issues: 0, pulls: 0 }),
    documents: async () => [], document: async () => "", branches: async () => ({ items: [], hasMore: false }),
    commits: async () => ({ items: [], hasMore: false }), commitCount: async () => 0, commit: async () => commitDetailFixture,
    issue: async (_repo, number) => ({ ...issueDetailFixture, number, commentCount: 0,
      permissions: { ...issueDetailFixture.permissions!, comment: canComment } }),
    issueComments: async () => ({ items: [], hasMore: false }), issueReferences: async () => [],
    issues: async () => ({ items: [], hasMore: false }), pulls: async () => ({ items: [], hasMore: false }),
    pull: async (_repo, number) => ({ ...githubDataFixture.pulls.open.value!.items[0]!, number,
      url: `${githubDataFixture.repo.url}/pull/${number}`, body: "PR description", updatedAt: "2026-01-01T00:00:00Z",
      baseBranch: "main", headBranch: "feature", additions: 1, deletions: 0, changedFiles: 1, commitCount: 0,
      commentCount: 0, labels: [], assignees: [], reviewers: [], mergeable: null, permissions: { comment: canComment } }),
    pullCommits: async () => [], pullContext: async () => pullContextFixture,
    runs: async () => ({ items: [], hasMore: false }),
    createIssueComment: async (_repo, _number, body) => ({ ...issueCommentsFixture[0]!, body }),
    ...overrides,
  }
}

for (const parent of ["issue", "pull"] as const) {
  for (const finish of ["discard", "post"] as const) {
    test(`${parent} restores its saved comment marker after restart and retires it after ${finish}`, async () => {
      const directory = mkdtempSync(join(tmpdir(), "opengh-comment-restart-"))
      const sessions: RepositorySession[] = []
      const views: Awaited<ReturnType<typeof testRender>>[] = []
      const body = "  Saved **draft**\nSecond line  "
      const key = `${repository.toLowerCase()}@${githubDataFixture.repo.id}#${number}${parent === "pull" ? ":pull" : ""}:comment`
      const launch = async (readOnly = false) => {
        const disk = createDiskDraftStore(directory)
        const session = createRepositorySession(loaders({}, !readOnly), disk)
        sessions.push(session)
        const view = await testRender(() => <Root repositoryArgument={repository} initialDetail={{ kind: parent, number }} cwd="/work"
          services={{ createRepositorySession: () => session, createPullReviewSession: createTestReviewSession,
            resolveRepository: async () => repository, resolveLocalRepository: async () => undefined,
            loadRecentRepositories: async () => [], rememberRepository: async () => {},
            loadRepositoryTabs: async () => ({}), saveRepositoryTabs: async () => {},
            loadConfig: async () => ({ ...defaultConfig }), saveConfig: async () => {} }} />, { width: 120, height: 45 })
        views.push(view)
        const settle = async () => { await Bun.sleep(40); await view.flush() }
        await settle()
        await waitForText(view, parent === "issue" ? issueDetailFixture.title : githubDataFixture.pulls.open.value!.items[0]!.title)
        return { session, view, disk, settle }
      }
      const editor = (view: Awaited<ReturnType<typeof testRender>>) => view.renderer.root.findDescendantById(`${parent}-comment-editor`) as TextareaRenderable | undefined
      try {
        const first = await launch()
        first.view.mockInput.pressKey("c")
        await first.settle()
        expect(editor(first.view)?.focused).toBe(true)
        await first.view.mockInput.typeText(body)
        await first.settle()
        const count = (node: Renderable, id: string): number => Number(node.id === id)
          + node.getChildren().reduce((total, child) => total + count(child, id), 0)
        const presentation = (inline: number, expanded: number, saved: number) => {
          expect(count(first.view.renderer.root, `${parent}-comment-editor`)).toBe(inline)
          expect(count(first.view.renderer.root, "issue-comment-writer")).toBe(expanded)
          expect(count(first.view.renderer.root, `${parent}-comment-resume`)).toBe(saved)
        }
        presentation(1, 0, 0)
        expect(first.session.flushDrafts!()).toBe(true)
        const generation = first.disk.load(key)?.generation
        const instance = editor(first.view)
        const description = first.view.renderer.root.findDescendantById(`${parent}-detail-description`)!
        await first.view.mockMouse.click(description.x + 1, description.y + 1)
        first.view.mockInput.pressKey("c")
        await first.settle()
        expect(editor(first.view) === instance).toBe(true)
        expect(editor(first.view)?.plainText).toBe(body)
        presentation(1, 0, 0)
        first.view.mockInput.pressKey("o", { ctrl: true })
        await first.settle()
        presentation(0, 1, 0)
        expect((first.view.renderer.root.findDescendantById("issue-comment-writer") as TextareaRenderable).plainText).toBe(body)
        first.view.mockInput.pressKey("o", { ctrl: true })
        await first.settle()
        presentation(1, 0, 0)
        expect(editor(first.view)?.plainText).toBe(body)
        for (let attempt = 0; attempt < 2; attempt++) {
          first.view.mockInput.pressEscape()
          await first.settle()
          await waitForText(first.view, "Draft saved · Resume")
          presentation(0, 0, 1)
          await clickControl(first.view, `${parent}-comment-resume`)
          presentation(1, 0, 0)
          expect(editor(first.view)?.plainText).toBe(body)
        }
        expect(first.session.flushDrafts!()).toBe(true)
        expect(first.disk.load(key)?.generation).toBe(generation)
        expect(readdirSync(directory).filter(file => file.endsWith(".json"))).toHaveLength(1)
        first.view.mockInput.pressEscape()
        await first.settle()
        await waitForText(first.view, "Draft saved · Resume")
        presentation(0, 0, 1)
        first.session.prepareIssueAction(number, "close", parent)
        first.session.updateIssueDraft(number, { body: "Closing explanation" }, parent)
        first.session.prepareIssueAction(number, "reopen", parent)
        first.session.updateIssueDraft(number, { body: "Reopening explanation" }, parent)
        expect(first.session.commentDraft!(number, parent)).toBe(body)
        expect(first.session.flushDrafts!()).toBe(true)
        const saved = first.disk.load(key)
        first.view.renderer.destroy()

        const second = await launch(finish === "discard")
        await waitForText(second.view, "Draft saved · Resume")
        expect(editor(second.view)).toBeUndefined()
        expect(second.session.issueAction(number, parent).body).toBe("")
        expect(second.disk.load(key)).toEqual(saved)
        await clickControl(second.view, `${parent}-comment-resume`)
        expect(editor(second.view)?.plainText).toBe(body)
        expect(editor(second.view)?.focused).toBe(true)
        if (finish === "discard") {
          second.view.mockInput.pressKey("s", { ctrl: true })
          await second.settle()
          expect(second.view.renderer.root.findDescendantById("issue-action-confirm")).toBeUndefined()
          second.view.mockInput.pressKey("d", { ctrl: true })
          await second.settle()
          second.view.mockInput.pressEscape()
          await second.settle()
        } else {
          second.view.mockInput.pressKey("s", { ctrl: true })
          await second.settle()
          await clickControl(second.view, "issue-action-confirm")
          await waitForText(second.view, "Comment posted")
        }
        expect(second.session.commentDraft!(number, parent)).toBe("")
        expect(second.view.renderer.root.findDescendantById(`${parent}-comment-resume`)).toBeUndefined()
        expect(second.session.flushDrafts!()).toBe(true)
        second.view.renderer.destroy()

        const third = await launch()
        expect(third.session.commentDraft!(number, parent)).toBe("")
        expect(third.view.renderer.root.findDescendantById(`${parent}-comment-resume`)).toBeUndefined()
        expect(editor(third.view)).toBeUndefined()
        third.session.prepareIssueAction(number, "close", parent)
        expect(third.session.issueAction(number, parent).body).toBe("Closing explanation")
        await third.settle()
        expect(third.view.renderer.root.findDescendantById(`${parent}-comment-resume`)).toBeUndefined()
        if (finish === "discard") {
          third.session.prepareIssueAction(number, "comment", parent)
          third.session.updateIssueDraft(number, { body: " \n " }, parent)
          expect(third.session.flushDrafts!()).toBe(true)
          third.view.renderer.destroy()
          const fourth = await launch()
          expect(fourth.session.commentDraft!(number, parent)).toBe(" \n ")
          expect(fourth.view.renderer.root.findDescendantById(`${parent}-comment-resume`)).toBeUndefined()
          expect(editor(fourth.view)).toBeUndefined()
        }
      } finally {
        for (const view of views) if (!view.renderer.isDestroyed) view.renderer.destroy()
        for (const session of sessions) session.flushDrafts!()
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
}

test("passive restoration keeps action slots, dirty edits and publication generations separate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "opengh-comment-generations-"))
  const sessions: RepositorySession[] = []
  const disk = createDiskDraftStore(directory)
  const key = `${repository.toLowerCase()}@${githubDataFixture.repo.id}#${number}:comment`
  const start = async () => {
    const session = createRepositorySession(loaders(), disk)
    sessions.push(session)
    await session.load(repository, "detail")
    return session
  }
  try {
    const writer = await start()
    writer.prepareIssueAction(number, "comment")
    writer.updateIssueDraft(number, { body: "Saved comment" })
    writer.prepareIssueAction(number, "close")
    writer.updateIssueDraft(number, { body: "Saved close" })
    expect(writer.flushDrafts!()).toBe(true)
    const saved = disk.load(key)

    const reader = await start()
    reader.prepareIssueAction(number, "close")
    reader.updateIssueDraft(number, { body: "Unsaved close" })
    await reader.loadIssue(number)
    expect(reader.commentDraft!(number)).toBe("Saved comment")
    expect(reader.issueAction(number).body).toBe("Unsaved close")
    expect(disk.load(key)).toEqual(saved)
    await reader.loadPull(number)
    expect(reader.commentDraft!(number, "pull")).toBe("")
    await reader.loadIssue(number + 1)
    expect(reader.commentDraft!(number + 1)).toBe("")
    reader.clearIssue()
    await reader.loadIssue(number)
    expect(reader.commentDraft!(number)).toBe("Saved comment")

    writer.prepareIssueAction(number, "comment")
    writer.updateIssueDraft(number, { body: "Changed in another session" })
    expect(writer.flushDrafts!()).toBe(true)
    reader.prepareIssueAction(number, "comment")
    expect(reader.commentDraft!(number)).toBe("Changed in another session")
    reader.updateIssueDraft(number, { body: "Local edit" })
    writer.updateIssueDraft(number, { body: "Newer remote edit" })
    expect(writer.flushDrafts!()).toBe(true)
    await reader.loadIssue(number, { force: true })
    expect(reader.commentDraft!(number)).toBe("Local edit")
    expect(reader.flushDrafts!()).toBe(false)
    expect(reader.draftSaveError!()).toContain("changed in another session")
    expect(disk.load(key)?.body).toBe("Newer remote edit")
    reader.discardIssueDraft(number)
    expect(reader.commentDraft!(number)).toBe("Newer remote edit")
    expect(reader.flushDrafts!()).toBe(true)

    const replacement = createRepositorySession(loaders({ metadata: async () => ({ ...githubDataFixture.repo, id: githubDataFixture.repo.id! + 1 }) }), disk)
    sessions.push(replacement)
    await replacement.load(repository, "detail")
    await replacement.loadIssue(number)
    expect(replacement.commentDraft!(number)).toBe("")
  } finally {
    for (const session of sessions) session.flushDrafts!()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("draft read failure does not block details and can recover on refresh", async () => {
  const directory = mkdtempSync(join(tmpdir(), "opengh-comment-read-"))
  const disk = createDiskDraftStore(directory)
  const key = `${repository.toLowerCase()}@${githubDataFixture.repo.id}#${number}:comment`
  disk.save(key, { generation: "saved", body: "Restored after retry", reason: "completed" }, undefined)
  let failed = true
  const session = createRepositorySession(loaders(), { ...disk, load: key => {
    if (failed) throw new Error("Draft unavailable")
    return disk.load(key)
  } })
  try {
    await session.load(repository, "detail")
    await session.loadIssue(number)
    expect(session.issueDetail()?.resource.status).toBe("ready")
    expect(session.commentDraft!(number)).toBe("")
    expect(session.draftSaveError!()).toContain("Draft unavailable")
    failed = false
    await session.loadIssue(number, { force: true })
    expect(session.commentDraft!(number)).toBe("Restored after retry")
    expect(session.draftSaveError!()).toBeUndefined()
    expect(session.issueAction(number).body).toBe("")
    expect(disk.load(key)?.generation).toBe("saved")
  } finally {
    session.flushDrafts!()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("legacy action state does not expose a close draft as a conversation draft", async () => {
  const [action, setAction] = createSignal<IssueActionState>({ body: "Close explanation", reason: "completed", operation: { status: "idle" } })
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    initialNavigation={{ detail: { kind: "issue", number } }}
    issueDetail={{ number, resource: { status: "ready", value: issueDetailFixture },
      comments: { status: "ready", value: { items: [], page: 1, hasMore: false } }, references: { status: "ready", value: [] } }}
    getIssueAction={() => action()} onPrepareIssueAction={() => setAction(current => ({ ...current, body: "Saved comment" }))}
    onIssueDraftChange={(_number, draft) => setAction(current => ({ ...current, ...draft }))}
    onSubmitIssueAction={async () => ({})} />, { width: 120, height: 40 })
  try {
    await view.flush()
    expect(!!view.renderer.root.findDescendantById("issue-comment-resume")).toBe(false)
    view.mockInput.pressKey("c")
    await view.flush()
    expect((view.renderer.root.findDescendantById("issue-comment-editor") as TextareaRenderable).plainText).toBe("Saved comment")
    view.mockInput.pressEscape()
    await Bun.sleep(40)
    await waitForText(view, "Draft saved · Resume")
    setAction(current => ({ ...current, body: "Another close explanation" }))
    await view.flush()
    await clickControl(view, "issue-comment-resume")
    expect((view.renderer.root.findDescendantById("issue-comment-editor") as TextareaRenderable).plainText).toBe("Saved comment")
  } finally { view.renderer.destroy() }
})
