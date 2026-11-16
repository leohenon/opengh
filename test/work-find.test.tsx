import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { defaultConfig } from "../src/config"
import { keybindingContexts, normalizeKeybindings, resolveKeybindings } from "../src/keybindings"
import type { RepositoryData } from "../src/repository-state"
import { App } from "../src/ui/app"
import { StatusBar } from "../src/ui/components/status-bar"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const view of active.splice(0)) if (!view.renderer.isDestroyed) view.renderer.destroy()
})

type View = Awaited<ReturnType<typeof testRender>>

async function escape(view: View) {
  view.mockInput.pressEscape()
  await Bun.sleep(30)
  await view.flush()
}

const lines = (view: View) => view.captureCharFrame().split("\n")
const statusLine = (view: View) =>
  lines(view)
    .filter((line) => line.trim())
    .at(-1) ?? ""
const findInput = (view: View) => view.renderer.root.findDescendantById("work-find-query")

async function renderFind(
  kind: "issues" | "pulls",
  options: { data?: RepositoryData; width?: number; height?: number; config?: typeof defaultConfig } = {},
) {
  const [data, setData] = createSignal<RepositoryData>(options.data ?? structuredClone(githubDataFixture))
  const changes: Array<[string, string]> = []
  const view = await testRender(
    () => (
      <App
        data={data}
        operations={repositoryOperationsFixture}
        initialPage={kind}
        config={options.config ?? { ...defaultConfig, iconStyle: "unicode" }}
        onWorkFindChange={(section, query) => {
          changes.push([section, query])
          setData((current) => ({ ...current, workFinds: { ...current.workFinds, [section]: query } }))
        }}
      />
    ),
    { width: options.width ?? 100, height: options.height ?? 30 },
  )
  active.push(view)
  await view.flush()
  return { view, changes, data, setData }
}

describe("work find", () => {
  test("F finds only on work lists and stays distinct from local search, page down, and diff file filtering", () => {
    const keys = resolveKeybindings()
    expect(keys["work.find"]).toEqual(["F"])
    expect(keys["search.start"]).toEqual(["/"])
    expect(keys["navigation.pageDown"]).toContain("f")
    expect(keys["diff.filterFiles"]).toEqual(["F"])
    expect(keybindingContexts.work).toContain("work.find")
    for (const context of ["issue", "pull", "commits", "diffBody", "diffFiles"])
      expect(keybindingContexts[context]).not.toContain("work.find")
    expect(() => normalizeKeybindings({ "work.find": ["f"] })).toThrow("navigation.pageDown")
    expect(() => normalizeKeybindings({ "work.find": ["/"] })).toThrow("search.start")
    expect(() => normalizeKeybindings({ "work.find": ["alt+f"] })).not.toThrow()
  })

  test.each(["issues", "pulls"] as const)("%s finds on submit, shows the query only in the status bar, and clears it", async (kind) => {
    const { view, changes, data } = await renderFind(kind)
    expect(view.renderer.root.findDescendantById(`work-find-${kind === "issues" ? "issue" : "pull"}`)).toBeUndefined()
    expect(view.captureCharFrame()).not.toContain("Filter")

    view.mockInput.pressKey("F")
    await view.flush()
    expect(findInput(view)).toBeDefined()
    expect(statusLine(view)).toContain("Find:")
    expect(statusLine(view)).not.toContain("open issues")
    expect(statusLine(view)).not.toContain("open pull requests")
    expect(statusLine(view)).toContain(kind === "issues" ? "label:bug author:@me assignee:@me" : "label:bug review-requested:@me -is:draft")
    expect(view.captureCharFrame()).toContain(githubDataFixture[kind].open.value!.items[0]!.title)
    expect(view.renderer.root.findDescendantById("work-find-cancel")).toBeUndefined()
    await view.mockInput.typeText("label:bug")
    await view.flush()
    expect(changes).toEqual([])
    view.mockInput.pressEnter()
    await view.flush()
    expect(changes).toEqual([[kind, "label:bug"]])
    expect(findInput(view)).toBeUndefined()
    expect(statusLine(view)).toContain("Find: label:bug")
    expect(lines(view).filter((line) => line.includes("label:bug"))).toHaveLength(1)
    expect(view.captureCharFrame()).toContain(`Open (${data()[kind].open.value!.items.length})`)

    view.mockInput.pressTab()
    await view.flush()
    view.mockInput.pressKey("F")
    await view.flush()
    expect(statusLine(view)).toContain("label:bug")
    await escape(view)
    view.mockInput.pressKey("F")
    await view.flush()
    await view.mockInput.typeText(" more")
    await escape(view)
    expect(findInput(view)).toBeUndefined()
    expect(changes).toHaveLength(1)
    expect(statusLine(view)).toContain("Find: label:bug")

    view.mockInput.pressKey("F")
    await view.flush()
    view.mockInput.pressKey("a", { ctrl: true })
    view.mockInput.pressKey("k", { ctrl: true })
    view.mockInput.pressEnter()
    await view.flush()
    expect(changes.at(-1)).toEqual([kind, ""])
    expect(view.captureCharFrame()).not.toContain("Find: label:bug")
  })

  test.each(["issues", "pulls"] as const)("%s Esc clears an active find after local search, and only then", async (kind) => {
    const { view, changes } = await renderFind(kind, {
      data: { ...structuredClone(githubDataFixture), workFinds: { issues: "label:bug", pulls: "label:bug" } },
    })
    expect(statusLine(view)).toContain("Find: label:bug")
    view.mockInput.pressKey("/")
    await view.mockInput.typeText("e")
    view.mockInput.pressEnter()
    await view.flush()
    await escape(view)
    expect(changes).toEqual([])
    expect(statusLine(view)).toContain("Find: label:bug")
    await escape(view)
    expect(changes).toEqual([[kind, ""]])
    expect(statusLine(view)).not.toContain("Find:")
    await escape(view)
    expect(changes).toHaveLength(1)
  })

  test("Esc on a detail page goes back without clearing the list's find", async () => {
    const changes: string[] = []
    let closed = 0
    const view = await testRender(
      () => (
        <App
          data={{ ...structuredClone(githubDataFixture), workFinds: { issues: "label:bug" } }}
          operations={repositoryOperationsFixture}
          initialPage="issues"
          onWorkFindChange={(_kind, query) => changes.push(query)}
          onCloseIssue={() => closed++}
        />
      ),
      { width: 100, height: 30 },
    )
    active.push(view)
    await view.flush()
    view.mockInput.pressEnter()
    await view.flush()
    expect(statusLine(view)).not.toContain("Find:")
    await escape(view)
    expect(changes).toEqual([])
    expect(statusLine(view)).toContain("Find: label:bug")
  })

  test("Esc does not clear a find or leave the repository while it is busy", async () => {
    const changes: string[] = []
    let returned = 0
    const view = await testRender(
      () => (
        <App
          data={{ ...structuredClone(githubDataFixture), workFinds: { issues: "label:bug" } }}
          operations={{ ...repositoryOperationsFixture, refresh: { status: "loading" } }}
          initialPage="issues"
          onWorkFindChange={(_kind, query) => changes.push(query)}
          onReturnToRepository={() => void returned++}
        />
      ),
      { width: 100, height: 30 },
    )
    active.push(view)
    await view.flush()
    await escape(view)
    expect(changes).toEqual([])
    expect(returned).toBe(0)
  })

  test("right-click offers Find on rows and list background", async () => {
    const { view } = await renderFind("issues")
    const row = lines(view).findIndex((line) => line.includes("ScrollBox loses focus"))
    await view.mockMouse.click(10, row, 2)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Find…")
    const item = lines(view).findIndex((line) => line.includes("Find…"))
    await view.mockMouse.click(lines(view)[item]!.indexOf("Find…"), item)
    await view.flush()
    expect(findInput(view)).toBeDefined()
    await escape(view)
    await view.mockMouse.click(10, 26, 2)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Find…")
  })

  test("local search does not submit a find, and find input does not trigger app shortcuts", async () => {
    let changes = 0
    let quit = 0
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          operations={repositoryOperationsFixture}
          initialPage="issues"
          onWorkFindChange={() => changes++}
          onQuit={() => quit++}
        />
      ),
      { width: 100, height: 30 },
    )
    active.push(view)
    await view.flush()
    view.mockInput.pressKey("/")
    await view.mockInput.typeText("resize")
    view.mockInput.pressEnter()
    await view.flush()
    expect(changes).toBe(0)
    expect(view.captureCharFrame()).toContain("accessible color themes")
    await escape(view)
    view.mockInput.pressKey("F")
    await view.flush()
    await view.mockInput.typeText("q / F")
    await view.flush()
    expect(view.captureCharFrame()).toContain("q / F")
    expect(quit).toBe(0)
    await escape(view)
    expect(changes).toBe(0)
    view.mockInput.pressEnter()
    await view.flush()
    view.mockInput.pressKey("F")
    await view.flush()
    expect(findInput(view)).toBeUndefined()
  })

  test("a remapped shortcut works and disabling it leaves right-click Find usable", async () => {
    const [disabled, setDisabled] = createSignal(false)
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          operations={repositoryOperationsFixture}
          config={{ ...defaultConfig, keybindings: { "work.find": disabled() ? [] : ["alt+f"] } }}
          initialPage="issues"
          onWorkFindChange={() => {}}
        />
      ),
      { width: 80, height: 24 },
    )
    active.push(view)
    await view.flush()
    view.mockInput.pressKey("F")
    await view.flush()
    expect(findInput(view)).toBeUndefined()
    view.mockInput.pressKey("f", { meta: true })
    await view.flush()
    expect(findInput(view)).toBeDefined()
    await escape(view)
    setDisabled(true)
    await view.flush()
    await view.mockMouse.click(10, 20, 2)
    await view.flush()
    const item = lines(view).findIndex((line) => line.includes("Find…"))
    await view.mockMouse.click(lines(view)[item]!.indexOf("Find…"), item)
    await view.flush()
    expect(findInput(view)).toBeDefined()
  })

  test.each(["issues", "pulls"] as const)("%s tabs show the search match count, capped at 1000+", async (kind) => {
    const fixture = structuredClone(githubDataFixture)
    const { view } = await renderFind(kind, {
      data: {
        ...fixture,
        workFinds: { [kind]: "label:bug" },
        [kind]: {
          open: { status: "ready", value: { ...fixture[kind].open.value!, hasMore: true, total: 87 } },
          closed: { status: "ready", value: { ...fixture[kind].closed.value!, hasMore: true, total: 4321 } },
        },
      },
    })
    expect(view.captureCharFrame()).toContain("Open (87)")
    expect(view.captureCharFrame()).toContain("Closed (1000+)")
  })

  test("empty results keep the status-bar query and issue/PR queries stay separate", async () => {
    const { view } = await renderFind("issues", {
      data: {
        ...structuredClone(githubDataFixture),
        workFinds: { issues: "label:bug", pulls: "author:@me" },
        issues: {
          open: { status: "ready", value: { items: [], page: 1, hasMore: false } },
          closed: { status: "ready", value: { items: [], page: 1, hasMore: false } },
        },
      },
    })
    expect(view.captureCharFrame()).toContain("No open issues found")
    expect(statusLine(view)).toContain("Find: label:bug")
    view.mockInput.pressKey("4")
    await view.flush()
    expect(statusLine(view)).toContain("Find: author:@me")
    view.mockInput.pressKey("F")
    await view.flush()
    expect(view.captureCharFrame()).toContain("author:@me")
    await escape(view)
    view.mockInput.pressKey("3")
    await view.flush()
    expect(statusLine(view)).toContain("Find: label:bug")
  })

  test("a busy repository keeps the prompt open without submitting, and Esc closes it", async () => {
    const changes: string[] = []
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          operations={{ ...repositoryOperationsFixture, refresh: { status: "loading" } }}
          initialPage="issues"
          onWorkFindChange={(_kind, query) => changes.push(query)}
        />
      ),
      { width: 100, height: 30 },
    )
    active.push(view)
    await view.flush()
    view.mockInput.pressKey("F")
    await view.flush()
    expect(statusLine(view)).toContain("repository busy")
    await view.mockInput.typeText("label:bug")
    view.mockInput.pressEnter()
    await view.flush()
    expect(changes).toEqual([])
    expect(findInput(view)).toBeDefined()
    await escape(view)
    expect(findInput(view)).toBeUndefined()
  })

  test("opening an issue or a menu closes the prompt", async () => {
    const { view, changes } = await renderFind("issues")
    view.mockInput.pressKey("F")
    await view.flush()
    const row = lines(view).findIndex((line) => line.includes("ScrollBox loses focus"))
    await view.mockMouse.click(10, row, 2)
    await view.flush()
    expect(findInput(view)).toBeUndefined()
    await escape(view)
    view.mockInput.pressKey("F")
    await view.flush()
    await view.mockMouse.click(10, row)
    await view.flush()
    expect(findInput(view)).toBeUndefined()
    expect(changes).toEqual([])
  })

  test("status hints keep main's error spacing and fit beside the find label", async () => {
    for (const [props, expected] of [
      [{ error: "boom" }, "× boom · aa"],
      [{ context: "Find: x" }, "Find: x · aa · bb"],
    ] as const) {
      const view = await testRender(() => <StatusBar {...props} hint="aa · bb" />, { width: 21, height: 1 })
      active.push(view)
      await view.flush()
      expect(view.captureCharFrame().trim()).toBe(expected)
    }
  })
})
