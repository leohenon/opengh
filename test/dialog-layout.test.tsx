import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { defaultConfig } from "../src/config"
import { ComposeDialog } from "../src/ui/components/compose-dialog"
import { IssueActionDialog } from "../src/ui/components/issue-actions"
import { IssueAssigneesPicker } from "../src/ui/components/issue-assignees-picker"
import { Reactions } from "../src/ui/components/reactions"
import { Settings } from "../src/ui/components/settings"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { RepositoryLoadError } from "../src/ui/launcher"
import { ThemeProvider } from "../src/ui/theme"

const active: Array<{ destroy(): void; isDestroyed: boolean }> = []
afterEach(() => {
  for (const renderer of active.splice(0)) if (!renderer.isDestroyed) renderer.destroy()
})

const noop = () => {}
const userError = "Validation Failed: Could not resolve to a User with the login of 'a-very-long-github-login-name-39-chars-x'. (HTTP 422)"
const failed = (message: string) => ({ body: "", reason: "completed" as const, operation: { status: "error" as const, message } })

async function rows(width: number, height: number, ui: () => JSX.Element) {
  const view = await testRender(
    () => (
      <ThemeProvider name="github">
        <KeybindingsProvider>{ui()}</KeybindingsProvider>
      </ThemeProvider>
    ),
    { width, height },
  )
  active.push(view.renderer)
  for (let pass = 0; pass < 3; pass++) {
    await view.renderOnce()
    await view.flush()
  }
  return view
    .captureCharFrame()
    .split("\n")
    .map((row) => row.trim())
}

const actionDialog = (kind: "close" | "duplicate", message: string) => () => (
  <IssueActionDialog
    number={412}
    kind={kind}
    parent={kind === "close" ? "pull" : undefined}
    state={failed(message)}
    showScrollbar={false}
    locked
    repositoryUrl="https://github.com/o/r"
    onBodyChange={noop}
    onReasonChange={noop}
    onDuplicateTargetChange={noop}
    onSubmit={noop}
    onDiscard={noop}
    onHintChange={noop}
    onClose={noop}
  />
)

test("action dialogs grow for their notices instead of painting the editor over them", async () => {
  for (const [width, height] of [
    [80, 24],
    [56, 14],
  ] as const) {
    const frame = await rows(width, height, actionDialog("close", userError))
    expect(frame.join("\n")).toContain("Validation Failed: Could not resolve to a User")
    expect(frame.join("\n")).toContain("Leave a comment (optional)…")
    expect(frame.some((row) => row.startsWith("Submit"))).toBe(true)
  }
  const sixLines = Array.from({ length: 6 }, (_, index) => `line ${index}: the request failed`).join("\n")
  const duplicate = await rows(56, 24, actionDialog("duplicate", sixLines))
  expect(duplicate).toContain("line 5: the request failed")
  expect(duplicate).toContain("Submit")
})

test("lists keep a row and errors keep their text when popups run out of height", async () => {
  const users = { status: "ready" as const, value: { items: [{ login: "user0" }, { login: "user1" }], page: 1, hasMore: false } }
  const assignees = await rows(56, 14, () => (
    <IssueAssigneesPicker
      number={412}
      state={{ ...failed(userError), selectedAssignees: ["user1"] }}
      users={users}
      onChange={noop}
      onLoadMore={noop}
      onSubmit={noop}
      onHintChange={noop}
      onClose={noop}
    />
  ))
  expect(assignees.join("\n")).toContain("Validation Failed: Could not resolve to a User")
  expect(assignees).toContain("Save")

  const saveError = "Could not save /Users/someone/.config/opengh/config.json: EACCES: permission denied"
  for (const [width, height] of [
    [110, 24],
    [80, 24],
    [56, 14],
  ] as const) {
    const settings = await rows(width, height, () => (
      <Settings config={defaultConfig} loadError={saveError} onChange={async () => {}} onClose={noop} />
    ))
    expect(settings.join("").replace(/\s+/g, "")).toContain(saveError.replace(/\s+/g, ""))
  }
})

test("compose dialogs keep the error and Create row in short terminals", async () => {
  const top = {
    label: "branches",
    render: () => <text>main ← some-user/fix/turbopack-sourcemap-names-for-scope-hoisted-modules-102474</text>,
    hints: () => [],
    keys: {},
  }
  for (const [width, height, branches] of [
    [100, 14, true],
    [100, 14, false],
    [56, 24, true],
  ] as const) {
    const frame = await rows(width, height, () => (
      <ComposeDialog
        idPrefix="compose-layout"
        heading="New pull request"
        confirmation="Create?"
        repositoryUrl="https://github.com/o/r"
        showScrollbar={false}
        showStatusBarHints
        draft={{ title: "A title", body: "" }}
        draftError={userError}
        top={branches ? (top as never) : undefined}
        onDraftChange={noop}
        onClose={noop}
        onHintChange={noop}
      />
    ))
    expect(frame.join(" ").replace(/\s+/g, " ")).toContain("(HTTP 422)")
    expect(frame).toContain("Add a description…")
    expect(frame.some((row) => row.startsWith("Create"))).toBe(true)
  }
})

test("repository load errors show the whole message", async () => {
  const message =
    "GitHub API request failed: POST https://api.github.com/repos/a-very-long-organization-name/a-very-long-repository-name-for-testing/issues/102474/assignees returned 422 Unprocessable Entity (Validation Failed: Could not resolve to a User)"
  const frame = await rows(56, 24, () => (
    <RepositoryLoadError
      repository="a-very-long-organization-name/a-very-long-repository-name-for-testing"
      message={message}
      onRetry={noop}
    />
  ))
  expect(frame.join(" ")).toContain("not resolve to a User)")
  expect(frame).toContain("Retry")
})

test("wrapped reactions do not leave a blank row between rows", async () => {
  const frame = await rows(24, 8, () => (
    <box width={22} flexDirection="column">
      <Reactions counts={{ "+1": 12, "-1": 3, laugh: 4, hooray: 15, confused: 2, heart: 101, rocket: 7, eyes: 33 }} />
    </box>
  ))
  const filled = frame.map((row, index) => (row ? index : -1)).filter((index) => index >= 0)
  expect(filled.length).toBeGreaterThan(1)
  expect(filled.at(-1)! - filled[0]!).toBe(filled.length - 1)
})
