import { describe, expect, test } from "bun:test"
import { resolveLinkTarget, type LinkTarget } from "../src/link-target"

describe("link targets", () => {
  test("resolves repository pages and cross-repository details without guessing issue types", () => {
    const repository = "other/project"
    const cases: [string, LinkTarget][] = [
      ["https://github.com/other/project.git/", { kind: "page", repository, page: "overview" }],
      ...(["issues", "pulls", "commits", "actions"] as const).map((page): [string, LinkTarget] => [
        `https://github.com/${repository}/${page}`, { kind: "page", repository, page },
      ]),
      ["http://github.com/other/project/issues/12", { kind: "detail", repository, detail: { kind: "number", number: 12 } }],
      ["https://github.com/other/project/pull/34/", { kind: "detail", repository, detail: { kind: "pull", number: 34 } }],
      ["https://github.com/other/project/pull/34/commits/ABC1234", { kind: "detail", repository, detail: { kind: "commit", sha: "abc1234" } }],
      ["https://github.com/other/project/commit/ABC1234", { kind: "detail", repository, detail: { kind: "commit", sha: "abc1234" } }],
      ["https://github.com/other/project/actions/runs/56", { kind: "detail", repository, detail: { kind: "run", id: 56 } }],
      ["https://github.com/other/project/pull/34/files", { kind: "diff", repository, target: { kind: "pull", number: 34 } }],
    ]
    for (const [url, expected] of cases) expect(resolveLinkTarget(url)).toEqual(expected)
  })

  test("preserves unsupported destinations and nonempty queries and anchors exactly", () => {
    const urls = [
      "https://github.com/apps/dependabot", "https://github.com/orgs/owner", "https://github.com/person", "https://github.com/", "https://github.com/other/project/tree/main",
      "https://github.com/other/project/releases/tag/v1", "https://github.com/other/project/checks",
      "https://github.com/other/project/blob/main/README.md", "https://docs.github.com/en",
      "https://github.com/other/project/commit/abcd.diff", "https://github.com/other/project/commit/abcd#diff-123",
      "https://github.com/other/project/issues/12#issuecomment-99",
      "https://github.com/other/project/pulls?q=is%3Aopen", "https://github.com/other/project/pull/34/files#diff-123",
      "https://github.com/other/project/actions/runs/56?check_suite_focus=true",
      "https://github.com/other/project/issues/12?ignored=/../#../", "https://github.com:8443/other/project",
      "https://example.com/a?x=1&y=2#part", "mailto:person@example.com?subject=Hello%20there",
    ]
    for (const url of urls) expect(resolveLinkTarget(url)).toEqual({ kind: "external", url })
  })

  test("rejects malformed targets and unsafe URLs before parser normalization", () => {
    const urls = [
      "", "other/project", "/other/project/issues/12", "//github.com/other/project", "github.com/other/project",
      "javascript:alert(1)", "data:text/html,test", "file:///tmp/test", "ssh://github.com/other/project",
      "https://", "https:github.com/other/project", "https:///github.com/other/project", "mailto:", "mailto://person@example.com",
      "https://user:password@github.com/other/project", "https://@example.com/", "https://example.com/%zz",
      " https://github.com/other/project", "https://git\nhub.com/other/project", "https://github.com/other\\project",
      "https://github.com/other/project/../evil", "https://github.com/other/project/%2e%2e/evil",
      "https://github.com/other/project/.%2E/evil", "https://example.com/%00", "mailto:a@b.com?subject=x%0d%0aBcc:c@d.com",
      "https://github.com/other/project/issues/0", "https://github.com/other/project/issues/9007199254740992",
      "https://github.com/other/project/pull/-1", "https://github.com/other/project/pull/1.5/files",
      "https://github.com/other/project/actions/runs/nope", "https://github.com/other/project/commit/abc",
      `https://github.com/other/project/commit/${"a".repeat(41)}`,
    ]
    for (const url of urls) expect(resolveLinkTarget(url)).toBeUndefined()
  })
})
