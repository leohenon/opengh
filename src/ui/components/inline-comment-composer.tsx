import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal, on, onMount, Show } from "solid-js"
import { replaceEditorText, useKeyActions, useKeybindings } from "../keybindings"
import { createMarkdownComposer } from "../markdown-composer"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { useTheme } from "../theme"
import { Action } from "./action"
import { GitHubMarkdown } from "./github-markdown"
import { MarkdownTextarea } from "./markdown-textarea"

// Grows with its text like a posted card, then scrolls instead of pushing the diff away.
const MIN_EDITOR_ROWS = 3
const MAX_EDITOR_ROWS = 12

/** opengh's markdown editor as a review card under the commented line. */
export function InlineCommentComposer(props: {
  title: string
  idPrefix?: string
  disabled?: boolean
  canPost?: boolean
  onHintChange?(hint: string | undefined): void
  /** Seeds the editor once; later changes belong to the editor. */
  body: string
  width: number
  marginLeft: number
  active: boolean
  repositoryUrl?: string
  sourceUrl?: string
  headSha?: string
  /** Preview navigation scrolls the diff, which contains the rendered comment. */
  scroll(): ScrollBoxRenderable | undefined
  onInput(body: string): void
  onSave(body: string): void
  onCancel(): void
  onExpand(): void
  /** Grown or previewing: the diff scrolls the card back into view. */
  onGrow?(): void
}) {
  const { colors, theme } = useTheme()
  const keys = useKeybindings()
  const id = () => props.idPrefix ?? "inline-comment"
  const markdownStyle = createReactiveMarkdownStyle(colors, theme)
  const [body, setBody] = createSignal(props.body)
  const [rows, setRows] = createSignal(MIN_EDITOR_ROWS)
  const [error, setError] = createSignal<string>()
  let editor: TextareaRenderable | undefined
  const composer = createMarkdownComposer({}, { editor: () => editor, scroll: props.scroll, blocked: () => !!props.disabled, onError: setError })
  const measure = () => {
    if (!editor || editor.isDestroyed) return
    const next = Math.max(MIN_EDITOR_ROWS, Math.min(MAX_EDITOR_ROWS, editor.editorView.getTotalVirtualLineCount()))
    const grew = next > rows()
    setRows(next)
    if (grew) props.onGrow?.()
  }
  const blocked = () => !!props.disabled || composer.externalEditing()
  const expand = () => { if (!blocked()) props.onExpand() }
  const save = () => {
    const text = editor?.plainText ?? body()
    if (!blocked() && props.canPost !== false && text.trim()) props.onSave(text)
  }
  const clear = () => { if (!blocked() && editor && !editor.isDestroyed) replaceEditorText(editor, "") }
  const cancel = () => { if (!blocked()) props.onCancel() }
  createEffect(() => props.onHintChange?.(props.active && !props.disabled ? keys.hints(
    ...(props.canPost === false ? [] : [["dialog.submit", "post"] as const]), ["dialog.togglePreview", composer.preview() ? "write" : "preview"],
    ["dialog.toggleExpanded", "expand"], ["dialog.externalEditor", "editor"], ["dialog.discard", "clear"], ["dialog.close", "keep draft"],
  ) : undefined))
  onMount(() => { editor?.gotoBufferEnd(); measure() }) // Reopened drafts continue where they left off.
  createEffect(on(composer.preview, (preview) => { if (preview) props.onGrow?.() }, { defer: true }))
  // Text goes to the focused composer, never to diff or application shortcuts.
  useKeyActions({
    ...composer.actions,
    "dialog.toggleExpanded": expand,
    "dialog.close": cancel,
    "dialog.submit": save,
    "dialog.discard": clear,
  }, { when: () => props.active && !props.disabled, priority: 50, modal: true })
  return (
    // While inactive, e.g. posting, a click must not focus the editor natively; the diff focuses it when allowed.
    <box id={`${id()}-composer-card`} width={props.width} marginLeft={props.marginLeft} flexShrink={0} flexDirection="column"
      onMouseDown={(event) => { if (!props.active) event.preventDefault() }}>
      <box id={`${id()}-field`} width="100%" flexShrink={0} flexDirection="column"
        border borderStyle="rounded" borderColor={props.active && !blocked() ? colors.blue : colors.border}
        title={` ${props.title}${composer.preview() ? " (preview)" : ""} `} titleColor={colors.muted}
        paddingLeft={1} paddingRight={1}>
        <MarkdownTextarea id={`${id()}-editor`} ref={(value) => { editor = value }}
          initialValue={props.body} visible={!composer.preview()} focused={props.active && !blocked() && !composer.preview()}
          width="100%" height={rows()} flexShrink={0} wrapMode="word"
          textColor={colors.text} focusedTextColor={colors.text} backgroundColor="transparent" focusedBackgroundColor="transparent"
          cursorColor={colors.blue} onSizeChange={measure}
          onContentChange={() => {
            if (!editor) return
            measure()
            if (editor.plainText === body()) return
            setBody(editor.plainText)
            props.onInput(editor.plainText)
          }} />
        <Show when={composer.preview()}>
          <box minHeight={MIN_EDITOR_ROWS} flexShrink={0} flexDirection="column">
            <Show when={body().trim()}>
              <GitHubMarkdown content={body()} syntaxStyle={markdownStyle()} backgroundColor="transparent" preserveImages codePanels
                context={props.repositoryUrl ? { repositoryUrl: props.repositoryUrl, ref: props.headSha, sourceUrl: props.sourceUrl } : undefined} />
            </Show>
          </box>
        </Show>
        <Show when={error()}><text flexShrink={0} wrapMode="word" fg={colors.red}>{error()}</text></Show>
        <box id={`${id()}-toolbar`} height={1} flexShrink={0} flexDirection="row" justifyContent="flex-end">
          <Action id={`${id()}-post`} disabled={blocked() || props.canPost === false || !body().trim()} onActivate={save}>Post</Action>
          <text fg={colors.muted} selectable={false}> · </text>
          <Action id={`${id()}-cancel`} fg={colors.muted} disabled={blocked()} onActivate={cancel}>Cancel</Action>
        </box>
      </box>
    </box>
  )
}
