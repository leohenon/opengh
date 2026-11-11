import { expect, test } from "bun:test"
import { renderStaticPage, STATIC_MAX_BYTES, STATIC_MAX_LINES } from "../src/ui/static-page"
import { InlineScreen } from "../src/inline-screen"
import { defaultConfig } from "../src/config"
import { testRender } from "@opentui/solid"
import { CodeRenderable, type Renderable } from "@opentui/core"
import { ThemeProvider } from "../src/ui/theme"
import { IconProvider } from "../src/ui/icon-style"
import { MarkdownProvider } from "../src/ui/markdown-preferences"
import type { InlineScreenData } from "../src/inline-screen"
import { issueDetailFixture, issueCommentsFixture, issuePullReferenceFixture, pullContextFixture, githubDataFixture } from "./fixtures/github-data"

test("static capture bounds tall pages and explicitly marks the retained prefix incomplete", async () => {
  const content = "Useful row\n".repeat(STATIC_MAX_LINES + 100) + "Beyond the limit"
  const output = await renderStaticPage(() => <scrollbox><text>{content}</text></scrollbox>,
    { width: 80, config: defaultConfig, color: false })
  expect(output).toContain("Useful row")
  expect(output).not.toContain("Beyond the limit")
  expect(output).toContain("Output is incomplete")
  expect(Buffer.byteLength(output)).toBeLessThan(STATIC_MAX_BYTES + 256)
  expect(output.split("\n").length).toBeLessThan(STATIC_MAX_LINES + 5)
})

test("static issue uses the real page layout and prints content beyond the capture window", async () => {
  const body = Array.from({ length: 100 }, (_, index) => `Paragraph ${index + 1}: **styled content**.`).join("\n\n")
  const data: InlineScreenData = { kind: "issue", detail: {
    number: issueDetailFixture.number,
    resource: { status: "ready", value: { ...issueDetailFixture, body } },
    comments: { status: "ready", value: { items: issueCommentsFixture, page: 1, hasMore: false } },
    references: { status: "ready", value: [issuePullReferenceFixture] },
  } }
  const output = await renderStaticPage(() => <InlineScreen config={defaultConfig} data={data} />, { width: 120, config: defaultConfig, color: false })
  expect(output).toContain(issueDetailFixture.title)
  expect(output).toContain("Paragraph 1:")
  expect(output).toContain("Paragraph 100:")
  expect(output).toContain(issueCommentsFixture[1]!.body.replaceAll("**", ""))
  expect(output).not.toContain("**styled content**")
  expect(output).not.toContain("\x1b")
  expect(output.match(/Paragraph \d+:/g)).toHaveLength(100)
  expect(output.match(/Labels/g)).toHaveLength(1)
  const metadata = output.split("\n").find(line => line.includes("Labels"))!
  expect(metadata).toContain("Assignees")
  expect(output.indexOf(metadata)).toBeLessThan(output.indexOf("Paragraph 1:"))
  expect(output).not.toContain("Referenced PRs")
  expect(output.match(new RegExp(issuePullReferenceFixture.title, "g"))).toHaveLength(1)
  const view = await testRender(() => <ThemeProvider name={defaultConfig.theme} mode={defaultConfig.colorMode}>
    <IconProvider style={defaultConfig.iconStyle}><MarkdownProvider style={defaultConfig.markdownStyle}>
      <InlineScreen config={defaultConfig} data={data} />
    </MarkdownProvider></IconProvider>
  </ThemeProvider>, { width: 120, height: output.split("\n").length + 4 })
  try {
    await view.flush()
    const highlight = async (node: Renderable): Promise<void> => {
      if (node instanceof CodeRenderable) await node.highlightingDone
      await Promise.all(node.getChildren().map(highlight))
    }
    await highlight(view.renderer.root)
    await view.flush()
    const expected = view.captureCharFrame().split("\n").map(line => line.trimEnd()).join("\n").trimEnd()
    expect(output.trimEnd()).toBe(expected)
  } finally {
    await view.dispose()
  }
})

test("static output uses the terminal background for Markdown, code, and comments", async () => {
  const config = { ...defaultConfig, theme: "github" as const, colorMode: "light" as const, iconStyle: "unicode" as const }
  const data: InlineScreenData = { kind: "issue", detail: {
    number: issueDetailFixture.number,
    resource: { status: "ready", value: { ...issueDetailFixture,
      body: "## Code\n\n```ts\nconst answer = 42;\nconsole.log(answer);\n```\n\n| Key | Value |\n| --- | --- |\n| Answer | 42 |" } },
    comments: { status: "ready", value: { items: issueCommentsFixture, page: 1, hasMore: false } },
    references: { status: "ready", value: [] },
  } }
  const output = await renderStaticPage(() => <InlineScreen config={config} data={data} />, { width: 80, config })
  const text = output.replace(/\x1b\[[\d;]*m/g, "")
  expect(text).toContain("const answer = 42;")
  expect(text).toContain("console.log(answer);")
  expect(text).toContain("Answer")
  expect(text).toMatch(/[┌┬┐─]/)
  expect(text).not.toContain("```")
  expect(text).not.toContain("## Code")
  expect(output).toContain("\x1b[0;")
  expect(output).not.toContain(";48;")
  expect(output).toContain(";38;2;")
  expect(text).toContain(issueCommentsFixture[0]!.body)
  const title = output.split("\n").find(line => line.includes(issueDetailFixture.title))!
  expect(title).toContain(";39;49m")
  expect(title).not.toContain(";48;2;")
  expect(output).not.toContain("\x1b[?1049")
})

test("static lists expand all virtualized rows without repeating the page header", async () => {
  const items = Array.from({ length: 70 }, (_, index) => ({ ...issueDetailFixture, number: index + 1, title: `Unique item ${index + 1}` }))
  const output = await renderStaticPage(() => <InlineScreen config={defaultConfig}
    data={{ kind: "issues", items, closedCount: "0" }} />, { width: 80, config: defaultConfig, color: false })
  expect(output.match(/Unique item \d+/g)).toHaveLength(70)
  expect(output).toContain("Unique item 1")
  expect(output).toContain("Unique item 70")
  expect(output.match(/Open \(70\)/g)).toHaveLength(1)
})


test("inline PR details stay above the description and omit empty metadata", async () => {
  const config = { ...defaultConfig, detailLayout: "wide" as const }
  const data: InlineScreenData = { kind: "pull", detail: {
    number: issueDetailFixture.number,
    resource: { status: "ready", value: { ...issueDetailFixture, labels: [], assignees: [],
      body: "The complete PR description.", merged: false, draft: false, baseBranch: "main", headBranch: "feature",
      additions: 5, deletions: 1, changedFiles: 1, commitCount: 0, reviewers: [], mergeable: true } },
    comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
    references: { status: "ready", value: [] },
    commits: { status: "ready", value: [] },
    context: { status: "ready", value: pullContextFixture },
  } }
  const output = await renderStaticPage(() => <InlineScreen config={config} data={data} />, { width: 140, config, color: false })
  expect(output).toContain("Branches main ← feature")
  expect(output.indexOf("Changes")).toBeLessThan(output.indexOf("The complete PR description."))
  for (const field of ["Details", "Labels", "Assignees", "Milestone", "Projects", "No reviews"])
    expect(output).not.toContain(field)
})


test("inline overview puts compact About above the full-width README", async () => {
  const config = { ...defaultConfig, detailLayout: "wide" as const }
  const repo = { ...githubDataFixture.repo, description: "Unique repository description." }
  const data: InlineScreenData = { kind: "overview", repo, documents: [{
    id: "readme", repository: repo.nameWithOwner, ref: "main", path: "README.md", label: "README",
    resource: { status: "ready", value: "# Unique README heading\n\nFull-width README content." },
  }] }
  const output = await renderStaticPage(() => <InlineScreen config={config} data={data} />, { width: 160, config, color: false })
  expect(output).toContain(`About · ${repo.nameWithOwner}`)
  expect(output).toContain(repo.description)
  const summary = output.split("\n").find(line => line.includes("stars"))!
  expect(summary).toContain("forks")
  expect(summary).toContain("watching")
  expect(summary).toContain(repo.language)
  expect(summary).toContain(repo.license)
  expect(output.indexOf(summary)).toBeLessThan(output.indexOf("Unique README heading"))
  const heading = output.split("\n").find(line => line.includes("Unique README heading"))!
  expect(heading).not.toContain("About")
  expect(heading).not.toContain(repo.description)
  expect(output.match(/Unique repository description/g)).toHaveLength(1)
})
