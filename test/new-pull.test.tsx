import { afterEach, describe, expect, test } from "bun:test"
import { render as mount, testRender } from "@opentui/solid"
import { createTestRenderer } from "@opentui/core/testing"
import { initializeHunk } from "../src/ui/hunk-host"
import { defaultConfig } from "../src/config"
import type { MergeCheck } from "../src/command-actions"
import { GitHubApiError } from "../src/github/transport"
import type {
  DiffTarget,
  NewPull,
  PullBranchComparison,
  PullRepositories,
  PullRepository,
  PullRequestDetail,
  PullRequestTemplate,
} from "../src/models"
import { createComposeDrafts, type ComposeDrafts } from "../src/compose-drafts"
import { createSignal } from "solid-js"
import type { DiffState } from "../src/repository-state"
import { patchFixture } from "./fixtures/diff"
import { defaultPullDraft } from "../src/ui/components/new-pull-dialog"
import { App } from "../src/ui/app"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const view of active.splice(0)) if (!view.renderer.isDestroyed) view.renderer.destroy()
})

type View = Awaited<ReturnType<typeof testRender>>

const repository = githubDataFixture.repo.nameWithOwner
const comparison = (aheadBy: number, files = 5): PullBranchComparison => ({
  comparison: { status: aheadBy ? "ahead" : "identical", aheadBy, behindBy: 0, commits: aheadBy, files, additions: 6, deletions: 2 },
})
const frame = (view: View) => view.captureCharFrame()
const lines = (view: View) => frame(view).split("\n")
const statusLine = (view: View) =>
  lines(view)
    .filter((line) => line.trim())
    .at(-1) ?? ""
const box = (view: View) => view.renderer.root.findDescendantById("new-pull-dialog")
const settle = async (view: View) => {
  await Bun.sleep(20)
  await view.flush()
}

async function render(
  options: {
    localBranch?: string
    compare?: (base: string, head: string) => Promise<PullBranchComparison>
    onLoadPull?: (number: number) => Promise<void>
    page?: "issues" | "pulls"
    drafts?: ComposeDrafts
    create?: (pull: NewPull) => Promise<PullRequestDetail>
    checkMerge?: (base: string, head: string) => Promise<MergeCheck>
    local?: boolean
    width?: number
    repositories?: PullRepositories | Promise<PullRepositories>
    branchesOf?: (repository: PullRepository) => string[]
    compareIn?: (repository: PullRepository, base: string, head: string) => void
    createIn?: (repository: PullRepository, pull: NewPull) => void
    templates?: (repository: PullRepository) => Promise<PullRequestTemplate[]>
  } = {},
) {
  const calls: Array<[string, string]> = []
  const view = await testRender(
    () => (
      <App
        data={structuredClone(githubDataFixture)}
        operations={repositoryOperationsFixture}
        initialPage={options.page ?? "pulls"}
        config={{ ...defaultConfig, iconStyle: "unicode", showStatusBarHints: true }}
        localRepository={options.local === false ? undefined : { directory: "/tmp/opengh", repository }}
        onLoadLocalBranch={async () => options.localBranch}
        onComparePull={(target, base, head) => {
          options.compareIn?.(target, base, head)
          calls.push([base, head])
          return options.compare ? options.compare(base, head) : Promise.resolve(comparison(3))
        }}
        onLoadPull={options.onLoadPull}
        newPullDrafts={options.drafts}
        onCreatePull={
          options.create
            ? (target, pull) => {
                options.createIn?.(target, pull)
                return options.create!(pull)
              }
            : undefined
        }
        onLoadPullRepositories={options.repositories ? () => Promise.resolve(options.repositories!) : undefined}
        onLoadPullBranches={async (target) => ({ items: options.branchesOf?.(target) ?? [], hasMore: false })}
        onCheckMerge={options.checkMerge}
        onLoadPullTemplates={options.templates}
      />
    ),
    { width: options.width ?? 100, height: 30 },
  )
  active.push(view)
  await view.flush()
  return { view, calls }
}

async function open(view: View) {
  view.mockInput.pressKey("c")
  await settle(view)
}

async function toTitle(view: View) {
  view.mockInput.pressArrow("down")
  await view.flush()
}

async function branches(view: View) {
  view.mockInput.pressArrow("up")
  await view.flush()
}

async function pick(view: View, branch: string) {
  await view.mockInput.typeText(branch)
  view.mockInput.pressEnter()
  await settle(view)
}

describe("new pull request", () => {
  test("c and right-click open it on the pull request list, with hints and help", async () => {
    const { view } = await render({ localBranch: "next" })
    expect(statusLine(view)).toContain("c new pull request")
    await open(view)
    expect(box(view)).toBeDefined()
    expect(frame(view)).toContain("New pull request")
    expect(frame(view)).not.toContain(`New pull request · ${repository}`)
    view.mockInput.pressEscape()
    await settle(view)
    expect(box(view)).toBeUndefined()
    view.mockInput.pressKey("?")
    await view.flush()
    expect(frame(view)).toContain("new pull request")
    view.mockInput.pressEscape()
    await settle(view)
    await view.mockMouse.click(10, 26, 2)
    await view.flush()
    const item = lines(view).findIndex((line) => line.includes("New pull request"))
    expect(item).toBeGreaterThanOrEqual(0)
    await view.mockMouse.click(lines(view)[item]!.indexOf("New pull request"), item)
    await settle(view)
    expect(box(view)).toBeDefined()
  })

  test("starts from the default base and the local branch, and summarizes the comparison", async () => {
    const { view, calls } = await render({ localBranch: "next" })
    await open(view)
    expect(frame(view)).toContain("main ← next")
    expect(frame(view)).toContain("3 commits · 5 files · +6 −2")
    expect(calls).toEqual([["main", "next"]])
  })

  test("opens the head picker when there is no local branch, or it is the base", async () => {
    for (const localBranch of [undefined, "main"]) {
      const { view, calls } = await render({ localBranch })
      await open(view)
      expect(frame(view)).toContain("Choose head branch")
      await pick(view, "next")
      expect(frame(view)).not.toContain("Choose head branch")
      expect(frame(view)).toContain("main ← next")
      expect(calls).toEqual([["main", "next"]])
      view.renderer.destroy()
    }
  })

  test("opens the head picker with a note when the local branch isn't on GitHub", async () => {
    const { view, calls } = await render({
      localBranch: "local-only",
      compare: async (_base, head) => {
        if (head === "local-only") throw new GitHubApiError("compare", "Not Found (HTTP 404)")
        return comparison(1, 1)
      },
    })
    await open(view)
    expect(frame(view)).toContain("Choose head branch")
    view.mockInput.pressEscape()
    await settle(view)
    expect(frame(view)).toContain("local-only isn't on GitHub. Choose a head branch.")
    expect(frame(view)).toContain("main ← choose head")
    view.mockInput.pressEnter()
    await settle(view)
    await pick(view, "next")
    expect(frame(view)).toContain("1 commit · 1 file · +6 −2")
    expect(calls).toEqual([
      ["main", "local-only"],
      ["main", "next"],
    ])
  })

  test("← selects the base branch and enter changes it", async () => {
    const { view, calls } = await render({ localBranch: "next" })
    await open(view)
    await branches(view)
    view.mockInput.pressArrow("left")
    view.mockInput.pressEnter()
    await settle(view)
    expect(frame(view)).toContain("Choose base branch")
    await pick(view, "next")
    expect(frame(view)).toContain("next ← next")
    expect(calls.at(-1)).toEqual(["next", "next"])
  })

  test("blocks with a message when there is nothing to compare", async () => {
    const { view } = await render({ localBranch: "next", compare: async () => comparison(0) })
    await open(view)
    expect(frame(view)).toContain("Nothing to compare — next has no commits ahead of main")
  })

  test("shows an existing pull request and opens it with → and enter", async () => {
    const opened: number[] = []
    const { view } = await render({
      localBranch: "next",
      compare: async () => ({
        ...comparison(2),
        existing: { number: 12, title: "Topic", state: "open", author: "octocat", createdAt: "2026-01-01T00:00:00Z", merged: false },
      }),
      onLoadPull: async (number) => {
        opened.push(number)
      },
    })
    await open(view)
    expect(frame(view)).toContain("Pull request #12 already exists")
    expect(frame(view)).toContain("Open #12")
    await branches(view)
    view.mockInput.pressArrow("right")
    await view.flush()
    expect(statusLine(view)).toContain("enter open #12")
    view.mockInput.pressEnter()
    await settle(view)
    expect(box(view)).toBeUndefined()
    expect(opened).toEqual([12])
  })

  test("shows the latest comparison when branches change before an earlier one finishes", async () => {
    let finishFirst: (value: PullBranchComparison) => void = () => {}
    const { view } = await render({
      localBranch: "next",
      compare: (base) =>
        base === "main"
          ? new Promise((resolve) => {
              finishFirst = resolve
            })
          : Promise.resolve(comparison(7, 9)),
    })
    await open(view)
    await branches(view)
    view.mockInput.pressArrow("left")
    view.mockInput.pressEnter()
    await settle(view)
    await pick(view, "next")
    expect(frame(view)).toContain("7 commits · 9 files · +6 −2")
    finishFirst(comparison(1, 1))
    await settle(view)
    expect(frame(view)).toContain("7 commits · 9 files · +6 −2")
    expect(frame(view)).not.toContain("1 commit · 1 file · +6 −2")
  })

  test("shows other errors in the summary", async () => {
    const { view } = await render({
      localBranch: "next",
      compare: async () => {
        throw new Error("GitHub request timed out.")
      },
    })
    await open(view)
    expect(frame(view)).toContain("GitHub request timed out.")
  })

  test("defaults the title and description from a single commit, or the branch name", () => {
    const single = { status: "ahead" as const, aheadBy: 1, behindBy: 0, commits: 1, files: 1, additions: 6, deletions: 2 }
    expect(defaultPullDraft({ ...single, message: "Fix resize\n\nKeeps the sidebar open.\n" }, "fix/resize")).toEqual({
      title: "Fix resize",
      body: "Keeps the sidebar open.",
    })
    expect(defaultPullDraft({ ...single, message: "Only a subject" }, "x")).toEqual({ title: "Only a subject", body: "" })
    expect(defaultPullDraft({ ...single, commits: 3, aheadBy: 3 }, "sandbox/new-pull_request-test")).toEqual({
      title: "Sandbox/new pull request test",
      body: "",
    })
    expect(defaultPullDraft({ ...single, message: "Fix\n\nBody" }, "x", "## Summary\r\n")).toEqual({
      title: "Fix",
      body: "Body\n\n## Summary\n",
    })
    expect(defaultPullDraft({ ...single, message: "Only a subject" }, "x", "T")).toEqual({ title: "Only a subject", body: "T" })
    expect(defaultPullDraft({ ...single, commits: 3, aheadBy: 3 }, "topic", "T")).toEqual({ title: "Topic", body: "T" })
  })

  test("opens on the branch row with the title and description filled in; tab steps through the summary to the title, and ↑ returns", async () => {
    const { view } = await render({
      localBranch: "next",
      compare: async () => ({
        comparison: {
          status: "ahead",
          aheadBy: 1,
          behindBy: 0,
          commits: 1,
          files: 1,
          additions: 6,
          deletions: 2,
          message: "Fix resize\n\nKeeps the sidebar open.",
        },
      }),
    })
    await open(view)
    const title = view.renderer.root.findDescendantById("new-pull-title") as unknown as { value: string; focused: boolean }
    const body = view.renderer.root.findDescendantById("new-pull-body") as unknown as { plainText: string }
    expect(title.value).toBe("Fix resize")
    expect(body.plainText).toBe("Keeps the sidebar open.")
    expect(title.focused).toBe(false)
    expect(statusLine(view)).toContain("↓ title")
    expect(statusLine(view)).toContain("tab next")
    view.mockInput.pressTab()
    await view.flush()
    expect(title.focused).toBe(false)
    expect(statusLine(view)).toContain("enter view diff")
    expect(frame(view)).toContain("1 commit · 1 file · +6 −2 ›")
    view.mockInput.pressTab()
    await view.flush()
    expect(title.focused).toBe(true)
    expect(statusLine(view)).toContain("↑ branches")
    await branches(view)
    expect(title.focused).toBe(false)
  })

  test("keeps typed text when the head changes, and a saved draft per head branch", async () => {
    const drafts = createComposeDrafts({ storage: false })
    const { view } = await render({ localBranch: "next", drafts })
    await open(view)
    const title = () => (view.renderer.root.findDescendantById("new-pull-title") as unknown as { value: string }).value
    const changeHead = async (branch: string) => {
      await branches(view)
      view.mockInput.pressEnter()
      await settle(view)
      await pick(view, branch)
    }
    expect(title()).toBe("Next")
    await toTitle(view)
    view.mockInput.pressKey("a", { ctrl: true })
    view.mockInput.pressKey("k", { ctrl: true })
    await view.mockInput.typeText("My title")
    await view.flush()
    await changeHead("main")
    expect(title()).toBe("My title")
    view.mockInput.pressEscape()
    await settle(view)
    expect(await drafts.load({ repositoryId: githubDataFixture.repo.id, head: "next" })).toEqual({ title: "My title", body: "" })

    await open(view)
    expect(title()).toBe("My title")
    await changeHead("main")
    expect(title()).toBe("Main")
    await changeHead("next")
    expect(title()).toBe("My title")
  })

  test("replaces untouched defaults when the head branch changes", async () => {
    const { view } = await render({ localBranch: "next" })
    await open(view)
    const title = () => (view.renderer.root.findDescendantById("new-pull-title") as unknown as { value: string }).value
    expect(title()).toBe("Next")
    await branches(view)
    view.mockInput.pressEnter()
    await settle(view)
    await pick(view, "main")
    expect(title()).toBe("Main")
  })

  test("ctrl+s confirms and creates the pull request with both branches, then clears the draft", async () => {
    const drafts = createComposeDrafts({ storage: false })
    const created: NewPull[] = []
    const { view } = await render({
      localBranch: "next",
      drafts,
      compare: async () => ({
        comparison: {
          status: "ahead",
          aheadBy: 1,
          behindBy: 0,
          commits: 1,
          files: 1,
          additions: 6,
          deletions: 2,
          message: "Fix resize\n\nKeeps the sidebar open.",
        },
      }),
      create: async (pull) => {
        created.push(pull)
        return { number: 77 } as PullRequestDetail
      },
    })
    await open(view)
    view.mockInput.pressKey("s", { ctrl: true })
    await view.flush()
    expect(frame(view)).toContain(`Create pull request in ${repository}: main ← next?`)
    view.mockInput.pressEnter()
    await settle(view)
    expect(created).toEqual([{ base: "main", head: "next", title: "Fix resize", body: "Keeps the sidebar open." }])
    expect(box(view)).toBeUndefined()
    expect(await drafts.load({ repositoryId: githubDataFixture.repo.id, head: "next" })).toEqual({ title: "", body: "" })
  })

  test("the confirm step offers Create and Create as draft, starting on Create each time", async () => {
    const created: NewPull[] = []
    const { view } = await render({
      localBranch: "next",
      width: 150,
      create: async (pull) => {
        created.push(pull)
        return { number: 7 } as PullRequestDetail
      },
    })
    await open(view)
    const confirm = async (key?: () => void) => {
      key?.()
      await view.flush()
    }
    await confirm(() => view.mockInput.pressKey("s", { ctrl: true }))
    expect(frame(view)).toContain("› Create    Create as draft")
    expect(statusLine(view)).toContain("←/→ choose · enter create · esc back")
    await confirm(() => view.mockInput.pressArrow("right"))
    expect(frame(view)).toContain("  Create  › Create as draft")
    expect(statusLine(view)).toContain("enter create draft")
    await confirm(() => view.mockInput.pressArrow("left"))
    expect(frame(view)).toContain("› Create    Create as draft")
    await confirm(() => view.mockInput.pressTab())
    expect(frame(view)).toContain("› Create as draft")
    await confirm(() => view.mockInput.pressTab())
    expect(frame(view)).toContain("› Create    Create as draft")
    await confirm(() => view.mockInput.pressArrow("right"))
    view.mockInput.pressEscape()
    await settle(view)
    expect(frame(view)).not.toContain("Create as draft")
    expect(box(view)).toBeDefined()
    await confirm(() => view.mockInput.pressKey("s", { ctrl: true }))
    expect(frame(view)).toContain("› Create    Create as draft")
    view.mockInput.pressArrow("right")
    view.mockInput.pressEnter()
    await settle(view)
    expect(created).toEqual([{ base: "main", head: "next", title: "Next", body: "", draft: true }])
    expect(box(view)).toBeUndefined()
  })

  test("clicking a choice creates with it", async () => {
    for (const [label, draft] of [
      ["Create as draft", true],
      ["Create", false],
    ] as const) {
      const created: NewPull[] = []
      const { view } = await render({
        localBranch: "next",
        width: 150,
        create: async (pull) => {
          created.push(pull)
          return { number: 7 } as PullRequestDetail
        },
      })
      await open(view)
      view.mockInput.pressKey("s", { ctrl: true })
      await view.flush()
      const row = lines(view).findIndex((line) => line.includes("Create as draft"))
      const column = label === "Create" ? lines(view)[row]!.indexOf("› Create") + 2 : lines(view)[row]!.indexOf(label)
      await view.mockMouse.click(column, row)
      await settle(view)
      expect(created).toEqual([{ base: "main", head: "next", title: "Next", body: "", ...(draft ? { draft: true } : {}) }])
      expect("draft" in created[0]!).toBe(draft)
      view.renderer.destroy()
    }
  })

  test("ctrl+s does nothing when there is nothing to compare or a pull request already exists", async () => {
    for (const compare of [
      async () => comparison(0),
      async () => ({
        ...comparison(2),
        existing: {
          number: 12,
          title: "Topic",
          state: "open" as const,
          author: "octocat",
          createdAt: "2026-01-01T00:00:00Z",
          merged: false,
        },
      }),
    ]) {
      const created: NewPull[] = []
      const { view } = await render({
        localBranch: "next",
        compare,
        create: async (pull) => {
          created.push(pull)
          return { number: 1 } as PullRequestDetail
        },
      })
      await open(view)
      view.mockInput.pressKey("s", { ctrl: true })
      await view.flush()
      expect(frame(view)).not.toContain("Create pull request in")
      expect(created).toEqual([])
      view.renderer.destroy()
    }
  })

  test("shows GitHub's reason and keeps the text when creating fails", async () => {
    const { view } = await render({
      localBranch: "next",
      create: async () => {
        throw new GitHubApiError("pulls", "gh: Validation Failed (HTTP 422) — A pull request already exists for owner:next.")
      },
    })
    await open(view)
    view.mockInput.pressKey("s", { ctrl: true })
    await view.flush()
    view.mockInput.pressEnter()
    await settle(view)
    expect(box(view)).toBeDefined()
    expect(frame(view)).toContain("A pull request already exists for owner:next.")
    expect((view.renderer.root.findDescendantById("new-pull-title") as unknown as { value: string }).value).toBe("Next")
  })

  describe("merge check", () => {
    const merge = (view: View) => view.renderer.root.findDescendantById("new-pull-merge")

    test("shows whether the branches merge, for each result", async () => {
      for (const [result, text] of [
        [{ status: "clean" }, "✓ Able to merge"],
        [{ status: "conflicts", files: ["a.ts", "b.ts"] }, "✗ Can't merge automatically — conflicts in a.ts, b.ts"],
        [{ status: "conflicts", files: ["a", "b", "c", "d", "e"] }, "conflicts in a, b, c, and 2 more"],
        [{ status: "unavailable", reason: "git 2.38 or later is required" }, "Merge check unavailable — git 2.38 or later is required"],
      ] as const) {
        const calls: Array<[string, string]> = []
        const { view } = await render({
          localBranch: "next",
          width: 150,
          checkMerge: async (base, head) => {
            calls.push([base, head])
            return result as MergeCheck
          },
        })
        await open(view)
        expect(merge(view)).toBeDefined()
        expect(frame(view)).toContain(text)
        expect(calls).toEqual([["main", "next"]])
        view.renderer.destroy()
      }
    })

    test("explains it is unavailable without a local checkout", async () => {
      let checks = 0
      const { view } = await render({
        local: false,
        width: 150,
        checkMerge: async () => {
          checks++
          return { status: "clean" }
        },
      })
      await open(view)
      await pick(view, "next")
      expect(frame(view)).toContain("Merge check unavailable — open opengh in a local checkout")
      expect(checks).toBe(0)
    })

    test("sits on the branch row, shortened to fit before the summary when space is tight", async () => {
      const { view } = await render({
        localBranch: "next",
        width: 90,
        checkMerge: async () => ({ status: "conflicts", files: ["src/a-very-long-file-name.ts", "src/another-long-file-name.ts"] }),
      })
      await open(view)
      const row = lines(view).find((line) => line.includes("main ← next"))!
      expect(row).toContain("✗ Conflicts")
      expect(row).toContain("3 commits · 5 files · +6 −2 ›")
      expect(row).not.toContain("long-file-name")
    })

    test("is hidden when there is nothing to compare or a pull request already exists, and creating stays possible with conflicts", async () => {
      let checks = 0
      const checkMerge = async () => {
        checks++
        return { status: "conflicts", files: ["a.ts"] } as MergeCheck
      }
      for (const compare of [
        async () => comparison(0),
        async () => ({
          ...comparison(2),
          existing: { number: 12, title: "T", state: "open" as const, author: "a", createdAt: "2026-01-01T00:00:00Z", merged: false },
        }),
      ]) {
        const { view } = await render({ localBranch: "next", compare, checkMerge })
        await open(view)
        expect(merge(view)).toBeUndefined()
        view.renderer.destroy()
      }
      expect(checks).toBe(0)
      const created: NewPull[] = []
      const { view } = await render({
        localBranch: "next",
        width: 150,
        checkMerge,
        create: async (pull) => {
          created.push(pull)
          return { number: 1 } as PullRequestDetail
        },
      })
      await open(view)
      expect(frame(view)).toContain("conflicts in a.ts")
      view.mockInput.pressKey("s", { ctrl: true })
      await view.flush()
      view.mockInput.pressEnter()
      await settle(view)
      expect(created).toHaveLength(1)
    })

    test("shows the latest result when branches change before an earlier check finishes", async () => {
      let finishFirst: (value: MergeCheck) => void = () => {}
      const { view } = await render({
        localBranch: "next",
        checkMerge: (base) =>
          base === "main"
            ? new Promise((resolve) => {
                finishFirst = resolve
              })
            : Promise.resolve({ status: "clean" }),
      })
      await open(view)
      expect(frame(view)).not.toContain("Able to merge")
      await branches(view)
      view.mockInput.pressArrow("left")
      view.mockInput.pressEnter()
      await settle(view)
      await pick(view, "next")
      expect(frame(view)).toContain("✓ Able to merge")
      finishFirst({ status: "conflicts", files: ["late.ts"] })
      await settle(view)
      expect(frame(view)).toContain("✓ Able to merge")
      expect(frame(view)).not.toContain("late.ts")
    })
  })

  describe("comparison diff", () => {
    async function renderWithDiff() {
      const loaded: DiffTarget[] = []
      const closed: DiffTarget[] = []
      const [diffs, setDiffs] = createSignal<Partial<Record<DiffTarget["kind"], DiffState>>>({})
      const view = await createTestRenderer({ width: 100, height: 30 })
      initializeHunk(view.renderer)
      await mount(
        () => (
          <App
            data={structuredClone(githubDataFixture)}
            operations={repositoryOperationsFixture}
            initialPage="pulls"
            config={{ ...defaultConfig, iconStyle: "unicode", showStatusBarHints: true }}
            localRepository={{ directory: "/tmp/opengh", repository }}
            onLoadLocalBranch={async () => "next"}
            onComparePull={async () => comparison(1, 1)}
            diffs={diffs()}
            onLoadDiff={async (target) => {
              loaded.push(target)
              setDiffs((current) => ({
                ...current,
                [target.kind]: { target, resource: { status: "ready", value: { kind: "patch", patch: patchFixture } } },
              }))
            }}
            onCloseDiff={(target) => {
              if (target) closed.push(target)
            }}
          />
        ),
        view.renderer,
      )
      active.push(view)
      await view.flush()
      return { view, loaded, closed }
    }
    const typeTitle = async (view: View) => {
      await toTitle(view)
      view.mockInput.pressKey("a", { ctrl: true })
      view.mockInput.pressKey("k", { ctrl: true })
      await view.mockInput.typeText("Kept title")
      await view.flush()
    }

    test("enter on the summary opens the comparison diff, and esc returns to the box as it was", async () => {
      const { view, loaded, closed } = await renderWithDiff()
      await open(view)
      await typeTitle(view)
      await branches(view)
      view.mockInput.pressTab()
      await view.flush()
      view.mockInput.pressEnter()
      await settle(view)
      expect(box(view)).toBeUndefined()
      expect(loaded).toEqual([{ kind: "compare", base: "main", head: "next" }])
      expect(frame(view)).toContain("example.ts")
      view.mockInput.pressEscape()
      await settle(view)
      expect(closed).toEqual([{ kind: "compare", base: "main", head: "next" }])
      expect(box(view)).toBeDefined()
      expect(frame(view)).toContain("main ← next")
      expect(statusLine(view)).toContain("enter view diff")
      expect((view.renderer.root.findDescendantById("new-pull-title") as unknown as { value: string }).value).toBe("Kept title")
    })

    test("D on the branch row opens it too, but not while typing", async () => {
      const { view, loaded } = await renderWithDiff()
      await open(view)
      await toTitle(view)
      view.mockInput.pressKey("D")
      await settle(view)
      expect(loaded).toEqual([])
      expect((view.renderer.root.findDescendantById("new-pull-title") as unknown as { value: string }).value).toContain("D")
      await branches(view)
      view.mockInput.pressKey("D")
      await settle(view)
      expect(loaded).toEqual([{ kind: "compare", base: "main", head: "next" }])
    })

    test("the summary is not selectable when there is nothing to compare", async () => {
      const { view } = await render({ localBranch: "next", compare: async () => comparison(0) })
      await open(view)
      await branches(view)
      view.mockInput.pressTab()
      await view.flush()
      expect(statusLine(view)).not.toContain("view diff")
      expect(frame(view)).not.toContain("›")
    })
  })

  describe("forks", () => {
    const browsed: PullRepository = {
      id: githubDataFixture.repo.id,
      nodeId: githubDataFixture.repo.nodeId,
      nameWithOwner: repository,
      defaultBranch: "main",
    }
    const fork: PullRepository = { id: 9001, nodeId: "R_fork", nameWithOwner: "you/opentui", defaultBranch: "main" }
    const upstream: PullRepository = { id: 9002, nodeId: "R_upstream", nameWithOwner: "upstream/opentui", defaultBranch: "dev" }

    test("picks the head repository first, then a branch from it, and compares owner:branch", async () => {
      const compared: Array<[number, string, string]> = []
      const { view } = await render({
        localBranch: "next",
        width: 150,
        repositories: { bases: [browsed], heads: [browsed, fork] },
        branchesOf: (target) => (target.id === fork.id ? ["topic", "main"] : []),
        compareIn: (target, base, head) => compared.push([target.id, base, head]),
      })
      await open(view)
      view.mockInput.pressEnter()
      await settle(view)
      expect(frame(view)).toContain("Choose head repository")
      expect(frame(view)).toContain("you/opentui")
      await pick(view, "you/")
      expect(frame(view)).toContain("Choose head branch · you/opentui")
      await pick(view, "topic")
      expect(frame(view)).toContain("main ← you:topic")
      expect(compared.at(-1)).toEqual([browsed.id, "main", "you:topic"])
      expect(frame(view)).toContain("Merge check unavailable — not checked across repositories yet")
    })

    test("picks a base repository, and creates the pull request there with an owner:branch head", async () => {
      const created: Array<[number, NewPull]> = []
      const { view } = await render({
        localBranch: "next",
        width: 150,
        repositories: { bases: [upstream, browsed], heads: [browsed, upstream] },
        branchesOf: (target) => (target.id === upstream.id ? ["dev", "main"] : []),
        create: async () => ({ number: 5 }) as PullRequestDetail,
        createIn: (target, pull) => created.push([target.id, pull]),
      })
      await open(view)
      view.mockInput.pressArrow("left")
      view.mockInput.pressEnter()
      await settle(view)
      expect(frame(view)).toContain("Choose base repository")
      await pick(view, "upstream")
      await pick(view, "dev")
      const owner = repository.split("/")[0]
      expect(frame(view)).toContain("upstream:dev ← next")
      view.mockInput.pressKey("s", { ctrl: true })
      await view.flush()
      expect(frame(view)).toContain(`Create pull request in upstream/opentui: dev ← ${owner}:next?`)
      view.mockInput.pressEnter()
      await settle(view)
      expect(created).toEqual([[upstream.id, { base: "dev", head: `${owner}:next`, title: "Next", body: "" }]])
    })

    test("esc in the repository or branch list keeps the current choice", async () => {
      const { view } = await render({
        localBranch: "next",
        repositories: { bases: [browsed], heads: [browsed, fork] },
        branchesOf: () => ["topic"],
      })
      await open(view)
      view.mockInput.pressEnter()
      await settle(view)
      view.mockInput.pressEscape()
      await settle(view)
      expect(frame(view)).toContain("main ← next")
      view.mockInput.pressEnter()
      await settle(view)
      await pick(view, "you/")
      view.mockInput.pressEscape()
      await settle(view)
      expect(frame(view)).toContain("main ← next")
    })

    test("when browsing a fork, the base starts on the original repository's default branch", async () => {
      const compared: Array<[number, string, string]> = []
      const { view } = await render({
        localBranch: "next",
        repositories: { bases: [upstream, browsed], heads: [browsed, upstream] },
        compareIn: (target, base, head) => compared.push([target.id, base, head]),
      })
      await open(view)
      const owner = repository.split("/")[0]
      expect(frame(view)).toContain("upstream:dev ← next")
      expect(compared.at(-1)).toEqual([upstream.id, "dev", `${owner}:next`])
    })

    test("keeps a base you chose before the repositories finished loading", async () => {
      let finish: (value: PullRepositories) => void = () => {}
      const { view } = await render({
        localBranch: "next",
        repositories: new Promise((resolve) => {
          finish = resolve
        }),
      })
      await open(view)
      view.mockInput.pressArrow("left")
      view.mockInput.pressEnter()
      await settle(view)
      await pick(view, "next")
      expect(frame(view)).toContain("next ← next")
      finish({ bases: [upstream, browsed], heads: [browsed, upstream] })
      await settle(view)
      expect(frame(view)).toContain("next ← next")
      expect(frame(view)).not.toContain("upstream:dev")
    })

    test("confirms with a message when the pull request is created in another repository", async () => {
      for (const [bases, shown] of [
        [[upstream, browsed], true],
        [[browsed], false],
      ] as const) {
        const { view } = await render({
          localBranch: "next",
          width: 150,
          repositories: { bases: [...bases], heads: [browsed] },
          create: async () => ({ number: 123 }) as PullRequestDetail,
        })
        await open(view)
        view.mockInput.pressKey("s", { ctrl: true })
        await view.flush()
        view.mockInput.pressEnter()
        await settle(view)
        expect(box(view)).toBeUndefined()
        if (shown) {
          expect(frame(view)).toContain("Pull request created")
          expect(frame(view)).toContain("upstream/opentui#123")
        } else expect(frame(view)).not.toContain("Pull request created")
        view.renderer.destroy()
      }
    })

    test("says when the pull request created in another repository is a draft", async () => {
      const { view } = await render({
        localBranch: "next",
        width: 150,
        repositories: { bases: [upstream, browsed], heads: [browsed] },
        create: async (pull) => ({ number: 124, draft: pull.draft === true }) as PullRequestDetail,
      })
      await open(view)
      view.mockInput.pressKey("s", { ctrl: true })
      await view.flush()
      view.mockInput.pressArrow("right")
      view.mockInput.pressEnter()
      await settle(view)
      expect(frame(view)).toContain("Draft pull request created")
      expect(frame(view)).toContain("#124")
    })

    test("skips the repository step when a side has only one repository", async () => {
      const { view } = await render({ localBranch: "next", repositories: { bases: [browsed], heads: [browsed] } })
      await open(view)
      view.mockInput.pressEnter()
      await settle(view)
      expect(frame(view)).not.toContain("Choose head repository")
      expect(frame(view)).toContain("Choose head branch")
    })
  })

  describe("templates", () => {
    const key = { repositoryId: githubDataFixture.repo.id, head: "next" }
    const single: PullBranchComparison = {
      comparison: {
        status: "ahead",
        aheadBy: 1,
        behindBy: 0,
        commits: 1,
        files: 1,
        additions: 6,
        deletions: 2,
        message: "Fix resize\n\nKeeps the sidebar open.",
      },
    }
    const several = [
      { filename: "pull_request_template.md", body: "Default" },
      { filename: "bug.md", body: "Bug fix" },
    ]

    test("fills in the only template after a single commit's body, without a list", async () => {
      const drafts = createComposeDrafts({ storage: false })
      const { view } = await render({
        localBranch: "next",
        drafts,
        compare: async () => single,
        templates: async () => [{ filename: "pull_request_template.md", body: "## Summary\r\n\r\n## Test plan\r\n" }],
      })
      await open(view)
      await settle(view)
      expect(frame(view)).not.toContain("Blank pull request")
      expect(box(view)).toBeDefined()
      expect(await drafts.load(key)).toEqual({ title: "Fix resize", body: "Keeps the sidebar open.\n\n## Summary\n\n## Test plan\n" })
    })

    test("with several commits, the description is just the template", async () => {
      const drafts = createComposeDrafts({ storage: false })
      const { view } = await render({
        localBranch: "next",
        drafts,
        templates: async () => [{ filename: "PULL_REQUEST_TEMPLATE.md", body: "## Summary\n" }],
      })
      await open(view)
      await settle(view)
      expect(await drafts.load(key)).toEqual({ title: "Next", body: "## Summary\n" })
    })

    test("lists several templates by file name with Blank pull request last, and fills in the one chosen", async () => {
      for (const [downs, body] of [
        [1, "Bug fix"],
        [2, ""],
      ] as const) {
        const drafts = createComposeDrafts({ storage: false })
        const { view } = await render({ localBranch: "next", drafts, templates: async () => several })
        await open(view)
        expect(box(view)).toBeUndefined()
        const rows = ["pull_request_template.md", "bug.md", "Blank pull request"].map((label) =>
          lines(view).findIndex((line) => line.includes(label)),
        )
        expect(rows.every((row, index) => row > 0 && (index === 0 || row > rows[index - 1]!))).toBe(true)
        for (let step = 0; step < downs; step++) view.mockInput.pressArrow("down")
        view.mockInput.pressEnter()
        await settle(view)
        await settle(view)
        expect(box(view)).toBeDefined()
        expect(await drafts.load(key)).toEqual({ title: "Next", body })
        view.renderer.destroy()
      }
    })

    test("an untouched template with Windows line endings still follows a new head branch", async () => {
      const drafts = createComposeDrafts({ storage: false })
      const { view } = await render({
        localBranch: "next",
        drafts,
        templates: async () => [{ filename: "pull_request_template.md", body: "## Summary\r\n" }],
      })
      await open(view)
      await settle(view)
      await branches(view)
      view.mockInput.pressEnter()
      await settle(view)
      await pick(view, "main")
      expect(await drafts.load({ ...key, head: "main" })).toEqual({ title: "Main", body: "## Summary\n" })
    })

    test("skips the list when a draft is saved for the branch", async () => {
      const drafts = createComposeDrafts({ storage: false })
      drafts.set(key, { title: "Saved", body: "Mine" })
      const { view } = await render({ localBranch: "next", drafts, templates: async () => several })
      await open(view)
      await settle(view)
      expect(frame(view)).not.toContain("Blank pull request")
      expect(box(view)).toBeDefined()
      expect((view.renderer.root.findDescendantById("new-pull-title") as unknown as { value: string }).value).toBe("Saved")
    })

    test("come from the base repository, the original when browsing a fork", async () => {
      const upstream: PullRepository = { id: 9002, nodeId: "R_upstream", nameWithOwner: "upstream/opentui", defaultBranch: "dev" }
      const browsed: PullRepository = {
        id: githubDataFixture.repo.id,
        nodeId: githubDataFixture.repo.nodeId,
        nameWithOwner: repository,
        defaultBranch: "main",
      }
      const requested: number[] = []
      const drafts = createComposeDrafts({ storage: false })
      const { view } = await render({
        localBranch: "next",
        drafts,
        repositories: { bases: [upstream, browsed], heads: [browsed, upstream] },
        templates: async (target) => {
          requested.push(target.id)
          return [{ filename: "pull_request_template.md", body: "Upstream template" }]
        },
      })
      await open(view)
      await settle(view)
      expect(requested).toEqual([upstream.id])
      const owner = repository.split("/")[0]
      expect(await drafts.load({ repositoryId: upstream.id, head: `${owner}:next` })).toEqual({ title: "Next", body: "Upstream template" })
    })

    test("opens without a template when templates can't be loaded", async () => {
      const drafts = createComposeDrafts({ storage: false })
      const { view } = await render({
        localBranch: "next",
        drafts,
        templates: async () => {
          throw new Error("Forbidden")
        },
      })
      await open(view)
      await settle(view)
      expect(box(view)).toBeDefined()
      expect(await drafts.load(key)).toEqual({ title: "Next", body: "" })
    })
  })
})
