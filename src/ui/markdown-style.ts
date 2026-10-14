import { SyntaxStyle } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createMemo, onCleanup } from "solid-js"
import type { AppColors, ResolvedTheme } from "../theme"

function createMarkdownStyle(colors: AppColors, theme: ResolvedTheme) {
  return SyntaxStyle.fromStyles({
    default: { fg: theme.markdownText },
    conceal: { fg: colors.muted },
    "markup.heading": { fg: theme.markdownHeading, bold: true },
    "markup.heading.1": { fg: theme.markdownHeading, bold: true },
    "markup.heading.2": { fg: theme.markdownHeading, bold: true },
    "markup.heading.3": { fg: theme.markdownHeading, bold: true },
    "markup.bold": { fg: theme.markdownStrong, bold: true },
    "markup.strong": { fg: theme.markdownStrong, bold: true },
    "markup.italic": { fg: theme.markdownEmph, italic: true },
    "markup.raw": { fg: theme.markdownText, bg: colors.panel },
    "markup.raw.block": { fg: theme.markdownCodeBlock, bg: colors.panel },
    "markup.raw.inline": { fg: theme.markdownText, bg: colors.panel },
    "markup.link": { fg: theme.markdownLink },
    "markup.link.label": { fg: theme.markdownLinkText, underline: true },
    "markup.link.url": { fg: colors.muted },
    "markup.image.marker": { fg: colors.muted },
    "markup.list": { fg: colors.muted },
    "markup.quote": { fg: theme.markdownText, italic: false },
    "diff.plus": { fg: colors.green },
    "diff.minus": { fg: colors.red },
    "diff.delta": { fg: colors.blue },
    comment: { fg: theme.syntaxComment, italic: true },
    keyword: { fg: theme.syntaxKeyword },
    string: { fg: theme.syntaxString },
    "string.special.key": { fg: theme.syntaxFunction },
    number: { fg: theme.syntaxNumber },
    function: { fg: theme.syntaxFunction },
    variable: { fg: theme.syntaxVariable },
    property: { fg: theme.syntaxFunction },
    type: { fg: theme.syntaxType },
    constructor: { fg: theme.syntaxType },
    escape: { fg: theme.syntaxNumber },
    constant: { fg: theme.syntaxNumber },
    boolean: { fg: theme.syntaxNumber },
    operator: { fg: theme.syntaxOperator },
    punctuation: { fg: theme.syntaxPunctuation },
  })
}

export function createReactiveMarkdownStyle(colors: AppColors, theme: ResolvedTheme) {
  const renderer = useRenderer()
  let current: SyntaxStyle | undefined
  const release = (style: SyntaxStyle) => {
    queueMicrotask(() => {
      if (!renderer.isDestroyed) renderer.requestRender()
      void renderer.idle().catch(() => {}).finally(() => style.destroy())
    })
  }
  const style = createMemo(() => {
    const previous = current
    current = createMarkdownStyle(colors, theme)
    if (previous) release(previous)
    return current
  })
  onCleanup(() => {
    if (current) release(current)
  })
  return style
}

