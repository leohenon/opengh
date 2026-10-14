import { describe, expect, test } from "bun:test"
import { normalizeGitHubMarkdown } from "../src/ui/github-markdown"

describe("GitHub Markdown normalization", () => {
  test("repository links and issue references resolve without changing code or existing links", () => {
    const markdown = normalizeGitHubMarkdown(`[Guide](CONTRIBUTING.md) [details](#details) [license](../LICENSE) [root](/SECURITY.md).

Fix #11126 and \\#11128, alongside other/repo#42 and [#99](https://example.com/custom).

C#123abc and #123abc aren't issue references. Inline \`#7\` stays code.

![Web UI](web-ui.png)

\`\`\`text
#8 stays code
\`\`\``, { context: { repositoryUrl: "https://github.com/qdrant/qdrant", ref: "feature/nested", path: "docs/README.md" } })
    expect(markdown).toContain("[Guide](https://github.com/qdrant/qdrant/blob/feature%2Fnested/docs/CONTRIBUTING.md)")
    expect(markdown).toContain("[details](https://github.com/qdrant/qdrant/blob/feature%2Fnested/docs/README.md#details)")
    expect(markdown).toContain("[license](https://github.com/qdrant/qdrant/blob/feature%2Fnested/LICENSE)")
    expect(markdown).toContain("[root](https://github.com/qdrant/qdrant/blob/feature%2Fnested/SECURITY.md)")
    expect(markdown).toContain("[#11126](https://github.com/qdrant/qdrant/issues/11126)")
    expect(markdown).toContain("[#11128](https://github.com/qdrant/qdrant/issues/11128)")
    expect(markdown).toContain("[other/repo#42](https://github.com/other/repo/issues/42)")
    expect(markdown).toContain("[#99](https://example.com/custom)")
    expect(markdown).not.toContain("/issues/123")
    expect(markdown).not.toContain("/issues/7")
    expect(markdown).not.toContain("/issues/8")
    expect(markdown).toContain("▧ [Web UI](https://github.com/qdrant/qdrant/blob/feature%2Fnested/docs/web-ui.png)")
    expect(markdown).toContain("#8 stays code")
    expect(normalizeGitHubMarkdown("[comment](#issuecomment-123)", { context: {
      repositoryUrl: "https://github.com/qdrant/qdrant", sourceUrl: "https://github.com/qdrant/qdrant/issues/10",
    } })).toContain("https://github.com/qdrant/qdrant/issues/10#issuecomment-123")
  })

  test("GitHub alerts become readable quote headings without changing code or literal markers", () => {
    const markdown = normalizeGitHubMarkdown("> [!WARNING]\n> Read the **migration guide**.\n\n[!NOTE] is literal here.\n\n```text\n> [!NOTE]\n```")
    expect(markdown).toContain("> **Warning**\n>\n> Read the **migration guide**.")
    expect(markdown).toContain("\\[!NOTE] is literal here.")
    expect(markdown).toContain("```text\n> [!NOTE]\n```")
  })

  test("issue attachments preserve branding and badge images as links", () => {
    const markdown = normalizeGitHubMarkdown(`![Broken logo](https://example.com/logo.png)\n\n![Build status](https://img.shields.io/build/status)\n\n![Qdrant](https://example.com/docs/logo.svg)`, { preserveImages: true })
    expect(markdown).toContain("▧ [Broken logo](https://example.com/logo.png)")
    expect(markdown).toContain("▧ [Build status](https://img.shields.io/build/status)")
    expect(markdown).toContain("▧ [Qdrant](https://example.com/docs/logo.svg)")
    expect(normalizeGitHubMarkdown("```\nplain log output\n```", { codePanels: true })).toBe("```text\nplain log output\n```")
  })

  test("filters decorative and badge images while preserving meaningful labels", () => {
    const markdown = normalizeGitHubMarkdown(`
<p align="center"><picture><img alt="Qdrant" src="https://example.com/docs/logo.svg"></picture></p>
<div>
  <a href="https://opentui.com"><img alt="OpenTUI logo" src="logo.png"></a>
  <a href="https://npmjs.com/package/core"><img alt="npm version" src="https://img.shields.io/npm/v/core"></a>
  <a href="https://github.com/build"><img alt="Core build status" src="build/badge.svg"></a>
  <a href="https://example.com/architecture"><img alt="Architecture diagram" src="architecture.png"></a>
</div>
`)

    expect(markdown).not.toContain("Qdrant")
    expect(markdown).not.toContain("OpenTUI logo")
    expect(markdown).not.toContain("npm version")
    expect(markdown).not.toContain("Core build status")
    expect(markdown).toContain("[Architecture diagram](https://example.com/architecture)")
    expect(markdown).not.toContain("\\[")
  })
})
