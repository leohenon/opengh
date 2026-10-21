import aura from "./assets/aura.json"
import ayu from "./assets/ayu.json"
import carbonfox from "./assets/carbonfox.json"
import catppuccinFrappe from "./assets/catppuccin-frappe.json"
import catppuccinMacchiato from "./assets/catppuccin-macchiato.json"
import catppuccin from "./assets/catppuccin.json"
import cobalt2 from "./assets/cobalt2.json"
import cursor from "./assets/cursor.json"
import dracula from "./assets/dracula.json"
import everforest from "./assets/everforest.json"
import flexoki from "./assets/flexoki.json"
import github from "./assets/github.json"
import gruvbox from "./assets/gruvbox.json"
import kanagawa from "./assets/kanagawa.json"
import lucentOrng from "./assets/lucent-orng.json"
import material from "./assets/material.json"
import matrix from "./assets/matrix.json"
import mercury from "./assets/mercury.json"
import monokai from "./assets/monokai.json"
import nightowl from "./assets/nightowl.json"
import nord from "./assets/nord.json"
import oneDark from "./assets/one-dark.json"
import opencode from "./assets/opencode.json"
import opengh from "./assets/opengh.json"
import orng from "./assets/orng.json"
import osakaJade from "./assets/osaka-jade.json"
import palenight from "./assets/palenight.json"
import rosepine from "./assets/rosepine.json"
import solarized from "./assets/solarized.json"
import synthwave84 from "./assets/synthwave84.json"
import terminal from "./assets/terminal-minimal.json"
import tokyonight from "./assets/tokyonight.json"
import vercel from "./assets/vercel.json"
import vesper from "./assets/vesper.json"
import zenburn from "./assets/zenburn.json"

type Mode = "dark" | "light"
type Variant = { dark: ThemeValue; light: ThemeValue }
type ThemeValue = string | number | Variant
export type ThemeJson = {
  defs?: Record<string, ThemeValue>
  theme: Record<string, ThemeValue>
}

export const themeNames = [
  "aura",
  "ayu",
  "carbonfox",
  "catppuccin",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "cobalt2",
  "cursor",
  "dracula",
  "everforest",
  "flexoki",
  "github",
  "gruvbox",
  "kanagawa",
  "lucent-orng",
  "material",
  "matrix",
  "mercury",
  "monokai",
  "nightowl",
  "nord",
  "one-dark",
  "opencode",
  "opengh",
  "orng",
  "osaka-jade",
  "palenight",
  "rosepine",
  "solarized",
  "synthwave84",
  "terminal-minimal",
  "terminal-native",
  "tokyonight",
  "vercel",
  "vesper",
  "zenburn",
] as const

export type ThemeName = typeof themeNames[number]

export const defaultTheme: ThemeName = "opengh"

const upstreamGitHub = github as ThemeJson
const githubDark = (key: string, dark: ThemeValue): ThemeValue => {
  const current = upstreamGitHub.theme[key]
  return typeof current === "object" ? { ...current, dark } : { dark, light: current }
}

const githubTheme: ThemeJson = {
  ...upstreamGitHub,
  defs: {
    ...upstreamGitHub.defs,
    darkFg: "#e6edf3",
    darkPink: "#f78166",
    darkPurple: "#a371f7",
  },
  theme: {
    ...upstreamGitHub.theme,
    accent: githubDark("accent", "darkPink"),
    warning: githubDark("warning", "darkOrange"),
    markdownHeading: githubDark("markdownHeading", "darkFg"),
    markdownLinkText: githubDark("markdownLinkText", "darkBlue"),
    markdownCode: githubDark("markdownCode", "darkGreen"),
    markdownCodeBlock: githubDark("markdownCodeBlock", "darkGreen"),
    markdownBlockQuote: githubDark("markdownBlockQuote", "darkFgMuted"),
    markdownEmph: githubDark("markdownEmph", "darkFg"),
    markdownStrong: githubDark("markdownStrong", "darkFg"),
    syntaxComment: githubDark("syntaxComment", "darkFgMuted"),
    syntaxKeyword: githubDark("syntaxKeyword", "darkPurple"),
    syntaxFunction: githubDark("syntaxFunction", "darkBlue"),
    syntaxVariable: githubDark("syntaxVariable", "darkFg"),
    syntaxString: githubDark("syntaxString", "darkGreen"),
    syntaxNumber: githubDark("syntaxNumber", "darkOrange"),
    syntaxType: githubDark("syntaxType", "darkOrange"),
    syntaxOperator: githubDark("syntaxOperator", "darkFgMuted"),
    syntaxPunctuation: githubDark("syntaxPunctuation", "darkFgMuted"),
  },
}

const terminalNativeTheme: ThemeJson = {
  ...terminal,
  theme: {
    ...terminal.theme,
    primary: 4,
    secondary: 5,
    accent: 6,
    error: 1,
    warning: 3,
    success: 2,
    info: 6,
    borderActive: 4,
    closedState: 1,
    markdownHeading: 4,
    syntaxVariable: 6,
    syntaxOperator: 5,
  },
}

const themes: Record<ThemeName, ThemeJson> = {
  aura: aura as ThemeJson,
  ayu: ayu as ThemeJson,
  carbonfox: carbonfox as ThemeJson,
  catppuccin: catppuccin as ThemeJson,
  "catppuccin-frappe": catppuccinFrappe as ThemeJson,
  "catppuccin-macchiato": catppuccinMacchiato as ThemeJson,
  cobalt2: cobalt2 as ThemeJson,
  cursor: cursor as ThemeJson,
  dracula: dracula as ThemeJson,
  everforest: everforest as ThemeJson,
  flexoki: flexoki as ThemeJson,
  github: githubTheme,
  gruvbox: gruvbox as ThemeJson,
  kanagawa: kanagawa as ThemeJson,
  "lucent-orng": lucentOrng as ThemeJson,
  material: material as ThemeJson,
  matrix: matrix as ThemeJson,
  mercury: mercury as ThemeJson,
  monokai: monokai as ThemeJson,
  nightowl: nightowl as ThemeJson,
  nord: nord as ThemeJson,
  "one-dark": oneDark as ThemeJson,
  opencode: opencode as ThemeJson,
  opengh: opengh as ThemeJson,
  orng: orng as ThemeJson,
  "osaka-jade": osakaJade as ThemeJson,
  palenight: palenight as ThemeJson,
  rosepine: rosepine as ThemeJson,
  solarized: solarized as ThemeJson,
  synthwave84: synthwave84 as ThemeJson,
  "terminal-minimal": terminal as ThemeJson,
  "terminal-native": terminalNativeTheme,
  tokyonight: tokyonight as ThemeJson,
  vercel: vercel as ThemeJson,
  vesper: vesper as ThemeJson,
  zenburn: zenburn as ThemeJson,
}

export type ResolvedTheme = Record<string, string> & {
  primary: string
  secondary: string
  accent: string
  error: string
  warning: string
  success: string
  info: string
  text: string
  textMuted: string
  background: string
  backgroundPanel: string
  backgroundElement: string
  backgroundMenu?: string
  border: string
  borderActive: string
  borderSubtle: string
}

export type AppColors = {
  header: string
  canvas: string
  panel: string
  panelHover: string
  border: string
  text: string
  muted: string
  blue: string
  salmon: string
  green: string
  red: string
  yellow: string
  purple: string
  openState: string
  closedState: string
}

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (themeNames as readonly string[]).includes(value)
}

function ansiColor(code: number) {
  const colors = [
    "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
    "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
  ]
  if (code < colors.length) return colors[code]!
  if (code < 232) {
    const index = code - 16
    const component = (value: number) => value === 0 ? 0 : value * 40 + 55
    const r = component(Math.floor(index / 36))
    const g = component(Math.floor(index / 6) % 6)
    const b = component(index % 6)
    return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`
  }
  const gray = Math.max(0, Math.min(255, (code - 232) * 10 + 8))
  const hex = gray.toString(16).padStart(2, "0")
  return `#${hex}${hex}${hex}`
}

export type TerminalThemeColors = {
  defaultForeground: string | null
  defaultBackground: string | null
  palette: (string | null)[]
}

function resolve(theme: ThemeJson, mode: Mode, palette?: (string | null)[]): ResolvedTheme {
  const resolveValue = (value: ThemeValue, chain: string[] = []): string => {
    if (typeof value === "number") return palette?.[value] ?? ansiColor(value)
    if (typeof value !== "string") return resolveValue(value[mode], chain)
    if (value === "transparent" || value === "none") return "#00000000"
    if (value.startsWith("#")) return value
    if (chain.includes(value)) throw new Error(`Circular theme reference: ${[...chain, value].join(" -> ")}`)
    const next = theme.defs?.[value] ?? theme.theme[value]
    if (next === undefined) throw new Error(`Theme color reference not found: ${value}`)
    return resolveValue(next, [...chain, value])
  }

  const result = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "thinkingOpacity")
      .map(([key, value]) => [key, resolveValue(value)]),
  ) as ResolvedTheme
  return result
}

function terminalTheme(theme: ThemeJson, mode: Mode, colors?: TerminalThemeColors): ThemeJson {
  // Partial defaults cannot form a reliable contrasting pair, especially after inversion.
  const detected = colors?.defaultForeground && colors.defaultBackground ? colors : undefined
  let foreground = detected?.defaultForeground ?? (mode === "dark" ? "#c0c0c0" : "#1f2937")
  let background = detected?.defaultBackground ?? (mode === "dark" ? "#000000" : "#ffffff")
  // Keep the terminal's colors, but reverse its surfaces when forcing the opposite mode.
  if (backgroundMode(background) !== mode) [foreground, background] = [background, foreground]
  const fg = rgb(foreground)!
  const bg = rgb(background)!
  const mix = (amount: number) => `#${bg.map((value, index) =>
    Math.round(value + (fg[index]! - value) * amount).toString(16).padStart(2, "0"),
  ).join("")}`
  return {
    ...theme,
    defs: { foreground, background, muted: mix(0.6), panel: mix(0.08), hover: mix(0.16), border: mix(0.35) },
  }
}

export function resolveTheme(name: string, mode: Mode = "dark", terminalColors?: TerminalThemeColors): ResolvedTheme {
  const selected = isThemeName(name) ? name : defaultTheme
  try {
    if (selected === "terminal-minimal" || selected === "terminal-native") {
      return resolve(terminalTheme(themes[selected], mode, terminalColors), mode, terminalColors?.palette)
    }
    return resolve(themes[selected], mode)
  } catch (error) {
    if (selected === defaultTheme) throw error
    return resolve(themes[defaultTheme], mode)
  }
}

function rgb(value: string) {
  const match = value.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (!match) return undefined
  const source = match[1]!
  const hex = source.length <= 4
    ? source.slice(0, 3).split("").map((part) => part + part).join("")
    : source.slice(0, 6)
  return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
}

function backgroundMode(background: string): Mode {
  const [r, g, b] = rgb(background)!
  // Match OpenTUI's terminal appearance detection.
  return (299 * r! + 587 * g! + 114 * b!) / 1000 > 128 ? "light" : "dark"
}

function colorDistance(left: string, right: string) {
  const a = rgb(left)
  const b = rgb(right)
  if (!a || !b) return left.toLowerCase() === right.toLowerCase() ? 0 : Number.POSITIVE_INFINITY
  return Math.sqrt(a.reduce((total, value, index) => total + (value - b[index]!) ** 2, 0))
}

function distinctStateColor(base: string, candidates: string[]) {
  return candidates.find((candidate) => colorDistance(base, candidate) >= 48) ?? candidates.at(-1) ?? base
}

export function appColors(theme: ResolvedTheme): AppColors {
  return {
    header: theme.backgroundPanel,
    canvas: theme.background,
    panel: theme.backgroundElement,
    panelHover: theme.backgroundMenu ?? theme.borderSubtle,
    border: theme.border,
    text: theme.text,
    muted: theme.textMuted,
    blue: theme.primary,
    salmon: theme.accent,
    green: theme.success,
    red: theme.error,
    yellow: theme.warning,
    purple: theme.secondary,
    openState: theme.success,
    closedState: theme.closedState ?? distinctStateColor(theme.success, [theme.secondary, theme.accent, theme.primary, theme.warning]),
  }
}
