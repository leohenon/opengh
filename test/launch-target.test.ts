import { describe, expect, test } from "bun:test"
import { parseLaunchArguments, type LaunchOptions } from "../src/launch-target"

describe("launch arguments", () => {
  test("preserves repository launch and parses URLs, bare identifiers, and explicit targets", () => {
    const cases: [string[], LaunchOptions][] = [
      [[], {}],
      [["."], { repositoryArgument: "." }],
      [["owner/repo"], { repositoryArgument: "owner/repo" }],
      [["https://github.com/owner/repo.git/"], { repositoryArgument: "owner/repo" }],
      [["https://github.com/owner/repo/issues/123?foo=bar#issuecomment-456"], { repositoryArgument: "owner/repo", initialDetail: { kind: "number", number: 123 } }],
      [["https://github.com/owner/repo/issues/123?ignored=/../#../"], { repositoryArgument: "owner/repo", initialDetail: { kind: "number", number: 123 } }],
      [["github.com/owner/repo/pull/456/"], { repositoryArgument: "owner/repo", initialDetail: { kind: "pull", number: 456 } }],
      [["https://github.com/owner/repo/commit/ABC1234#diff-123"], { repositoryArgument: "owner/repo", initialDetail: { kind: "commit", sha: "abc1234" } }],
      [["https://github.com/owner/repo/actions/runs/789"], { repositoryArgument: "owner/repo", initialDetail: { kind: "run", id: 789 } }],
      ...(["issues", "pulls", "commits", "actions"] as const).map((page): [string[], LaunchOptions] => [
        [`https://github.com/owner/repo/${page}`], { repositoryArgument: "owner/repo", initialPage: page },
      ]),
      [["123"], { repositoryArgument: ".", initialDetail: { kind: "number", number: 123 } }],
      [["#456"], { repositoryArgument: ".", initialDetail: { kind: "number", number: 456 } }],
      [["ABC1234"], { repositoryArgument: ".", initialDetail: { kind: "commit", sha: "abc1234" } }],
      [["owner/repo", "123"], { repositoryArgument: "owner/repo", initialDetail: { kind: "number", number: 123 } }],
      [[".", "abcd"], { repositoryArgument: ".", initialDetail: { kind: "commit", sha: "abcd" } }],
      [["https://github.com/owner/repo", "f".repeat(40)], { repositoryArgument: "owner/repo", initialDetail: { kind: "commit", sha: "f".repeat(40) } }],
      [["--commit", "1234567"], { repositoryArgument: ".", initialDetail: { kind: "commit", sha: "1234567" } }],
      [["owner/repo", "--issue", "#123"], { repositoryArgument: "owner/repo", initialDetail: { kind: "issue", number: 123 } }],
      [["--pr=456", "owner/repo"], { repositoryArgument: "owner/repo", initialDetail: { kind: "pull", number: 456 } }],
      [["owner/repo", "--", "123"], { repositoryArgument: "owner/repo", initialDetail: { kind: "number", number: 123 } }],
      [["--help"], { help: true }],
      [["-h"], { help: true }],
    ]
    for (const [args, expected] of cases) expect(parseLaunchArguments(args)).toEqual(expected)
  })

  test("rejects malformed, conflicting, unsupported, and unsafe targets", () => {
    const cases = [
      ["not-a-repository"], ["owner/repo", "xyz"], ["owner/repo", "123", "456"],
      ["0"], ["#0"], ["9007199254740992"], ["f".repeat(41)],
      ["--commit", "abc"], ["--commit=xyz1234"], ["--commit"], ["--issue", "--pr"],
      ["--issue", "-1"], ["--pr=1.5"], ["--unknown"], ["--", "--help"],
      ["--commit", "abcd", "--commit", "abcd"], ["--issue", "123", "--pr", "456"],
      ["owner/repo", "123", "--pr", "456"], ["123", "456"],
      ["https://example.com/owner/repo/issues/123"],
      ["https://github.example.com/owner/repo"],
      ["https://user:password@github.com/owner/repo"],
      ["https://github.com:8443/owner/repo"], ["ssh://github.com/owner/repo"],
      ["https://github.com/owner"], ["https://github.com/owner/repo/tree/main"],
      ["https://github.com/good/repo/../../evil/other/issues/7"],
      ["https://github.com/good/repo/%2e%2e/%2e%2e/evil/other/issues/7"],
      ["https://github.com/owner/repo/issues/123/.."],
      ["https://github.com/owner/repo/issues/.%2E/123"],
      ["https://github.com/owner\\repo/issues/123"],
      ["https://git\nhub.com/owner/repo/issues/12\t3"],
      ["https://github.com/owner/repo/constructor"], ["https://github.com/owner/repo/toString"],
      ["https://github.com/owner/repo/issues/0"], ["https://github.com/owner/repo/pull/not-a-number"],
      ["https://github.com/owner/repo/commit/not-a-hash"],
      ["https://github.com/owner/repo/pull/123/files"],
      ["https://github.com/owner/repo/issues/123", "456"],
      ["https://github.com/owner/repo/commits", "--commit", "abcd"],
    ]
    for (const args of cases) expect(() => parseLaunchArguments(args)).toThrow()
  })
})
