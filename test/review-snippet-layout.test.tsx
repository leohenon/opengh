import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ReviewThread } from "../src/ui/components/pull-review-threads"
import { createReactiveMarkdownStyle } from "../src/ui/markdown-style"
import { useTheme } from "../src/ui/theme"

const code = 'const message = "' + "Long source text with spaces. ".repeat(10) + 'END"'
function Sample() {
  const { colors, theme } = useTheme()
  const style = createReactiveMarkdownStyle(colors, theme)
  return <box width="100%" flexDirection="row">
    <box id="thread-pane" flexGrow={1} flexBasis={0} minWidth={0}>
      <ReviewThread syntaxStyle={style()} backgroundColor={colors.panel} context={{ repositoryUrl: "https://github.com/o/r" }} thread={{
        kind: "review-thread", id: "long-line", path: "example.ts", line: 1, originalLine: 1, diffSide: "RIGHT", isResolved: false, isOutdated: false,
        comments: [{ id: "comment", author: "alice", authorAssociation: "MEMBER", body: "Comment below the code", createdAt: "2026-01-01", updatedAt: "2026-01-01",
          url: "https://github.com/o/r/pull/1", diffHunk: `@@ -0,0 +1,1 @@\n+${code}` }],
      }} />
    </box>
    <box id="sidebar" width={12} flexShrink={0}><text>SIDEBAR</text></box>
  </box>
}

test("timeline snippets wrap full source text within their card without overflowing the sidebar", async () => {
  const view = await testRender(() => <Sample />, { width: 90, height: 60 })
  try {
    for (const width of [90, 55]) {
      view.resize(width, 60)
      await view.flush()
      const codeBox = view.renderer.root.findDescendantById("review-code-long-line")!
      const sidebar = view.renderer.root.findDescendantById("sidebar")!
      const row = codeBox.getChildren()[0]!
      const text = row.getChildren().at(-1)!
      expect(text.height).toBeGreaterThan(1)
      expect(text.x + text.width).toBeLessThanOrEqual(codeBox.x + codeBox.width)
      expect(codeBox.x + codeBox.width).toBeLessThanOrEqual(sidebar.x)
      const frame = view.captureCharFrame().split("\n")
      const fragments = frame.slice(text.y, text.y + text.height).map(line => line.slice(text.x, text.x + text.width))
      const rendered = fragments.join("")
      expect(fragments.map(line => line.trim()).join(" ").replace(/\s+/g, " ")).toBe(code.replace(/\s+/g, " "))
      expect(rendered.replace(/\s/g, "")).toBe(code.replace(/\s/g, ""))
      for (const line of frame.slice(codeBox.y, codeBox.y + codeBox.height))
        expect(line.slice(codeBox.x + codeBox.width, sidebar.x).replace(/│/g, "").trim()).toBe("")
    }
  } finally { view.renderer.destroy() }
})
