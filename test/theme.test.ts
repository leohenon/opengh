import { describe, expect, test } from "bun:test"
import { appColors, isThemeName, resolveTheme, themeNames } from "../src/theme"

const required = [
  "primary",
  "secondary",
  "accent",
  "error",
  "warning",
  "success",
  "text",
  "textMuted",
  "background",
  "backgroundPanel",
  "backgroundElement",
  "border",
  "borderSubtle",
  "markdownText",
  "markdownHeading",
  "markdownLink",
  "markdownLinkText",
  "markdownCode",
  "markdownCodeBlock",
  "markdownBlockQuote",
  "markdownEmph",
  "markdownStrong",
  "markdownListItem",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
] as const

describe("themes", () => {
  test("includes the complete OpenCode built-in theme list", () => {
    expect(themeNames).toHaveLength(33)
    expect(themeNames).toContain("github")
    expect(themeNames).toContain("opencode")
    expect(themeNames).toContain("tokyonight")
  })

  test("resolves every built-in theme in dark and light modes", () => {
    for (const name of themeNames) {
      for (const mode of ["dark", "light"] as const) {
        const theme = resolveTheme(name, mode)
        for (const key of required) expect(theme[key], `${name}.${mode}.${key}`).toMatch(/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
        expect(appColors(theme).canvas).toBe(theme.background)
      }
    }
  })

  test("preserves the existing GitHub palette as the default", () => {
    const colors = appColors(resolveTheme("github"))
    expect(colors).toEqual({
      header: "#010409",
      canvas: "#0d1117",
      panel: "#161b22",
      panelHover: "#21262d",
      border: "#30363d",
      text: "#e6edf3",
      muted: "#8b949e",
      blue: "#58a6ff",
      salmon: "#f78166",
      green: "#3fb950",
      red: "#f85149",
      yellow: "#d29922",
      purple: "#a371f7",
      openState: "#3fb950",
      closedState: "#a371f7",
    })
    expect(resolveTheme("github")).toMatchObject({
      markdownText: "#e6edf3",
      markdownHeading: "#e6edf3",
      markdownCode: "#3fb950",
      markdownCodeBlock: "#3fb950",
      markdownEmph: "#e6edf3",
      markdownStrong: "#e6edf3",
      syntaxComment: "#8b949e",
      syntaxKeyword: "#a371f7",
      syntaxFunction: "#58a6ff",
      syntaxVariable: "#e6edf3",
      syntaxString: "#3fb950",
      syntaxNumber: "#d29922",
      syntaxType: "#d29922",
      syntaxOperator: "#8b949e",
      syntaxPunctuation: "#8b949e",
    })
  })

  test("keeps open and closed state colors distinct", () => {
    for (const name of themeNames) {
      const colors = appColors(resolveTheme(name))
      expect(colors.closedState, name).not.toBe(colors.openState)
    }
    expect(appColors(resolveTheme("vesper"))).toMatchObject({
      openState: "#99FFE4",
      closedState: "#FFC799",
    })
  })

  test("falls back safely for unknown theme names", () => {
    expect(isThemeName("unknown")).toBe(false)
    expect(resolveTheme("unknown")).toEqual(resolveTheme("github"))
  })
})
