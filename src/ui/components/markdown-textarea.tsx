import { getTreeSitterClient, SyntaxStyle, type StyleDefinitionInput, type TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, splitProps, type ComponentProps } from "solid-js"
import { KeyTextarea } from "../keybindings"
import { useTheme } from "../theme"
import { markdownEditorOffsets } from "../markdown-editor-offsets"

// Reserved for this wrapper; never clear highlights belonging to the caller.
const highlightRef = 0x4d44

export function MarkdownTextarea(props: ComponentProps<typeof KeyTextarea>) {
  const [local, rest] = splitProps(props, ["ref", "onContentChange", "syntaxStyle"])
  const renderer = useRenderer()
  const { colors, theme } = useTheme()
  const sourceStyle = SyntaxStyle.create(renderer.nativeScene)
  const [editor, setEditor] = createSignal<TextareaRenderable>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let disposed = false

  // Keep IDs stable across theme changes. Source styles intentionally have no
  // backgrounds or concealment: the parent owns editor chrome and every cell.
  createEffect(() => {
    const styles: Record<string, StyleDefinitionInput> = {
      conceal: { fg: colors.muted },
      punctuation: { fg: colors.muted },
      label: { fg: colors.muted },
      "markup.heading": { fg: theme.markdownHeading, bold: true },
      "markup.strong": { fg: theme.markdownStrong, bold: true },
      "markup.bold": { fg: theme.markdownStrong, bold: true },
      "markup.italic": { fg: theme.markdownEmph, italic: true },
      "markup.strikethrough": { fg: colors.muted },
      "markup.link": { fg: colors.muted },
      "markup.link.label": { fg: theme.markdownLinkText, underline: true },
      "markup.link.url": { fg: theme.markdownLink },
      "markup.raw": { fg: theme.markdownCodeBlock },
      "markup.list": { fg: colors.muted },
      "markup.list.checked": { fg: theme.markdownSuccess ?? colors.green },
      "markup.quote": { fg: theme.markdownText },
      "string.escape": { fg: theme.syntaxNumber },
    }
    for (const [scope, style] of Object.entries(styles)) sourceStyle.registerStyle(scope, style)
    renderer.requestRender()
  })

  const schedule = () => {
    const version = ++generation
    clearTimeout(timer)
    const target = editor()
    if (disposed || !target || target.isDestroyed) return
    const style = local.syntaxStyle ?? sourceStyle
    timer = setTimeout(async () => {
      if (disposed || version !== generation || target.isDestroyed) return
      try {
        const text = target.plainText
        const result = await getTreeSitterClient().highlightOnce(text, "markdown")
        if (disposed || version !== generation || target.isDestroyed || target.plainText !== text || result.error) return

        // web-tree-sitter returns UTF-16 indices, NOT UTF-8 byte offsets.
        // In 0.6.6 EditBuffer AddRange uses display offsets EXCLUDING newlines
        // (as its ExtmarksController does). Let the buffer measure Unicode,
        // tabs and control notation with its own settings rather than guessing.
        const highlights = result.highlights ?? []
        const offsets = markdownEditorOffsets(text, (value) => target.editBuffer.measureText(value))
        target.editBuffer.runMutation(() => {
          // Keep the previous colors while parsing, then replace them in one
          // mutation so no frame displays an unhighlighted buffer between edits.
          target.removeHighlightsByRef(highlightRef)
          for (const [start, end, scope, meta] of highlights) {
            // Treat conceal captures as punctuation COLOR only, ignoring all
            // replacement/line-hiding metadata. spell/nospell have no style.
            let name = meta?.conceal !== undefined ? "conceal" : scope
            let styleId = style.resolveStyleId(name)
            while (styleId === null && name.includes(".")) {
              name = name.slice(0, name.lastIndexOf("."))
              styleId = style.resolveStyleId(name)
            }
            if (styleId === null || start >= text.length || end <= start) continue
            target.editBuffer.addHighlightByCharRange({
              start: offsets.starts[start]!,
              end: offsets.ends[Math.min(end, text.length)]!,
              styleId,
              priority: name === "conceal" ? 200 : 100,
              hlRef: highlightRef,
            })
          }
        })
        target.requestRender()
      } catch {
        // Parser/worker failures keep the last colors and never block editing.
      }
    }, 80)
  }

  createEffect(() => {
    const target = editor()
    const style = local.syntaxStyle ?? sourceStyle
    if (target && !target.isDestroyed) {
      target.syntaxStyle = style
      schedule()
    }
  })

  onCleanup(() => {
    disposed = true
    generation++
    clearTimeout(timer)
    const target = editor()
    if (target && !target.isDestroyed) {
      target.removeHighlightsByRef(highlightRef)
      if (target.syntaxStyle === sourceStyle) target.syntaxStyle = null
    }
    // Styles can still be borrowed by an in-flight native frame.
    void renderer.idle().catch(() => {}).finally(() => sourceStyle.destroy())
  })

  return <KeyTextarea {...rest} ref={(value) => {
    setEditor(value)
    if (typeof local.ref === "function") local.ref(value)
  }} onContentChange={(event) => {
    schedule()
    local.onContentChange?.(event)
  }} />
}
