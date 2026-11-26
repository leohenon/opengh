import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, type ComponentProps } from "solid-js"
import { App } from "../src/ui/app"
import { defaultConfig } from "../src/config"
import type { IssueComment } from "../src/models"
import type { InitialNavigation } from "../src/navigation"
import { githubDataFixture, issueDetailFixture, repositoryOperationsFixture } from "./fixtures/github-data"

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

  test("a comment link scrolls the conversation to that comment", async () => {
    const comments: IssueComment[] = Array.from({ length: 30 }, (_, index) => ({
      id: 1000 + index,
      author: "max",
      authorAssociation: "MEMBER",
      body: `Comment body ${index}`,
      createdAt: "2026-04-13T10:00:00Z",
      updatedAt: "2026-04-13T10:00:00Z",
    }))
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          config={defaultConfig}
          operations={repositoryOperationsFixture}
          initialNavigation={{ detail: { kind: "issue", number: issueDetailFixture.number }, comment: 1025 }}
          issueDetail={{
            number: issueDetailFixture.number,
            resource: { status: "ready", value: issueDetailFixture },
            comments: { status: "ready", value: { items: comments, page: 1, hasMore: false } },
            references: { status: "ready", value: [] },
          }}
        />
      ),
      { width: 120, height: 32 },
    )
    active.push(view)
    for (let attempt = 0; attempt < 20 && !view.captureCharFrame().includes("Comment body 25"); attempt++) await settle(view)
    await settle(view)
    const frame = view.captureCharFrame()
    expect(frame).toContain("Comment body 25")
    expect(frame).not.toContain("The viewport loses focus after a resize.")
    const lines = frame.split("\n")
    const author = lines.findIndex((line, index) => line.includes("max ·") && lines[index + 2]?.includes("Comment body 25"))
    expect(author).toBeGreaterThan(-1)
    expect(author).toBeLessThan(10)
  })
})
