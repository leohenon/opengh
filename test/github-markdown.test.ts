import { describe, expect, test } from "bun:test"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { visit } from "unist-util-visit"
import { gitHubMarkdownFallback, normalizeGitHubMarkdown } from "../src/ui/github-markdown"

describe("GitHub Markdown normalization", () => {
  test("bounds source size and tree complexity before recursive conversion", () => {
    const attack = "<a>" + "<span>".repeat(12_000) + "hello" + "</span>".repeat(12_000) + "</a>"
    for (const source of [attack, "> ".repeat(80) + "deep", "*x* ".repeat(10_001), "<template>".repeat(80) + "hello" + "</template>".repeat(80)])
      expect(() => normalizeGitHubMarkdown(source)).toThrow("Markdown is too complex")
    for (const source of ["x".repeat(1024 * 1024 + 1), "界".repeat(400_000)])
      expect(() => normalizeGitHubMarkdown(source)).toThrow("Markdown is too large")
    for (const ending of ["\n", "\r\n", "\r"])
      expect(() => normalizeGitHubMarkdown("```text\n" + ("x" + ending).repeat(10_000) + "```"))
        .toThrow("too many lines")
    const expansion = "[a][r] ".repeat(1000) + "\n\n[r]: https://example.com/" + "x".repeat(8000)
    expect(() => normalizeGitHubMarkdown(expansion)).toThrow("expansion exceeds")
    expect(() => normalizeGitHubMarkdown("#1 ".repeat(10_000), { context: { repositoryUrl: "https://github.com/owner/repo" } }))
      .toThrow("Markdown is too complex")
    const fallback = gitHubMarkdownFallback(("hello\u001b\u0085\n").repeat(10_000), new Error("private detail"))
    expect(fallback).toContain("Markdown conversion failed. Showing a plain-text preview.")
    expect(fallback).not.toContain("private detail")
    expect(fallback).not.toMatch(/[\u001b\u0085]/)
    expect(fallback.length).toBeLessThan(4300)
    expect(fallback.split("\n").length).toBeLessThanOrEqual(44)
  })

  test("projects padded GFM cells before conversion with an aggregate table budget", () => {
    const attack = "|" + "h|".repeat(3000) + "\n|" + "-|".repeat(3000) + "\n" + "|x|\n".repeat(4000)
    expect(Buffer.byteLength(attack)).toBe(28_004)
    // This error comes from boundedMarkdown, not the post-conversion HAST cap.
    expect(() => normalizeGitHubMarkdown(attack)).toThrow("Markdown is too complex (table expansion)")
    const modestTable = "|" + "h|".repeat(40) + "\n|" + "-|".repeat(40) + "\n" + "|x|\n".repeat(100)
    expect(normalizeGitHubMarkdown(modestTable)).toContain("| h")
    expect(() => normalizeGitHubMarkdown((modestTable + "\n").repeat(3)))
      .toThrow("Markdown is too complex (table expansion)")
    const ragged = "| Name | Status |\n| :--- | ---: |\n| Ada |\n| Bob | Ready | ignored |"
    const padded = "| Name | Status |\n| :--- | ---: |\n| Ada | |\n| Bob | Ready |"
    expect(normalizeGitHubMarkdown(ragged)).toBe(normalizeGitHubMarkdown(padded))
    const longCell = "x".repeat(8000)
    const longColumn = normalizeGitHubMarkdown(`| ${longCell} |\n| --- |\n` + "|x|\n".repeat(1000))
    expect(longColumn).toContain(longCell)
    expect(longColumn.length).toBeLessThan(30_000) // No longest-cell padding across every serialized row.
    expect(() => normalizeGitHubMarkdown('<table><tr><td colspan="1000000000">x</td></tr></table>'))
      .toThrow("Markdown is too complex (table expansion)")
    const rowSpan = (span: number) => `<table><tr><td rowspan="${span}">x</td></tr></table>`
    expect(normalizeGitHubMarkdown(rowSpan(1_000_000_000))).toBe(normalizeGitHubMarkdown(rowSpan(1)))
    const spanning = '<table><tr><th colspan="2">Heading</th></tr><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>'
    expect(normalizeGitHubMarkdown(spanning)).toBe(normalizeGitHubMarkdown("| Heading | |\n| --- | --- |\n| A | B |\n| | C |"))
  })

  test("control-bearing Markdown and HTML links remain text", () => {
    for (const control of ["\u007f", "\u0080", "\u0085", "\u009f"]) {
      const source = `[Unsafe](https://example.com/${control}path) and <a href="https://example.com/${control}path">HTML unsafe</a>`
      for (const markdown of [normalizeGitHubMarkdown(source), normalizeGitHubMarkdown(source, { context: { repositoryUrl: "https://github.com/owner/repo" } })]) {
        expect(markdown).toContain("Unsafe")
        expect(markdown).toContain("HTML unsafe")
        const links: unknown[] = []
        visit(unified().use(remarkParse).parse(markdown), ["link", "definition"], (node) => { links.push(node) })
        expect(links).toEqual([])
      }
    }
  })

  test("malformed destinations become inert labels without losing valid neighboring links", () => {
    for (const context of [undefined, { repositoryUrl: "https://github.com/o/r" }]) {
      for (const target of ["//[", "https://[", "//example.com:bad", "https://%zz/"]) {
        const source = `[broken](${target}) [reference][bad] <a href="${target}">HTML</a> ![image](${target})`
          + `\n\n[bad]: ${target}`
        const markdown = normalizeGitHubMarkdown(source, { context })
        expect(markdown).toBe("broken reference HTML ▧ image")
        const links: unknown[] = []
        visit(unified().use(remarkParse).parse(markdown), ["link", "definition", "linkReference"], (node) => { links.push(node) })
        expect(links).toEqual([])
      }
      const markdown = normalizeGitHubMarkdown('[broken](//[) [valid][good] <a href="//example.com/docs">HTML</a>'
        + '\n\n[good]: https://example.com/guide', { context })
      expect(markdown).toContain("broken [valid](https://example.com/guide)")
      expect(markdown).toContain(`[HTML](${context ? "https:" : ""}//example.com/docs)`)
    }
  })

  test("drops interactive form projections before datalist inputs can expand", () => {
    const options = `<option value="${"v".repeat(20_000)}" label="choice"></option>`.repeat(4)
    const source = `<datalist id="d">${options}</datalist>` + '<input list="d" multiple>'.repeat(100)
    expect(Buffer.byteLength(source)).toBeLessThan(85_000)
    expect(normalizeGitHubMarkdown(source)).toBe("")
    const controls = '<form>Static <button>button text<input list="d"></button>'
      + '<select><optgroup><option>Hidden option</option></optgroup></select>'
      + '<textarea>Hidden textarea</textarea><output>Hidden output</output>'
      + '<input value="Hidden input"></form>'
    const markdown = normalizeGitHubMarkdown(controls)
    expect(markdown).toContain("Static button text")
    expect(markdown).not.toContain("Hidden")
  })

  test("converter and context generated destinations are always sanitized", () => {
    const source = '<base href="file:///tmp/"><a href="relative">Relative</a>'
      + '<input type="image" src="file:///tmp/local-file" alt="Open">'
      + '<input type="url" value="file:///tmp/local-file">'
      + '<input type="url" value="javascript:alert(1)">'
      + '<input type="email" value="hidden@example.com">'
      + '\n\n[Unsafe reference][bad] ![Unsafe image][bad]\n\n[bad]: file:///tmp/local-file'
      + '\n\n[Safe](https://example.com/) ![Screenshot](https://example.com/ui.png)'
    for (const context of [undefined, { repositoryUrl: "https://github.com/owner/repo" }]) {
      const markdown = normalizeGitHubMarkdown(source, { context })
      expect(markdown).toContain("Relative")
      expect(markdown).toContain("Unsafe reference")
      expect(markdown).toContain("Unsafe image")
      expect(markdown).toContain("[Safe](https://example.com/)")
      expect(markdown).toContain("▧ [Screenshot](https://example.com/ui.png)")
      expect(markdown).not.toContain("local-file")
      expect(markdown).not.toContain("hidden@example.com")
      visit(unified().use(remarkParse).parse(markdown), ["link", "image", "definition"], (node) => {
        if (node.type === "link" || node.type === "image" || node.type === "definition")
          expect(node.url).not.toMatch(/^(?:file|javascript|data):|[\u0000-\u001f\u007f-\u009f]/i)
      })
    }
    // Exercise the final pass independently of early HTML/Markdown checks:
    // resolution itself can generate a forbidden destination from context.
    for (const context of [
      { repositoryUrl: "file:///tmp/repo" },
      { repositoryUrl: "https://github.com/owner/repo", sourceUrl: "file:///tmp/source" },
    ]) {
      const markdown = normalizeGitHubMarkdown("[Readable](#section)", { context })
      expect(markdown).toBe("Readable")
    }
  })

  test("task states stay readable and fenced control markup stays literal", () => {
    const tasks = "- [x] Complete\n- [ ] Pending"
    expect(normalizeGitHubMarkdown(tasks)).toBe(tasks)
    const markup = '<base href="file:///tmp/"><input type="image" src="file:///tmp/local-file">\n'
      + '<datalist id="d"><option value="literal"></option></datalist><input list="d">'
    for (const codePanels of [true, false])
      expect(normalizeGitHubMarkdown("```html\n" + markup + "\n```", { codePanels }))
        .toBe("```html\n" + markup + "\n```")
    const checks = normalizeGitHubMarkdown('<p><input type="checkbox" checked disabled list="d"> Done '
      + '<input type="radio" disabled list="d"> Pending</p>')
    const labels: string[] = []
    visit(unified().use(remarkParse).parse(checks), "text", (node) => { labels.push(node.value) })
    expect(labels.join("")).toContain("[x] Done")
    expect(labels.join("")).toContain("[ ] Pending")
  })

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

  test("commit references and mentions link only in prose, without wrapping existing links", () => {
    const full = "a".repeat(40)
    const markdown = normalizeGitHubMarkdown(`Use abc1234, other/repo@deadbee, ${full}, and @octocat.

Leave deadbee, 1234567, abc123, abc1234z, xabc1234, abc1234_name, and name@octocat.com alone.

[abc1234 @octocat](https://example.com/existing) and https://example.com/abc1234.

Inline \`abc1234 @octocat\` and ![abc1234](https://example.com/image.png).

<!-- other/repo@abc1234 @hidden -->

\`\`\`text
other/repo@abc1234 @hidden
\`\`\``, { context: { repositoryUrl: "https://github.com/owner/repo" }, preserveImages: true })
    expect(markdown).toContain("[abc1234](https://github.com/owner/repo/commit/abc1234)")
    expect(markdown).toContain("[other/repo@deadbee](https://github.com/other/repo/commit/deadbee)")
    expect(markdown).toContain(`[${full}](https://github.com/owner/repo/commit/${full})`)
    expect(markdown).toContain("[@octocat](https://github.com/octocat)")
    expect(markdown).toContain("[abc1234 @octocat](https://example.com/existing)")
    expect(markdown).toContain("▧ [abc1234](https://example.com/image.png)")
    expect(markdown.match(/\/commit\//g)).toHaveLength(3)
    expect(markdown).not.toContain("https://github.com/hidden")
    expect(markdown).toContain("`abc1234 @octocat`")
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
