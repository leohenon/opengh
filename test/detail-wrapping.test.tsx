import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "../src/config"
import type { PullDetailState } from "../src/repository-state"
import { App } from "../src/ui/app"
import { githubDataFixture, issueCommentsFixture, pullContextFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const active: Array<{ destroy(): void; isDestroyed: boolean }> = []
afterEach(() => {
  for (const renderer of active.splice(0)) if (!renderer.isDestroyed) renderer.destroy()
})

const summary = githubDataFixture.pulls.open.value!.items[0]!
const date = "2026-04-14T09:00:00Z"
const login = "some-extremely-long-github-login-name-39"
const pull: PullDetailState = {
  number: summary.number,
  resource: {
    status: "ready",
    value: {
      ...summary,
      body: "Body.",
      url: `${githubDataFixture.repo.url}/pull/${summary.number}`,
      updatedAt: date,
      baseBranch: "backports",
      headBranch: "fix/turbopack-sourcemap-general-availability",
      headRepository: "some-user/next.js",
      additions: 1234,
      deletions: 56,
      changedFiles: 42,
      commitCount: 7,
      commentCount: 1,
      labels: [
        "area: turbopack/source-maps",
        "type: bug",
        "linear: next",
        "CI approved",
        "needs-triage-from-maintainers",
        "good first issue",
      ],
      assignees: ["maria-dev", login],
      reviewers: [],
      mergeable: null,
    } as never,
  },
  comments: {
    status: "ready",
    value: {
      items: [{ ...issueCommentsFixture[0]!, author: login, authorAssociation: "CONTRIBUTOR", updatedAt: "2026-05-01T00:00:00Z" }],
      page: 1,
      hasMore: false,
    },
  },
  references: {
    status: "ready",
    value: [
      {
        kind: "pull",
        id: "ref1",
        repository: "a-rather-long-repository-owner/a-rather-long-repository-name",
        number: 102474,
        title: "Ref title",
        url: "https://github.com/x/y/pull/102474",
        state: "open",
        merged: false,
        draft: false,
        actor: "max",
        createdAt: date,
      },
    ],
  },
  commits: { status: "ready", value: [] },
  events: [
    { kind: "draft", event: "ready_for_review", id: "d1", actor: login, createdAt: date },
    {
      kind: "review-dismissed",
      event: "review_dismissed",
      id: "x1",
      actor: "another-very-long-login-name",
      reviewer: login,
      createdAt: date,
      body: "Stale after force-push; see https://github.com/vercel/next.js/pull/102474#discussion_r1234567890 and packages/next/src/server/lib/router-utils/setup-dev-bundler.ts",
    },
    {
      kind: "review",
      event: "reviewed",
      id: "r1",
      reviewId: 1,
      actor: "another-very-long-login-name-for-reviews",
      state: "approved",
      body: "LGTM",
      authorAssociation: "MEMBER",
      createdAt: date,
      url: "u",
    },
  ] as never,
  context: {
    status: "ready",
    value: {
      ...pullContextFixture,
      milestone: { title: "Next.js 15.3 — Turbopack production builds stable/general-availability (Q2)", url: "m", dueAt: date },
      projects: [{ id: "p", title: "Roadmap/Tracking Board (2026)", url: "p" }],
      closingIssues: [
        {
          number: 7,
          title: "packages/next/src/server/lib/router-utils/setup-dev-bundler.ts",
          url: "https://github.com/vercel/next.js/issues/7",
          repository: "vercel/next.js",
          state: "closed",
        },
        { number: 8, title: "Short", url: "https://github.com/vercel/next.js/issues/8", repository: "vercel/next.js", state: "open" },
      ],
      readiness: {
        ...pullContextFixture.readiness,
        checksComplete: true,
        checks: [
          {
            id: "c",
            name: "build-and-test / test turbopack production integration (ubuntu-latest, node 22, shard 12/16) / run-tests-with-retries",
            state: "failure",
            required: true,
          },
        ],
      },
    } as never,
  },
}

async function frame(width: number) {
  const view = await testRender(
    () => (
      <App
        data={{ ...githubDataFixture, repo: { ...githubDataFixture.repo, nameWithOwner: "vercel/next.js" } }}
        operations={repositoryOperationsFixture}
        config={defaultConfig}
        initialNavigation={{ detail: { kind: "pull", number: summary.number } }}
        pullDetail={pull}
      />
    ),
    { width, height: 120 },
  )
  active.push(view.renderer)
  for (let pass = 0; pass < 3; pass++) {
    await view.flush()
    await Bun.sleep(60)
  }
  return view
    .captureCharFrame()
    .split("\n")
    .map((row) => row.trimEnd())
}

test("details and timeline lines wrap at spaces and separators and keep each separator with its text", async () => {
  for (const width of [164, 80, 56]) {
    const rows = await frame(width)
    const text = rows.join("\n")
    expect(text).not.toMatch(/[\ufdd0-\ufdef\u00a0]/)
    for (const row of rows) {
      expect(row.replace(/^[\s│@⑂−✓×]+/, "")).not.toMatch(/^· /)
      expect(row).not.toMatch(/\bnext\.$/)
    }
    expect(text).toMatch(/\(Q2\) · due \S+ ago/)
    expect(text).toMatch(/run-tests-with-retries · Required/)
    expect(text).toMatch(/review · \S+ ago/)
    expect(text).not.toMatch(/\d+m\n.*o ago/)
  }
})
