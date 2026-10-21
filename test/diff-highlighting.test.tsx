import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import { DiffScreen } from "../src/ui/pages/diff"
import { initializeHunk } from "../src/ui/hunk-host"
import { ThemeProvider } from "../src/ui/theme"

const patch = `diff --git a/message.ts b/message.ts
--- a/message.ts
+++ b/message.ts
@@ -1 +1 @@
-const message = "old message"
+const message = "new message"
`

test("diff syntax colors load asynchronously, follow the theme, and retain plain-text fallback", async () => {
  const setup = await createTestRenderer({ width: 72, height: 18 })
  initializeHunk(setup.renderer)
  const [theme, setTheme] = createSignal("github")
  const [mode, setMode] = createSignal<"dark" | "light">("dark")
  const [content, setContent] = createSignal(patch)
  await render(() => <ThemeProvider name={theme()} mode={mode()}><box width="100%" height="100%">
    <DiffScreen target={{ kind: "commit", sha: "color-test" }}
      resource={{ status: "ready", value: { kind: "patch", patch: content() } }}
      interactive showScrollbar onLoadFiles={() => {}} />
  </box></ThemeProvider>, setup.renderer)
  const tokens = () => {
    const row = setup.captureSpans().lines.find((line) => line.spans.map((span) => span.text).join("").includes("new message"))
    const keyword = row?.spans.find((span) => span.text.includes("const"))?.fg
    const literal = row?.spans.find((span) => span.text.includes('"'))?.fg
    return keyword && literal ? { keyword, literal } : undefined
  }
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5_000
    while (!predicate() && Date.now() < deadline) {
      await Bun.sleep(20)
      await setup.flush()
    }
    expect(predicate()).toBe(true)
  }
  try {
    await setup.flush()
    // Source text is immediately usable while the highlighter is still loading.
    expect(setup.captureCharFrame()).toContain("new message")
    await waitFor(() => { const value = tokens(); return Boolean(value && !value.keyword.equals(value.literal)) })
    const firstKeyword = tokens()!.keyword.toInts()
    setTheme("dracula")
    await waitFor(() => {
      const value = tokens()
      return Boolean(value && !value.keyword.equals(value.literal)
        && JSON.stringify(value.keyword.toInts()) !== JSON.stringify(firstKeyword))
    })
    const lightBackground = () => {
      const row = setup.captureSpans().lines.find((line) => line.spans.map((span) => span.text).join("").includes("new message"))
      const rgb = row?.spans.find((span) => span.text.includes("const"))?.bg.toInts()
      return rgb ? (rgb[0]! * 299 + rgb[1]! * 587 + rgb[2]! * 114) / 1000 > 128 : undefined
    }
    for (const name of ["github", "opengh", "dracula"]) {
      setTheme(name)
      setMode("light")
      await waitFor(() => lightBackground() === true)
      setMode("dark")
      await waitFor(() => lightBackground() === false)
    }
    setContent(patch.replaceAll("message.ts", "message.unrecognized"))
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("new message")
    expect(setup.captureCharFrame()).not.toContain("Cannot render")
  } finally {
    setup.renderer.destroy()
    await setup.renderer.closed
  }
}, 10_000)
