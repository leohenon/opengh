import { expect, test } from "bun:test"
import { referenceLinkChunks, repositoryUrlFromCommitUrl } from "../src/ui/reference-links"

const repositoryUrl = "https://github.com/owner/repo"

test("plain inline chunks retain source text and independent reference targets", () => {
  const text = "Fix #42 with abc1234 and other/project@deadbee; thanks @octocat. See [guide](https://example.com/docs) or https://example.com/path(foo)."
  const chunks = referenceLinkChunks(text, repositoryUrl)
  expect(chunks.map((chunk) => chunk.text).join("")).toBe(text)
  expect(chunks.filter((chunk) => chunk.href)).toEqual([
    { text: "#42", href: `${repositoryUrl}/issues/42` },
    { text: "abc1234", href: `${repositoryUrl}/commit/abc1234` },
    { text: "other/project@deadbee", href: "https://github.com/other/project/commit/deadbee" },
    { text: "@octocat", href: "https://github.com/octocat" },
    { text: "guide", href: "https://example.com/docs" },
    { text: "https://example.com/docs", href: "https://example.com/docs" },
    { text: "https://example.com/path(foo)", href: "https://example.com/path(foo)" },
  ])
})

test("strict commit boundaries, code, comments and emails are not references", () => {
  const text = "deadbee 1234567 abc123 abc1234z xabc1234 /abc1234 abc1234_name abc1234.txt name@octocat.com @bad--login `abc1234` ```text\nabc1234 `@octocat`\n``` <!-- abc1234 @octocat --> " + "a".repeat(41)
  const chunks = referenceLinkChunks(text, repositoryUrl)
  expect(chunks.map((chunk) => chunk.text).join("")).toBe(text)
  expect(chunks.some((chunk) => chunk.href)).toBe(false)
  for (const full of ["a".repeat(40), "1".repeat(40)]) {
    expect(referenceLinkChunks(full, repositoryUrl)).toEqual([{ text: full, href: `${repositoryUrl}/commit/${full}` }])
  }
  expect(referenceLinkChunks("#42 abc1234", "javascript:alert(1)")).toEqual([{ text: "#42 abc1234" }])
  expect(referenceLinkChunks("#42 abc1234")).toEqual([{ text: "#42 abc1234" }])
})

test("timeline repository context is inferred only from GitHub commit entity URLs", () => {
  expect(repositoryUrlFromCommitUrl(`${repositoryUrl}/commit/abc1234`)).toBe(repositoryUrl)
  expect(repositoryUrlFromCommitUrl(`${repositoryUrl}/pull/42/commits/abc1234`)).toBe(repositoryUrl)
  for (const url of ["https://example.com/owner/repo/commit/abc1234", `${repositoryUrl}/pull/42`, `${repositoryUrl}/commit/not-a-sha`, "javascript:alert(1)"]) {
    expect(repositoryUrlFromCommitUrl(url)).toBeUndefined()
  }
})
