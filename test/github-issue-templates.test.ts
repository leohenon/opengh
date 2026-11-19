import { describe, expect, test } from "bun:test"
import { createGitHubIssueTemplates, formTemplate, markdownTemplate } from "../src/github/issue-templates"
import { GitHubApiError, type GitHubTransport } from "../src/github/transport"
import { githubDataFixture } from "./fixtures/github-data"

const repository = { ...githubDataFixture.repo, id: 123 }

describe("issue templates", () => {
  test("reads Markdown templates from their header and keeps the body unchanged", () => {
    expect(
      markdownTemplate("---\nname: Bug report\nabout: Report a bug\ntitle: '[Bug] '\nlabels: bug\n---\n\n**Describe it**\n<!-- keep -->\n"),
    ).toEqual({ name: "Bug report", about: "Report a bug", title: "[Bug] ", body: "\n**Describe it**\n<!-- keep -->\n" })
    expect(markdownTemplate("---\r\nname: Windows\r\n---\r\nBody")).toEqual({ name: "Windows", about: "", title: "", body: "Body" })
    expect(markdownTemplate("No header")).toBeUndefined()
    expect(markdownTemplate("---\nabout: Missing name\n---\nBody")).toBeUndefined()
    expect(markdownTemplate("---\nname: [unclosed\n---\nBody")).toBeUndefined()
  })

  test("turns issue forms into a Markdown description", () => {
    const form = formTemplate(`
name: Bug report
description: File a bug
title: "[Bug]: "
labels: [bug]
body:
  - type: markdown
    attributes:
      value: Thanks for reporting!
  - type: input
    id: version
    attributes:
      label: Version
      description: Which version?
      placeholder: 1.2.3
    validations:
      required: true
  - type: dropdown
    id: os
    attributes:
      label: OS
      options: [macOS, Linux, Windows]
      default: 1
  - type: dropdown
    id: browsers
    attributes:
      label: Browsers
      multiple: true
      options: [Firefox, Chrome]
  - type: textarea
    id: logs
    attributes:
      label: Logs
      render: shell
  - type: textarea
    id: what
    attributes:
      label: What happened?
      value: It broke -->
  - type: checkboxes
    id: terms
    attributes:
      label: Checks
      options:
        - label: I searched existing issues
          required: true
        - label: I read the docs
  - type: input
    attributes:
      description: Missing label is skipped
`)
    expect(form).toEqual({
      name: "Bug report",
      about: "File a bug",
      title: "[Bug]: ",
      body: [
        "<!-- Thanks for reporting! -->",
        "### Version\n\n<!-- Which version? -->\n<!-- placeholder: 1.2.3 -->\n<!-- required -->",
        "### OS\n\n<!-- options: macOS, Linux, Windows -->\nLinux",
        "### Browsers\n\n<!-- options (one or more): Firefox, Chrome -->",
        "### Logs\n\n```shell\n\n```",
        "### What happened?\n\nIt broke -->",
        "### Checks\n\n- [ ] I searched existing issues <!-- required -->\n- [ ] I read the docs",
      ].join("\n\n"),
    })
    expect(formTemplate("name: x\ndescription: no body")).toBeUndefined()
    expect(formTemplate("body: []")).toBeUndefined()
    expect(formTemplate(": not yaml :")).toBeUndefined()
  })

  test("loads repository templates sorted by filename, skipping config, other files and invalid templates", async () => {
    const paths: string[] = []
    const base = "repositories/123/contents/.github/ISSUE_TEMPLATE"
    const files: Record<string, string> = {
      "b_feature.md": "---\nname: Feature\n---\nIdea",
      "a_bug.yml": "name: Bug\nbody:\n  - type: input\n    attributes: { label: Version }",
      "config.yml": "blank_issues_enabled: false",
      "broken.md": "no header",
      "notes.txt": "ignored",
    }
    const loader = createGitHubIssueTemplates({
      async json<T>(path: string) {
        paths.push(path)
        return [
          ...Object.keys(files).map((name) => ({ type: "file", name, path: `.github/ISSUE_TEMPLATE/${name}` })),
          { type: "dir", name: "nested", path: ".github/ISSUE_TEMPLATE/nested" },
        ] as T
      },
      async text(path: string) {
        paths.push(path)
        return files[decodeURIComponent(path.slice(base.length + 1))]!
      },
    })
    expect(await loader(repository)).toEqual([
      { name: "Bug", about: "", title: "", body: "### Version\n" },
      { name: "Feature", about: "", title: "", body: "Idea" },
    ])
    expect(paths.sort()).toEqual([base, `${base}/a_bug.yml`, `${base}/b_feature.md`, `${base}/broken.md`].sort())
  })

  test("returns no templates when the folder is missing and passes other failures through", async () => {
    const failing = (error: Error): GitHubTransport => ({
      async json<T>(): Promise<T> {
        throw error
      },
      async text() {
        return ""
      },
    })
    expect(await createGitHubIssueTemplates(failing(new GitHubApiError("contents", "Not Found (HTTP 404)")))(repository)).toEqual([])
    const denied = new GitHubApiError("contents", "Forbidden (HTTP 403)")
    await expect(createGitHubIssueTemplates(failing(denied))(repository)).rejects.toBe(denied)
  })
})
