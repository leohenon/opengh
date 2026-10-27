import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createSignal, onCleanup } from "solid-js"
import { editMarkdownExternally } from "./external-editor"
import { replaceEditorText, useKeyActions, type KeyHandlers } from "./keybindings"

export type ComposerPresentation = {
  expanded?: boolean
  onExpandedChange?(expanded: boolean): void
  showStatusBarHints?: boolean
}

export function createMarkdownComposer(props: ComposerPresentation, options: {
  editor(): TextareaRenderable | undefined
  scroll(): ScrollBoxRenderable | undefined
  blocked(): boolean
  editable?(): boolean
  onError(message: string | undefined): void
}) {
  const renderer = useRenderer()
  const [localExpanded, setLocalExpanded] = createSignal(false)
  const [preview, setPreview] = createSignal(false)
  const [externalEditing, setExternalEditing] = createSignal(false)
  const expanded = () => props.expanded ?? localExpanded()
  let disposed = false
  onCleanup(() => { disposed = true })
  const blocked = () => externalEditing() || options.blocked()
  const openEditor = async () => {
    const editor = options.editor()
    if (!editor || blocked() || options.editable?.() === false) return
    setPreview(false)
    options.onError(undefined)
    setExternalEditing(true)
    try {
      const next = await editMarkdownExternally(renderer, editor.plainText)
      if (disposed || editor.isDestroyed) return
      setExternalEditing(false)
      if (next !== editor.plainText) replaceEditorText(editor, next)
    } catch (error) {
      if (!disposed) options.onError(error instanceof Error ? error.message : "Could not open editor. Text kept unchanged.")
    } finally {
      if (!disposed) {
        setExternalEditing(false)
        options.editor()?.focus()
      }
    }
  }
  useKeyActions({}, { when: externalEditing, priority: 250, modal: true })
  const scrollPreview = (operation: (scroll: ScrollBoxRenderable) => void) => {
    if (!preview() || blocked()) return false
    const scroll = options.scroll()
    if (scroll) operation(scroll)
  }
  const actions: KeyHandlers = {
    "dialog.toggleExpanded": () => {
      if (blocked()) return false
      const next = !expanded()
      setLocalExpanded(next)
      props.onExpandedChange?.(next)
    },
    "dialog.togglePreview": () => { if (blocked()) return false; setPreview(value => !value) },
    "dialog.externalEditor": () => { void openEditor() },
    "navigation.up": () => scrollPreview(scroll => scroll.scrollBy(-1)),
    "navigation.down": () => scrollPreview(scroll => scroll.scrollBy(1)),
    "navigation.halfPageUp": () => scrollPreview(scroll => scroll.scrollBy(-Math.max(1, Math.floor(scroll.viewport.height / 2)))),
    "navigation.halfPageDown": () => scrollPreview(scroll => scroll.scrollBy(Math.max(1, Math.floor(scroll.viewport.height / 2)))),
    "navigation.pageUp": () => scrollPreview(scroll => scroll.scrollBy(-Math.max(1, scroll.viewport.height))),
    "navigation.pageDown": () => scrollPreview(scroll => scroll.scrollBy(Math.max(1, scroll.viewport.height))),
    "navigation.first": () => scrollPreview(scroll => scroll.scrollTo(0)),
    "navigation.last": () => scrollPreview(scroll => scroll.scrollTo(scroll.scrollHeight)),
  }
  return { expanded, preview, externalEditing, actions }
}
