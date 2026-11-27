import { afterEach, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { render, testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { defaultConfig } from "../src/config"
import type { PullRepository } from "../src/models"
import { App } from "../src/ui/app"
import { BranchPicker } from "../src/ui/components/branch-picker"
import { ReviewHeader } from "../src/ui/components/header"
import { Help } from "../src/ui/components/help"
import { RepositoryPicker } from "../src/ui/components/repository-picker"
import { SearchBar } from "../src/ui/components/search-bar"
import { StatusBar } from "../src/ui/components/status-bar"
import { TemplatePicker } from "../src/ui/components/template-picker"
import { initializeHunk } from "../src/ui/hunk-host"
import { KeybindingsProvider } from "../src/ui/keybindings"
import { DiffScreen } from "../src/ui/pages/diff"
import { SwitchRepositoryScreen } from "../src/ui/pages/switch-repository"
import { ThemeProvider } from "../src/ui/theme"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const active: Array<{ destroy(): void; isDestroyed: boolean }> = []
afterEach(() => {
  for (const renderer of active.splice(0)) if (!renderer.isDestroyed) renderer.destroy()
})

const branch = "zhengdaodeguL/fix/turbopack-sourcemap-names-for-scope-hoisted-modules-102474"
const longRepository = "a-very-long-organization-name/a-very-long-repository-name-for-testing"
const noop = () => {}

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
  await view.flush()
  await Bun.sleep(40)
  await view.flush()
  return view
    .captureCharFrame()
    .split("\n")
    .map((row) => row.trimEnd())
}

test("picker rows truncate names and keep their markers", async () => {
  const repository = (id: number, nameWithOwner: string, defaultBranch: string) =>
    ({ id, nodeId: `R${id}`, nameWithOwner, defaultBranch }) as PullRepository
  const current = repository(1, longRepository, "release/2026-04-long-default-branch-name")
  for (const width of [164, 80, 56]) {
    const branches = await rows(width, 14, () => (
      <BranchPicker
        branches={{ status: "ready", value: { items: ["main", branch], page: 1, hasMore: false } }}
        current={branch}
        showScrollbar={false}
        onSelect={noop}
        onLoadMore={async () => {}}
        onRetry={noop}
        onClose={noop}
      />
    ))
    const selected = branches.find((row) => row.includes("›"))!
    expect(selected).toEndWith("✓ current")
    expect(selected.includes(branch) || selected.includes("...")).toBe(true)
    if (width === 164) expect(selected).toContain(branch)

    const repositories = await rows(width, 12, () => (
      <RepositoryPicker
        title="Base repository"
        repositories={[current, repository(2, "vercel/next.js", "canary")]}
        current={current}
        showScrollbar={false}
        onSelect={noop}
        onClose={noop}
      />
    ))
    expect(repositories.find((row) => row.includes("›"))).toEndWith("✓ selected")

    const switcher = await rows(width, 14, () => (
      <SwitchRepositoryScreen
        recent={[longRepository, "open-telemetry/opentelemetry-collector-contrib"]}
        current={longRepository}
        showStatusBarHints={false}
        onOpen={noop}
        onClose={noop}
      />
    ))
    expect(switcher.find((row) => row.includes("›"))).toEndWith("✓ current")
    expect(switcher.join("\n")).toContain("open-telemetry / ")
    expect(switcher.find((row) => row.includes("Search"))!.trim().length).toBeLessThan(width - 6)
  }
})

test("review headers keep both ends of a compare label and space the totals", async () => {
  for (const width of [164, 80, 56]) {
    const [header] = await rows(width, 2, () => (
      <ReviewHeader
        repo={{ ...githubDataFixture.repo, nameWithOwner: "a-rather-long-organization/frontend-monorepo" }}
        target={{
          kind: "compare",
          base: "release/2025-quarter-four-long-lived-stabilisation-branch",
          head: "feature/application-frontend-notifications",
        }}
        totals={{ additions: 10, deletions: 10 }}
      />
    ))
    expect(header).toEndWith(width > 56 ? "notifications" : "tifications")
    expect(header).toContain(" +10 −10 ")
  }
})

test("help descriptions fit or end in an ellipsis", async () => {
  const wide = await rows(164, 40, () => <Help view="diff" onClose={noop} />)
  expect(wide.join("\n")).toContain("filter file paths in the status bar; Esc clears")
  const narrow = await rows(56, 24, () => <Help view="diff" onClose={noop} />)
  expect(narrow.find((row) => row.includes("esc "))).toContain("...")
})

test("status and search rows truncate with an ellipsis and space the match count", async () => {
  const [error] = (
    await rows(56, 2, () => (
      <StatusBar hint="" error="GitHub API request failed: POST https://api.github.com/repos/owner/issues returned 422" />
    ))
  ).filter(Boolean)
  expect(error).toStartWith("  × GitHub API request failed")
  expect(error).toEndWith("...")
  const [search] = (
    await rows(56, 2, () => (
      <SearchBar
        query="constVeryDescriptiveIdentifierNameThatIsLongerThanTheWidth ok"
        editing={false}
        current={0}
        total={0}
        onInput={noop}
      />
    ))
  ).filter(Boolean)
  expect(search).toEndWith("ok No matches")
})

test("template rows show whole names when the popup can widen", async () => {
  const templates = [{ name: "Feature request for the Turbopack bundler and related build tooling", about: "Suggest an idea" }]
  const frame = await rows(164, 12, () => (
    <TemplatePicker
      idPrefix="row-truncation"
      heading="New issue"
      blank="Blank issue"
      templates={templates}
      label={(template) => template.name}
      about={(template) => template.about}
      onSelect={noop}
      onClose={noop}
      onHintChange={noop}
    />
  ))
  expect(frame.join("\n")).toContain("Feature request for the Turbopack bundler and related build tooling  Suggest an idea")
})

test("the commits branch label shrinks with an ellipsis and keeps its dropdown marker", async () => {
  for (const width of [164, 90, 56]) {
    const view = await testRender(
      () => (
        <App
          data={{
            ...githubDataFixture,
            currentBranch: branch,
            branches: { status: "ready", value: { items: ["main", branch], page: 1, hasMore: false } },
          }}
          operations={repositoryOperationsFixture}
        />
      ),
      { width, height: 12 },
    )
    active.push(view.renderer)
    await view.flush()
    view.mockInput.pressKey("2")
    await Bun.sleep(40)
    await view.flush()
    const header = view
      .captureCharFrame()
      .split("\n")
      .find((row) => row.includes("commits"))!
      .trimEnd()
    expect(header).toEndWith("▾")
    expect(header.includes(branch) || header.includes("...")).toBe(true)
  }
})

test("new pull request branches give way to the comparison summary", async () => {
  for (const width of [164, 100, 80, 56]) {
    const view = await testRender(
      () => (
        <App
          data={structuredClone(githubDataFixture)}
          operations={repositoryOperationsFixture}
          initialPage="pulls"
          config={{ ...defaultConfig, showStatusBarHints: true }}
          localRepository={{ directory: "/tmp/opengh", repository: githubDataFixture.repo.nameWithOwner }}
          onLoadLocalBranch={async () => branch}
          onComparePull={async () => ({
            comparison: { status: "ahead", aheadBy: 123, behindBy: 0, commits: 123, files: 300, additions: 123456, deletions: 98765 },
          })}
          onLoadPullBranches={async () => ({ items: ["main", branch], hasMore: false })}
        />
      ),
      { width, height: 30 },
    )
    active.push(view.renderer)
    await view.flush()
    view.mockInput.pressKey("c")
    for (let pass = 0; pass < 4; pass++) {
      await Bun.sleep(40)
      await view.flush()
    }
    const row = view
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes(" ← "))!
      .trimEnd()
    expect(row).toEndWith(width > 56 ? "+123,456+ −98,765+ ›" : "›")
    expect(row).toMatch(width > 56 ? /102474/ : /zhen\.\.\.02474/)
  }
})

test("diff file headers keep their stats and the sidebar keeps its ellipsis", async () => {
  const file = (path: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`
  const patch = [file(`d4/${"q".repeat(42)}.ts`), file(`${"x".repeat(25)}29.ts`)].join("")
  const setup = await createTestRenderer({ width: 80, height: 16 })
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
        />
      </box>
    ),
    setup.renderer,
  )
  for (let pass = 0; pass < 4; pass++) {
    await setup.flush()
    await setup.renderer.idle()
  }
  const frame = setup.captureCharFrame().split("\n")
  expect(frame.find((row) => row.includes("│d4/"))!.trimEnd()).toEndWith("+1 −1")
  expect(frame.some((row) => /^ {2}x+\.\.\. *│/.test(row))).toBe(true)
})
