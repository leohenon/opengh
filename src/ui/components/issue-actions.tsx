import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { usePaste, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Index, onCleanup, Show, untrack } from "solid-js"
import type { IssueActionKind, IssueActionParent, IssueCloseReason } from "../../models"
import type { IssueActionState } from "../../repository-state"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { useTheme } from "../theme"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { editMarkdownExternally } from "../external-editor"
import { MarkdownTextarea } from "./markdown-textarea"
import { GitHubMarkdown } from "./github-markdown"
import { Popup } from "./popup"
import { KeyInput, replaceEditorText, useKeyActions, useKeybindings } from "../keybindings"
import { Action } from "./action"
import { mouseClick, mouseHover } from "../mouse"
import { scrollRowIntoView } from "../scroll-selection"

export function IssueActionsMenu(props: {
  number: number
  parent?: IssueActionParent
  state: "open" | "closed"
  permissions?: Partial<Record<IssueActionKind, boolean>>
  onSelect(kind: Exclude<IssueActionKind, "comment">): void
  merge?: { reason?: string; checking?: boolean }
  onMerge?(): void
  draftAction?: "draft" | "ready"
  onChangeDraft?(draft: boolean): void
  onReview?(): void
  onOpenGitHub?(): void
  onClose(): void
}) {
  const { colors } = useTheme()
  const [selected, setSelected] = createSignal(0)
  const items = createMemo(() => {
    const actions: { kind: Exclude<IssueActionKind, "comment">; label: string }[] = props.state === "open" ? [
      { kind: "close", label: `Close ${props.parent === "pull" ? "PR" : "issue"}…` },
      { kind: "duplicate", label: "Mark as duplicate…" },
    ] : [{ kind: "reopen", label: `Reopen ${props.parent === "pull" ? "PR" : "issue"}…` }]
    actions.push({ kind: "assignees", label: "Edit assignees…" })
    const visible: { kind: Exclude<IssueActionKind, "comment"> | "merge" | "github" | "review" | "draft" | "ready"; label: string; disabled?: boolean }[] =
      actions.filter((item) => !(props.parent === "pull" && item.kind === "duplicate") && props.permissions?.[item.kind])
    if (props.parent === "pull" && props.state === "open" && props.draftAction)
      visible.unshift({ kind: props.draftAction, label: props.draftAction === "draft" ? "Mark as draft…" : "Ready for review…" })
    if (props.merge) {
      visible.unshift({ kind: "merge", label: "Merge…", disabled: !!props.merge.reason })
      if (props.merge.reason && !props.merge.checking && props.onOpenGitHub) visible.push({ kind: "github", label: "Open on GitHub" })
    }
    if (props.onReview) visible.push({ kind: "review", label: "Review…" })
    if (props.parent === "pull") {
      const order = ["review", "merge", "assignees", "draft", "ready", "close", "reopen", "github"]
      visible.sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind))
    }
    return visible
  })
  const active = () => Math.min(selected(), items().length - 1)
  const dimensions = useTerminalDimensions()
  let list: ScrollBoxRenderable | undefined
  // Renderable height getters clamp to one even when Yoga has no rows left.
  // Popup reserves two terminal rows; its padding, title and gap use four more.
  const hasRows = () => dimensions().height > 6
  const revealSelection = () => {
    if (hasRows() && active() >= 0) scrollRowIntoView(list, active(), 1)
  }
  createEffect(revealSelection)
  onCleanup(() => list?.viewport.off("resize", revealSelection))
  const move = (delta: number) => {
    if (!hasRows()) return
    setSelected(Math.max(0, Math.min(items().length - 1, active() + delta)))
    revealSelection()
  }
  const activate = (index = active()) => {
    const item = items()[index]
    if (!item || item.disabled || !hasRows() || !list
      || index < list.scrollTop || index >= list.scrollTop + list.viewport.height) return
    setSelected(index)
    if (item.kind === "merge") props.onMerge?.()
    else if (item.kind === "review") props.onReview?.()
    else if (item.kind === "github") props.onOpenGitHub?.()
    else if (item.kind === "draft" || item.kind === "ready") props.onChangeDraft?.(item.kind === "draft")
    else props.onSelect(item.kind)
  }
  useKeyActions({
    "dialog.close": () => props.onClose(),
    "navigation.up": () => move(-1),
    "navigation.down": () => move(1),
    "navigation.activate": () => activate(),
  }, { priority: 100, modal: true })
  return (
    <Popup width={52} height={items().length + 5} placement="center" zIndex={250} onClose={props.onClose}>
      <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>{props.parent === "pull" ? "PR" : "Issue"} #{props.number} · Actions</text>
        <box height={1} flexShrink={0} />
        <scrollbox id="issue-actions-scroll" ref={(value) => {
          list = value
          list.viewport.on("resize", revealSelection)
        }} flexGrow={1} flexShrink={1} minHeight={0} focusable={false} scrollX={false} scrollY>
        <Index each={items()}>{(item, index) => {
          const hover = mouseHover(() => !item().disabled, () => item().kind)
          return (
            <box id={`issue-menu-${item().kind}`} height={1} flexShrink={0} backgroundColor={active() === index || hover.hovered() ? colors.panelHover : colors.panel}
              {...mouseClick(() => activate(index), () => !item().disabled, () => item().kind, hover)}>
              <text selectable={false} fg={item().disabled ? colors.muted : active() === index || hover.hovered() ? colors.blue : colors.text}
                attributes={hover.hovered() ? TextAttributes.BOLD : TextAttributes.NONE}>{active() === index ? "› " : "  "}{item().label}</text>
            </box>
          )
        }}</Index>
        </scrollbox>
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
  showStatusBarHints?: boolean
  expanded?: boolean
  onExpandedChange?(expanded: boolean): void
  onEditorActiveChange?(active: boolean): void
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
  const renderer = useRenderer()
  const markdownStyle = createReactiveMarkdownStyle(colors, theme)
  const startsWithReason = props.kind === "close" && props.parent !== "pull" && props.state.retry !== "close"
  const [stage, setStage] = createSignal<"reason" | "edit">(startsWithReason ? "reason" : "edit")
  const [editorOpened, setEditorOpened] = createSignal(!startsWithReason)
  const [reasonChoice, setReasonChoice] = createSignal(props.state.reason)
  const closeReasons: readonly IssueCloseReason[] = ["completed", "not_planned"]
  createEffect(() => props.onEditorActiveChange?.(stage() === "edit" && props.kind !== "duplicate"))
  onCleanup(() => props.onEditorActiveChange?.(false))
  const [body, setBody] = createSignal(props.state.body)
  const [localExpanded, setLocalExpanded] = createSignal(false)
  const expanded = () => props.expanded ?? localExpanded()
  const toggleExpanded = () => {
    const next = !expanded()
    setLocalExpanded(next)
    props.onExpandedChange?.(next)
  }
  const [externalEditing, setExternalEditing] = createSignal(false)
  const [editorError, setEditorError] = createSignal<string>()
  let disposed = false
  onCleanup(() => { disposed = true })
  const [preview, setPreview] = createSignal(false)
  const [cursor, setCursor] = createSignal({ line: 0, visualColumn: 0 })
  const [confirmSubmit, setConfirmSubmit] = createSignal(false)
  let writer: TextareaRenderable | undefined
  let duplicateInput: TextareaRenderable | undefined
  let previewScroll: ScrollBoxRenderable | undefined
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  const pending = () => props.state.operation.status === "loading"
  const retry = () => props.state.retry === props.kind ? props.state.retry : undefined
  const hasPreview = () => props.kind === "comment" || props.kind === "reopen" || props.kind === "close"
  const previewing = () => stage() === "edit" && hasPreview() && preview()
  const writing = () => stage() === "edit" && !previewing() && !confirmSubmit() && !pending() && !retry() && !externalEditing()
  const duplicateNumber = () => {
    const match = props.state.duplicateTarget?.trim().match(/^#?([1-9]\d*)$/)
    const number = Number(match?.[1])
    return Number.isSafeInteger(number) && number > 0 ? number : undefined
  }
  const duplicateError = () => !(props.state.duplicateTarget ?? "").trim() ? ""
    : duplicateNumber() === undefined ? "Enter an issue number such as #123."
    : duplicateNumber() === props.number ? "An issue cannot be a duplicate of itself." : ""
  const canSubmit = () => stage() === "edit" && !pending() && !externalEditing() && (props.kind === "duplicate"
    ? duplicateNumber() !== undefined && duplicateNumber() !== props.number
    : Boolean(retry()) || props.kind !== "comment" || Boolean(body().trim()))
  const action = () => retry() ?? props.kind
  const subject = () => props.parent === "pull" ? "PR" : "issue"
  const hasCloseReason = () => props.kind === "close" && props.parent !== "pull"
  const title = () => props.kind === "comment" ? `${props.parent === "pull" ? "PR " : ""}#${props.number}`
    : `${props.kind === "duplicate" ? "Mark as duplicate" : props.kind === "close" ? `Close ${subject()}` : `Reopen ${subject()}`} · #${props.number}${hasCloseReason() ? ` · ${props.state.reason === "completed" ? "Completed" : "Not planned"}` : ""}`
  const requestSubmit = () => { if (canSubmit()) setConfirmSubmit(true) }
  const requestClose = () => {
    if (pending() || externalEditing()) return
    if (confirmSubmit()) setConfirmSubmit(false)
    else if (hasCloseReason() && !retry() && stage() === "edit") {
      setReasonChoice(props.state.reason)
      setStage("reason")
    } else props.onClose()
  }
  const confirm = () => {
    if (!canSubmit()) return
    setConfirmSubmit(false)
    props.onSubmit()
  }
  const discard = () => {
    if (pending() || confirmSubmit() || externalEditing()) return
    const editor = props.kind === "duplicate" ? duplicateInput : writer
    if (editor && !editor.isDestroyed) replaceEditorText(editor, "")
    if (props.kind === "duplicate") props.onDuplicateTargetChange("")
    else if (hasCloseReason() && !retry()) props.onBodyChange("")
    else {
      props.onDiscard()
      if (hasCloseReason()) { setReasonChoice(props.state.reason); setStage("reason") }
    }
  }
  const openExternalEditor = async () => {
    if (stage() !== "edit" || !hasPreview() || confirmSubmit() || pending() || retry() || externalEditing() || !writer) return
    setPreview(false)
    setEditorError(undefined)
    setExternalEditing(true)
    try {
      const next = await editMarkdownExternally(renderer, writer.plainText)
      if (disposed || writer.isDestroyed) return
      setExternalEditing(false)
      if (next !== writer.plainText) replaceEditorText(writer, next)
    } catch (error) {
      if (!disposed) setEditorError(error instanceof Error ? error.message : "Could not open editor. Draft kept unchanged.")
    } finally {
      if (!disposed) {
        setExternalEditing(false)
        writer?.focus()
      }
    }
  }
  const confirmation = () => {
    if (action() === "comment") return `Post comment to ${props.parent === "pull" ? "PR " : ""}#${props.number}?`
    if (action() === "duplicate") return `Close #${props.number} as a duplicate of #${duplicateNumber()}?`
    if (retry()) return `Retry ${action() === "close" ? "closing" : "reopening"} ${subject()} #${props.number}?`
    const verb = action() === "close" ? "close" : "reopen"
    return `${body().trim() ? `Post comment and ${verb}` : action() === "close" ? "Close" : "Reopen"} ${subject()} #${props.number}?`
  }
  const chooseReason = (reason = reasonChoice()) => {
    if (pending() || retry() || confirmSubmit() || externalEditing()) return
    props.onReasonChange(reason)
    setReasonChoice(reason)
    setEditorOpened(true)
    setStage("edit")
  }
  const moveReason = (direction: number) => {
    const index = closeReasons.indexOf(reasonChoice())
    setReasonChoice(closeReasons[(index + direction + closeReasons.length) % closeReasons.length]!)
  }

  createEffect(() => props.onHintChange(pending() ? "Saving…"
    : confirmSubmit() ? keys.hints(["dialog.confirm", "confirm"], ["dialog.close", "back"])
    : stage() === "reason" ? keys.hints(["navigation.activate", "select"], [["navigation.up", "navigation.down"], "choose"], ["dialog.close", "close"])
    : retry() ? keys.hints(["dialog.submit", "retry"], ["dialog.discard", "discard"], ["dialog.close", "back"])
    : props.kind === "duplicate" ? keys.hints([["dialog.confirm", "dialog.submit"], "review"], ["dialog.discard", "discard"], ["dialog.close", "back"])
    : keys.hints(
      ["dialog.submit", "submit"],
      ["dialog.togglePreview", previewing() ? "write" : "preview"],
      ["dialog.toggleExpanded", expanded() ? "restore" : "expand"],
      ["dialog.externalEditor", "editor"],
      ["dialog.discard", "clear"],
      ["dialog.close", hasCloseReason() ? "back" : "keep draft"],
    )))
  onCleanup(() => props.onHintChange(undefined))

  // Echoed typing must not replace the buffer (and reset its cursor/selection).
  createEffect(() => {
    const next = props.state.body
    setBody(next)
    if (writer && !writer.isDestroyed && writer.plainText !== next) untrack(() => writer?.setText(next))
  })

  usePaste((event) => {
    if (!writing()) { event.preventDefault(); event.stopPropagation() }
  })
  useKeyActions({}, { when: () => pending() || externalEditing(), priority: 200, modal: true })
  useKeyActions({
    "dialog.close": requestClose,
    "navigation.activate": () => chooseReason(),
    "navigation.up": () => moveReason(-1),
    "navigation.down": () => moveReason(1),
  }, { when: () => stage() === "reason" && !pending(), priority: 100, modal: true })
  useKeyActions({
    "dialog.close": requestClose,
    "dialog.confirm": confirm,
  }, { when: () => confirmSubmit() && !pending(), priority: 150, modal: true })
  useKeyActions({
    "dialog.close": requestClose,
    "dialog.submit": requestSubmit,
    "dialog.discard": discard,
  }, { when: () => stage() === "edit" && !confirmSubmit() && !pending(), priority: 100, modal: true })
  useKeyActions({
    "dialog.toggleExpanded": toggleExpanded,
    "dialog.externalEditor": () => { void openExternalEditor() },
  }, { when: () => stage() === "edit" && hasPreview() && !confirmSubmit() && !pending() && !retry() && !externalEditing(), priority: 110 })
  useKeyActions({
    "dialog.confirm": () => {
      if (props.kind !== "duplicate") return false
      requestSubmit()
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
      <Show when={stage() === "reason"}>
        <Popup width={52} height={7} placement="center" zIndex={250} onClose={requestClose}>
          <box id="issue-close-reason-menu" flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
            <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Close issue · #{props.number}</text>
            <box height={1} flexShrink={0} />
            <For each={closeReasons}>{reason => {
              const enabled = () => !pending() && !retry()
              const hover = mouseHover(enabled, () => reason)
              const active = () => enabled() && reasonChoice() === reason
              return <box id={`issue-close-reason-${reason}`} height={1} flexShrink={0}
                backgroundColor={active() || hover.hovered() ? colors.panelHover : colors.panel}
                {...mouseClick(() => chooseReason(reason), enabled, () => reason, hover)}>
                <text selectable={false} fg={!enabled() ? colors.muted : active() || hover.hovered() ? colors.blue : colors.text}
                  attributes={hover.hovered() ? TextAttributes.BOLD : TextAttributes.NONE}>{active() ? "› " : "  "}{reason === "completed" ? "Completed…" : "Not planned…"}</text>
              </box>
            }}</For>
          </box>
        </Popup>
      </Show>
      <Show when={editorOpened()}>
      <Popup visible={stage() === "edit"} fullscreen={expanded()} reserveStatusBar={props.showStatusBarHints}
        width={props.kind === "duplicate" ? 56 : props.kind === "close" && props.parent === "pull" ? 64 : 86}
        height={props.kind === "duplicate" ? props.state.operation.status === "error" ? 11 : 8 : props.kind === "close" && props.parent === "pull" ? 11 : 27}
        placement="center" zIndex={250}
        onClose={requestClose}
      >
        <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
          <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
            <text flexGrow={1} minWidth={0} wrapMode="none" fg={colors.text} attributes={TextAttributes.BOLD}>{title()}</text>
            <text fg={colors.muted}>{previewing() ? "Preview" : ""}</text>
          </box>
          <Show when={props.locked && props.kind !== "duplicate"}>
            <text flexShrink={0} fg={colors.yellow}>Locked thread — commenting depends on your GitHub permissions.</text>
          </Show>
          <Show when={retry()}>
            <text flexShrink={0} fg={colors.green}>Comment posted. Only the issue state change will be retried.</text>
          </Show>
          <Show when={props.kind === "duplicate"}>
            <box marginTop={1} flexShrink={0} flexDirection="column">
              <KeyInput ref={value => { duplicateInput = value }} value={props.state.duplicateTarget ?? ""} placeholder="#123" maxLength={17}
                focused={writing()} textColor={colors.text} focusedTextColor={colors.text} backgroundColor={colors.panel}
                focusedBackgroundColor={colors.panel} cursorColor={colors.blue}
                onInput={(target) => {
                  if (writing() && target !== (props.state.duplicateTarget ?? "")) props.onDuplicateTargetChange(target)
                }} />
              <Show when={duplicateError()}><text fg={colors.red}>{duplicateError()}</text></Show>
            </box>
          </Show>
          <Show when={props.kind !== "duplicate"}>
            <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="column" overflow="hidden">
              <MarkdownTextarea id="issue-comment-writer"
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
                selectionBg={colors.blue}
                selectionFg={colors.panel}
                onCursorChange={setCursor}
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
          <Show when={editorError()}><text flexShrink={0} fg={colors.red}>{editorError()}</text></Show>
          <Show when={props.state.operation.status === "error"}>
            <text flexShrink={0} fg={colors.red}>{props.state.operation.status === "error" ? props.state.operation.message : ""}</text>
          </Show>
          <box height={1} flexShrink={0} flexDirection="row" gap={2} marginTop={1}>
            <Action id="issue-action-submit" disabled={!canSubmit() || confirmSubmit()} onActivate={requestSubmit}>{retry() ? "Retry" : "Submit"}</Action>
            <Show when={props.kind !== "duplicate" && !previewing() && !retry()}>
              <text flexGrow={1} minWidth={0} />
              <text fg={colors.muted}>Ln {cursor().line + 1}, Col {cursor().visualColumn + 1}</text>
            </Show>
          </box>
        </box>
      </Popup>
      </Show>
      <Show when={confirmSubmit()}>
        <Popup width={56} height={action() === "close" || action() === "duplicate" ? 6 : 5} placement="center" zIndex={300} onClose={requestClose}>
          <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
            <text fg={colors.text} attributes={TextAttributes.BOLD}>{confirmation()}</text>
            <Show when={action() === "close" && props.parent !== "pull"}>
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
