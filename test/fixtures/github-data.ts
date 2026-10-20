import type { CommitDetail, IssueDetail, IssueComment, IssuePullReference, PullContext } from "../../src/models"
import type { RepositoryData, RepositoryDocumentState, RepositoryOperations } from "../../src/repository-state"

const issues = {
  open: [
    { number: 412, state: "open" as const, title: "ScrollBox loses focus after terminal resize", author: "maria-dev", createdAt: "2026-04-12T09:15:00Z" },
    { number: 407, state: "open" as const, title: "Add support for accessible color themes", author: "samuelk", createdAt: "2026-04-10T17:41:00Z" },
    { number: 399, state: "open" as const, title: "Text selection wraps one cell too early", author: "pixelperfect", createdAt: "2026-04-06T12:20:00Z" },
    { number: 388, state: "open" as const, title: "Document custom renderable lifecycle", author: "drewcodes", createdAt: "2026-04-01T08:00:00Z" },
  ],
  closed: [
    { number: 376, state: "closed" as const, title: "Fix terminal redraw after returning from background", author: "terminal-dev", createdAt: "2026-03-28T11:20:00Z" },
  ],
}

const pulls = {
  open: [
    { number: 421, state: "open" as const, merged: false, title: "fix: retain focused child during layout changes", author: "maria-dev", createdAt: "2026-04-14T08:32:00Z" },
    { number: 418, state: "open" as const, merged: false, title: "feat: add high contrast theme tokens", author: "samuelk", createdAt: "2026-04-13T14:11:00Z" },
    { number: 410, state: "open" as const, merged: false, title: "docs: explain renderable cleanup", author: "drewcodes", createdAt: "2026-04-11T10:05:00Z" },
  ],
  closed: [
    { number: 402, state: "closed" as const, merged: true, title: "fix: preserve selection after refresh", author: "terminal-dev", createdAt: "2026-04-08T15:45:00Z" },
  ],
}

export const repositoryDocumentsFixture: RepositoryDocumentState[] = [
  { path: "README.md", label: "README", content: "# OpenTUI\n\nA TypeScript library for building rich terminal user interfaces." },
  { path: "CODE_OF_CONDUCT.md", label: "Code of conduct", content: "# Code of conduct\n\nBe respectful and welcoming." },
  { path: "CONTRIBUTING.md", label: "Contributing", content: "# Contributing\n\nThanks for helping improve OpenTUI." },
  { path: "LICENSE", label: "MIT license", content: "MIT License\n\nCopyright OpenTUI contributors." },
  { path: "SECURITY.md", label: "Security", content: "# Security Policy\n\nPlease report vulnerabilities privately." },
].map(({ path, label, content }) => ({
  id: `anomalyco/opentui:${path}`,
  repository: "anomalyco/opentui",
  ref: "main",
  path,
  label,
  resource: { status: "ready" as const, value: content },
}))

export const githubDataFixture: RepositoryData = {
  commitCount: { status: "ready", value: 4 },
  workCounts: { status: "ready", value: { issues: 61, pulls: 24 } },
  repo: {
    nameWithOwner: "anomalyco/opentui",
    url: "https://github.com/anomalyco/opentui",
    description: "A TypeScript library for building rich terminal user interfaces",
    visibility: "PUBLIC",
    defaultBranch: "main",
    stars: 5280,
    forks: 214,
    watchers: 42,
    openIssues: 61,
    language: "TypeScript",
    license: "MIT",
    updatedAt: "2026-04-14T10:24:00Z",
  },
  documents: { status: "ready", value: repositoryDocumentsFixture },
  issues: {
    open: { status: "ready", value: { items: issues.open, page: 1, hasMore: false } },
    closed: { status: "ready", value: { items: issues.closed, page: 1, hasMore: false } },
  },
  pulls: {
    open: { status: "ready", value: { items: pulls.open, page: 1, hasMore: false } },
    closed: { status: "ready", value: { items: pulls.closed, page: 1, hasMore: false } },
  },
  runs: {
    status: "ready",
    value: {
      items: [
        { id: 9812, name: "CI", title: "fix: retain focused child during layout changes", status: "completed", conclusion: "success", createdAt: "2026-04-14T09:02:00Z" },
        { id: 9809, name: "Release", title: "Publish v0.4.5", status: "completed", conclusion: "success", createdAt: "2026-04-14T07:20:00Z" },
        { id: 9801, name: "CI", title: "feat: add high contrast theme tokens", status: "in_progress", conclusion: "", createdAt: "2026-04-13T14:15:00Z" },
        { id: 9798, name: "Docs", title: "docs: explain renderable cleanup", status: "completed", conclusion: "failure", createdAt: "2026-04-13T11:30:00Z" },
      ],
      page: 1,
      hasMore: false,
    },
  },
  branches: { status: "ready", value: { items: ["main", "next"], page: 1, hasMore: false } },
  currentBranch: "main",
  commits: {
    status: "ready",
    value: {
      items: [
        { sha: "7ca91d2000000000000000000000000000000000", message: "fix: avoid duplicate key events", author: "max", date: "2026-04-14T06:41:00Z" },
        { sha: "cad92f4000000000000000000000000000000000", message: "feat: expose terminal dimensions hook", author: "jane", date: "2026-04-13T19:12:00Z" },
        { sha: "19a2f81000000000000000000000000000000000", message: "docs: update Solid quick start", author: "drewcodes", date: "2026-04-13T10:04:00Z" },
        { sha: "ab801ec000000000000000000000000000000000", message: "chore: publish v0.4.5", author: "release-bot", date: "2026-04-12T21:50:00Z" },
      ],
      page: 1,
      hasMore: false,
    },
  },
}

export const commitDetailFixture: CommitDetail = {
  ...githubDataFixture.commits.value!.items[0]!,
  fullMessage: "fix: avoid duplicate key events\n\nKeep one owner for keyboard input so a single key press fires once.",
  committer: { name: "web-flow", date: "2026-04-14T06:45:00Z" },
  additions: 18,
  deletions: 7,
  files: {
    items: [
      { path: "src/input.ts", status: "modified", additions: 12, deletions: 5 },
      { path: "test/input.test.ts", previousPath: "test/keys.test.ts", status: "renamed", additions: 6, deletions: 2 },
    ],
    page: 1,
    hasMore: false,
  },
  filesTruncated: false,
}

export const pullContextFixture: PullContext = {
  threads: [], projects: [], closingIssues: [], warnings: [],
  readiness: { headSha: commitDetailFixture.sha, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", checks: [], checksComplete: true },
}

export const repositoryOperationsFixture: RepositoryOperations = {
  refresh: { status: "idle" },
  branch: { status: "idle" },
}

export const issueDetailFixture: IssueDetail = {
  ...githubDataFixture.issues.open.value!.items[0]!,
  url: "https://github.com/anomalyco/opentui/issues/412",
  body: "## Reproduction\n\nThe viewport loses focus after a resize.\n\n- [x] Confirmed on macOS\n- [ ] Check Linux\n\n```ts\nrenderer.resize(40, 24)\n```",
  updatedAt: "2026-04-14T08:00:00Z",
  locked: false,
  permissions: { comment: true, close: true, reopen: true, duplicate: true },
  labels: ["bug", "terminal"],
  assignees: ["max", "jane"],
  milestone: { title: "Next release", dueAt: "2026-05-01T00:00:00Z" },
  commentCount: 2,
}

export const issueCommentsFixture: IssueComment[] = [
  { id: 101, author: "max", authorAssociation: "MEMBER", body: "Thanks for the clear reproduction.",
    createdAt: "2026-04-13T10:00:00Z", updatedAt: "2026-04-13T10:00:00Z" },
  { id: 102, author: "maria-dev", authorAssociation: "NONE", body: "Still reproducible with **scrollbars enabled**.",
    createdAt: "2026-04-14T08:00:00Z", updatedAt: "2026-04-14T08:30:00Z" },
]

export const issuePullReferenceFixture: IssuePullReference = {
  kind: "pull",
  id: "cross-referenced:other/repo:77:2026-04-14T09:00:00Z:max",
  repository: "other/repo",
  number: 77,
  title: "Fix viewport focus after resize",
  url: "https://github.com/other/repo/pull/77",
  state: "closed",
  merged: true,
  draft: false,
  actor: "max",
  createdAt: "2026-04-14T09:00:00Z",
}
