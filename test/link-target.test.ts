import { describe, expect, test } from "bun:test"
import { resolveLinkTarget, unsupportedLinkMessage, type LinkTarget } from "../src/link-target"

describe("link targets", () => {
  test("resolves repository pages and cross-repository details without guessing issue types", () => {
    const repository = "other/project"
    const cases: [string, LinkTarget][] = [
      ["https://github.com/other/project.git/", { kind: "page", repository, page: "overview" }],
      ...(["issues", "pulls", "commits", "actions"] as const).map((page): [string, LinkTarget] => [
        `https://github.com/${repository}/${page}`,
        { kind: "page", repository, page },
      ]),
      ["http://github.com/other/project/issues/12", { kind: "detail", repository, detail: { kind: "number", number: 12 } }],
      ["https://github.com/other/project/pull/34/", { kind: "detail", repository, detail: { kind: "pull", number: 34 } }],
      [
        "https://github.com/other/project/pull/34/commits/ABC1234",
        { kind: "detail", repository, detail: { kind: "commit", sha: "abc1234" } },
      ],
      ["https://github.com/other/project/commit/ABC1234", { kind: "detail", repository, detail: { kind: "commit", sha: "abc1234" } }],
      ["https://github.com/other/project/actions/runs/56", { kind: "detail", repository, detail: { kind: "run", id: 56 } }],
      ["https://github.com/other/project/pull/34/files", { kind: "diff", repository, target: { kind: "pull", number: 34 } }],
    ]
    for (const [url, expected] of cases) expect(resolveLinkTarget(url)).toEqual(expected)
  })

  test("opens GitHub changes links and recognizes file anchors with line suffixes", () => {
    const repository = "other/project"
    const fileHash = "a".repeat(64)
    const base = "b".repeat(40)
    const head = "c".repeat(40)
    expect(resolveLinkTarget(`https://github.com/${repository}/pull/34/changes/${base}..${head}#diff-${fileHash}R12-R15`)).toEqual({
      kind: "diff",
      repository,
      target: { kind: "compare", base, head, pullNumber: 34, fileHash },
    })
    expect(resolveLinkTarget(`https://github.com/${repository}/commit/ABC1234#diff-${fileHash}`)).toEqual({
      kind: "diff",
      repository,
      target: { kind: "commit", sha: "abc1234", fileHash },
    })
  })

  test("opens Actions job and check-focus links at their parent run", () => {
    for (const suffix of [
      "",
      "/job/78",
      "/job/78/",
      "?check_suite_focus=true",
      "/job/78?check_suite_focus=true",
      "/job/78?pr=34",
      "/job/78?pr=34&check_suite_focus=true#step:3:4",
      "/job/78?check_suite_focus=false#step:3:4",
      "/job/78#step:3:4",
    ]) {
      expect(resolveLinkTarget(`https://github.com/other/project/actions/runs/56${suffix}`)).toEqual({
        kind: "detail",
        repository: "other/project",
        detail: { kind: "run", id: 56 },
      })
    }
  })

  test("preserves unsupported destinations and nonempty queries and anchors exactly", () => {
    const urls = [
      "https://github.com/apps/dependabot",
      "https://github.com/orgs/owner",
      "https://github.com/person",
      "https://github.com/",
      "https://github.com/other/project/tree/main",
      "https://github.com/other/project/releases/tag/v1",
      "https://github.com/other/project/checks",
      "https://github.com/other/project/blob/main/README.md",
      "https://docs.github.com/en",
      "https://github.com/other/project/commit/abcd.diff",
      "https://github.com/other/project/commit/abcd#diff-123",
      "https://github.com/other/project/pulls?q=is%3Aopen",
      "https://github.com/other/project/pull/34/files#diff-123",
      "https://github.com/other/project/actions/runs/56?unknown=true",
      "https://github.com/other/project/actions/runs/56?check_suite_focus=invalid",
      "https://github.com/other/project/actions/runs/56/job/78?pr=invalid",
      "https://github.com/other/project/actions/runs/56/job/78?pr=0",
      "https://github.com/other/project/actions/runs/56/job/78/logs",
      "https://github.com/other/project/actions/runs/56#unknown",
      "https://github.com/other/project/actions/runs/56/job/78?unknown=true",
      "https://github.com/other/project/issues/12?ignored=/../#../",
      "https://github.com:8443/other/project",
      "https://example.com/a?x=1&y=2#part",
      "mailto:person@example.com?subject=Hello%20there",
    ]
    for (const url of urls) expect(resolveLinkTarget(url)).toEqual({ kind: "external", url })
  })

  test("rejects malformed targets and unsafe URLs before parser normalization", () => {
    const urls = [
      "",
      "other/project",
      "/other/project/issues/12",
      "//github.com/other/project",
      "github.com/other/project",
      "javascript:alert(1)",
      "data:text/html,test",
      "file:///tmp/test",
      "ssh://github.com/other/project",
      "https://",
      "https:github.com/other/project",
      "https:///github.com/other/project",
      "mailto:",
      "mailto://person@example.com",
      "https://user:password@github.com/other/project",
      "https://@example.com/",
      "https://example.com/%zz",
      " https://github.com/other/project",
      "https://git\nhub.com/other/project",
      "https://github.com/other\\project",
      "https://github.com/other/project/../evil",
      "https://github.com/other/project/%2e%2e/evil",
      "https://github.com/other/project/.%2E/evil",
      "https://example.com/%00",
      "mailto:a@b.com?subject=x%0d%0aBcc:c@d.com",
      "https://github.com/other/project/issues/0",
      "https://github.com/other/project/issues/9007199254740992",
      "https://github.com/other/project/pull/-1",
      "https://github.com/other/project/pull/1.5/files",
      "https://github.com/other/project/actions/runs/nope",
      "https://github.com/other/project/actions/runs/0/job/78",
      "https://github.com/other/project/actions/runs/56/job/0",
      "https://github.com/other/project/actions/runs/56/job/nope",
      "https://github.com/other/project/actions/runs/56/job/9007199254740992",
    ]
    for (const url of urls) expect(resolveLinkTarget(url)).toBeUndefined()
  })

  test("opens issue and PR conversations from comment and other anchors", () => {
    const repository = "other/project"
    const cases: [string, LinkTarget][] = [
      [
        "https://github.com/other/project/issues/12#issuecomment-99",
        { kind: "detail", repository, detail: { kind: "number", number: 12 }, comment: 99 },
      ],
      [
        "https://github.com/other/project/pull/34#issuecomment-7",
        { kind: "detail", repository, detail: { kind: "pull", number: 34 }, comment: 7 },
      ],
      ["https://github.com/other/project/pull/34#discussion_r5", { kind: "detail", repository, detail: { kind: "pull", number: 34 } }],
      [
        "https://github.com/other/project/pull/34#pullrequestreview-8",
        { kind: "detail", repository, detail: { kind: "pull", number: 34 } },
      ],
    ]
    for (const [url, expected] of cases) expect(resolveLinkTarget(url)).toEqual(expected)
    expect(resolveLinkTarget("https://github.com/other/project/issues/0#issuecomment-1")).toBeUndefined()
  })

  test("starts issue and pull request creation, ignoring prefill queries", () => {
    const repository = "other/project"
    for (const suffix of ["issues/new", "issues/new/", "issues/new?template=bug.md", "issues/new/choose", "issues/new#top"])
      expect(resolveLinkTarget(`https://github.com/${repository}/${suffix}`)).toEqual({ kind: "new-issue", repository })
    expect(resolveLinkTarget("https://github.com/other/project/pull/new/main")).toEqual({ kind: "new-pull", repository, head: "main" })
    expect(resolveLinkTarget("https://github.com/other/project/pull/new/feature/login?expand=1")).toEqual({
      kind: "new-pull",
      repository,
      head: "feature/login",
    })
    for (const url of [
      "https://github.com/other/project/pull/new/fork:branch",
      "https://github.com/other/project/issues/new/other",
      "https://github.com/other/project/pull/new",
    ])
      expect(resolveLinkTarget(url)).toEqual({ kind: "external", url })
  })

  test("resolves branch and tag names in commit and history links", () => {
    const repository = "other/project"
    const cases: [string, LinkTarget][] = [
      ["https://github.com/other/project/commit/main", { kind: "ref", repository, name: "main", view: "commit" }],
      ["https://github.com/other/project/commit/feature/login", { kind: "ref", repository, name: "feature/login", view: "commit" }],
      ["https://github.com/other/project/commit/abc", { kind: "ref", repository, name: "abc", view: "commit" }],
      [`https://github.com/other/project/commit/${"a".repeat(41)}`, { kind: "ref", repository, name: "a".repeat(41), view: "commit" }],
      ["https://github.com/other/project/commits/next", { kind: "ref", repository, name: "next", view: "commits" }],
      ["https://github.com/other/project/commits/release%2F1.0", { kind: "ref", repository, name: "release/1.0", view: "commits" }],
    ]
    for (const [url, expected] of cases) expect(resolveLinkTarget(url)).toEqual(expected)
    for (const url of [
      "https://github.com/other/project/commit/main.patch",
      "https://github.com/other/project/commit/main#diff-123",
      "https://github.com/other/project/commits/main?author=max",
      "https://github.com/other/project/commits/bad..name",
      "https://github.com/other/project/commits/name.lock",
    ])
      expect(resolveLinkTarget(url)).toEqual({ kind: "external", url })
  })

  test("explains GitHub pages that open in the browser", () => {
    const cases: [string, string | undefined][] = [
      ["https://github.com/other/project/discussions/12", "Discussions are not yet supported, opening in browser"],
      ["https://github.com/other/project/blob/main/src/app.ts", "Files are not yet supported, opening in browser"],
      ["https://github.com/other/project/wiki", "The wiki is not yet supported, opening in browser"],
      ["https://github.com/other/project/security", "Security is not yet supported, opening in browser"],
      ["https://github.com/other/project/constructor", "This page is not yet supported, opening in browser"],
      ["https://github.com/other/project/commit/v1.0", "This page is not yet supported, opening in browser"],
      ["https://github.com/person", "This page is not yet supported, opening in browser"],
      ["https://example.com/docs", undefined],
      ["https://docs.github.com/en", undefined],
      ["mailto:person@example.com", undefined],
    ]
    for (const [url, message] of cases) expect(unsupportedLinkMessage(url)).toBe(message)
  })
})
