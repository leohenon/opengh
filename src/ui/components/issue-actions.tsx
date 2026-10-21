import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, usePaste } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Index, onCleanup, Show, untrack } from "solid-js"
import type { IssueActionKind, IssueCloseReason } from "../../models"
import type { IssueActionState } from "../../repository-state"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { useTheme } from "../theme"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { GitHubMarkdown } from "./github-markdown"
import { Popup } from "./popup"

export function IssueActionsMenu(props: {
  number: number
  state: "open" | "closed"
  permissions?: Partial<Record<IssueActionKind, boolean>>
  onSelect(kind: Exclude<IssueActionKind, "comment">): void
  onClose(): void
}) {
  const { colors } = useTheme()
  const [selected, setSelected] = createSignal(0)
  const items = createMemo(() => {
    const actions: { kind: Exclude<IssueActionKind, "comment">; label: string }[] = props.state === "open" ? [
      { kind: "close", label: "Close issue…" },
      { kind: "duplicate", label: "Mark as duplicate…" },
    ] : [{ kind: "reopen", label: "Reopen issue…" }]
    actions.push({ kind: "assignees", label: "Edit assignees…" })
    return actions.filter((item) => props.permissions?.[item.kind])
  })
  const active = () => Math.min(selected(), items().length - 1)
  useKeyboard((event) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.name === "escape") props.onClose()
    else if (event.name === "up" || event.name === "k") setSelected(Math.max(0, active() - 1))
    else if (event.name === "down" || event.name === "j") setSelected(Math.min(items().length - 1, active() + 1))
    else if (event.name === "return" || event.name === "enter") {
      const item = items()[active()]
      if (item) props.onSelect(item.kind)
    }
  })
  return (
    <Popup width={52} height={items().length + 4} placement="center" zIndex={250}>
      <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Issue #{props.number} · Actions</text>
        <box height={1} flexShrink={0} />
        <Index each={items()}>{(item, index) => (
          <box height={1} flexShrink={0} backgroundColor={active() === index ? colors.panelHover : colors.panel}>
            <text fg={active() === index ? colors.blue : colors.text} onMouseDown={(event) => {
              event.preventDefault()
              if (event.button === 0) { setSelected(index); props.onSelect(item().kind) }
            }}>{active() === index ? "› " : "  "}{item().label}</text>
          </box>
        )}</Index>
        <box flexGrow={1} minHeight={0} />
      </box>
    </Popup>
  )
}

export function IssueActionDialog(props: {
  number: number
  kind: IssueActionKind
  state: IssueActionState
  showScrollbar: boolean
  locked?: boolean
  repositoryUrl: string
  defaultBranch?: string
  onBodyChange(body: string): void
  onReasonChange(reason: IssueCloseReason): void
  onDuplicateTargetChange(target: string): void
  onSubmit(): void
  onDiscard(): void
  onHintChange(hint: string | undefined): void
  onConfirmationChange?: (confirming: boolean) => void
  onClose(): void
}) {
  const { colors, theme } = useTheme()
  const markdownStyle = createReactiveMarkdownStyle(colors, theme)
  const [body, setBody] = createSignal(props.state.body)
  const [preview, setPreview] = createSignal(false)
  const [confirmSubmit, setConfirmSubmit] = createSignal(false)
  let writer: TextareaRenderable | undefined
  let previewScroll: ScrollBoxRenderable | undefined
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  const pending = () => props.state.operation.status === "loading"
  const retry = () => props.state.retry === props.kind ? props.state.retry : undefined
  const hasPreview = () => props.kind === "comment" || props.kind === "reopen"
  const previewing = () => hasPreview() && preview()
  const writing = () => !previewing() && !confirmSubmit() && !pending() && !retry()
  const duplicateNumber = () => {
    const match = props.state.duplicateTarget?.trim().match(/^#?([1-9]\d*)$/)
    const number = Number(match?.[1])
    return Number.isSafeInteger(number) && number > 0 ? number : undefined
  }
  const duplicateError = () => !(props.state.duplicateTarget ?? "").trim() ? ""
    : duplicateNumber() === undefined ? "Enter an issue number such as #123."
    : duplicateNumber() === props.number ? "An issue cannot be a duplicate of itself." : ""
  const canSubmit = () => !pending() && (props.kind === "duplicate"
    ? duplicateNumber() !== undefined && duplicateNumber() !== props.number
    : Boolean(retry()) || props.kind !== "comment" || Boolean(body().trim()))
  const action = () => retry() ?? props.kind
  const title = () => props.kind === "comment" ? `#${props.number}`
    : `${props.kind === "duplicate" ? "Mark as duplicate" : props.kind === "close" ? "Close issue" : "Reopen issue"} · #${props.number}`
  const requestSubmit = () => { if (canSubmit()) setConfirmSubmit(true) }
  const confirmation = () => {
    if (action() === "comment") return `Post comment to #${props.number}?`
    if (action() === "duplicate") return `Close #${props.number} as a duplicate of #${duplicateNumber()}?`
    if (retry()) return `Retry ${action() === "close" ? "closing" : "reopening"} issue #${props.number}?`
    const verb = action() === "close" ? "close" : "reopen"
    return `${body().trim() ? `Post comment and ${verb}` : action() === "close" ? "Close" : "Reopen"} issue #${props.number}?`
  }
  const changeReason = (reason: IssueCloseReason) => {
    if (!pending() && !retry() && !confirmSubmit()) props.onReasonChange(reason)
  }

  createEffect(() => props.onHintChange(confirmSubmit() ? "enter confirm · esc back"
    : retry() ? "ctrl+s retry · ctrl+d discard · esc back"
    : props.kind === "duplicate" ? "enter review · esc back"
    : (props.kind === "close" ? "tab change reason" : "tab preview")
      + " · ctrl+s submit · ctrl+d discard · esc keep draft"))
  createEffect(() => props.onConfirmationChange?.(confirmSubmit()))
  onCleanup(() => { props.onHintChange(undefined); props.onConfirmationChange?.(false) })

  // Echoed typing must not replace the buffer (and reset its cursor/selection).
  createEffect(() => {
    const next = props.state.body
    setBody(next)
    if (writer && writer.plainText !== next) untrack(() => writer?.setText(next))
  })

  usePaste((event) => {
    if (!writing()) { event.preventDefault(); event.stopPropagation() }
  })
  useKeyboard((event) => {
    const consume = () => { event.preventDefault(); event.stopPropagation() }
    const enter = event.name === "return" || event.name === "enter"
    if (pending()) { consume(); return }
    if (confirmSubmit()) {
      consume()
      if (event.name === "escape") setConfirmSubmit(false)
      else if (enter && !event.ctrl && !event.meta && canSubmit()) {
        setConfirmSubmit(false)
        props.onSubmit()
      }
      return
    }
    if (event.name === "escape") { consume(); props.onClose(); return }
    if (event.ctrl && event.name === "s") {
      consume(); requestSubmit(); return
    }
    if (props.kind === "duplicate" && enter && !event.ctrl && !event.meta) { consume(); requestSubmit(); return }
    if (event.ctrl && event.name === "d") {
      consume()
      if (props.kind === "duplicate") props.onDuplicateTargetChange("")
      else props.onDiscard()
      return
    }
    if (event.name === "tab") {
      consume()
      if (!retry()) {
        if (props.kind === "close") changeReason(props.state.reason === "completed" ? "not_planned" : "completed")
        else if (hasPreview()) setPreview((value) => !value)
      }
      return
    }
    if (retry()) { consume(); return }
    if (previewing()) {
      consume()
      if (event.name === "up" || event.name === "k") previewScroll?.scrollBy(-1)
      else if (event.name === "down" || event.name === "j") previewScroll?.scrollBy(1)
      else if (event.name === "pageup") previewScroll?.scrollBy(-Math.max(1, previewScroll?.viewport.height ?? 1))
      else if (event.name === "pagedown") previewScroll?.scrollBy(Math.max(1, previewScroll?.viewport.height ?? 1))
    }
    // All other keys belong to the focused writer; App gates ambient shortcuts.
  })

  return (
    <>
      <Popup
        width={props.kind === "duplicate" ? 56 : props.kind === "close" ? 64 : 86}
        height={props.kind === "duplicate" ? props.state.operation.status === "error" ? 10 : 7 : props.kind === "close" ? 10 : 26}
        placement="center" zIndex={250}
      >
        <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
          <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
            <text fg={colors.text} attributes={TextAttributes.BOLD}>{title()}</text>
          </box>
          <Show when={props.locked && props.kind !== "duplicate"}>
            <text flexShrink={0} fg={colors.yellow}>Locked thread — commenting depends on your GitHub permissions.</text>
          </Show>
          <Show when={props.kind === "close" && !retry()}>
            <box height={1} flexShrink={0} flexDirection="row" gap={2}>
              <text fg={colors.muted}>Reason</text>
              <text fg={props.state.reason === "completed" ? colors.blue : colors.muted} onMouseDown={(event) => {
                event.preventDefault()
                if (event.button === 0) changeReason("completed")
              }}>{props.state.reason === "completed" ? "●" : "○"} Completed</text>
              <text fg={props.state.reason === "not_planned" ? colors.blue : colors.muted} onMouseDown={(event) => {
                event.preventDefault()
                if (event.button === 0) changeReason("not_planned")
              }}>{props.state.reason === "not_planned" ? "●" : "○"} Not planned</text>
            </box>
          </Show>
          <Show when={retry()}>
            <text flexShrink={0} fg={colors.green}>Comment posted. Only the issue state change will be retried.</text>
          </Show>
          <Show when={!retry() && hasPreview()}>
            <box height={1} flexShrink={0} flexDirection="row" gap={2}>
              <text fg={!previewing() ? colors.blue : colors.muted} onMouseDown={(event) => {
                event.preventDefault()
                if (event.button === 0 && !pending() && !confirmSubmit()) setPreview(false)
              }}>Write</text>
              <text fg={previewing() ? colors.blue : colors.muted} onMouseDown={(event) => {
                event.preventDefault()
                if (event.button === 0 && !pending() && !confirmSubmit()) setPreview(true)
              }}>Preview</text>
            </box>
            <box height={1} flexShrink={0} />
          </Show>
          <Show when={props.kind === "duplicate"}>
            <box marginTop={1} flexShrink={0} flexDirection="column">
              <input value={props.state.duplicateTarget ?? ""} placeholder="#123" maxLength={17}
                focused={writing()} textColor={colors.text} focusedTextColor={colors.text} backgroundColor={colors.panel}
                focusedBackgroundColor={colors.panel} cursorColor={colors.blue}
                onInput={(target) => {
                  if (writing() && target !== (props.state.duplicateTarget ?? "")) props.onDuplicateTargetChange(target)
                }} />
              <Show when={duplicateError()}><text fg={colors.red}>{duplicateError()}</text></Show>
            </box>
          </Show>
          <Show when={props.kind !== "duplicate"}>
            <box flexGrow={1} minHeight={0} marginTop={props.kind === "close" ? 1 : 0} flexDirection="column" overflow="hidden">
              <textarea
                ref={(value) => { writer = value }}
                initialValue={props.state.body}
                visible={!previewing() && !retry()}
                focused={writing()}
                flexGrow={1}
                minHeight={0}
                width="100%"
                wrapMode="word"
                placeholder={props.kind === "comment" ? "Write a comment…" : "Leave a comment (optional)…"}
                placeholderColor={colors.muted}
                textColor={colors.text}
                focusedTextColor={colors.text}
                backgroundColor={colors.panel}
                focusedBackgroundColor={colors.panel}
                cursorColor={colors.blue}
                onContentChange={() => {
                  if (!writer || !writing()) return
                  const next = writer.plainText
                  setBody(next)
                  if (next !== props.state.body) props.onBodyChange(next)
                }}
              />
              <Show when={previewing() && !retry()}>
                <scrollbox id="issue-comment-preview-scroll" ref={(value) => { previewScroll = value; bindScrollbar(value) }} flexGrow={1} minHeight={0} scrollX={false} scrollY>
                  <Show when={body().trim()} fallback={<text fg={colors.muted}>Nothing to preview.</text>}>
                    <GitHubMarkdown content={body()} syntaxStyle={markdownStyle()} backgroundColor={colors.panel} preserveImages codePanels
                      context={{ repositoryUrl: props.repositoryUrl, ref: props.defaultBranch, sourceUrl: `${props.repositoryUrl}/issues/${props.number}` }} />
                </Show>
              </scrollbox>
            </Show>
          </box>
          </Show>
          <Show when={props.state.operation.status === "error"}>
            <text flexShrink={0} fg={colors.red}>{props.state.operation.status === "error" ? props.state.operation.message : ""}</text>
          </Show>
        </box>
      </Popup>
      <Show when={confirmSubmit()}>
        <Popup width={56} height={action() === "close" || action() === "duplicate" ? 6 : 5} placement="center" zIndex={300}>
          <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
            <text fg={colors.text} attributes={TextAttributes.BOLD}>{confirmation()}</text>
            <Show when={action() === "close"}>
              <text fg={colors.muted}>Reason: {props.state.reason === "completed" ? "Completed" : "Not planned"}</text>
            </Show>
            <box flexGrow={1} minHeight={0} />
            <text height={1} flexShrink={0} fg={colors.muted}>enter confirm · esc back</text>
          </box>
        </Popup>
      </Show>
    </>
  )
}
