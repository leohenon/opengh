import { TextAttributes, type InputRenderable, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import type { ComposeDraft } from "../../compose-drafts"
import type { HintEntry } from "../../keybindings"
import { editMarkdownExternally } from "../external-editor"
import { KeyInput, replaceEditorText, useKeyActions, useKeybindings, type KeyHandlers } from "../keybindings"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { useTheme } from "../theme"
import { Action } from "./action"
import { GitHubMarkdown } from "./github-markdown"
import { MarkdownTextarea } from "./markdown-textarea"
import { Popup } from "./popup"

const titleLabel = "<!-- opengh: title -->"
const descriptionLabel = "<!-- opengh: description -->"
const labelLines = (label: string) => new RegExp(`^${label}[ \\t]*(?:\\r?\\n|$)`, "gm")

export function draftEditorText(draft: ComposeDraft) {
  return `${titleLabel}\n${draft.title}\n\n${descriptionLabel}\n${draft.body}`
}

export function parseDraftEditorText(text: string): ComposeDraft {
  const titleMatch = labelLines(titleLabel).exec(text)
  const descriptionPattern = labelLines(descriptionLabel)
  descriptionPattern.lastIndex = titleMatch ? titleMatch.index + titleMatch[0].length : 0
  const descriptionMatch = titleMatch && descriptionPattern.exec(text)
  if (titleMatch && descriptionMatch) {
    const lines = text.slice(titleMatch.index + titleMatch[0].length, descriptionMatch.index).split(/\r?\n/)
    const first = lines.findIndex((line) => line.trim())
    const rest =
      first < 0
        ? ""
        : lines
            .slice(first + 1)
            .join("\n")
            .trim()
    const body = text.slice(descriptionMatch.index + descriptionMatch[0].length)
    return { title: first < 0 ? "" : lines[first]!, body: rest ? `${rest}\n\n${body}` : body }
  }
  const plain = text.replace(labelLines(titleLabel), "").replace(labelLines(descriptionLabel), "")
  const newline = /\r?\n/.exec(plain)
  if (!newline) return { title: plain, body: "" }
  return { title: plain.slice(0, newline.index), body: plain.slice(newline.index + newline[0].length).replace(/^\r?\n/, "") }
}

export type ComposeTop = {
  label: string
  keys: KeyHandlers
  next?(): boolean
  hints(): HintEntry[]
  render(active: () => boolean, focus: () => void): JSX.Element
}

export type ComposeControls = { replace(draft: ComposeDraft): void; draft(): ComposeDraft; focus(field: "top" | "title"): void }

export function ComposeDialog(props: {
  idPrefix: string
  heading: string
  confirmation: string
  repositoryUrl: string
  defaultBranch?: string
  showScrollbar: boolean
  draft: ComposeDraft
  draftError?: string
  showStatusBarHints?: boolean
  top?: ComposeTop
  initialField?: "top" | "title"
  blocked?: boolean
  suspended?: boolean
  onReady?(controls: ComposeControls): void
  onDraftChange(draft: ComposeDraft): void
  onSubmit?(title: string, body: string): Promise<unknown>
  onClose(): void
  onHintChange(hint: string | undefined): void
}) {
  const { colors, theme } = useTheme()
  const keys = useKeybindings()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const confirmWidth = () => Math.max(1, Math.min(Math.max(56, Bun.stringWidth(props.confirmation) + 4), dimensions().width - 2))
  const confirmHeight = () => 4 + Math.ceil(Bun.stringWidth(props.confirmation) / Math.max(1, confirmWidth() - 4))
  const markdownStyle = createReactiveMarkdownStyle(colors, theme)
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  let titleInput: InputRenderable | undefined
  let previewScroll: ScrollBoxRenderable | undefined
  let writer: TextareaRenderable | undefined
  let disposed = false
  const [field, setField] = createSignal<"top" | "title" | "body">(props.top ? (props.initialField ?? "title") : "title")
  const [title, setTitle] = createSignal(props.draft.title)
  const [body, setBody] = createSignal(props.draft.body)
  const [confirming, setConfirming] = createSignal(false)
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [preview, setPreview] = createSignal(false)
  const [externalEditing, setExternalEditing] = createSignal(false)
  const [editorError, setEditorError] = createSignal<string>()
  const [bodyTop, setBodyTop] = createSignal(true)
  const [position, setPosition] = createSignal({ line: 0, column: 0 })
  const updateCursor = () => {
    const editor = field() === "title" ? titleInput : writer
    if (editor && !editor.isDestroyed) setPosition({ line: editor.logicalCursor.row, column: editor.logicalCursor.col })
    setBodyTop(!writer || writer.isDestroyed || (writer.scrollY === 0 && writer.visualCursor.visualRow === 0))
  }
  createEffect(on(field, () => queueMicrotask(updateCursor)))
  createEffect(on([title, body], ([title, body]) => props.onDraftChange({ title, body }), { defer: true }))
  const clear = () => {
    if (titleInput && !titleInput.isDestroyed) replaceEditorText(titleInput, "")
    if (writer && !writer.isDestroyed) replaceEditorText(writer, "")
    setError(undefined)
    setPreview(false)
    setField("title")
  }
  const editing = () => !props.suspended && !confirming() && !pending() && !externalEditing()
  const writing = () => editing() && !preview()
  const active = (name: "top" | "title" | "body") => writing() && field() === name
  const openExternalEditor = async () => {
    if (!editing() || !writer || !titleInput) return
    setPreview(false)
    setEditorError(undefined)
    setExternalEditing(true)
    try {
      const next = parseDraftEditorText(await editMarkdownExternally(renderer, draftEditorText({ title: title(), body: body() })))
      if (disposed || writer.isDestroyed || titleInput.isDestroyed) return
      setExternalEditing(false)
      if (next.title !== title()) replaceEditorText(titleInput, next.title)
      if (next.body !== writer.plainText) replaceEditorText(writer, next.body)
    } catch (error) {
      if (!disposed) setEditorError(error instanceof Error ? error.message : "Could not open editor. Draft kept unchanged.")
    } finally {
      if (!disposed) {
        setExternalEditing(false)
        setField("body")
      }
    }
  }
  const scrollPreview = (direction: number, half = false) => {
    previewScroll?.scrollBy(direction * Math.max(1, Math.floor((previewScroll?.viewport.height ?? 1) / (half ? 2 : 1))))
  }
  const canSubmit = () => !!props.onSubmit && !props.blocked && !!title().trim() && !pending()
  const requestSubmit = () => {
    if (canSubmit()) setConfirming(true)
  }
  const submit = async () => {
    if (!canSubmit() || !props.onSubmit) return
    setConfirming(false)
    setPending(true)
    setError(undefined)
    try {
      await props.onSubmit(title(), body())
      if (!disposed) props.onClose()
    } catch (error) {
      if (!disposed) setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (!disposed) setPending(false)
    }
  }
  createEffect(() =>
    props.onHintChange(
      props.suspended
        ? undefined
        : pending()
          ? "Creating…"
          : confirming()
            ? keys.hints(["dialog.confirm", "confirm"], ["dialog.close", "back"])
            : keys.hints(
                ["dialog.submit", "create"],
                ...(active("top") && props.top ? [...props.top.hints(), ["navigation.down", "title"] as const] : []),
                ...(active("title") && props.top ? [["editor.move-up", props.top.label] as const] : []),
                ...(writing() && field() === "title" ? [[["dialog.nextField", "editor.move-down"], "description"] as const] : []),
                ...(writing() && field() === "body" && bodyTop() ? [["editor.move-up", "title"] as const] : []),
                ["dialog.close", "keep draft"],
                ["dialog.togglePreview", preview() ? "write" : "preview"],
                ["dialog.discard", "clear"],
                ["dialog.externalEditor", "editor"],
              ),
    ),
  )
  onCleanup(() => {
    disposed = true
    props.onHintChange(undefined)
  })
  useKeyActions({}, { when: () => pending() || externalEditing(), priority: 200, modal: true })
  useKeyActions(
    { "dialog.close": () => setConfirming(false), "dialog.confirm": () => void submit() },
    { when: () => confirming() && !pending(), priority: 150, modal: true },
  )
  useKeyActions(
    {
      "dialog.close": props.onClose,
      "dialog.submit": requestSubmit,
      "dialog.discard": clear,
      "dialog.togglePreview": () => setPreview((value) => !value),
      "dialog.externalEditor": () => void openExternalEditor(),
    },
    { when: editing, priority: 100, modal: true },
  )
  useKeyActions({ "dialog.nextField": () => setField("body") }, { when: () => writing() && field() === "title", priority: 110 })
  useKeyActions(
    {
      ...props.top?.keys,
      "dialog.nextField": () => {
        if (!props.top?.next?.()) setField("title")
      },
      "navigation.down": () => setField("title"),
    },
    { when: () => active("top"), priority: 110 },
  )
  onMount(() =>
    props.onReady?.({
      replace(draft) {
        if (titleInput && !titleInput.isDestroyed && draft.title !== title()) replaceEditorText(titleInput, draft.title)
        if (writer && !writer.isDestroyed && draft.body !== writer.plainText) replaceEditorText(writer, draft.body)
      },
      draft: () => ({ title: title(), body: body() }),
      focus: (next) => setField(next === "top" && !props.top ? "title" : next),
    }),
  )
  useKeyActions(
    {
      "navigation.up": () => previewScroll?.scrollBy(-1),
      "navigation.down": () => previewScroll?.scrollBy(1),
      "navigation.halfPageUp": () => scrollPreview(-1, true),
      "navigation.halfPageDown": () => scrollPreview(1, true),
      "navigation.pageUp": () => scrollPreview(-1),
      "navigation.pageDown": () => scrollPreview(1),
      "navigation.first": () => previewScroll?.scrollTo(0),
      "navigation.last": () => previewScroll?.scrollTo(previewScroll.scrollHeight),
    },
    { when: () => editing() && preview(), priority: 110 },
  )

  return (
    <>
      <Popup
        width={86}
        height={27}
        expanded
        reserveStatusBar={props.showStatusBarHints}
        placement="center"
        zIndex={250}
        onClose={() => {
          if (editing()) props.onClose()
        }}
      >
        <box id={`${props.idPrefix}-dialog`} flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
          <box height={1} flexShrink={0} flexDirection="row">
            <text flexGrow={1} minWidth={0} wrapMode="none" fg={colors.text} attributes={TextAttributes.BOLD}>
              {props.heading}
            </text>
            <text fg={colors.muted}>{preview() ? "Preview" : ""}</text>
          </box>
          <Show when={props.top}>
            {(top) => (
              <>
                <box height={1} flexShrink={0} marginTop={1} flexDirection="row">
                  {top().render(
                    () => active("top"),
                    () => setField("top"),
                  )}
                </box>
                <box height={1} flexShrink={0} border={["top"]} borderColor={colors.border} />
              </>
            )}
          </Show>
          <text
            height={1}
            flexShrink={0}
            marginTop={props.top ? 0 : 1}
            fg={active("title") ? colors.blue : colors.muted}
            attributes={active("title") ? TextAttributes.BOLD : TextAttributes.NONE}
          >
            Title
          </text>
          <KeyInput
            id={`${props.idPrefix}-title`}
            ref={(value) => {
              titleInput = value
            }}
            width="100%"
            value={title()}
            placeholder="Add a title"
            placeholderColor={colors.muted}
            focused={writing() && field() === "title"}
            onMouseDown={() => {
              setField("title")
              queueMicrotask(updateCursor)
            }}
            onInput={setTitle}
            onSubmit={() => setField("body")}
            onCursorChange={updateCursor}
            onKeyDown={(event) => {
              queueMicrotask(updateCursor)
              if (keys.matches(event, "editor.move-up") && props.top) {
                event.preventDefault()
                setField("top")
              }
              if (!keys.matches(event, "editor.move-down")) return
              event.preventDefault()
              setField("body")
            }}
            textColor={colors.text}
            focusedTextColor={colors.text}
            backgroundColor={colors.panel}
            focusedBackgroundColor={colors.panel}
            cursorColor={colors.blue}
          />
          <box height={1} flexShrink={0} border={["top"]} borderColor={colors.border} />
          <text
            height={1}
            flexShrink={0}
            fg={active("body") ? colors.blue : colors.muted}
            attributes={active("body") ? TextAttributes.BOLD : TextAttributes.NONE}
          >
            Description
          </text>
          <MarkdownTextarea
            id={`${props.idPrefix}-body`}
            ref={(value) => {
              writer = value
            }}
            initialValue={props.draft.body}
            flexGrow={1}
            minHeight={1}
            width="100%"
            wrapMode="word"
            visible={!preview()}
            placeholder="Add a description…"
            placeholderColor={colors.muted}
            focused={writing() && field() === "body"}
            onMouseDown={() => {
              setField("body")
              queueMicrotask(updateCursor)
            }}
            onContentChange={() => {
              if (writer) setBody(writer.plainText)
            }}
            onCursorChange={updateCursor}
            onKeyDown={(event) => {
              queueMicrotask(updateCursor)
              if (!writer || !keys.matches(event, "editor.move-up") || writer.scrollY !== 0 || writer.visualCursor.visualRow !== 0) return
              event.preventDefault()
              setField("title")
            }}
            textColor={colors.text}
            focusedTextColor={colors.text}
            backgroundColor={colors.panel}
            focusedBackgroundColor={colors.panel}
            cursorColor={colors.blue}
            selectionBg={colors.blue}
            selectionFg={colors.panel}
          />
          <Show when={preview()}>
            <scrollbox
              id={`${props.idPrefix}-preview-scroll`}
              ref={(value) => {
                previewScroll = value
                bindScrollbar(value)
              }}
              focusable={false}
              flexGrow={1}
              minHeight={0}
              scrollX={false}
              scrollY
            >
              <Show when={body().trim()} fallback={<text fg={colors.muted}>Nothing to preview.</text>}>
                <GitHubMarkdown
                  content={body()}
                  syntaxStyle={markdownStyle()}
                  backgroundColor={colors.panel}
                  preserveImages
                  codePanels
                  wide
                  context={{ repositoryUrl: props.repositoryUrl, ref: props.defaultBranch }}
                />
              </Show>
            </scrollbox>
          </Show>
          <Show when={editorError()}>
            <text flexShrink={0} marginTop={1} fg={colors.red} wrapMode="word">
              {editorError()}
            </text>
          </Show>
          <Show when={props.draftError}>
            <text flexShrink={0} marginTop={1} fg={colors.yellow} wrapMode="word">
              {props.draftError}
            </text>
          </Show>
          <Show when={error()}>
            <text flexShrink={0} marginTop={1} fg={colors.red} wrapMode="word">
              {error()}
            </text>
          </Show>
          <box height={1} flexShrink={0} marginTop={1} flexDirection="row">
            <Action id={`${props.idPrefix}-submit`} disabled={!canSubmit() || confirming()} onActivate={requestSubmit}>
              Create
            </Action>
            <Show when={!preview()}>
              <text flexGrow={1} minWidth={0} />
              <text fg={colors.muted}>
                Ln {position().line + 1}, Col {position().column + 1}
              </text>
            </Show>
          </box>
        </box>
      </Popup>
      <Show when={confirming()}>
        <Popup width={confirmWidth()} height={confirmHeight()} placement="center" zIndex={300} onClose={() => setConfirming(false)}>
          <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
            <text fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="word">
              {props.confirmation}
            </text>
            <box flexGrow={1} minHeight={0} />
            <box height={1} flexShrink={0}>
              <Action id={`${props.idPrefix}-confirm`} disabled={!canSubmit()} onActivate={() => void submit()}>
                Confirm
              </Action>
            </box>
          </box>
        </Popup>
      </Show>
    </>
  )
}
