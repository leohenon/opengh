import { afterEach, expect, test } from "bun:test"
import type { RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { normalizeCustomThemes, resolveTheme, themeNames, type CustomThemes } from "../src/theme"
import { initializeHunk } from "../src/ui/hunk-host"
import { hunkThemeColors } from "../src/ui/hunk-theme"
import { DiffScreen } from "../src/ui/pages/diff"
import { ThemeProvider } from "../src/ui/theme"

const active: Array<{ destroy(): void; isDestroyed: boolean }> = []
afterEach(() => {
  for (const renderer of active.splice(0)) if (!renderer.isDestroyed) renderer.destroy()
})

const patch = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 const context = 1
-const old = 2
+const changed = 2
+const added = 3
 const after = 4
`
const hex = (color: RGBA) =>
  `#${[color.r, color.g, color.b]
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`

async function backgrounds(name: string, mode: "dark" | "light", themes?: CustomThemes) {
  const setup = await createTestRenderer({ width: 120, height: 12 })
  active.push(setup.renderer)
  initializeHunk(setup.renderer)
  await render(
    () => (
      <ThemeProvider name={name} mode={mode} themes={themes}>
        <box width="100%" height="100%">
          <DiffScreen
            target={{ kind: "pull", number: 1 }}
            resource={{ status: "ready", value: { kind: "patch", patch } }}
            interactive
            showScrollbar={false}
            onLoadFiles={() => {}}
          />
        </box>
      </ThemeProvider>
    ),
    setup.renderer,
  )
  for (let pass = 0; pass < 6; pass++) {
    await Bun.sleep(30)
    await setup.flush()
    await setup.renderer.idle()
  }
  const lines = setup.captureSpans().lines
  const at = (text: string, column?: number) => {
    const line = lines.find((candidate) =>
      candidate.spans
        .map((span) => span.text)
        .join("")
        .includes(text),
    )!
    const target =
      column ??
      line.spans
        .map((span) => span.text)
        .join("")
        .indexOf(text)
    let start = 0
    for (const span of line.spans) {
      if (target < start + span.width) return hex(span.bg)
      start += span.width
    }
  }
  return { list: at("Files"), context: at("const context"), added: at("const added"), removed: at("const old") }
}

test("diffs use the app's canvas and the theme's own change colors, including themes Hunk has no match for", async () => {
  const theme = resolveTheme("carbonfox", "dark")
  const colors = await backgrounds("carbonfox", "dark")
  expect(colors.context).toBe(colors.list)
  expect(colors.context).toBe(theme.background)
  expect(colors.added).toBe(theme.diffAddedBg)
  expect(colors.removed).toBe(theme.diffRemovedBg)

  const light = await backgrounds("github", "light")
  expect(light.context).toBe(light.list)
  expect(light.added).toBe(resolveTheme("github", "light").diffAddedBg)
})

test("themes whose change colors cannot tell additions from removals keep Hunk's", async () => {
  const nord = await backgrounds("nord", "dark")
  expect(nord.context).toBe(nord.list)
  expect(nord.added).not.toBe(nord.removed)
  expect(nord.added).not.toBe(nord.context)
})

test("every bundled theme maps to opaque colors Hunk accepts", () => {
  for (const mode of ["dark", "light"] as const)
    for (const name of themeNames) {
      const colors = hunkThemeColors(resolveTheme(name, mode), "github-dark-default")
      if (!colors) continue
      const { id, base, ...slots } = colors
      expect(id).toStartWith("opengh-")
      expect(base).toBe("github-dark-default")
      for (const value of Object.values(slots)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
    }
  expect(hunkThemeColors(resolveTheme("cursor", "dark"), "github-dark-default")?.addedBg).toMatch(/^#[0-9a-f]{6}$/)
})

test("custom themes reach the diff through their own colors", async () => {
  const themes = normalizeCustomThemes({
    ocean: { base: "carbonfox", colors: { background: "#101820", diffAddedBg: "#113355", diffRemovedBg: "#553311" } },
  })
  const colors = await backgrounds("ocean", "dark", themes)
  expect(colors).toEqual({ list: "#101820", context: "#101820", added: "#113355", removed: "#553311" })
})
