import { describe, expect, test } from "bun:test"
import { launchUsage, parseLaunchArguments, updateUsage, type LaunchOptions } from "../src/launch-target"

// Parser-only tests: never import the CLI/updater or perform updates/network requests.
describe("launch arguments", () => {
  test("aligns help descriptions across usage and options", () => {
    const rows = launchUsage.split("\n").filter((line) => line.startsWith("  opengh") || line.startsWith("  -"))
    expect(rows).toHaveLength(20)
    for (const row of rows) {
      const columns = /^  (\S.*?)( {2,})(\S.*)$/.exec(row)
      expect(columns).not.toBeNull()
      expect(2 + columns![1]!.length + columns![2]!.length).toBe(42)
    }
  })

  test("preserves repository launch and parses URLs, bare identifiers, and explicit targets", () => {
    const cases: [string[], LaunchOptions][] = [
      [[], {}],
      [["."], { repositoryArgument: "." }],
      [["--focus"], { focus: true }],
      [["--inline"], { inline: true }],
      [["--resume"], { resume: true }],
      [["--resume", "--focus"], { resume: true, focus: true }],
      [["#234", "--inline"], { inline: true, repositoryArgument: ".", initialDetail: { kind: "number", number: 234 } }],
      [
        ["owner/repo", "--inline", "--pr=456"],
        { inline: true, repositoryArgument: "owner/repo", initialDetail: { kind: "pull", number: 456 } },
      ],
      [
        ["--inline", "--focus", "https://github.com/owner/repo/issues"],
        { focus: true, inline: true, repositoryArgument: "owner/repo", initialPage: "issues" },
      ],
      [["#234", "--focus"], { focus: true, repositoryArgument: ".", initialDetail: { kind: "number", number: 234 } }],
      [
        ["--focus", "owner/repo", "--pr", "456"],
        { focus: true, repositoryArgument: "owner/repo", initialDetail: { kind: "pull", number: 456 } },
      ],
      [["https://github.com/owner/repo/issues", "--focus"], { focus: true, repositoryArgument: "owner/repo", initialPage: "issues" }],
      [["owner/repo"], { repositoryArgument: "owner/repo" }],
      [["https://github.com/owner/repo.git/"], { repositoryArgument: "owner/repo" }],
      [
        ["https://github.com/owner/repo/issues/123?foo=bar#issuecomment-456"],
        { repositoryArgument: "owner/repo", initialDetail: { kind: "number", number: 123 } },
      ],
      [
        ["https://github.com/owner/repo/issues/123?ignored=/../#../"],
        { repositoryArgument: "owner/repo", initialDetail: { kind: "number", number: 123 } },
      ],
      [["github.com/owner/repo/pull/456/"], { repositoryArgument: "owner/repo", initialDetail: { kind: "pull", number: 456 } }],
      [
        ["https://github.com/owner/repo/commit/ABC1234#diff-123"],
        { repositoryArgument: "owner/repo", initialDetail: { kind: "commit", sha: "abc1234" } },
      ],
      [["https://github.com/owner/repo/actions/runs/789"], { repositoryArgument: "owner/repo", initialDetail: { kind: "run", id: 789 } }],
      ...(["issues", "pulls", "commits", "actions"] as const).map((page): [string[], LaunchOptions] => [
        [`https://github.com/owner/repo/${page}`],
        { repositoryArgument: "owner/repo", initialPage: page },
      ]),
      [["123"], { repositoryArgument: ".", initialDetail: { kind: "number", number: 123 } }],
      [["#456"], { repositoryArgument: ".", initialDetail: { kind: "number", number: 456 } }],
      [["ABC1234"], { repositoryArgument: ".", initialDetail: { kind: "commit", sha: "abc1234" } }],
      [["owner/repo", "123"], { repositoryArgument: "owner/repo", initialDetail: { kind: "number", number: 123 } }],
      [[".", "abcd"], { repositoryArgument: ".", initialDetail: { kind: "commit", sha: "abcd" } }],
      [
        ["https://github.com/owner/repo", "f".repeat(40)],
        { repositoryArgument: "owner/repo", initialDetail: { kind: "commit", sha: "f".repeat(40) } },
      ],
      [["--commit", "1234567"], { repositoryArgument: ".", initialDetail: { kind: "commit", sha: "1234567" } }],
      [["owner/repo", "--issue", "#123"], { repositoryArgument: "owner/repo", initialDetail: { kind: "issue", number: 123 } }],
      [["--pr=456", "owner/repo"], { repositoryArgument: "owner/repo", initialDetail: { kind: "pull", number: 456 } }],
      [["owner/repo", "--", "123"], { repositoryArgument: "owner/repo", initialDetail: { kind: "number", number: 123 } }],
      [["--help"], { help: true }],
      [["-h"], { help: true }],
      [["--version"], { version: true }],
      [["-v"], { version: true }],
    ]
    for (const [args, expected] of cases) expect(parseLaunchArguments(args)).toEqual(expected)
  })

  test("supports focus flags and the legacy compatibility alias", () => {
    for (const flag of ["--focus", "-f", "--standalone"]) {
      expect(parseLaunchArguments(["issues", flag])).toEqual({
        repositoryArgument: ".",
        initialPage: "issues",
        focus: true,
      })
      expect(parseLaunchArguments(["owner/repo", "--pr", "456", flag])).toEqual({
        repositoryArgument: "owner/repo",
        initialDetail: { kind: "pull", number: 456 },
        focus: true,
      })
    }
    for (const flags of [["-if"], ["-fi"], ["-i", "-f"]]) {
      expect(parseLaunchArguments(flags)).toEqual({ repositoryArgument: ".", interactive: true, focus: true })
      expect(parseLaunchArguments([...flags, "--repo", "owner/repo"])).toEqual({
        repositoryArgument: "owner/repo",
        interactive: true,
        focus: true,
      })
    }
    expect(launchUsage).toContain("-f, --focus")
    expect(launchUsage).not.toContain("--standalone")
    for (const args of [["--focus=false"], ["-f=false"], ["--standalone=false"], ["--", "-f"], ["--", "-if"], ["-ifx"]])
      expect(() => parseLaunchArguments(args)).toThrow()
  })

  test("opens page commands in the current or explicitly selected repository", () => {
    for (const page of ["issues", "pulls", "actions"] as const) {
      expect(parseLaunchArguments([page])).toEqual({ repositoryArgument: ".", initialPage: page })
      expect(parseLaunchArguments([page, "--repo", "owner/repo"])).toEqual({ repositoryArgument: "owner/repo", initialPage: page })
      expect(parseLaunchArguments(["--repo=owner/repo", page])).toEqual({ repositoryArgument: "owner/repo", initialPage: page })
      expect(parseLaunchArguments([page, "--repo", ".", "--focus", "--inline"])).toEqual({
        repositoryArgument: ".",
        initialPage: page,
        focus: true,
        inline: true,
      })
      expect(parseLaunchArguments([page, "--help"])).toEqual({ help: true })
      expect(parseLaunchArguments([`owner/${page}`])).toEqual({ repositoryArgument: `owner/${page}` })
    }
  })

  test("opens the interactive page picker with a repository but no target", () => {
    for (const flag of ["-i", "--interactive"]) {
      expect(parseLaunchArguments([flag])).toEqual({ interactive: true, repositoryArgument: "." })
      expect(parseLaunchArguments([flag, "--repo", "owner/repo"])).toEqual({ interactive: true, repositoryArgument: "owner/repo" })
      expect(parseLaunchArguments(["owner/repo", flag, "--focus"])).toEqual({
        interactive: true,
        repositoryArgument: "owner/repo",
        focus: true,
      })
      expect(parseLaunchArguments([flag, "--help"])).toEqual({ help: true })
      for (const extra of [
        ["issues"],
        ["pulls"],
        ["actions"],
        ["123"],
        ["abcd"],
        ["owner/repo", "123"],
        ["--pr", "123"],
        ["--resume"],
        ["--inline"],
        ["https://github.com/owner/repo/issues"],
        ["https://github.com/owner/repo/pull/123"],
      ])
        expect(() => parseLaunchArguments([flag, ...extra])).toThrow()
    }
  })

  test("supports repository flags for existing launch targets", () => {
    expect(parseLaunchArguments(["--repo", "owner/repo"])).toEqual({ repositoryArgument: "owner/repo" })
    expect(parseLaunchArguments(["123", "--repo=owner/repo"])).toEqual({
      repositoryArgument: "owner/repo",
      initialDetail: { kind: "number", number: 123 },
    })
    expect(parseLaunchArguments(["--repo", "owner/repo", "--pr", "456"])).toEqual({
      repositoryArgument: "owner/repo",
      initialDetail: { kind: "pull", number: 456 },
    })
  })

  test("rejects conflicting page commands and repository flags", () => {
    const cases = [
      ["issues", "pulls"],
      ["issues", "123"],
      ["issues", "owner/repo"],
      ["issues", "--issue", "123"],
      ["pulls", "--pr", "123"],
      ["actions", "--commit", "abcd"],
      ["--resume", "issues"],
      ["--resume", "--repo", "owner/repo"],
      ["--repo"],
      ["--repo="],
      ["issues", "--repo", "--inline"],
      ["issues", "--repo", "invalid"],
      ["--repo", "https://github.com/owner/repo/issues"],
      ["issues", "--repo", "owner/repo", "--repo", "other/repo"],
      ["owner/repo", "--repo", "other/repo"],
      ["--repo", "owner/repo", "https://github.com/other/repo/issues"],
      ["issues", "--", "--repo", "owner/repo"],
    ]
    for (const args of cases) expect(() => parseLaunchArguments(args)).toThrow()
  })

  test("parses update and update help without running the updater", () => {
    expect(parseLaunchArguments(["update"])).toEqual({ update: true })
    for (const help of ["--help", "-h"]) expect(parseLaunchArguments(["update", help])).toEqual({ update: true, help: true })
    expect(launchUsage).toContain("  opengh update")
    expect(updateUsage).toContain("opengh update")
    expect(updateUsage).toContain("latest stable")
    expect(updateUsage).toContain("-h, --help")
  })

  test("recognizes update only as the exact first argument", () => {
    expect(parseLaunchArguments(["owner/update"])).toEqual({ repositoryArgument: "owner/update" })
    expect(parseLaunchArguments(["update/repo"])).toEqual({ repositoryArgument: "update/repo" })
    expect(parseLaunchArguments(["https://github.com/owner/update"])).toEqual({ repositoryArgument: "owner/update" })
    for (const args of [
      ["--", "update"],
      ["owner/repo", "update"],
      ["--inline", "update"],
      ["--focus", "update"],
      ["--resume", "update"],
      ["UPDATE"],
      [" update"],
      ["update "],
    ])
      expect(() => parseLaunchArguments(args)).toThrow()
  })

  test("rejects repositories, targets, modes, and extra update arguments even with help", () => {
    const extras = [
      ["owner/repo"],
      ["."],
      ["https://github.com/owner/repo"],
      ["123"],
      ["abcd"],
      ["update"],
      ["--issue", "123"],
      ["--pr=123"],
      ["--commit", "abcd"],
      ["--resume"],
      ["--inline"],
      ["--focus"],
      ["--unknown"],
      ["--force"],
      ["--check"],
      ["--version"],
      ["-v"],
      ["v1.2.3"],
      ["--version=1.2.3"],
      ["--"],
      ["--", "owner/repo"],
      ["--help", "owner/repo"],
      ["owner/repo", "--help"],
      ["--help", "--help"],
      ...["--resume", "--inline", "--focus", "--unknown"].flatMap((option) => [
        ["--help", option],
        [option, "-h"],
      ]),
    ]
    for (const extra of extras) expect(() => parseLaunchArguments(["update", ...extra])).toThrow("opengh update")
  })

  test("preserves root help and version behavior before update or after mode flags", () => {
    const cases: [string[], LaunchOptions][] = [
      [["--help", "update", "--force"], { help: true }],
      [["-h", "update"], { help: true }],
      [["--version", "update", "--inline"], { version: true }],
      [["-v", "update"], { version: true }],
      [["--resume", "--help"], { help: true }],
      [["--inline", "--version"], { version: true }],
      [["owner/repo", "--help"], { help: true }],
    ]
    for (const [args, expected] of cases) expect(parseLaunchArguments(args)).toEqual(expected)
  })

  test("accepts explicit local paths without treating them as GitHub names", () => {
    for (const path of [
      ".",
      "..",
      "../",
      "/path/to/repo/",
      "/owner/repo",
      "./owner/repo",
      "../repo",
      "~/projects/repo",
      "./repo with spaces",
    ]) {
      expect(parseLaunchArguments([path])).toEqual({ repositoryArgument: path })
      expect(parseLaunchArguments([path, "123"])).toEqual({ repositoryArgument: path, initialDetail: { kind: "number", number: 123 } })
      expect(parseLaunchArguments([path, "--pr", "123", "--inline"])).toEqual({
        repositoryArgument: path,
        initialDetail: { kind: "pull", number: 123 },
        inline: true,
      })
      expect(parseLaunchArguments(["issues", "--repo", path])).toEqual({ repositoryArgument: path, initialPage: "issues" })
      expect(parseLaunchArguments([`--repo=${path}`, "--pr", "123"])).toEqual({
        repositoryArgument: path,
        initialDetail: { kind: "pull", number: 123 },
      })
      expect(parseLaunchArguments(["--interactive", "--repo", path])).toEqual({ repositoryArgument: path, interactive: true })
      expect(() => parseLaunchArguments(["--repo", path, "owner/repo"])).toThrow()
      expect(() => parseLaunchArguments(["--resume", path])).toThrow()
    }
    expect(parseLaunchArguments(["owner/repo"])).toEqual({ repositoryArgument: "owner/repo" })
  })

  test("rejects malformed, conflicting, unsupported, and unsafe targets", () => {
    const cases = [
      ["not-a-repository"],
      ["owner/repo", "xyz"],
      ["owner/repo", "123", "456"],
      ["0"],
      ["#0"],
      ["9007199254740992"],
      ["f".repeat(41)],
      ["--commit", "abc"],
      ["--commit=xyz1234"],
      ["--commit"],
      ["--issue", "--pr"],
      ["--height", "12"],
      ["--inline", "--height"],
      ["--inline", "--height", "--pr"],
      ["--inline", "--height=0"],
      ["--inline", "--height=-1"],
      ["--inline", "--height=1.5"],
      ["--inline", "--height=Infinity"],
      ["--inline", "--height=9007199254740992"],
      ["--inline=false"],
      ["--focus=false"],
      ["--focus", "--", "--focus"],
      ["--resume=false"],
      ["--resume", "owner/repo"],
      ["--resume", "--inline"],
      ["--resume", "123"],
      ["--resume", "--pr", "123"],
      ["--issue", "-1"],
      ["--pr=1.5"],
      ["--unknown"],
      ["--", "--help"],
      ["--version=false"],
      ["--", "--version"],
      ["--commit", "abcd", "--commit", "abcd"],
      ["--issue", "123", "--pr", "456"],
      ["owner/repo", "123", "--pr", "456"],
      ["123", "456"],
      ["https://example.com/owner/repo/issues/123"],
      ["https://github.example.com/owner/repo"],
      ["https://user:password@github.com/owner/repo"],
      ["https://github.com:8443/owner/repo"],
      ["ssh://github.com/owner/repo"],
      ["https://github.com/owner"],
      ["https://github.com/owner/repo/tree/main"],
      ["https://github.com/good/repo/../../evil/other/issues/7"],
      ["https://github.com/good/repo/%2e%2e/%2e%2e/evil/other/issues/7"],
      ["https://github.com/owner/repo/issues/123/.."],
      ["https://github.com/owner/repo/issues/.%2E/123"],
      ["https://github.com/owner\\repo/issues/123"],
      ["https://git\nhub.com/owner/repo/issues/12\t3"],
      ["https://github.com/owner/repo/constructor"],
      ["https://github.com/owner/repo/toString"],
      ["https://github.com/owner/repo/issues/0"],
      ["https://github.com/owner/repo/pull/not-a-number"],
      ["https://github.com/owner/repo/commit/not-a-hash"],
      ["https://github.com/owner/repo/pull/123/files"],
      ["https://github.com/owner/repo/issues/123", "456"],
      ["https://github.com/owner/repo/commits", "--commit", "abcd"],
    ]
    for (const args of cases) expect(() => parseLaunchArguments(args)).toThrow()
  })
})

test("diff flags parse with PR and commit targets", () => {
  const cases: [string[], LaunchOptions][] = [
    [
      ["owner/repo", "--pr", "123", "--inline", "--diff"],
      { inline: true, diff: true, repositoryArgument: "owner/repo", initialDetail: { kind: "pull", number: 123 } },
    ],
    [
      ["--diff", "--inline", "--commit", "abc1234"],
      { inline: true, diff: true, repositoryArgument: ".", initialDetail: { kind: "commit", sha: "abc1234" } },
    ],
    [["123", "--inline", "--diff"], { inline: true, diff: true, repositoryArgument: ".", initialDetail: { kind: "number", number: 123 } }],
    [
      ["--inline", "--diff", "--file", " dir/sp ace é.ts", "--repo", "owner/repo", "--pr", "1"],
      { inline: true, diff: true, file: " dir/sp ace é.ts", repositoryArgument: "owner/repo", initialDetail: { kind: "pull", number: 1 } },
    ],
    [
      ["--commit=abcd", "--inline", "--diff", "--file=-x=y"],
      { inline: true, diff: true, file: "-x=y", repositoryArgument: ".", initialDetail: { kind: "commit", sha: "abcd" } },
    ],
  ]
  for (const [args, expected] of cases) expect(parseLaunchArguments(args)).toEqual(expected)
})

test("diff flags require --inline and a PR or commit target", () => {
  const cases: [string[], string][] = [
    [["--diff", "--pr", "123"], "--diff requires --inline"],
    [["--inline", "--file", "a.ts", "--pr", "123"], "--file requires --diff"],
    [["--inline", "--diff", "--file", "a.ts", "--file", "b.ts", "--pr", "1"], "only once"],
    [["--inline", "--diff", "--file=", "--pr", "1"], "--file requires a repository-relative path"],
    [["--inline", "--diff", "--file", "--pr", "1"], "--file requires a repository-relative path"],
    [["--inline", "--diff", "--issue", "123"], "--diff requires a PR or commit target"],
    [["--inline", "--diff"], "--diff requires a PR or commit target"],
    [["pulls", "--inline", "--diff"], "--diff requires a PR or commit target"],
    [["https://github.com/owner/repo/actions/runs/123", "--inline", "--diff"], "--diff requires a PR or commit target"],
    [["owner/repo", "--pr", "1", "--json"], "Unknown option"],
  ]
  for (const [args, message] of cases) expect(() => parseLaunchArguments(args)).toThrow(message)
})
