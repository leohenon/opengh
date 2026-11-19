import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "../src/config"
import { keybindingContexts, resolveKeybindings } from "../src/keybindings"
import type { InputRenderable, TextareaRenderable } from "@opentui/core"
import type { IssueDetail, IssueTemplate } from "../src/models"
import { App } from "../src/ui/app"
import { draftEditorText as issueEditorText, parseDraftEditorText as parseIssueEditorText } from "../src/ui/components/compose-dialog"
import { githubDataFixture, repositoryOperationsFixture } from "./fixtures/github-data"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const view of active.splice(0)) if (!view.renderer.isDestroyed) view.renderer.destroy()
})

type View = Awaited<ReturnType<typeof testRender>>

const lines = (view: View) => view.captureCharFrame().split("\n")
const statusLine = (view: View) =>
  lines(view)
    .filter((line) => line.trim())
    .at(-1) ?? ""
const dialog = (view: View) => view.renderer.root.findDescendantById("new-issue-dialog")

async function render(
  page: "issues" | "pulls",
  config = { ...defaultConfig, iconStyle: "unicode" as const },
  onCreateIssue?: (title: string, body: string) => Promise<IssueDetail>,
  onLoadIssueTemplates?: () => Promise<IssueTemplate[]>,
) {
  const view = await testRender(
    () => (
      <App
        data={structuredClone(githubDataFixture)}
        operations={repositoryOperationsFixture}
        initialPage={page}
        config={config}
        onCreateIssue={onCreateIssue}
        onLoadIssueTemplates={onLoadIssueTemplates}
      />
    ),
    { width: 100, height: 30 },
  )
  active.push(view)
  await view.flush()
  return view
}

describe("new issue", () => {
  test("c is bound only on work lists", () => {
    expect(resolveKeybindings()["work.create"]).toEqual(["c"])
    expect(keybindingContexts.work).toContain("work.create")
    for (const context of ["issue", "pull", "commits"]) expect(keybindingContexts[context]).not.toContain("work.create")
  })

  test("c opens the new issue dialog on the issue list and Esc closes it", async () => {
    const view = await render("issues")
    view.mockInput.pressKey("c")
    await view.flush()
    expect(dialog(view)).toBeDefined()
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    expect(dialog(view)).toBeUndefined()
  })

  test("c does not open the new issue dialog on the pull request list", async () => {
    const view = await render("pulls")
    view.mockInput.pressKey("c")
    await view.flush()
    expect(dialog(view)).toBeUndefined()
  })

  test("status bar and help show c only on the issue list", async () => {
    const config = { ...defaultConfig, iconStyle: "unicode" as const, showStatusBarHints: true }
    const issues = await render("issues", config)
    expect(statusLine(issues)).toContain("c new issue")
    issues.mockInput.pressKey("?")
    await issues.flush()
    expect(issues.captureCharFrame()).toContain("new issue")
    const pulls = await render("pulls", config)
    expect(statusLine(pulls)).not.toContain("new issue")
  })

  test("right-click offers New issue on issue rows and list background", async () => {
    const view = await render("issues")
    const row = lines(view).findIndex((line) => line.includes("ScrollBox loses focus"))
    await view.mockMouse.click(10, row, 2)
    await view.flush()
    const item = lines(view).findIndex((line) => line.includes("New issue"))
    expect(item).toBeGreaterThanOrEqual(0)
    await view.mockMouse.click(lines(view)[item]!.indexOf("New issue"), item)
    await view.flush()
    expect(dialog(view)).toBeDefined()
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    await view.mockMouse.click(10, 26, 2)
    await view.flush()
    expect(view.captureCharFrame()).toContain("New issue")
  })

  test("right-click does not offer New issue on the pull request list", async () => {
    const view = await render("pulls")
    await view.mockMouse.click(10, 26, 2)
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("New issue")
  })

  test("Tab, Enter and ↓ move from the title to the description, Tab indents there, and ↑ on the first line returns", async () => {
    const view = await render("issues")
    view.mockInput.pressKey("c")
    await view.flush()
    const title = view.renderer.root.findDescendantById("new-issue-title") as InputRenderable
    const body = view.renderer.root.findDescendantById("new-issue-body") as TextareaRenderable
    expect(view.captureCharFrame()).toContain("New issue")
    expect(view.captureCharFrame()).not.toContain("New issue · anomalyco/opentui")
    expect(title.focused).toBe(true)
    await view.mockInput.typeText("Crash")
    view.mockInput.pressTab()
    await view.flush()
    expect(body.focused).toBe(true)
    await view.mockInput.typeText("- a")
    view.mockInput.pressEnter()
    view.mockInput.pressTab()
    await view.mockInput.typeText("- b")
    await view.flush()
    expect(body.plainText).toBe("- a\n  - b")
    view.mockInput.pressArrow("up")
    await view.flush()
    expect(body.focused).toBe(true)
    view.mockInput.pressArrow("up")
    await view.flush()
    expect(title.focused).toBe(true)
    expect(title.value).toBe("Crash")
    view.mockInput.pressEnter()
    await view.flush()
    expect(body.focused).toBe(true)
    view.mockInput.pressArrow("up")
    view.mockInput.pressArrow("up")
    await view.flush()
    expect(title.focused).toBe(true)
    view.mockInput.pressArrow("down")
    await view.flush()
    expect(body.focused).toBe(true)
  })

  test("hints show ↓ in the title and ↑ only on the first line of the description", async () => {
    const view = await render("issues", { ...defaultConfig, iconStyle: "unicode", showStatusBarHints: true })
    view.mockInput.pressKey("c")
    await Bun.sleep(10)
    await view.flush()
    expect(statusLine(view)).toContain("tab/↓ description")
    expect(statusLine(view)).not.toContain("↑ title")
    view.mockInput.pressTab()
    await view.flush()
    expect(statusLine(view)).toContain("↑ title")
    expect(statusLine(view)).not.toContain("description")
    view.mockInput.pressEnter()
    await view.flush()
    expect(statusLine(view)).not.toContain("↑ title")
    view.mockInput.pressArrow("up")
    await view.flush()
    expect(statusLine(view)).toContain("↑ title")
  })

  test("shows the cursor line and column for the active field, including after arrow keys", async () => {
    const view = await render("issues")
    view.mockInput.pressKey("c")
    await Bun.sleep(10)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Ln 1, Col 1")
    await view.mockInput.typeText("Crash")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Ln 1, Col 6")
    view.mockInput.pressTab()
    await view.mockInput.typeText("ab")
    view.mockInput.pressEnter()
    await view.mockInput.typeText("c")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Ln 2, Col 2")
    view.mockInput.pressArrow("up")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Ln 1, Col 2")
    view.mockInput.pressKey("p", { ctrl: true })
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Ln 1")
  })

  test("Ctrl+S asks to confirm, Enter creates the issue with the raw title and description, and the box closes", async () => {
    const calls: Array<[string, string]> = []
    const view = await render("issues", undefined, async (title, body) => {
      calls.push([title, body])
      return {} as IssueDetail
    })
    view.mockInput.pressKey("c")
    await view.flush()
    view.mockInput.pressKey("s", { ctrl: true })
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Create issue in")
    await view.mockInput.typeText(" Crash ")
    view.mockInput.pressTab()
    await view.mockInput.typeText("Steps")
    view.mockInput.pressKey("s", { ctrl: true })
    await view.flush()
    expect(view.captureCharFrame()).toContain("Create issue in anomalyco/opentui?")
    expect(view.captureCharFrame()).toContain("Confirm")
    expect(view.captureCharFrame()).not.toContain("Create as draft")
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    expect(view.captureCharFrame()).not.toContain("Create issue in")
    expect(dialog(view)).toBeDefined()
    view.mockInput.pressKey("s", { ctrl: true })
    await view.flush()
    view.mockInput.pressEnter()
    await view.flush()
    await Bun.sleep(10)
    await view.flush()
    expect(calls).toEqual([[" Crash ", "Steps"]])
    expect(dialog(view)).toBeUndefined()
  })

  test("shows Creating… while pending and keeps the text with the error when creation fails", async () => {
    let fail: (error: Error) => void = () => {}
    const view = await render(
      "issues",
      { ...defaultConfig, iconStyle: "unicode", showStatusBarHints: true },
      () =>
        new Promise<IssueDetail>((_, reject) => {
          fail = reject
        }),
    )
    view.mockInput.pressKey("c")
    await view.flush()
    await view.mockInput.typeText("Crash")
    view.mockInput.pressKey("s", { ctrl: true })
    await view.flush()
    view.mockInput.pressEnter()
    await view.flush()
    expect(statusLine(view)).toContain("Creating…")
    view.mockInput.pressEscape()
    await Bun.sleep(30)
    await view.flush()
    expect(dialog(view)).toBeDefined()
    fail(new Error("Couldn't confirm the issue was created. Check the issue list before trying again."))
    await Bun.sleep(10)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Couldn't confirm the issue was created.")
    const title = view.renderer.root.findDescendantById("new-issue-title") as InputRenderable
    expect(title.value).toBe("Crash")
    expect(title.focused).toBe(true)
  })

  test("Esc keeps the draft, c reopens it, Ctrl+D clears the entire draft, and creating clears it", async () => {
    const view = await render("issues", undefined, async () => ({}) as IssueDetail)
    const fields = () => ({
      title: (view.renderer.root.findDescendantById("new-issue-title") as InputRenderable).value,
      body: (view.renderer.root.findDescendantById("new-issue-body") as TextareaRenderable).plainText,
    })
    const open = async () => {
      view.mockInput.pressKey("c")
      await Bun.sleep(10)
      await view.flush()
    }
    const close = async () => {
      view.mockInput.pressEscape()
      await Bun.sleep(30)
      await view.flush()
    }
    await open()
    await view.mockInput.typeText("Crash")
    view.mockInput.pressTab()
    await view.mockInput.typeText("Steps")
    await close()
    expect(dialog(view)).toBeUndefined()
    await open()
    expect(fields()).toEqual({ title: "Crash", body: "Steps" })

    view.mockInput.pressKey("d", { ctrl: true })
    await view.flush()
    expect(fields()).toEqual({ title: "", body: "" })
    expect((view.renderer.root.findDescendantById("new-issue-title") as InputRenderable).focused).toBe(true)
    await close()
    await open()
    expect(fields()).toEqual({ title: "", body: "" })

    await view.mockInput.typeText("Crash")
    view.mockInput.pressKey("s", { ctrl: true })
    await view.flush()
    view.mockInput.pressEnter()
    await Bun.sleep(10)
    await view.flush()
    expect(dialog(view)).toBeUndefined()
    await open()
    expect(fields()).toEqual({ title: "", body: "" })
  })

  test("Ctrl+P previews the rendered description and returns to writing", async () => {
    const view = await render("issues")
    view.mockInput.pressKey("c")
    await Bun.sleep(10)
    await view.flush()
    view.mockInput.pressTab()
    await view.mockInput.typeText("**Bold** text")
    view.mockInput.pressKey("p", { ctrl: true })
    await view.flush()
    const body = view.renderer.root.findDescendantById("new-issue-body") as TextareaRenderable
    expect(view.renderer.root.findDescendantById("new-issue-preview-scroll")).toBeDefined()
    expect(body.visible).toBe(false)
    for (let attempt = 0; attempt < 100 && !view.captureCharFrame().includes("Bold text"); attempt++) {
      await Bun.sleep(10)
      await view.flush()
    }
    expect(view.captureCharFrame()).toContain("Bold text")
    expect(view.captureCharFrame()).not.toContain("**Bold**")
    view.mockInput.pressKey("p", { ctrl: true })
    await view.flush()
    expect(view.renderer.root.findDescendantById("new-issue-preview-scroll")).toBeUndefined()
    expect(body.visible).toBe(true)
    expect(body.focused).toBe(true)
  })

  test("the external editor file labels the title and description and reads them back", () => {
    const labelled = "<!-- opengh: title -->\nCrash\n\n<!-- opengh: description -->\nSteps\n"
    expect(issueEditorText({ title: "Crash", body: "Steps\n" })).toBe(labelled)
    for (const draft of [
      { title: "Crash", body: "Steps\n" },
      { title: "", body: "<!-- Description -->\n<!-- keep -->\nBody" },
      { title: "Crash", body: "\nStarts with an empty line" },
      { title: " Crash ", body: "" },
      { title: "", body: "" },
    ])
      expect(parseIssueEditorText(issueEditorText(draft))).toEqual(draft)
    expect(parseIssueEditorText("<!-- opengh: title -->\r\n\r\nCrash\r\nMore\r\n<!-- opengh: description -->\r\nSteps\r\n")).toEqual({
      title: "Crash",
      body: "More\n\nSteps\r\n",
    })
    expect(parseIssueEditorText("<!-- opengh: title -->\nCrash\n\nSteps\n")).toEqual({ title: "Crash", body: "Steps\n" })
    expect(parseIssueEditorText("Crash\n\n<!-- opengh: description -->\nSteps\n")).toEqual({ title: "Crash", body: "Steps\n" })
    expect(parseIssueEditorText("Crash")).toEqual({ title: "Crash", body: "" })
    expect(parseIssueEditorText("Crash\n")).toEqual({ title: "Crash", body: "" })
    expect(parseIssueEditorText("Crash\nNo empty line")).toEqual({ title: "Crash", body: "No empty line" })
    expect(parseIssueEditorText("Crash\r\n\r\nSteps\r\n")).toEqual({ title: "Crash", body: "Steps\r\n" })
  })

  test("Ctrl+G edits the title and description in the external editor and saves them to the draft", async () => {
    const previous = process.env.VISUAL
    const view = await render("issues")
    const suspend = spyOn(view.renderer, "suspend").mockResolvedValue(undefined)
    const resume = spyOn(view.renderer, "resume").mockResolvedValue(undefined)
    try {
      view.mockInput.pressKey("c")
      await Bun.sleep(10)
      await view.flush()
      await view.mockInput.typeText("Crash")
      view.mockInput.pressTab()
      await view.mockInput.typeText("Steps")
      const seen = join(mkdtempSync(join(tmpdir(), "opengh-new-issue-editor-")), "seen.md")
      process.env.VISUAL = `tee ${seen} >/dev/null <`
      view.mockInput.pressKey("g", { ctrl: true })
      for (let attempt = 0; attempt < 100 && !existsSync(seen); attempt++) await Bun.sleep(10)
      await Bun.sleep(30)
      await view.flush()
      expect(readFileSync(seen, "utf8")).toBe("<!-- opengh: title -->\nCrash\n\n<!-- opengh: description -->\nSteps")
      rmSync(dirname(seen), { recursive: true, force: true })
      process.env.VISUAL =
        "printf '<!-- opengh: title -->\\nEdited title\\n\\n<!-- opengh: description -->\\n<!-- keep -->\\n## Steps\\n' >"
      view.mockInput.pressKey("g", { ctrl: true })
      const body = view.renderer.root.findDescendantById("new-issue-body") as TextareaRenderable
      for (let attempt = 0; attempt < 100 && body.plainText !== "<!-- keep -->\n## Steps\n"; attempt++) {
        await Bun.sleep(10)
        await view.flush()
      }
      expect(body.plainText).toBe("<!-- keep -->\n## Steps\n")
      expect(body.focused).toBe(true)
      expect(suspend).toHaveBeenCalledTimes(2)
      expect(resume).toHaveBeenCalledTimes(2)
      view.mockInput.pressEscape()
      await Bun.sleep(30)
      await view.flush()
      view.mockInput.pressKey("c")
      await Bun.sleep(10)
      await view.flush()
      expect((view.renderer.root.findDescendantById("new-issue-title") as InputRenderable).value).toBe("Edited title")
      expect((view.renderer.root.findDescendantById("new-issue-body") as TextareaRenderable).plainText).toBe("<!-- keep -->\n## Steps\n")
    } finally {
      suspend.mockRestore()
      resume.mockRestore()
      if (previous === undefined) delete process.env.VISUAL
      else process.env.VISUAL = previous
    }
  })

  describe("templates", () => {
    const bug: IssueTemplate = { name: "Bug report", about: "Report a bug", title: "[Bug] ", body: "### Steps\n" }
    const feature: IssueTemplate = { name: "Feature", about: "", title: "", body: "### Idea\n" }
    const fields = (view: View) => ({
      title: (view.renderer.root.findDescendantById("new-issue-title") as InputRenderable).value,
      body: (view.renderer.root.findDescendantById("new-issue-body") as TextareaRenderable).plainText,
    })
    const templateList = (view: View) => view.renderer.root.findDescendantById("new-issue-templates")
    const settle = async (view: View) => {
      await Bun.sleep(20)
      await view.flush()
    }

    test("c lists templates with Blank issue last, and choosing one fills the box and keeps it as the draft", async () => {
      let loads = 0
      const view = await render("issues", undefined, undefined, async () => {
        loads++
        return [bug, feature]
      })
      view.mockInput.pressKey("c")
      await settle(view)
      expect(templateList(view)).toBeDefined()
      const frame = view.captureCharFrame()
      expect(frame).toContain("Bug report")
      expect(frame).toContain("Report a bug")
      expect(frame.indexOf("Bug report")).toBeLessThan(frame.indexOf("Feature"))
      expect(frame.indexOf("Feature")).toBeLessThan(frame.indexOf("Blank issue"))
      view.mockInput.pressEnter()
      await settle(view)
      expect(templateList(view)).toBeUndefined()
      expect(fields(view)).toEqual({ title: "[Bug] ", body: "### Steps\n" })

      view.mockInput.pressEscape()
      await settle(view)
      view.mockInput.pressKey("c")
      await settle(view)
      expect(templateList(view)).toBeUndefined()
      expect(fields(view)).toEqual({ title: "[Bug] ", body: "### Steps\n" })

      view.mockInput.pressKey("d", { ctrl: true })
      view.mockInput.pressEscape()
      await settle(view)
      view.mockInput.pressKey("c")
      await settle(view)
      expect(templateList(view)).toBeDefined()
      view.mockInput.pressArrow("down")
      view.mockInput.pressArrow("down")
      view.mockInput.pressEnter()
      await settle(view)
      expect(fields(view)).toEqual({ title: "", body: "" })
      expect(loads).toBe(2)
    })

    test("Esc closes the template list", async () => {
      const view = await render("issues", undefined, undefined, async () => [bug])
      view.mockInput.pressKey("c")
      await settle(view)
      view.mockInput.pressEscape()
      await settle(view)
      expect(templateList(view)).toBeUndefined()
      expect(dialog(view)).toBeUndefined()
    })

    test("goes straight to the box when there are no templates or they fail to load", async () => {
      for (const load of [async () => [], async () => Promise.reject(new Error("Forbidden"))]) {
        const view = await render("issues", undefined, undefined, load)
        view.mockInput.pressKey("c")
        await settle(view)
        expect(templateList(view)).toBeUndefined()
        expect(dialog(view)).toBeDefined()
        expect(view.captureCharFrame()).not.toContain("Forbidden")
        view.renderer.destroy()
      }
    })
  })
})
