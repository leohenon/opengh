import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA, type BoxRenderable, type TextRenderable } from "@opentui/core"
import { createSignal, Show } from "solid-js"
import { App } from "../src/ui/app"
import { defaultConfig } from "../src/config"
import { appColors, resolveTheme } from "../src/theme"
import { ThemeProvider } from "../src/ui/theme"
import { ContextMenu } from "../src/ui/components/context-menu"
import { mouseClick } from "../src/ui/mouse"
import type { CommitDetailState, IssueActionState } from "../src/repository-state"
import type { CommandSpec, LocalRepository } from "../src/command-actions"
import { commitDetailFixture, githubDataFixture, issueDetailFixture, repositoryOperationsFixture } from "./fixtures/github-data"
import { clickControl } from "./fixtures/mouse"

test("context menu is mouse-only, has no initial selection, and keeps wheel and dismissal behavior", async () => {
  const [open, setOpen] = createSignal(true)
  let selected = ""
  let background = 0
  const view = await testRender(() => <box width="100%" height="100%" {...mouseClick(() => { background++ })}>
    <Show when={open()}><ContextMenu position={{ x: 27, y: 11 }} items={[
      { label: "Unavailable", disabled: true, run: () => {} }, { label: "Copy text", run: () => {} },
    ]} onClose={() => setOpen(false)} onSelect={(item) => { selected = item.label; setOpen(false) }} /></Show>
  </box>, { width: 28, height: 12 })
  try {
    await view.flush()
    const menu = view.renderer.root.findDescendantById("context-menu")!
    expect(view.captureCharFrame()).not.toMatch(/[┌┐└┘─│]/) // Match the app's borderless popup panels.
    expect(menu.x + menu.width).toBeLessThanOrEqual(28)
    expect(menu.y + menu.height).toBeLessThanOrEqual(12)
    const first = view.renderer.root.findDescendantById("context-menu-row-0") as BoxRenderable
    const second = view.renderer.root.findDescendantById("context-menu-row-1") as BoxRenderable
    expect(first.backgroundColor).toEqual(second.backgroundColor)
    await view.mockMouse.moveTo(second.x + 2, second.y)
    await view.flush()
    expect(first.backgroundColor).not.toEqual(second.backgroundColor)
    view.mockInput.pressArrow("up")
    view.mockInput.pressEnter()
    await view.flush()
    expect(selected).toBe("")
    expect(first.backgroundColor).toEqual(second.backgroundColor)
    await clickControl(view, "context-menu-row-0")
    expect(selected).toBe("")
    await view.mockMouse.pressDown(0, 0)
    await view.mockMouse.scroll(0, 0, "down")
    await view.mockMouse.release(0, 0)
    expect(open()).toBe(true)
    expect(background).toBe(0)
    view.mockInput.pressEnter()
    expect(selected).toBe("")
    view.resize(28, 1)
    await view.flush()
    view.mockInput.pressArrow("down")
    view.mockInput.pressEnter()
    await view.flush()
    expect(selected).toBe("")
    expect(view.captureCharFrame()).toContain("Unavailable")
    await view.mockMouse.scroll(menu.x + 2, menu.y, "down")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Copy text")
    await clickControl(view, "context-menu-row-1")
    expect(selected).toBe("Copy text")
    expect(open()).toBe(false)
    setOpen(true)
    await view.flush()
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    expect(open()).toBe(false)
    setOpen(true)
    await view.flush()
    await view.mockMouse.click(0, 0)
    expect(open()).toBe(false)
    expect(background).toBe(0)
  } finally { view.renderer.destroy() }
})

test("context menus are compact, highlight edge to edge, and separate Back without making the gap clickable", async () => {
  const [name, setName] = createSignal("opengh")
  const [items, setItems] = createSignal([
    { label: "React", run: () => {} }, { label: "Copy text", run: () => {} },
    { label: "Add comment", run: () => {} }, { label: "Back", run: () => {} },
  ])
  let selected = ""
  const view = await testRender(() => <ThemeProvider name={name()}>
    <ContextMenu position={{ x: 3, y: 2 }} items={items()}
      onClose={() => {}} onSelect={(item) => { selected = item.label }} />
  </ThemeProvider>, { width: 40, height: 14 })
  try {
    await view.flush()
    const menu = view.renderer.root.findDescendantById("context-menu") as BoxRenderable
    const row = (index: number) => view.renderer.root.findDescendantById(`context-menu-row-${index}`) as BoxRenderable
    const label = row(1).getChildren()[0] as TextRenderable
    const idle = row(1).backgroundColor
    expect(menu.width).toBe(Bun.stringWidth("Add comment") + 2)
    expect(menu.height).toBe(5)
    expect(row(0).y).toBe(menu.y)
    expect(row(1).x).toBe(menu.x)
    expect(row(1).width).toBe(menu.width)
    expect(label.x).toBe(menu.x + 1)
    expect(row(3).y).toBe(row(2).y + 2)
    expect(row(0).backgroundColor).toEqual(idle)
    expect(label.fg).toEqual(RGBA.fromHex(appColors(resolveTheme("opengh")).text))
    expect(idle).not.toEqual(RGBA.fromHex(appColors(resolveTheme("opengh")).panel))
    // The highlight includes both padding columns, not just the label.
    await view.mockMouse.moveTo(menu.x, row(1).y)
    await view.flush()
    expect(row(1).backgroundColor).not.toEqual(idle)
    expect(label.fg).toEqual(RGBA.fromHex(appColors(resolveTheme("opengh")).blue))
    expect(selected).toBe("")
    const gapY = row(2).y + 1
    expect(view.captureCharFrame().split("\n")[gapY]!.slice(menu.x, menu.x + menu.width).trim()).toBe("")
    await view.mockMouse.moveTo(menu.x + 1, gapY)
    await view.mockMouse.click(menu.x + 1, gapY)
    await view.flush()
    expect(selected).toBe("")
    expect(row(1).backgroundColor).toEqual(idle)
    await view.mockMouse.moveTo(menu.x + menu.width - 1, row(1).y)
    await view.flush()
    expect(row(1).backgroundColor).not.toEqual(idle)
    setName("opencode")
    await view.flush()
    expect(row(1).backgroundColor).toEqual(RGBA.fromHex(appColors(resolveTheme("opencode")).panelHover))
    expect(label.fg).toEqual(RGBA.fromHex(appColors(resolveTheme("opencode")).blue))
    await view.mockMouse.click(menu.x + menu.width - 1, row(1).y)
    expect(selected).toBe("Copy text")
    setItems([{ label: "Back", run: () => {} }])
    await view.flush()
    expect(menu.height).toBe(1)
    expect(row(0).y).toBe(menu.y)
    await clickControl(view, "context-menu-row-0")
    expect(selected).toBe("Back")
  } finally { view.renderer.destroy() }
})

test("context menus dismiss beyond a movement safe zone, not on keyboard or stationary layout updates", async () => {
  const [open, setOpen] = createSignal(true)
  const [position, setPosition] = createSignal({ x: 20, y: 8 })
  let closed = 0
  let activated = 0
  let background = 0
  const view = await testRender(() => <box width="100%" height="100%" {...mouseClick(() => { background++ })}>
    <Show when={open()}><ContextMenu position={position()} items={[
      { label: "Open", run: () => {} }, { label: "Copy URL", run: () => {} },
    ]} onClose={() => { closed++; setOpen(false) }} onSelect={() => { activated++ }} /></Show>
  </box>, { width: 80, height: 24 })
  try {
    await view.flush()
    const menu = view.renderer.root.findDescendantById("context-menu")!
    const x = menu.x + 1
    const nearBottom = menu.y + menu.height + 2
    for (const point of [
      { x, y: menu.y + 1 },
      { x: menu.x + menu.width + 5, y: menu.y + 1 },
      { x: menu.x - 6, y: menu.y + 1 },
      { x, y: menu.y - 3 },
      { x, y: nearBottom },
    ]) {
      await view.mockMouse.moveTo(point.x, point.y)
      await view.flush()
      expect(open()).toBe(true)
    }
    view.mockInput.pressArrow("down")
    setPosition({ x: 50, y: 12 }) // The menu moved away, not the pointer.
    await view.flush()
    expect(open()).toBe(true)
    await view.mockMouse.emitMouseEvent("move", x, nearBottom)
    await view.flush()
    expect(open()).toBe(true)
    await view.mockMouse.moveTo(x + 1, nearBottom)
    await view.flush()
    expect(open()).toBe(false)
    expect(closed).toBe(1)
    expect(activated).toBe(0)
    expect(background).toBe(0)
  } finally { view.renderer.destroy() }
})

test("row context menus use the clicked subject, preserve left clicks, and reject removed targets", async () => {
  const [data, setData] = createSignal(structuredClone(githubDataFixture))
  const copied: string[] = []
  const opened: Array<string | number | undefined> = []
  const loads: number[] = []
  const runLoads: number[] = []
  let commits = 0
  const view = await testRender(() => <App data={data} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: true }}
    onLoadCommit={async () => { commits++ }} onLoadIssue={async (number) => { loads.push(number) }}
    onLoadRun={async (id) => { runLoads.push(id) }}
    onCopyToClipboard={async (value) => { copied.push(value); return true }}
    onOpenInBrowser={async (target) => { opened.push(target) }}
  />, { width: 100, height: 30 })
  const point = (text: string) => {
    const rows = view.captureCharFrame().split("\n")
    const y = rows.findIndex((row) => row.includes(text))
    expect(y).toBeGreaterThanOrEqual(0)
    return { x: Bun.stringWidth(rows[y]!.slice(0, rows[y]!.indexOf(text))), y }
  }
  const right = async (text: string) => {
    await view.flush()
    const { x, y } = point(text)
    await view.mockMouse.click(x, y, 2)
    await view.flush()
  }
  try {
    await view.flush()
    view.mockInput.pressKey("2")
    await view.flush()
    expect(view.captureCharFrame()).toContain("↑/↓ select")
    const commit = githubDataFixture.commits.value!.items[1]!
    const { x, y } = point(commit.message)
    await view.mockMouse.drag(x, y, x + 3, y, 2)
    expect(view.renderer.root.findDescendantById("context-menu")).toBeUndefined()
    await right(commit.message)
    expect(commits).toBe(0)
    expect(view.captureCharFrame()).toContain("View diff")
    expect(view.captureCharFrame().split("\n").at(-2)?.trim()).toBe("")
    expect(view.captureCharFrame()).not.toContain("↑/↓ select")
    expect(view.captureCharFrame()).not.toContain("enter choose")
    expect(view.captureCharFrame()).not.toContain("esc close")
    for (const key of ["j", "o", "y"]) view.mockInput.pressKey(key)
    view.mockInput.pressEnter()
    await view.flush()
    expect(commits).toBe(0)
    expect(copied).toEqual([])
    expect(opened).toEqual([])
    expect(view.renderer.root.findDescendantById("context-menu")).toBeDefined()
    await clickControl(view, "context-menu-row-2")
    expect(copied).toEqual([commit.sha])
    await right(commit.message)
    await clickControl(view, "context-menu-row-3")
    expect(opened).toEqual([commit.sha])
    view.mockInput.pressKey("4")
    await view.flush()
    const pull = githubDataFixture.pulls.open.value!.items[1]!
    await right(pull.title)
    await clickControl(view, "context-menu-row-2")
    expect(copied.at(-1)).toBe(`https://github.com/anomalyco/opentui/pull/${pull.number}`)
    view.mockInput.pressKey("5")
    await view.flush()
    const run = githubDataFixture.runs.value!.items[1]!
    await right(run.title)
    expect(runLoads).toEqual([])
    expect(view.captureCharFrame()).not.toContain("View diff")
    expect(view.renderer.root.findDescendantById("context-menu-row-3")).toBeUndefined()
    await clickControl(view, "context-menu-row-1")
    expect(copied.at(-1)).toBe(`https://github.com/anomalyco/opentui/actions/runs/${run.id}`)
    await right(run.title)
    await clickControl(view, "context-menu-row-2")
    expect(opened.at(-1)).toBe(`actions/runs/${run.id}`)
    await right(run.title)
    setData((current) => ({ ...current, runs: { status: "ready", value: { ...current.runs.value!, items: current.runs.value!.items.filter((item) => item.id !== run.id) } } }))
    await view.flush()
    expect(view.renderer.root.findDescendantById("context-menu")).toBeUndefined()
    expect(runLoads).toEqual([])
    setData(structuredClone(githubDataFixture))
    await right(run.title)
    await clickControl(view, "context-menu-row-0")
    expect(runLoads).toEqual([run.id])
    expect(view.renderer.root.findDescendantById("run-detail-scroll")).toBeDefined()
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    expect(view.captureCharFrame().split("\n").find((row) => row.includes("▌"))).toContain(run.title)
    view.mockInput.pressKey("3")
    await view.flush()
    const issue = githubDataFixture.issues.open.value!.items[0]!
    await right(issue.title)
    expect(view.captureCharFrame()).not.toContain("View diff")
    setData((current) => ({ ...current, issues: { ...current.issues, open: { status: "ready", value: { items: [], page: 1, hasMore: false } } } }))
    await view.flush()
    expect(view.renderer.root.findDescendantById("context-menu")).toBeUndefined()
    expect(loads).toEqual([])
    setData(structuredClone(githubDataFixture))
    await right(issue.title)
    await clickControl(view, "context-menu-row-0")
    expect(loads).toEqual([issue.number])
    expect(view.renderer.root.findDescendantById("context-menu")).toBeUndefined()
    expect(view.renderer.root.findDescendantById("page-actions")).toBeUndefined()
  } finally { view.renderer.destroy() }
})


test("repository documents and detail backgrounds expose context menus while existing popups stay isolated", async () => {
  const copied: string[] = []
  const [detail, setDetail] = createSignal<CommitDetailState>()
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    commitDetail={detail()} onLoadCommit={async (sha) => { setDetail({ sha, resource: { status: "ready", value: { ...commitDetailFixture, sha } } }) }}
    onCopyToClipboard={async (value) => { copied.push(value); return true }}
    onOpenInBrowser={async () => {}} />, { width: 110, height: 32 })
  try {
    await view.flush()
    const document = view.renderer.root.findDescendantById("overview-document-scroll")!
    await view.mockMouse.click(document.x + 3, document.y + 2, 2)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Copy repository URL")
    await clickControl(view, "context-menu-row-1")
    expect(copied).toEqual([githubDataFixture.repo.url])
    view.mockInput.pressKey("2")
    view.mockInput.pressEnter()
    await view.flush()
    const commit = view.renderer.root.findDescendantById("commit-detail-scroll")!
    await view.mockMouse.click(commit.x + 3, commit.y + 2, 2)
    await view.flush()
    expect(view.captureCharFrame()).toContain("View diff")
    expect(view.captureCharFrame()).toContain("Copy SHA")
    expect(view.captureCharFrame()).toContain("Open on GitHub")
    expect((view.renderer.root.findDescendantById("context-menu-row-3")!.getChildren()[0] as TextRenderable).plainText).toBe("Back")
    expect(view.renderer.root.findDescendantById("context-menu-row-4")).toBeUndefined()
    await clickControl(view, "context-menu-row-2")
    expect(copied.at(-1)).toBe(commitDetailFixture.sha)
    view.mockInput.pressKey("?")
    await view.flush()
    await view.mockMouse.click(0, 0, 2)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Help")
    expect(view.renderer.root.findDescendantById("context-menu")).toBeUndefined()
    expect(detail()?.sha).toBe(commitDetailFixture.sha)
    expect(view.renderer.root.findDescendantById("commit-detail-scroll")).toBe(commit)
  } finally { view.renderer.destroy() }
})


test("repository context Clone previews before running and follows local-repository and command guards", async () => {
  const [local, setLocal] = createSignal<LocalRepository>()
  const [cwd, setCwd] = createSignal<string | undefined>("/tmp")
  const [runner, setRunner] = createSignal(true)
  const commands: CommandSpec[] = []
  const run = async (spec: CommandSpec) => {
    commands.push(spec)
    return { cancel: () => {}, result: Promise.resolve({ exitCode: 0, cancelled: false }) }
  }
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    cwd={cwd()} localRepository={local()} onRunCommand={runner() ? run : undefined} />,
  { width: 100, height: 32 })
  const right = async () => {
    await view.flush()
    const document = view.renderer.root.findDescendantById("overview-document-scroll")!
    await view.mockMouse.click(document.x + 3, document.y + 2, 2)
    await view.flush()
  }
  const dismiss = async () => { await view.mockMouse.click(0, 0); await view.flush() }
  try {
    await right()
    expect(view.captureCharFrame()).toContain("Clone repository")
    expect(commands).toEqual([])
    await clickControl(view, "context-menu-row-2")
    expect(view.renderer.root.findDescendantById("context-menu")).toBeUndefined()
    expect(view.captureCharFrame()).toContain(`Clone ${githubDataFixture.repo.nameWithOwner}?`)
    expect(commands).toEqual([])
    await dismiss()
    expect(view.renderer.root.findDescendantById("command-confirm")).toBeUndefined()
    expect(commands).toEqual([])
    await right()
    await clickControl(view, "context-menu-row-2")
    await clickControl(view, "command-confirm")
    expect(commands).toEqual([{
      args: ["gh", "repo", "clone", `github.com/${githubDataFixture.repo.nameWithOwner}`, "/tmp/opentui", "--", "--progress"], cwd: "/tmp",
    }])
    await dismiss()
    await right()
    setLocal({ directory: "/tmp/opentui", repository: githubDataFixture.repo.nameWithOwner.toUpperCase() })
    await view.flush()
    await clickControl(view, "context-menu-row-2") // Eligibility can disappear while the menu is open.
    expect(view.renderer.root.findDescendantById("context-menu")).toBeDefined()
    expect(view.renderer.root.findDescendantById("command-confirm")).toBeUndefined()
    expect(commands).toHaveLength(1)
    await dismiss()
    await right()
    expect(view.captureCharFrame()).not.toContain("Clone repository")
    await dismiss()
    setLocal(undefined)
    setRunner(false)
    await right()
    expect(view.captureCharFrame()).not.toContain("Clone repository")
    await dismiss()
    setRunner(true)
    setCwd(undefined)
    await right()
    expect(view.captureCharFrame()).not.toContain("Clone repository")
    expect(commands).toHaveLength(1)
  } finally { view.renderer.destroy() }
})

test("message comment actions follow permission/pending guards and reopen the existing retained draft", async () => {
  const [allowed, setAllowed] = createSignal(false)
  const [action, setAction] = createSignal<IssueActionState>({ body: "Retained draft", reason: "completed", operation: { status: "idle" } })
  const prepared: Array<{ number: number; kind: string }> = []
  let submitted = 0
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    issueDetail={{ number: issueDetailFixture.number,
      resource: { status: "ready", value: { ...issueDetailFixture, body: "Description.", nodeId: "I_412", canReact: true, permissions: { ...issueDetailFixture.permissions!, comment: allowed() } } },
      comments: { status: "ready", value: { items: [], page: 1, hasMore: false } }, references: { status: "ready", value: [] } }}
    getIssueAction={() => action()} onPrepareIssueAction={(number, kind) => { prepared.push({ number, kind }) }}
    onIssueDraftChange={(_number, draft) => setAction((current) => ({ ...current, ...draft }))}
    onSubmitIssueAction={async () => { submitted++; return {} }}
    getReactionAction={() => ({ operation: { status: "idle" } })}
    onAddReaction={async () => { throw new Error("Unexpected reaction") }}
  />, { width: 100, height: 32 })
  const right = async (id: string) => {
    await view.flush()
    const target = view.renderer.root.findDescendantById(id)!
    await view.mockMouse.click(target.x + 1, target.y + 1, 2)
    await view.flush()
  }
  const escape = async () => { view.mockInput.pressEscape(); await Bun.sleep(30); await view.flush() }
  try {
    await view.flush()
    view.mockInput.pressKey("3")
    view.mockInput.pressEnter()
    await view.flush()
    await right("issue-detail-scroll")
    expect(view.captureCharFrame()).not.toContain("Add comment")
    await escape()
    setAllowed(true)
    setAction((current) => ({ ...current, operation: { status: "loading" } }))
    await right("issue-detail-description")
    expect(view.captureCharFrame()).not.toContain("Add comment")
    await escape()
    setAction((current) => ({ ...current, operation: { status: "idle" } }))
    await right("issue-detail-description")
    expect(view.captureCharFrame()).toContain("Add comment")
    expect((view.renderer.root.findDescendantById("context-menu-row-3")!.getChildren()[0] as TextRenderable).plainText).toBe("Back")
    setAllowed(false) // Permission can disappear after the menu was opened.
    await clickControl(view, "context-menu-row-2")
    expect(prepared).toEqual([])
    expect(view.renderer.root.findDescendantById("issue-action-submit")).toBeUndefined()
    await escape()
    setAllowed(true)
    await right("issue-detail-scroll")
    expect(view.captureCharFrame()).toContain("Add comment")
    expect((view.renderer.root.findDescendantById("context-menu-row-3")!.getChildren()[0] as TextRenderable).plainText).toBe("Back")
    expect(view.renderer.root.findDescendantById("context-menu-row-4")).toBeUndefined()
    await clickControl(view, "context-menu-row-2")
    expect(prepared).toEqual([{ number: 412, kind: "comment" }])
    expect(view.captureCharFrame()).toContain("Retained draft")
    expect(view.renderer.root.findDescendantById("context-menu")).toBeUndefined()
    expect(submitted).toBe(0)
    await view.mockMouse.click(0, 0)
    await view.flush()
    await right("issue-detail-description")
    await clickControl(view, "context-menu-row-2")
    expect(prepared).toHaveLength(2)
    expect(view.captureCharFrame()).toContain("Retained draft")
    expect(action().body).toBe("Retained draft")
    expect(submitted).toBe(0)
  } finally { view.renderer.destroy() }
})
