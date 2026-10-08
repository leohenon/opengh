import type { RepositoryData, RepositoryOperations } from "../../src/repository-state"

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
    { number: 421, state: "open" as const, title: "fix: retain focused child during layout changes", author: "maria-dev", createdAt: "2026-04-14T08:32:00Z" },
    { number: 418, state: "open" as const, title: "feat: add high contrast theme tokens", author: "samuelk", createdAt: "2026-04-13T14:11:00Z" },
    { number: 410, state: "open" as const, title: "docs: explain renderable cleanup", author: "drewcodes", createdAt: "2026-04-11T10:05:00Z" },
  ],
  closed: [
    { number: 402, state: "closed" as const, title: "fix: preserve selection after refresh", author: "terminal-dev", createdAt: "2026-04-08T15:45:00Z" },
  ],
}

export const githubDataFixture: RepositoryData = {
  repo: {
    nameWithOwner: "anomalyco/opentui",
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
  readme: {
    status: "ready",
    value: "# OpenTUI\n\nA TypeScript library for building rich terminal user interfaces.",
  },
  contributing: {
    status: "ready",
    value: "# Contributing\n\nThanks for helping improve OpenTUI.",
  },
  security: {
    status: "ready",
    value: "# Security Policy\n\nPlease report vulnerabilities privately.",
  },
  license: {
    status: "ready",
    value: "MIT License\n\nCopyright OpenTUI contributors.",
  },
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

export const repositoryOperationsFixture: RepositoryOperations = {
  refresh: { status: "idle" },
  branch: { status: "idle" },
}
