import type { HunkDiffCustomTheme, HunkDiffCustomThemeColorKey, HunkDiffThemeName } from "hunkdiff/opentui"
import type { ResolvedTheme } from "../theme"

type Rgb = [number, number, number]

function parse(value: string | undefined): { rgb: Rgb; alpha: number } | undefined {
  const hex = value?.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1]
  if (!hex) return undefined
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex
  const channel = (index: number) => parseInt(full.slice(index * 2, index * 2 + 2), 16)
  return { rgb: [channel(0), channel(1), channel(2)], alpha: full.length === 8 ? channel(3) / 255 : 1 }
}

function format(rgb: Rgb) {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`
}

function opaque(value: string | undefined, canvas?: Rgb) {
  const color = parse(value)
  if (!color || color.alpha === 0) return undefined
  if (color.alpha === 1) return format(color.rgb)
  if (!canvas) return undefined
  return format(color.rgb.map((channel, index) => channel * color.alpha + canvas[index]! * (1 - color.alpha)) as Rgb)
}

export function hunkThemeColors(theme: ResolvedTheme, base: HunkDiffThemeName): HunkDiffCustomTheme | undefined {
  const canvas = opaque(theme.background)
  if (!canvas) return undefined
  const backdrop = parse(canvas)!.rgb
  const color = (token: string) => opaque(theme[token], backdrop)
  const colors: Partial<Record<HunkDiffCustomThemeColorKey, string | undefined>> = {
    background: canvas,
    panel: canvas,
    contextBg: canvas,
    contextContentBg: canvas,
    lineNumberBg: canvas,
    panelAlt: color("backgroundElement"),
    border: color("border"),
    text: color("text"),
    muted: color("textMuted"),
    lineNumberFg: color("diffLineNumber") ?? color("textMuted"),
    addedSignColor: color("diffAdded"),
    removedSignColor: color("diffRemoved"),
  }
  const added = color("diffAddedBg")
  const removed = color("diffRemovedBg")
  if (added && removed && added !== removed && added !== canvas && removed !== canvas)
    Object.assign(colors, { addedBg: added, addedContentBg: added, removedBg: removed, removedContentBg: removed })
  const defined = Object.fromEntries(Object.entries(colors).filter(([, value]) => value)) as Partial<
    Record<HunkDiffCustomThemeColorKey, string>
  >
  return { id: `opengh-${Bun.hash(JSON.stringify([base, defined])).toString(36)}`, base, ...defined }
}
