import { SyntaxStyle, type CliRenderer, type StyleDefinitionInput } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createMemo, onCleanup } from "solid-js"
import type { AppColors, ResolvedTheme } from "../theme"
import { useMarkdownPreference } from "./markdown-preferences"

function createMarkdownStyle(colors: AppColors, theme: ResolvedTheme, owner: CliRenderer["nativeScene"], minimal: boolean) {
  const styles: Record<string, StyleDefinitionInput> = {
    default: { fg: theme.markdownText },
    conceal: { fg: colors.muted },
    "markup.heading": { fg: theme.markdownHeading, bold: true },
    "markup.heading.1": { fg: theme.markdownHeading, bold: true, underline: minimal },
    "markup.heading.2": { fg: theme.markdownHeading, bold: true },
    "markup.heading.3": { fg: theme.markdownHeading, bold: false, italic: true },
    "markup.heading.4": { fg: theme.markdownHeading, bold: false, underline: true },
    "markup.heading.5": { fg: colors.muted, bold: true },
    "markup.heading.6": { fg: colors.muted, bold: false, italic: true },
    // OpenTUI 0.6.6 has no strikethrough SyntaxStyle flag; prose chunks add it.
    "markup.strikethrough": { fg: colors.muted },
    "markup.bold": { fg: theme.markdownStrong, bold: true },
    "markup.strong": { fg: theme.markdownStrong, bold: true },
    "markup.italic": { fg: theme.markdownEmph, italic: true },
    "markup.raw": { fg: theme.markdownText, bg: colors.panel },
    "markup.raw.block": { fg: theme.markdownCodeBlock, bg: colors.panel },
    "markup.raw.inline": { fg: theme.markdownText, bg: colors.panel },
    "markup.link": { fg: theme.markdownLink },
    "markup.link.label": { fg: theme.markdownLink, underline: true },
    "markup.link.url": { fg: colors.muted },
    "markup.image.marker": { fg: colors.muted },
    "markup.list": { fg: colors.muted },
    "markup.list.checked": { fg: theme.markdownSuccess ?? colors.green, bold: true },
    "markup.list.unchecked": { fg: colors.muted },
    "markup.quote": { fg: theme.markdownText, italic: false },
    "diff.plus": { fg: theme.diffAdded ?? colors.green },
    "diff.minus": { fg: theme.diffRemoved ?? colors.red },
    "diff.delta": { fg: theme.diffHunkHeader ?? colors.blue },
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
  }
  if (minimal) {
    for (const [scope, style] of Object.entries(styles)) {
      // Links and diff colors convey meaning rather than syntax decoration.
      if (scope.startsWith("diff.") || scope.startsWith("markup.link") && scope !== "markup.link.url") continue
      style.fg = ["conceal", "comment", "markup.link.url", "markup.image.marker", "markup.list"].includes(scope)
        ? colors.muted : colors.text
      delete style.bg
      if (scope === "comment") delete style.italic
    }
  }
  return SyntaxStyle.fromStyles(styles, owner)
}

export function createReactiveMarkdownStyle(colors: AppColors, theme: ResolvedTheme) {
  const renderer = useRenderer()
  const preference = useMarkdownPreference()
  let current: SyntaxStyle | undefined
  const release = (style: SyntaxStyle) => {
    queueMicrotask(() => {
      if (!renderer.isDestroyed) renderer.requestRender()
      void renderer.idle().catch(() => {}).finally(() => style.destroy())
    })
  }
  const style = createMemo(() => {
    const previous = current
    current = createMarkdownStyle(colors, theme, renderer.nativeScene, preference() === "minimal")
    if (previous) release(previous)
    return current
  })
  onCleanup(() => {
    if (current) release(current)
  })
  return style
}

