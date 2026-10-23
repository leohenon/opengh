import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { usePaste } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Index, onCleanup, Show, untrack } from "solid-js"
import type { IssueActionKind, IssueActionParent, IssueCloseReason } from "../../models"
import type { IssueActionState } from "../../repository-state"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { useTheme } from "../theme"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { GitHubMarkdown } from "./github-markdown"
import { Popup } from "./popup"
import { KeyInput, KeyTextarea, useKeyActions, useKeybindings } from "../keybindings"
import { Action } from "./action"
import { mouseClick, mouseHover } from "../mouse"

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
  const activate = (index = active()) => {
    const item = items()[index]
    if (item) { setSelected(index); props.onSelect(item.kind) }
  }
  useKeyActions({
    "dialog.close": () => props.onClose(),
    "navigation.up": () => { setSelected(Math.max(0, active() - 1)) },
    "navigation.down": () => { setSelected(Math.min(items().length - 1, active() + 1)) },
    "navigation.activate": () => activate(),
  }, { priority: 100, modal: true })
  return (
    <Popup width={52} height={items().length + 5} placement="center" zIndex={250} onClose={props.onClose}>
      <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Issue #{props.number} · Actions</text>
        <box height={1} flexShrink={0} />
        <Index each={items()}>{(item, index) => {
          const hover = mouseHover(() => true, () => item().kind)
          return (
            <box height={1} flexShrink={0} backgroundColor={active() === index || hover.hovered() ? colors.panelHover : colors.panel}
              {...mouseClick(() => activate(index), () => true, () => item().kind, hover)}>
              <text selectable={false} fg={active() === index ? colors.blue : colors.text}>{active() === index ? "› " : "  "}{item().label}</text>
            </box>
          )
        }}</Index>
        <box flexGrow={1} minHeight={0} />
      </box>
    </Popup>
  )
}

export function IssueActionDialog(props: {
  number: number
  kind: IssueActionKind
  parent?: IssueActionParent
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
  onClose(): void
}) {
  const { colors, theme } = useTheme()
  const keys = useKeybindings()
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
  const title = () => props.kind === "comment" ? `${props.parent === "pull" ? "PR " : ""}#${props.number}`
    : `${props.kind === "duplicate" ? "Mark as duplicate" : props.kind === "close" ? "Close issue" : "Reopen issue"} · #${props.number}`
  const requestSubmit = () => { if (canSubmit()) setConfirmSubmit(true) }
  const requestClose = () => {
    if (pending()) return
    if (confirmSubmit()) setConfirmSubmit(false)
    else props.onClose()
  }
  const confirm = () => {
    if (!canSubmit()) return
    setConfirmSubmit(false)
    props.onSubmit()
  }
  const discard = () => {
    if (pending() || confirmSubmit()) return
    if (props.kind === "duplicate") props.onDuplicateTargetChange("")
    else props.onDiscard()
  }
  const confirmation = () => {
    if (action() === "comment") return `Post comment to ${props.parent === "pull" ? "PR " : ""}#${props.number}?`
    if (action() === "duplicate") return `Close #${props.number} as a duplicate of #${duplicateNumber()}?`
    if (retry()) return `Retry ${action() === "close" ? "closing" : "reopening"} issue #${props.number}?`
    const verb = action() === "close" ? "close" : "reopen"
    return `${body().trim() ? `Post comment and ${verb}` : action() === "close" ? "Close" : "Reopen"} issue #${props.number}?`
  }
  const changeReason = (reason: IssueCloseReason) => {
    if (!pending() && !retry() && !confirmSubmit()) props.onReasonChange(reason)
  }

  createEffect(() => props.onHintChange(pending() ? "Saving…"
    : confirmSubmit() ? keys.hints(["dialog.confirm", "confirm"], ["dialog.close", "back"])
    : retry() ? keys.hints(["dialog.submit", "retry"], ["dialog.discard", "discard"], ["dialog.close", "back"])
    : props.kind === "duplicate" ? keys.hints([["dialog.confirm", "dialog.submit"], "review"], ["dialog.discard", "discard"], ["dialog.close", "back"])
    : keys.hints([props.kind === "close" ? "dialog.changeReason" : "dialog.togglePreview", props.kind === "close" ? "change reason" : "preview"], ["dialog.submit", "submit"], ["dialog.discard", "discard"], ["dialog.close", "keep draft"])))
  onCleanup(() => props.onHintChange(undefined))

  // Echoed typing must not replace the buffer (and reset its cursor/selection).
  createEffect(() => {
    const next = props.state.body
    setBody(next)
    if (writer && writer.plainText !== next) untrack(() => writer?.setText(next))
  })

  usePaste((event) => {
    if (!writing()) { event.preventDefault(); event.stopPropagation() }
  })
  useKeyActions({}, { when: pending, priority: 200, modal: true })
  useKeyActions({
    "dialog.close": requestClose,
    "dialog.confirm": confirm,
  }, { when: () => confirmSubmit() && !pending(), priority: 150, modal: true })
  useKeyActions({
    "dialog.close": requestClose,
    "dialog.submit": requestSubmit,
    "dialog.discard": discard,
  }, { when: () => !confirmSubmit() && !pending(), priority: 100, modal: true })
  useKeyActions({
    "dialog.confirm": () => {
      if (props.kind !== "duplicate") return false
      requestSubmit()
    },
    "dialog.changeReason": () => {
      if (props.kind !== "close") return false
      changeReason(props.state.reason === "completed" ? "not_planned" : "completed")
    },
    "dialog.togglePreview": () => {
      if (!hasPreview()) return false
      setPreview((value) => !value)
    },
  }, { when: writing, priority: 110 })
  const scrollPreview = (direction: number, half = false) => {
    previewScroll?.scrollBy(direction * Math.max(1, Math.floor((previewScroll?.viewport.height ?? 1) / (half ? 2 : 1))))
  }
  useKeyActions({
    "dialog.togglePreview": () => { setPreview(false) },
    "navigation.up": () => { previewScroll?.scrollBy(-1) },
    "navigation.down": () => { previewScroll?.scrollBy(1) },
    "navigation.halfPageUp": () => scrollPreview(-1, true),
    "navigation.halfPageDown": () => scrollPreview(1, true),
    "navigation.pageUp": () => scrollPreview(-1),
    "navigation.pageDown": () => scrollPreview(1),
    "navigation.first": () => { previewScroll?.scrollTo(0) },
    "navigation.last": () => { if (previewScroll) previewScroll.scrollTo(previewScroll.scrollHeight) },
  }, { when: () => previewing() && !confirmSubmit() && !pending() && !retry(), priority: 110 })

  return (
    <>
      <Popup
        width={props.kind === "duplicate" ? 56 : props.kind === "close" ? 64 : 86}
        height={props.kind === "duplicate" ? props.state.operation.status === "error" ? 10 : 7 : props.kind === "close" ? 10 : 26}
        placement="center" zIndex={250}
        onClose={requestClose}
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
              <text fg={props.state.reason === "completed" ? colors.blue : colors.muted} selectable={false}
                {...mouseClick(() => changeReason("completed"), () => !pending() && !confirmSubmit())}>{props.state.reason === "completed" ? "●" : "○"} Completed</text>
              <text fg={props.state.reason === "not_planned" ? colors.blue : colors.muted} selectable={false}
                {...mouseClick(() => changeReason("not_planned"), () => !pending() && !confirmSubmit())}>{props.state.reason === "not_planned" ? "●" : "○"} Not planned</text>
            </box>
          </Show>
          <Show when={retry()}>
            <text flexShrink={0} fg={colors.green}>Comment posted. Only the issue state change will be retried.</text>
          </Show>
          <Show when={!retry() && previewing()}>
            <text height={1} flexShrink={0} fg={colors.muted}>Preview</text>
          </Show>
          <Show when={props.kind === "duplicate"}>
            <box marginTop={1} flexShrink={0} flexDirection="column">
              <KeyInput value={props.state.duplicateTarget ?? ""} placeholder="#123" maxLength={17}
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
              <KeyTextarea
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
                <scrollbox id="issue-comment-preview-scroll" ref={(value) => { previewScroll = value; bindScrollbar(value) }} focusable={false} flexGrow={1} minHeight={0} scrollX={false} scrollY>
                  <Show when={body().trim()} fallback={<text fg={colors.muted}>Nothing to preview.</text>}>
                    <GitHubMarkdown content={body()} syntaxStyle={markdownStyle()} backgroundColor={colors.panel} preserveImages codePanels
                      context={{ repositoryUrl: props.repositoryUrl, ref: props.defaultBranch, sourceUrl: `${props.repositoryUrl}/${props.parent === "pull" ? "pull" : "issues"}/${props.number}` }} />
                </Show>
              </scrollbox>
            </Show>
          </box>
          </Show>
          <Show when={props.state.operation.status === "error"}>
            <text flexShrink={0} fg={colors.red}>{props.state.operation.status === "error" ? props.state.operation.message : ""}</text>
          </Show>
          <box height={1} flexShrink={0} flexDirection="row" gap={2}>
            <Action id="issue-action-submit" disabled={!canSubmit() || confirmSubmit()} onActivate={requestSubmit}>{retry() ? "Retry" : "Submit"}</Action>
          </box>
        </box>
      </Popup>
      <Show when={confirmSubmit()}>
        <Popup width={56} height={action() === "close" || action() === "duplicate" ? 6 : 5} placement="center" zIndex={300} onClose={requestClose}>
          <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
            <text fg={colors.text} attributes={TextAttributes.BOLD}>{confirmation()}</text>
            <Show when={action() === "close"}>
              <text fg={colors.muted}>Reason: {props.state.reason === "completed" ? "Completed" : "Not planned"}</text>
            </Show>
            <box flexGrow={1} minHeight={0} />
            <box height={1} flexShrink={0} flexDirection="row" gap={2}>
              <Action id="issue-action-confirm" disabled={!canSubmit()} onActivate={confirm}>Confirm</Action>
            </box>
          </box>
        </Popup>
      </Show>
    </>
  )
}
