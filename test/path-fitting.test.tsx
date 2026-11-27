import { afterEach, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { render, testRender } from "@opentui/solid"
import type { PullReviewThread } from "../src/models"
import { ReviewCommentDialog } from "../src/ui/components/pull-review-dialog"
import { ReviewThread } from "../src/ui/components/pull-review-threads"
import { initializeHunk } from "../src/ui/hunk-host"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { createReactiveMarkdownStyle } from "../src/ui/markdown-style"
import { DiffScreen } from "../src/ui/pages/diff"
import { ThemeProvider, useTheme } from "../src/ui/theme"

const active: Array<{ destroy(): void; isDestroyed: boolean }> = []
afterEach(() => {
  for (const renderer of active.splice(0)) if (!renderer.isDestroyed) renderer.destroy()
})

const longPath = "packages/next/src/server/lib/router-utils/setup-dev-bundler-with-turbopack.test.ts"
const comment = {
  id: "c1",
  author: "max",
  authorAssociation: "MEMBER",
  body: "Please rename this.",
  createdAt: "",
  updatedAt: "",
  url: "u",
}
const thread = (overrides: Partial<PullReviewThread> = {}): PullReviewThread => ({
  kind: "review-thread",
  id: "t1",
  path: longPath,
  line: 1201,
  isResolved: true,
  isOutdated: true,
  comments: [comment, { ...comment, id: "c2", author: "jane" }],
  ...overrides,
})

function Thread(props: { collapsed: boolean }) {
  const { colors, theme } = useTheme()
  const style = createReactiveMarkdownStyle(colors, theme)
  return (
    <ReviewThread
      thread={thread()}
      collapsed={props.collapsed}
      syntaxStyle={style()}
      backgroundColor={colors.panel}
      context={{ repositoryUrl: "https://github.com/o/r" }}
    />
  )
}

test("review thread headers keep the file name and their status labels", async () => {
  for (const width of [164, 80, 56])
    for (const collapsed of [false, true]) {
      const view = await testRender(
        () => (
          <ThemeProvider name="github">
            <box width={width - 4}>
              <Thread collapsed={collapsed} />
            </box>
          </ThemeProvider>
        ),
        { width, height: 14 },
      )
      active.push(view.renderer)
      await view.flush()
      await Bun.sleep(40)
      await view.flush()
      const header = view
        .captureCharFrame()
        .split("\n")
        .find((row) => row.includes("Resolved"))!
        .trimEnd()
      expect(header).toEndWith("Resolved Outdated")
      expect(header).toMatch(width === 56 ? /\.\.\..*t\.ts/ : /setup-dev-bundle.*\.test\.ts/)
      if (collapsed) expect(header).toContain(":1201 · 2 comments")
      if (width === 164) expect(header).toContain(longPath)
    }
})

test("review dialogs keep the file name, line and side", async () => {
  const anchor = {
    path: "packages/next/src/build/webpack/loaders/next-flight-loader/module-proxy-with-a-long-name/index.test.tsx",
    line: 1234,
    startLine: 1200,
    side: "RIGHT" as const,
  }
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <KeybindingsProvider>
          <ReviewCommentDialog
            anchor={anchor as never}
            repositoryUrl="https://github.com/o/r"
            headSha="abc"
            showScrollbar={false}
            onSave={() => {}}
            onClose={() => {}}
            onHintChange={() => {}}
          />
        </KeybindingsProvider>
      </ThemeProvider>
    ),
    { width: 80, height: 30 },
  )
  active.push(view.renderer)
  await view.flush()
  expect(view.captureCharFrame()).toContain(".../module-proxy-with-a-long-name/index.test.tsx:1200–1234 (RIGHT)")
})

test("diff headers keep renames' arrow and both names, and outdated card titles keep the file", async () => {
  const rename = (from: string, to: string) =>
    `diff --git a/${from} b/${to}\nsimilarity index 90%\nrename from ${from}\nrename to ${to}\n--- a/${from}\n+++ b/${to}\n@@ -1 +1 @@\n-old\n+new\n`
  const patch =
    rename(
      "packages/application-frontend/src/legacy/NotificationRendererImplementation.tsx",
      "packages/application-frontend/src/features/NotificationPreferencesModernPanelRendererImplementation.new.tsx",
    ) + `diff --git a/${longPath} b/${longPath}\n--- a/${longPath}\n+++ b/${longPath}\n@@ -1 +1 @@\n-old\n+new\n`
  for (const width of [164, 100, 80]) {
    const setup = await createTestRenderer({ width, height: 30 })
    active.push(setup.renderer)
    initializeHunk(setup.renderer)
    await render(
      () => (
        <box width="100%" height="100%">
          <DiffScreen
            target={{ kind: "pull", number: 8 }}
            resource={{ status: "ready", value: { kind: "patch", patch } }}
            interactive
            showScrollbar={false}
            onLoadFiles={() => {}}
            threads={[thread({ line: 99 })]}
          />
        </box>
      ),
      setup.renderer,
    )
    for (let pass = 0; pass < 4; pass++) {
      await Bun.sleep(30)
      await setup.flush()
      await setup.renderer.idle()
    }
    const frame = setup.captureCharFrame().split("\n")
    const renamed = frame.find((row) => row.includes("renamed"))!.trimEnd()
    expect(renamed).toContain(" → ")
    expect(renamed).toMatch(/Notifi.*\.tsx → .*\.new\.tsx +renamed \+1 −1$/)
    const card = frame.find((row) => row.includes("Outdated · "))
    expect(card).toBeDefined()
    expect(card).toMatch(/Outdated · .*t\.ts:99 · resolved ─/)
  }
})
