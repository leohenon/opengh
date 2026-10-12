import { describe, expect, test } from "bun:test"
import { normalizeGitHubMarkdown } from "../src/ui/github-markdown"

describe("GitHub Markdown normalization", () => {
  test("issue attachments preserve branding and badge images as links", () => {
    const markdown = normalizeGitHubMarkdown(`![Broken logo](https://example.com/logo.png)\n\n![Build status](https://img.shields.io/build/status)`, { preserveImages: true })
    expect(markdown).toContain("[Image: Broken logo](https://example.com/logo.png)")
    expect(markdown).toContain("[Image: Build status](https://img.shields.io/build/status)")
    expect(normalizeGitHubMarkdown("```\nplain log output\n```", { codePanels: true })).toBe("```text\nplain log output\n```")
  })

  test("filters decorative and badge images while preserving meaningful labels", () => {
    const markdown = normalizeGitHubMarkdown(`
<div>
  <a href="https://opentui.com"><img alt="OpenTUI logo" src="logo.png"></a>
  <a href="https://npmjs.com/package/core"><img alt="npm version" src="https://img.shields.io/npm/v/core"></a>
  <a href="https://github.com/build"><img alt="Core build status" src="build/badge.svg"></a>
  <a href="https://example.com/architecture"><img alt="Architecture diagram" src="architecture.png"></a>
</div>
`)

    expect(markdown).not.toContain("OpenTUI logo")
    expect(markdown).not.toContain("npm version")
    expect(markdown).not.toContain("Core build status")
    expect(markdown).toContain("[Architecture diagram](https://example.com/architecture)")
    expect(markdown).not.toContain("\\[")
  })
})
