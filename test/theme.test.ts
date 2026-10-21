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
  test("includes the OpenCode built-in themes and custom bundled themes", () => {
    expect(themeNames).toHaveLength(36)
    expect(themeNames).toContain("opengh")
    expect(themeNames).not.toContain("github-light")
    expect(themeNames).toContain("terminal-minimal")
    expect(themeNames).toContain("terminal-native")
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

  test("preserves the existing GitHub palette", () => {
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

  test("gives GitHub, opengh, and terminal themes distinct dark and light variants", () => {
    for (const name of ["github", "opengh", "terminal-minimal", "terminal-native"]) {
      expect(resolveTheme(name, "light").background).not.toBe(resolveTheme(name, "dark").background)
      expect(resolveTheme(name, "light").text).not.toBe(resolveTheme(name, "dark").text)
    }
    expect(isThemeName("github-light")).toBe(false)
  })

  test("uses neutral terminal UI with bright status colors and colored Markdown", () => {
    for (const [foreground, background] of [["#eeeeee", "#111111"], ["#111111", "#eeeeee"]]) {
      const mode = background === "#eeeeee" ? "light" : "dark"
      const theme = resolveTheme("terminal-minimal", mode, {
        defaultForeground: foreground!,
        defaultBackground: background!,
        palette: [null, "#cc3333", "#33aa55", "#ccaa33", "#5588ff", "#aa55cc", "#33aaaa", null, null, "#ff5555", "#55ff55"],
      })
      expect(theme.text).toBe(foreground!)
      expect(theme.background).toBe(background!)
      expect(theme.primary).toBe(foreground!)
      expect(theme.syntaxKeyword).toBe("#aa55cc")
      expect(theme.markdownHeading).toBe(foreground!)
      expect(theme.markdownLink).toBe("#5588ff")
      expect(theme.markdownCodeBlock).toBe("#33aa55")
      expect(theme.syntaxString).toBe("#33aa55")
      expect(theme.textMuted).not.toBe(foreground!)
      expect(theme.backgroundElement).not.toBe(background!)
      expect(theme.error).toBe(mode === "dark" ? "#ff5555" : "#cc3333")
      expect(theme.diffAdded).toBe("#33aa55")
      expect(theme.warning).toBe(foreground!)
      expect(appColors(theme)).toMatchObject({
        openState: mode === "dark" ? "#55ff55" : "#33aa55",
        closedState: mode === "dark" ? "#ff5555" : "#cc3333",
        purple: "#aa55cc",
      })
    }
    expect(resolveTheme("terminal-minimal", "dark", {
      defaultForeground: null, defaultBackground: null, palette: [],
    })).toEqual(resolveTheme("terminal-minimal"))
  })

  test("reverses detected terminal surfaces when forcing the opposite mode", () => {
    for (const name of ["terminal-minimal", "terminal-native"]) {
      const colors = { defaultForeground: "#eeeeee", defaultBackground: "#111111", palette: [] }
      // OpenTUI detects this mid-gray terminal as light; retain its native surfaces.
      expect(resolveTheme(name, "light", { ...colors, defaultForeground: "#111111", defaultBackground: "#909090" }))
        .toMatchObject({ text: "#111111", background: "#909090" })
      expect(resolveTheme(name, "light", colors)).toMatchObject({ text: "#111111", background: "#eeeeee" })
      expect(resolveTheme(name, "dark", { ...colors, defaultForeground: "#111111", defaultBackground: "#eeeeee" }))
        .toMatchObject({ text: "#eeeeee", background: "#111111" })
    }
  })

  test("uses contrasting fallback surfaces when terminal defaults are incomplete", () => {
    for (const name of ["terminal-minimal", "terminal-native"]) {
      for (const mode of ["dark", "light"] as const) {
        const palette = [null, null, null, null, null, "#aa55cc"]
        for (const defaults of [
          { defaultForeground: null, defaultBackground: mode === "light" ? "#000000" : "#ffffff" },
          { defaultForeground: mode === "light" ? "#ffffff" : "#000000", defaultBackground: null },
        ]) {
          expect(resolveTheme(name, mode, { ...defaults, palette })).toMatchObject({
            text: mode === "dark" ? "#c0c0c0" : "#1f2937",
            background: mode === "dark" ? "#000000" : "#ffffff",
            syntaxKeyword: "#aa55cc",
          })
        }
      }
    }
  })

  test("uses the full terminal palette for terminal-native", () => {
    const palette = ["#101010", "#cc3333", "#33aa55", "#ccaa33", "#5588ff", "#aa55cc", "#33aaaa"]
    const theme = resolveTheme("terminal-native", "dark", {
      defaultForeground: "#eeeeee", defaultBackground: "#111111", palette,
    })
    expect(theme.text).toBe("#eeeeee")
    expect(theme.background).toBe("#111111")
    expect(theme.primary).toBe(palette[4]!)
    expect(theme.accent).toBe(palette[6]!)
    expect(theme.warning).toBe(palette[3]!)
    expect(theme.markdownHeading).toBe(palette[4]!)
    expect(theme.syntaxKeyword).toBe(palette[5]!)
    expect(appColors(theme)).toMatchObject({
      openState: palette[2]!, closedState: palette[1]!, purple: palette[5]!,
    })
  })

  test("falls back safely for unknown theme names", () => {
    expect(isThemeName("unknown")).toBe(false)
    expect(resolveTheme("unknown")).toEqual(resolveTheme("opengh"))
  })
})
