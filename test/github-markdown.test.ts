import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { visit } from "unist-util-visit"
import { GitHubMarkdownError, gitHubMarkdownFallback, hasMarkdownSyntax, normalizeGitHubMarkdown } from "../src/ui/github-markdown"

describe("GitHub Markdown normalization", () => {
  test("rejects container-prefix attacks before parsing, under a parent-enforced deadline", () => {
    // A regression must not block the test runner's event loop. This is a hang
    // backstop, not a latency benchmark; assertions identify the pre-parse guard.
    const result = spawnSync(
      process.execPath,
      [
        "--eval",
        `
      import { strict as assert } from "node:assert"
      import { GitHubMarkdownError, normalizeGitHubMarkdown, assertGitHubMarkdownSource } from "./src/ui/github-markdown"
      const attacks = [
        "> ".repeat(100000) + "text",
        "> ".repeat(65) + "text",
        ">".repeat(65) + "text",
        ...["- ", "+ ", "* ", "1. ", "1) ", "> - 1. >\\t"].map(prefix => prefix.repeat(65) + "text"),
        "- start\\r\\n" + "\\t".repeat(33) + "- text",
        "- start\\r\\n" + " ".repeat(130) + "1) text",
        ("> ".repeat(4) + "text\\r\\n").repeat(5001),
      ]
      for (const source of attacks) {
        assertGitHubMarkdownSource(source) // Plain-text documents keep their limits.
        assert.throws(() => normalizeGitHubMarkdown(source), error =>
          error instanceof GitHubMarkdownError && error.message === "Markdown is too complex (container prefixes before parsing)")
      }
    `,
      ],
      { cwd: new URL("..", import.meta.url), timeout: 10_000, encoding: "utf8" },
    )
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
  })

  test("prefix guard preserves ordinary README lists, fences, links, and alerts", () => {
    const source =
      "# Guide\r\n\r\n" +
      "- [Guide](https://example.com/)\r\n  1. Child\r\n".repeat(500) +
      "\r\n> [!NOTE]\r\n> Read this.\r\n\r\n```text\r\n>>> sample\r\n- 1. literal\r\n```"
    const markdown = normalizeGitHubMarkdown(source)
    expect(markdown.match(/\[Guide\]/g)).toHaveLength(500)
    expect(markdown).toContain("> **Note**")
    expect(markdown).toContain("```text\n>>> sample\r\n- 1. literal\n```")
  })

  test("bounds source size and tree complexity before recursive conversion", () => {
    const attack = "<a>" + "<span>".repeat(12_000) + "hello" + "</span>".repeat(12_000) + "</a>"
    for (const source of [
      attack,
      "> ".repeat(80) + "deep",
      "*x* ".repeat(10_001),
      "<template>".repeat(80) + "hello" + "</template>".repeat(80),
    ])
      expect(() => normalizeGitHubMarkdown(source)).toThrow("Markdown is too complex")
    for (const source of ["x".repeat(1024 * 1024 + 1), "界".repeat(400_000)])
      expect(() => normalizeGitHubMarkdown(source)).toThrow("Markdown is too large")
    for (const ending of ["\n", "\r\n", "\r"])
      expect(() => normalizeGitHubMarkdown("```text\n" + ("x" + ending).repeat(10_000) + "```")).toThrow("too many lines")
    const expansion = "[a][r] ".repeat(1000) + "\n\n[r]: https://example.com/" + "x".repeat(8000)
    expect(() => normalizeGitHubMarkdown(expansion)).toThrow("expansion exceeds")
    expect(() => normalizeGitHubMarkdown("#1 ".repeat(10_000), { context: { repositoryUrl: "https://github.com/owner/repo" } })).toThrow(
      "Markdown is too complex",
    )
    const fallback = gitHubMarkdownFallback("hello\u001b\u0085\n".repeat(10_000), new Error("private detail"))
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
    expect(() => normalizeGitHubMarkdown((modestTable + "\n").repeat(3))).toThrow("Markdown is too complex (table expansion)")
    const ragged = "| Name | Status |\n| :--- | ---: |\n| Ada |\n| Bob | Ready | ignored |"
    const padded = "| Name | Status |\n| :--- | ---: |\n| Ada | |\n| Bob | Ready |"
    expect(normalizeGitHubMarkdown(ragged)).toBe(normalizeGitHubMarkdown(padded))
    const longCell = "x".repeat(8000)
    const longColumn = normalizeGitHubMarkdown(`| ${longCell} |\n| --- |\n` + "|x|\n".repeat(1000))
    expect(longColumn).toContain(longCell)
    expect(longColumn.length).toBeLessThan(30_000) // No longest-cell padding across every serialized row.
    expect(() => normalizeGitHubMarkdown('<table><tr><td colspan="1000000000">x</td></tr></table>')).toThrow(
      "Markdown is too complex (table expansion)",
    )
    const rowSpan = (span: number) => `<table><tr><td rowspan="${span}">x</td></tr></table>`
    expect(normalizeGitHubMarkdown(rowSpan(1_000_000_000))).toBe(normalizeGitHubMarkdown(rowSpan(1)))
    const spanning = '<table><tr><th colspan="2">Heading</th></tr><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>'
    expect(normalizeGitHubMarkdown(spanning)).toBe(normalizeGitHubMarkdown("| Heading | |\n| --- | --- |\n| A | B |\n| | C |"))
  })

  test("control-bearing Markdown and HTML links remain text", () => {
    for (const control of ["\u007f", "\u0080", "\u0085", "\u009f"]) {
      const source = `[Unsafe](https://example.com/${control}path) and <a href="https://example.com/${control}path">HTML unsafe</a>`
      for (const markdown of [
        normalizeGitHubMarkdown(source),
        normalizeGitHubMarkdown(source, { context: { repositoryUrl: "https://github.com/owner/repo" } }),
      ]) {
        expect(markdown).toContain("Unsafe")
        expect(markdown).toContain("HTML unsafe")
        const links: unknown[] = []
        visit(unified().use(remarkParse).parse(markdown), ["link", "definition"], (node) => {
          links.push(node)
        })
        expect(links).toEqual([])
      }
    }
  })

  test("malformed destinations become inert labels without losing valid neighboring links", () => {
    for (const context of [undefined, { repositoryUrl: "https://github.com/o/r" }]) {
      for (const target of ["//[", "https://[", "//example.com:bad", "https://%zz/"]) {
        const source = `[broken](${target}) [reference][bad] <a href="${target}">HTML</a> ![image](${target})` + `\n\n[bad]: ${target}`
        const markdown = normalizeGitHubMarkdown(source, { context })
        expect(markdown).toBe("broken reference HTML ▧ image")
        const links: unknown[] = []
        visit(unified().use(remarkParse).parse(markdown), ["link", "definition", "linkReference"], (node) => {
          links.push(node)
        })
        expect(links).toEqual([])
      }
      const markdown = normalizeGitHubMarkdown(
        '[broken](//[) [valid][good] <a href="//example.com/docs">HTML</a>' + "\n\n[good]: https://example.com/guide",
        { context },
      )
      expect(markdown).toContain("broken [valid](https://example.com/guide)")
      expect(markdown).toContain(`[HTML](${context ? "https:" : ""}//example.com/docs)`)
    }
  })

  test("drops interactive form projections before datalist inputs can expand", () => {
    const options = `<option value="${"v".repeat(20_000)}" label="choice"></option>`.repeat(4)
    const source = `<datalist id="d">${options}</datalist>` + '<input list="d" multiple>'.repeat(100)
    expect(Buffer.byteLength(source)).toBeLessThan(85_000)
    expect(normalizeGitHubMarkdown(source)).toBe("")
    const controls =
      '<form>Static <button>button text<input list="d"></button>' +
      "<select><optgroup><option>Hidden option</option></optgroup></select>" +
      "<textarea>Hidden textarea</textarea><output>Hidden output</output>" +
      '<input value="Hidden input"></form>'
    const markdown = normalizeGitHubMarkdown(controls)
    expect(markdown).toContain("Static button text")
    expect(markdown).not.toContain("Hidden")
  })

  test("converter and context generated destinations are always sanitized", () => {
    const source =
      '<base href="file:///tmp/"><a href="relative">Relative</a>' +
      '<input type="image" src="file:///tmp/local-file" alt="Open">' +
      '<input type="url" value="file:///tmp/local-file">' +
      '<input type="url" value="javascript:alert(1)">' +
      '<input type="email" value="hidden@example.com">' +
      "\n\n[Unsafe reference][bad] ![Unsafe image][bad]\n\n[bad]: file:///tmp/local-file" +
      "\n\n[Safe](https://example.com/) ![Screenshot](https://example.com/ui.png)"
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
    const markup =
      '<base href="file:///tmp/"><input type="image" src="file:///tmp/local-file">\n' +
      '<datalist id="d"><option value="literal"></option></datalist><input list="d">'
    for (const codePanels of [true, false])
      expect(normalizeGitHubMarkdown("```html\n" + markup + "\n```", { codePanels })).toBe("```html\n" + markup + "\n```")
    const checks = normalizeGitHubMarkdown(
      '<p><input type="checkbox" checked disabled list="d"> Done ' + '<input type="radio" disabled list="d"> Pending</p>',
    )
    const labels: string[] = []
    visit(unified().use(remarkParse).parse(checks), "text", (node) => {
      labels.push(node.value)
    })
    expect(labels.join("")).toContain("[x] Done")
    expect(labels.join("")).toContain("[ ] Pending")
  })

  test("repository links and issue references resolve without changing code or existing links", () => {
    const markdown = normalizeGitHubMarkdown(
      `[Guide](CONTRIBUTING.md) [details](#details) [license](../LICENSE) [root](/SECURITY.md).

Fix #11126 and \\#11128, alongside other/repo#42 and [#99](https://example.com/custom).

C#123abc and #123abc aren't issue references. Inline \`#7\` stays code.

![Web UI](web-ui.png)

\`\`\`text
#8 stays code
\`\`\``,
      { context: { repositoryUrl: "https://github.com/qdrant/qdrant", ref: "feature/nested", path: "docs/README.md" } },
    )
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
    expect(markdown).toContain("![Web UI](https://github.com/qdrant/qdrant/blob/feature%2Fnested/docs/web-ui.png)")
    expect(markdown).toContain("#8 stays code")
    expect(
      normalizeGitHubMarkdown("[comment](#issuecomment-123)", {
        context: {
          repositoryUrl: "https://github.com/qdrant/qdrant",
          sourceUrl: "https://github.com/qdrant/qdrant/issues/10",
        },
      }),
    ).toContain("https://github.com/qdrant/qdrant/issues/10#issuecomment-123")
  })

  test("commit references and mentions link only in prose, without wrapping existing links", () => {
    const full = "a".repeat(40)
    const markdown = normalizeGitHubMarkdown(
      `Use abc1234, other/repo@deadbee, ${full}, and @octocat.

Leave deadbee, 1234567, abc123, abc1234z, xabc1234, abc1234_name, and name@octocat.com alone.

[abc1234 @octocat](https://example.com/existing) and https://example.com/abc1234.

Inline \`abc1234 @octocat\` and ![abc1234](https://example.com/image.png).

<!-- other/repo@abc1234 @hidden -->

\`\`\`text
other/repo@abc1234 @hidden
\`\`\``,
      { context: { repositoryUrl: "https://github.com/owner/repo" }, preserveImages: true },
    )
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
    const markdown = normalizeGitHubMarkdown(
      "> [!WARNING]\n> Read the **migration guide**.\n\n[!NOTE] is literal here.\n\n```text\n> [!NOTE]\n```",
    )
    expect(markdown).toContain("> **Warning**\n>\n> Read the **migration guide**.")
    expect(markdown).toContain("\\[!NOTE] is literal here.")
    expect(markdown).toContain("```text\n> [!NOTE]\n```")
  })

  test("single newlines break lines in discussions and stay soft in documents", () => {
    const source = [
      "Fixes #12",
      "Closes #13",
      "",
      "- item line",
      "  continued line",
      "",
      "> [!NOTE]",
      "> quote one",
      "> quote two",
      "",
      "Inline `code",
      "span` and **bold",
      "text**.",
      "",
      "```text",
      "one",
      "two",
      "```",
    ].join("\n")
    const discussion = normalizeGitHubMarkdown(source, { preserveImages: true })
    expect(discussion).toContain("Fixes #12\\\nCloses #13")
    expect(discussion).toContain("- item line\\\n  continued line")
    expect(discussion).toContain("> **Note**\n>\n> quote one\\\n> quote two")
    expect(discussion).toContain("Inline `code span` and **bold\\\ntext**.")
    expect(discussion).toContain("```text\none\ntwo\n```")
    const document = normalizeGitHubMarkdown(source)
    expect(document).toContain("Fixes #12 Closes #13")
    expect(document).toContain("- item line continued line")
    expect(document).toContain("> quote one quote two")
    expect(document).not.toContain("\\\n")
    expect(normalizeGitHubMarkdown("one\r\ntwo\rthree", { preserveImages: true })).toBe("one\\\ntwo\\\nthree")
  })

  test("discussions too long to keep their line breaks render joined instead of as a preview", () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index}`).join("\n")
    expect(normalizeGitHubMarkdown(lines(6_000), { preserveImages: true }).split("\\\n")).toHaveLength(6_000)
    const joined = normalizeGitHubMarkdown(lines(9_000), { preserveImages: true })
    expect(joined).not.toContain("\n")
    expect(joined.startsWith("line 0 line 1 line 2")).toBe(true)
    expect(joined.endsWith("line 8998 line 8999")).toBe(true)
    expect(() => normalizeGitHubMarkdown(lines(10_001), { preserveImages: true })).toThrow("too many lines")
    expect(() => normalizeGitHubMarkdown("<span>".repeat(25_000) + "x", { preserveImages: true })).toThrow(GitHubMarkdownError)
  })

  test("unwrapped line breaks rejoin hard-wrapped prose and keep the breaks an author chose", () => {
    const unwrap = (value: string) => normalizeGitHubMarkdown(value, { lineBreaks: "unwrapped" })
    expect(
      unwrap(
        [
          "Clarify when a shared session promise needs Suspense in the",
          "Authentication with Cache Components guide. A layout can call",
          "`getCurrentUser()` and forward the promise without awaiting it. The",
          "boundary goes around the UI that waits for the user.",
        ].join("\n"),
      ),
    ).toBe(
      "Clarify when a shared session promise needs Suspense in the Authentication with Cache Components guide. A layout can call `getCurrentUser()` and forward the promise without awaiting it. The boundary goes around the UI that waits for the user.",
    )
    expect(
      unwrap(
        [
          "- Tested a layout that forwards the session promise in the iron-session",
          "  example on 16.4.6 and 16.5.0-canary.68. With Cache Components and",
          "  Partial Prefetching enabled.",
          "- Second item",
          "  kept apart",
        ].join("\n"),
      ),
    ).toBe(
      "- Tested a layout that forwards the session promise in the iron-session example on 16.4.6 and 16.5.0-canary.68. With Cache Components and Partial Prefetching enabled.\n- Second item\\\n  kept apart",
    )
    const mixed = unwrap(
      [
        "This paragraph was wrapped by hand at seventy-two columns so its lines",
        "continue onto the next one and should be joined back together when shown.",
        "",
        "Fixes #12",
        "Closes #13",
        "",
        "```text",
        "one line of preformatted output that is long enough to look wrapped here",
        "two",
        "```",
        "",
        "Co-authored-by: Some Very Long Contributor Name <some.very.long.name@example-company.com>",
        "Signed-off-by: Other Person <other@example.com>",
      ].join("\n"),
    )
    expect(mixed).toContain("so its lines continue onto the next one and should be joined")
    expect(mixed).toContain("Fixes #12\\\nCloses #13")
    expect(mixed).toContain("long enough to look wrapped here\ntwo\n```")
    expect(mixed).toContain("example-company.com>\\\nSigned-off-by:")
    expect(unwrap("Fixes the login flow for everyone\nUpdates the signup flow for teams")).toBe(
      "Fixes the login flow for everyone\\\nUpdates the signup flow for teams",
    )
    expect(normalizeGitHubMarkdown("one\ntwo")).toBe("one two")
  })

  test("Markdown syntax is recognized without treating plain commit text as Markdown", () => {
    for (const value of [
      "### What?\n\nText",
      "Use `getCurrentUser()` here",
      "```sh\nls\n```",
      "See [the guide](https://example.com/guide)",
      "This is **important**",
      "- [x] done",
      "<!-- template -->\nText",
    ])
      expect(hasMarkdownSyntax(value)).toBe(true)
    for (const value of [
      "Keep one owner for keyboard input so a single key press fires once.",
      "- first change\n- second change",
      "Handle Array<string> and __init__ for #1234\n\nSigned-off-by: A <a@example.com>",
      "#1234 follow-up: globs like *.ts and *.tsx",
    ])
      expect(hasMarkdownSyntax(value)).toBe(false)
  })

  test("lists keep the spacing they were written with", () => {
    expect(normalizeGitHubMarkdown("- a\n- b\n  - nested\n  - nested two\n- c")).toBe("- a\n- b\n  - nested\n  - nested two\n- c")
    expect(normalizeGitHubMarkdown("1. one\n   ```sh\n   ls\n   ```\n   - k\n   - l\n2. two")).toBe(
      "1. one\n   ```sh\n   ls\n   ```\n   - k\n   - l\n2. two",
    )
    expect(normalizeGitHubMarkdown("<ul><li>a</li><li>b<ul><li>x</li><li>y</li></ul></li></ul>")).toBe("- a\n- b\n  - x\n  - y")
    expect(normalizeGitHubMarkdown("- a\n\n- b\n  - nested\n  - nested two")).toBe("- a\n\n- b\n\n  - nested\n  - nested two")
    expect(normalizeGitHubMarkdown("- one\n\n  two\n- three")).toBe("- one\n\n  two\n\n- three")
    expect(normalizeGitHubMarkdown("- [x] done\n  - [ ] sub one\n  - [ ] sub two\n- [ ] todo")).toBe(
      "- [x] done\n  - [ ] sub one\n  - [ ] sub two\n- [ ] todo",
    )
  })

  test("standalone images retain image identity while inline images and badges stay compact", () => {
    expect(normalizeGitHubMarkdown("![Screenshot](ui.png)")).toBe("![Screenshot](ui.png)")
    expect(normalizeGitHubMarkdown("[![Screenshot](ui.png)](https://example.com/view)")).toBe("![Screenshot](https://example.com/view)")
    expect(normalizeGitHubMarkdown('<p><picture><source srcset="dark.png"><img alt="Screenshot" src="ui.png"></picture></p>')).toBe(
      "![Screenshot](ui.png)",
    )
    expect(normalizeGitHubMarkdown("Before ![Inline](ui.png) after")).toBe("Before ▧ [Inline](ui.png) after")
    expect(normalizeGitHubMarkdown('<div>Before <img alt="Inline" src="ui.png"> after</div>')).toBe("Before ▧ [Inline](ui.png) after")
    expect(normalizeGitHubMarkdown("- ![Nested](ui.png)")).toBe("- ▧ [Nested](ui.png)")
    expect(normalizeGitHubMarkdown("![Build status](https://img.shields.io/build/status)", { preserveImages: true })).toBe(
      "▧ [Build status](https://img.shields.io/build/status)",
    )
    expect(normalizeGitHubMarkdown("![Unsafe](javascript:alert)")).toBe("▧ Unsafe")
  })

  test("standalone images keep descriptions separate from filename fallbacks", () => {
    expect(normalizeGitHubMarkdown("![](images/screen%20shot.png?token=secret)")).toBe(
      '![](images/screen%20shot.png?token=secret "screen shot.png")',
    )
    expect(normalizeGitHubMarkdown("[![](images/screen.png)](https://example.com/view)")).toBe('![](https://example.com/view "screen.png")')
    expect(normalizeGitHubMarkdown("![](https://example.com/)")).toBe('![](https://example.com/ "open image")')
    expect(normalizeGitHubMarkdown('<img alt=" " title="Useful description" src="screen.png">')).toBe("![Useful description](screen.png)")
  })

  test("issue attachments preserve branding and badge images as links", () => {
    const markdown = normalizeGitHubMarkdown(
      `![Broken logo](https://example.com/logo.png)\n\n![Build status](https://img.shields.io/build/status)\n\n![Qdrant](https://example.com/docs/logo.svg)`,
      { preserveImages: true },
    )
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
