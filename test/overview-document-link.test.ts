import { expect, test } from "bun:test"
import { overviewDocumentLink } from "../src/overview-document-link"

const current = { id: "readme", label: "README", repository: "owner/repo", ref: "feature/docs", path: "README.md" }
const prefix = "https://github.com/owner/repo/blob/feature%2Fdocs/"

test("overview Markdown links use known encoded refs and safely decode nested filenames", () => {
  expect(overviewDocumentLink(`${prefix}docs/Getting%20Started.MARKDOWN#intro`, current, [current])).toMatchObject({
    repository: current.repository,
    ref: current.ref,
    path: "docs/Getting Started.MARKDOWN",
  })
  for (const url of [
    `${prefix}docs/page.md?raw=1`,
    `${prefix}docs/page.md?`,
    `${prefix}docs/page.md?#intro`,
    `${prefix}docs/%2e%2e/page.md`,
    `${prefix}docs/../page.md`,
    `${prefix}docs/%2Fpage.md`,
    `${prefix}docs/%5Cpage.md`,
    `${prefix}%E0%A4.md`,
    `${prefix}%zz.md`,
    `${prefix}docs//page.md`,
    `${prefix}page.txt`,
    `${prefix}page.mdx`,
    "https://github.com/owner/repo/blob/feature/docs/page.md",
    "https://github.com/owner/repo/blob/unknown/page.md",
    "https://github.com/other/repo/blob/feature%2Fdocs/page.md",
    "https://example.com/owner/repo/blob/feature%2Fdocs/page.md",
  ])
    expect(overviewDocumentLink(url, current, [current])).toBeUndefined()
  expect(overviewDocumentLink(`${prefix}page.md`, undefined, [current])).toBeUndefined()
  expect(overviewDocumentLink(`${prefix}page.md`, current, [])).toBeUndefined()
})
