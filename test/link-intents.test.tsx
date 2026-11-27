import { afterEach, describe, expect, test } from "bun:test"
import type { ScrollBoxRenderable } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal, type ComponentProps } from "solid-js"
import { App } from "../src/ui/app"
import { createCommentReveal, type CommentReveal } from "../src/ui/reveal-comment"
import { defaultConfig } from "../src/config"
import type { IssueComment } from "../src/models"
import type { InitialNavigation } from "../src/navigation"
import {
  githubDataFixture,
  issueDetailFixture,
  issuePullReferenceFixture,
  pullContextFixture,
  repositoryOperationsFixture,
} from "./fixtures/github-data"
import { waitForText } from "./fixtures/wait"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const setup of active.splice(0)) if (!setup.renderer.isDestroyed) setup.renderer.destroy()
})

type AppProps = Partial<ComponentProps<typeof App>>
const sha = "f".repeat(40)

async function settle(view: { flush(): Promise<void> }) {
  for (let frame = 0; frame < 4; frame++) {
    await Bun.sleep(5)
    await view.flush()
  }
}

async function clickLink(href: string, props: AppProps = {}) {
  const locations: Array<{ repository: string; initial: InitialNavigation }> = []
  const external: string[] = []
  const view = await testRender(
    () => (
      <App
        data={{ ...githubDataFixture, repo: { ...githubDataFixture.repo, description: `See ${href}` } }}
        config={defaultConfig}
        operations={repositoryOperationsFixture}
        onOpenLocation={(repository, initial) => {
          locations.push({ repository, initial })
        }}
        onOpenUrl={async (url) => {
          external.push(url)
        }}
        {...props}
      />
    ),
    { width: 120, height: 32 },
  )
  active.push(view)
  await view.flush()
  const position = (() => {
    for (let y = 0; y < view.renderer.height; y++)
      for (let x = 0; x < view.renderer.width; x++) if (view.renderer.getLinkAt(x, y) === href) return { x, y }
  })()
  if (!position) throw new Error(`No painted hyperlink for ${href}`)
  await view.mockMouse.click(position.x, position.y)
  await settle(view)
  return { view, locations, external }
}

const comments: IssueComment[] = Array.from({ length: 30 }, (_, index) => ({
  id: 1000 + index,
  author: index === 25 ? "target-author" : "max",
  authorAssociation: "MEMBER",
  body: `Comment body ${index}`,
  createdAt: "2026-04-13T10:00:00Z",
  updatedAt: "2026-04-13T10:00:00Z",
}))
const issue = { ...issueDetailFixture, body: Array.from({ length: 50 }, (_, i) => `Discussion line ${i}`).join("\n\n") }

const creation = {
  onCreateIssue: async () => ({ number: 1 }) as never,
  onCreatePull: async () => ({ number: 1 }) as never,
  onComparePull: async () => ({}) as never,
}

describe("links inside opengh", () => {
  test("GitHub pages opengh can't show open in the browser with a notice", async () => {
    const url = "https://github.com/anomalyco/opentui/discussions/12"
    const { view, external, locations } = await clickLink(url)
    expect(external).toEqual([url])
    expect(locations).toEqual([])
    expect(view.captureCharFrame()).toContain("Discussions are not yet supported")
  })

  test("other websites open in the browser without a notice", async () => {
    const url = "https://example.com/docs/"
    const { view, external } = await clickLink(url)
    expect(external).toEqual([url])
    expect(view.captureCharFrame()).not.toContain("not yet supported")
  })

  test("new issue links start the new issue flow", async () => {
    const { view, external } = await clickLink("https://github.com/anomalyco/opentui/issues/new", creation)
    expect(external).toEqual([])
    expect(view.captureCharFrame()).toContain("New issue")

    const other = await clickLink("https://github.com/other/project/issues/new?template=bug.md", creation)
    expect(other.locations).toEqual([{ repository: "other/project", initial: { page: "issues", create: { kind: "issue" } } }])
  })

  test("new issue links open in the browser when opengh can't create issues", async () => {
    const url = "https://github.com/anomalyco/opentui/issues/new"
    const { external } = await clickLink(url)
    expect(external).toEqual([url])
  })

  test("new pull request links start the new pull request flow with their branch", async () => {
    const { locations } = await clickLink("https://github.com/other/project/pull/new/feature/login?expand=1", creation)
    expect(locations).toEqual([
      { repository: "other/project", initial: { page: "pulls", create: { kind: "pull", head: "feature/login" } } },
    ])
  })

  test.each(["main", "v1.0"])("commit links open the commit %s names, whether branch or tag", async (ref) => {
    const resolved: Array<[string, string]> = []
    const { locations, external } = await clickLink(`https://github.com/other/project/commit/${ref}`, {
      onResolveCommit: async (repository, name) => {
        resolved.push([repository, name])
        return sha
      },
    })
    expect(resolved).toEqual([["other/project", ref]])
    expect(external).toEqual([])
    expect(locations).toEqual([{ repository: "other/project", initial: { detail: { kind: "commit", sha } } }])
  })

  test("compare links open the comparison on the Commits page", async () => {
    const { locations, external } = await clickLink("https://github.com/other/project/compare/v1.0...v1.1")
    expect(external).toEqual([])
    expect(locations).toEqual([
      { repository: "other/project", initial: { page: "commits", diff: { kind: "compare", base: "v1.0", head: "v1.1" } } },
    ])
  })

  test("tag history opens in the browser, saying tags aren't supported", async () => {
    const url = "https://github.com/other/project/commits/v1.0"
    const { view, external } = await clickLink(url, { onResolveBranch: async () => undefined, onResolveTag: async () => true })
    expect(external).toEqual([url])
    expect(view.captureCharFrame()).toContain("Tags are not yet supported")
  })

  test("branch history links switch the Commits page to that branch", async () => {
    const switched: string[] = []
    const { view } = await clickLink("https://github.com/anomalyco/opentui/commits/next", {
      onResolveBranch: async () => sha,
      onBranchChange: (branch) => switched.push(branch),
    })
    expect(switched).toEqual(["next"])
    expect(view.captureCharFrame()).toContain("Commits")
  })

  test("commit links to names that don't exist open in the browser", async () => {
    const url = "https://github.com/other/project/commit/nothing-here"
    const { view, external, locations } = await clickLink(url, { onResolveCommit: async () => undefined })
    expect(external).toEqual([url])
    expect(locations).toEqual([])
    expect(view.captureCharFrame()).toContain("This page is not yet supported")
  })

  test("comment links open the conversation in opengh with the comment to reveal", async () => {
    const { locations, external } = await clickLink("https://github.com/other/project/issues/12#issuecomment-99", {
      onResolveIssueKind: async () => "issue",
    })
    expect(external).toEqual([])
    expect(locations).toEqual([{ repository: "other/project", initial: { detail: { kind: "issue", number: 12 }, comment: 99 } }])
  })
})

describe("link intents when a repository opens", () => {
  test("a branch waits until the Commits page can switch", async () => {
    const [canSwitch, setCanSwitch] = createSignal(false)
    const switched: string[] = []
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          config={defaultConfig}
          operations={repositoryOperationsFixture}
          initialNavigation={{ page: "commits", branch: "next" }}
          canSwitchBranch={canSwitch()}
          onBranchChange={(branch) => switched.push(branch)}
        />
      ),
      { width: 120, height: 32 },
    )
    active.push(view)
    await settle(view)
    expect(switched).toEqual([])
    setCanSwitch(true)
    await settle(view)
    expect(switched).toEqual(["next"])
  })

  test("a new issue intent opens the editor", async () => {
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          config={defaultConfig}
          operations={repositoryOperationsFixture}
          initialNavigation={{ page: "issues", create: { kind: "issue" } }}
          {...creation}
        />
      ),
      { width: 120, height: 32 },
    )
    active.push(view)
    await settle(view)
    expect(view.captureCharFrame()).toContain("New issue")
  })

  test.each(["resize", "shrink", "wheel", "drag"])("pending comment on a scrolled viewport: %s", async (action) => {
    const [target, setTarget] = createSignal<CommentReveal>()
    const [ready, setReady] = createSignal(false)
    const [tail, setTail] = createSignal(69)
    let scroll!: ScrollBoxRenderable
    const view = await testRender(
      () => {
        createCommentReveal({ renderer: useRenderer(), target, ready, sources: () => [], scroll: () => scroll, elementId: () => "anchor" })
        return (
          <scrollbox height="100%" ref={(value) => (scroll = value)}>
            <box height={30} flexShrink={0} />
            <box id="anchor" height={1} flexShrink={0} />
            <box height={tail()} flexShrink={0} />
          </scrollbox>
        )
      },
      { width: 40, height: 10 },
    )
    active.push(view)
    await view.flush()
    scroll.scrollTo(90)
    expect(scroll.scrollTop).toBe(90)
    setTarget({ id: 1, request: 1 })
    if (action === "shrink") setTail(59)
    else view.resize(40, 20)
    await view.flush()
    expect(scroll.scrollTop).toBe(80)
    if (action === "wheel") await view.mockMouse.scroll(2, 5, "up")
    if (action === "drag") {
      const slider = scroll.verticalScrollBar.slider
      await view.mockMouse.drag(slider.x, slider.y + slider.height - 1, slider.x, slider.y + 4)
    }
    const manual = action === "wheel" || action === "drag"
    const before = scroll.scrollTop
    if (manual) expect(before).toBeLessThan(80)
    setReady(true)
    await view.flush()
    expect(scroll.scrollTop).toBe(manual ? before : 30)
  })

  test.each(["cached", "delayed", "manual", "hidden"])(
    "a comment link respects the viewport from the first ready frame: %s",
    async (mode) => {
      const [ready, setReady] = createSignal(mode === "cached")
      const view = await testRender(
        () => (
          <App
            data={githubDataFixture}
            config={defaultConfig}
            operations={repositoryOperationsFixture}
            initialNavigation={{ detail: { kind: "issue", number: issueDetailFixture.number }, comment: 1025 }}
            issueDetail={{
              number: issueDetailFixture.number,
              resource: { status: "ready", value: issue },
              comments: ready()
                ? { status: "ready", value: { items: comments, page: 1, hasMore: false } }
                : { status: "loading", phase: "load" },
              references: { status: "ready", value: [] },
            }}
          />
        ),
        { width: 120, height: 32 },
      )
      active.push(view)
      if (mode !== "cached") await view.flush()
      const scroll = view.renderer.root.findDescendantById("issue-detail-scroll") as ScrollBoxRenderable
      if (mode === "manual") {
        view.mockInput.pressKey("G")
        await view.flush()
        expect(scroll.scrollTop).toBeGreaterThan(0)
      }
      const before = scroll.scrollTop
      if (mode === "hidden") {
        view.mockInput.pressKey("1")
        await settle(view)
        expect(view.captureCharFrame()).toContain("Code of conduct")
      }
      setReady(true)
      if (mode === "hidden") {
        for (let frame = 0; frame < 125; frame++) await view.renderOnce()
        expect(scroll.scrollTop).toBe(before)
        view.mockInput.pressKey("3")
      }
      for (let pass = 0; pass < 4; pass++) {
        await view.renderOnce()
        if (mode === "manual") expect(scroll.scrollTop).toBe(before)
        else {
          const row = view
            .captureCharFrame()
            .split("\n")
            .findIndex((line) => line.includes("target-author"))
          expect(row).toBeGreaterThanOrEqual(0)
          expect(row).toBeLessThan(10)
        }
      }
      if (mode !== "manual") await waitForText(view, "Comment body 25")
    },
  )

  test.each(["issue", "manual", "pull"] as const)("older timeline entries arrive after the comment is stable: %s", async (mode) => {
    const [stage, setStage] = createSignal(0)
    const kind = mode === "pull" ? "pull" : "issue"
    const summary = githubDataFixture.pulls.open.value!.items[0]!
    const number = kind === "issue" ? issue.number : summary.number
    const older = "2026-04-01T10:00:00Z"
    const loading = { status: "loading", phase: "load" } as const
    const ready = <T,>(value: T) => ({ status: "ready" as const, value })
    const page = ready({ items: comments, page: 1, hasMore: false })
    const refs = Array.from({ length: 15 }, (_, i) => ({ ...issuePullReferenceFixture, id: String(i), number: i + 1, createdAt: older }))
    const references = () => (stage() >= 1 ? ready(refs) : loading)
    const pull = {
      ...issue,
      ...summary,
      url: `${githubDataFixture.repo.url}/pull/${number}`,
      baseBranch: "main",
      headBranch: "next",
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      commitCount: 4,
      reviewers: [],
      mergeable: null,
    }
    const commits = githubDataFixture.commits.value!.items.map((commit) => ({ ...commit, committedAt: older }))
    const threads = [
      {
        kind: "review-thread" as const,
        id: "review-thread-1",
        path: "file.ts",
        createdAt: older,
        isResolved: false,
        isOutdated: false,
        comments: [{ ...comments[0]!, id: "inline-1", url: pull.url, body: "A review thread" }],
      },
    ]
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          config={defaultConfig}
          operations={repositoryOperationsFixture}
          initialNavigation={{ detail: { kind, number }, comment: 1025 }}
          issueDetail={kind === "issue" ? { number, resource: ready(issue), comments: page, references: references() } : undefined}
          pullDetail={
            kind === "pull"
              ? {
                  number,
                  resource: ready(pull),
                  comments: page,
                  references: references(),
                  commits: stage() >= 2 ? ready(commits) : loading,
                  context: stage() >= 3 ? ready({ ...pullContextFixture, threads }) : loading,
                }
              : undefined
          }
        />
      ),
      { width: 120, height: 32 },
    )
    active.push(view)
    const scroll = view.renderer.root.findDescendantById(`${kind}-detail-scroll`) as ScrollBoxRenderable
    const targetRow = () =>
      view
        .captureCharFrame()
        .split("\n")
        .findIndex((line) => line.includes("target-author"))
    await waitForText(view, "Comment body 25")
    for (let next = 1; next <= (kind === "pull" ? 3 : 1); next++) {
      for (let frame = 0; frame < 8; frame++) await view.renderOnce()
      const row = targetRow()
      expect(row).toBeGreaterThanOrEqual(0)
      if (mode === "manual") {
        view.mockInput.pressKey("g")
        await view.flush()
        expect(scroll.scrollTop).toBe(0)
      }
      const before = scroll.scrollTop
      setStage(next)
      for (let frame = 0; frame < 4; frame++) {
        await view.renderOnce()
        expect(targetRow()).toBe(mode === "manual" ? -1 : row)
      }
      await view.flush()
      if (mode === "manual") {
        expect(scroll.scrollTop).toBe(before)
        expect(targetRow()).toBe(-1)
      } else {
        expect(scroll.scrollTop).toBeGreaterThan(before)
        expect(targetRow()).toBe(row)
      }
    }
  })
})
