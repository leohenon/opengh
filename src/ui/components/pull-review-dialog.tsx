import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import type { PullReviewSession, ReviewAnchor, ReviewEvent } from "../../review-types"
import { KeyTextarea, useKeyActions, useKeybindings } from "../keybindings"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { mouseClick, mouseHover } from "../mouse"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { useTheme } from "../theme"
import { Action } from "./action"
import { GitHubMarkdown } from "./github-markdown"
import { Popup } from "./popup"

export type ReviewCommentDialogProps = {
  anchor: ReviewAnchor
  body?: string
  repositoryUrl: string
  headSha: string
  onSave(body: string): void
  onClose(): void
  onHintChange(hint: string | undefined): void
  showScrollbar: boolean
}

// Kept mounted while previewing: hiding the native editor preserves cursor and undo.
function ReviewEditor(props: {
  title: string
  body: string
  repositoryUrl: string
  headSha: string
  showScrollbar: boolean
  saveLabel: string
  allowEmpty?: boolean
  onChange?(body: string): void
  onSave(body: string): void
  onClose(): void
  onHintChange(hint: string | undefined): void
}) {
  const { colors, theme } = useTheme()
  const keys = useKeybindings()
  const markdownStyle = createReactiveMarkdownStyle(colors, theme)
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  const [body, setBody] = createSignal(props.body)
  const [preview, setPreview] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [confirming, setConfirming] = createSignal(false)
  let writer: TextareaRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined
  const save = () => { if (props.allowEmpty || body().trim()) setConfirming(true) }
  const confirm = () => {
    if (!props.allowEmpty && !body().trim()) return
    setConfirming(false)
    setError(undefined)
    try { props.onSave(body()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit comment.") }
  }
  const close = () => { if (confirming()) setConfirming(false); else props.onClose() }
  createEffect(() => props.onHintChange(confirming()
    ? keys.hints(["dialog.confirm", "confirm"], ["dialog.close", "back"])
    : keys.hints(["dialog.togglePreview", preview() ? "write" : "preview"], ["dialog.submit", "post comment"], ["dialog.close", "back"])))
  onCleanup(() => props.onHintChange(undefined))
  useKeyActions({ "dialog.close": close, "dialog.confirm": confirm }, { when: confirming, priority: 180, modal: true })
  useKeyActions({
    "dialog.close": close,
    "dialog.submit": save,
    "dialog.togglePreview": () => setPreview(value => !value),
    "navigation.up": () => { if (!preview()) return false; scroll?.scrollBy(-1) },
    "navigation.down": () => { if (!preview()) return false; scroll?.scrollBy(1) },
    "navigation.pageUp": () => { if (!preview()) return false; scroll?.scrollBy(-(scroll.viewport.height || 1)) },
    "navigation.pageDown": () => { if (!preview()) return false; scroll?.scrollBy(scroll.viewport.height || 1) },
  }, { when: () => !confirming(), priority: 160, modal: true })
  return <><Popup width={86} height={27} placement="center" zIndex={300} onClose={close}>
    <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
      <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
        <text flexGrow={1} minWidth={0} wrapMode="none" fg={colors.text} attributes={TextAttributes.BOLD}>{props.title}</text>
        <Action id="review-editor-preview" disabled={confirming()} onActivate={() => setPreview(value => !value)}>{preview() ? "Write" : "Preview"}</Action>
      </box>
      <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="column" overflow="hidden">
        <KeyTextarea id="review-editor-body" ref={value => { writer = value }} initialValue={props.body}
          visible={!preview()} focused={!preview() && !confirming()} flexGrow={1} minHeight={0} width="100%" wrapMode="word"
          placeholder="Write a comment…" placeholderColor={colors.muted} textColor={colors.text}
          focusedTextColor={colors.text} backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} cursorColor={colors.blue}
          onContentChange={() => {
            if (!writer || preview() || confirming()) return
            setBody(writer.plainText)
            try { props.onChange?.(writer.plainText); setError(undefined) }
            catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save draft.") }
          }} />
        <Show when={preview()}>
          <scrollbox ref={value => { scroll = value; bindScrollbar(value) }} flexGrow={1} minHeight={0} scrollY scrollX={false} focusable={false}>
            <Show when={body().trim()} fallback={<text fg={colors.muted}>Nothing to preview.</text>}>
              <GitHubMarkdown content={body()} syntaxStyle={markdownStyle()} backgroundColor={colors.panel} preserveImages codePanels
                context={{ repositoryUrl: props.repositoryUrl, ref: props.headSha }} />
            </Show>
          </scrollbox>
        </Show>
      </box>
      <Show when={error()}><text height={2} flexShrink={0} wrapMode="word" fg={colors.red}>{error()}</text></Show>
      <box height={1} flexShrink={0} marginTop={1}>
        <Action id="review-editor-save" disabled={confirming() || !props.allowEmpty && !body().trim()} onActivate={save}>{props.saveLabel}</Action>
      </box>
    </box>
  </Popup>
  <Show when={confirming()}>
    <Popup width={64} height={7} placement="center" zIndex={350} onClose={close}>
      <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Post inline comment?</text>
        <text maxHeight={3} flexShrink={0} wrapMode="word" fg={colors.text}>{props.title}</text>
        <box flexGrow={1} minHeight={0} />
        <Action id="inline-comment-confirm" onActivate={confirm}>Confirm</Action>
      </box>
    </Popup>
  </Show></>
}

export function ReviewCommentDialog(props: ReviewCommentDialogProps) {
  return <ReviewEditor title={`${props.anchor.path}:${props.anchor.startLine ? `${props.anchor.startLine}–` : ""}${props.anchor.line} (${props.anchor.side})`}
    body={props.body ?? ""} repositoryUrl={props.repositoryUrl} headSha={props.headSha} showScrollbar={props.showScrollbar}
    saveLabel="Submit" onSave={props.onSave} onClose={props.onClose} onHintChange={props.onHintChange} />
}

export type PullReviewDialogProps = {
  number?: number
  session: PullReviewSession
  onSubmit(): void
  onClose(): void
  onOpenGitHub(): void
  onJump(anchor: ReviewAnchor): void
  onHintChange(hint: string | undefined): void
  repositoryUrl: string
  showScrollbar: boolean
}

const events: ReviewEvent[] = ["COMMENT", "APPROVE", "REQUEST_CHANGES"]
const eventLabels: Record<ReviewEvent, string> = { COMMENT: "Comment", APPROVE: "Approve", REQUEST_CHANGES: "Request changes" }

export function PullReviewDialog(props: PullReviewDialogProps) {
  const { colors } = useTheme()
  const keys = useKeybindings()
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  const [confirmation, setConfirmation] = createSignal<"submit" | "discard" | "head" | "legacy">()
  const [localError, setLocalError] = createSignal<string>()
  const [discarding, setDiscarding] = createSignal(false)
  let writer: TextareaRenderable | undefined
  let confirmationScroll: ScrollBoxRenderable | undefined
  const state = () => props.session.state()
  const draft = () => state().draft
  const eligibility = () => state().eligibility
  const busy = () => state().status === "submitting" || discarding()
  const locked = () => busy() || state().status === "loading" || state().status === "idle" || !!state().uncertain || !!draft()?.submission
  const mismatch = () => !!draft() && !!eligibility() && (draft()!.headSha !== eligibility()!.headSha
    || draft()!.baseSha !== eligibility()!.baseSha || (!!draft()!.comments.length && !draft()!.baseSha))
  const allowed = (event: ReviewEvent) => {
    const value = eligibility()
    return !!value && (event === "COMMENT" ? value.canComment : event === "APPROVE" ? value.canApprove : value.canRequestChanges)
  }
  const available = createMemo(() => events.filter(allowed))
  const validFeedback = () => draft()?.event === "APPROVE" || !!draft()?.body.trim()
  const canClearLegacy = () => !!draft()?.comments.length && !locked()
  const canSubmit = () => state().status === "ready" && !locked() && !!draft() && !mismatch()
    && !eligibility()?.pendingReviewUrl && !draft()!.comments.length && allowed(draft()!.event) && validFeedback()
  const canUseHead = () => (state().status === "ready" || state().status === "error") && !locked() && mismatch() && draft()?.comments.length === 0
  const selectEvent = (event: ReviewEvent) => {
    if (locked() || confirmation() || !allowed(event)) return
    try { props.session.setEvent(event); setLocalError(undefined) }
    catch (error) { setLocalError(error instanceof Error ? error.message : "Could not update review type.") }
  }
  const cycleEvent = (direction: number) => {
    const options = available()
    if (options.length < 2) return
    const index = Math.max(0, options.indexOf(draft()?.event ?? "COMMENT"))
    selectEvent(options[(index + direction + options.length) % options.length]!)
  }
  createEffect(() => {
    const current = draft()
    const fallback = available()[0]
    if (current && fallback && !locked() && !allowed(current.event)) selectEvent(fallback)
  })
  createEffect(() => {
    const body = draft()?.body ?? ""
    if (writer && writer.plainText !== body) untrack(() => writer?.setText(body))
  })
  const requestSubmit = () => {
    if (canSubmit()) setConfirmation("submit")
    else if (canUseHead()) setConfirmation("head")
    else if (canClearLegacy()) setConfirmation("legacy")
  }
  const close = () => {
    if (busy()) return
    if (confirmation()) setConfirmation(undefined)
    else props.onClose()
  }
  const confirm = async () => {
    const action = confirmation()
    if (action === "submit" && canSubmit()) {
      setConfirmation(undefined)
      props.onSubmit()
    } else if (action === "head" && canUseHead()) {
      try { props.session.useCurrentHead(); setConfirmation(undefined) }
      catch (error) { setLocalError(error instanceof Error ? error.message : "Could not change the review commit."); setConfirmation(undefined) }
    } else if (action === "legacy" && canClearLegacy()) {
      try {
        for (const comment of draft()!.comments) props.session.removeComment(comment.id)
        setConfirmation(undefined)
      } catch (error) { setLocalError(error instanceof Error ? error.message : "Could not remove saved inline drafts.") }
    } else if (action === "discard" && !locked()) {
      setDiscarding(true)
      setLocalError(undefined)
      try {
        await props.session.discard()
        if (state().message) setLocalError(state().message)
        else props.onClose()
      } catch (error) { setLocalError(error instanceof Error ? error.message : "Could not discard draft.") }
      finally { setDiscarding(false); setConfirmation(undefined) }
    }
  }
  createEffect(() => props.onHintChange(busy() ? "Saving…" : confirmation()
    ? keys.hints(["dialog.confirm", "confirm"], ["dialog.close", "back"])
    : keys.hints(...(available().length > 1 ? [[["dialog.nextField", "dialog.previousField"], "review type"] as const] : []),
      ["dialog.submit", "submit review"], ["dialog.discard", "discard draft"], ["dialog.close", "keep draft"])))
  onCleanup(() => props.onHintChange(undefined))
  useKeyActions({}, { when: busy, priority: 200, modal: true })
  useKeyActions({
    "dialog.close": close, "dialog.confirm": () => void confirm(),
    "navigation.up": () => confirmationScroll?.scrollBy(-1), "navigation.down": () => confirmationScroll?.scrollBy(1),
    "navigation.pageUp": () => confirmationScroll?.scrollBy(-confirmationScroll.viewport.height),
    "navigation.pageDown": () => confirmationScroll?.scrollBy(confirmationScroll.viewport.height),
  }, { when: () => !!confirmation() && !busy(), priority: 180, modal: true })
  useKeyActions({
    "dialog.close": close, "dialog.submit": requestSubmit,
    "dialog.discard": () => { if (draft() && !locked()) setConfirmation("discard") },
    "dialog.nextField": () => cycleEvent(1), "dialog.previousField": () => cycleEvent(-1),
  }, { when: () => !confirmation() && !busy(), priority: 100, modal: true })
  const warning = () => [...new Set([
    state().message && (state().status === "error" || state().message !== eligibility()?.reason && state().message !== "Review submitted.") ? state().message : undefined,
    localError(),
    !eligibility()?.canComment ? eligibility()?.reason : undefined,
    state().uncertain || draft()?.submission ? "Submission outcome uncertain. Draft preserved; check GitHub before retrying." : undefined,
    mismatch() ? "The diff changed. Inspect the latest changes before submitting. Remove outdated inline drafts or discard this draft to start again." : undefined,
  ].filter(Boolean))].join("\n")
  return <>
    <Popup width={86} height={27} placement="center" zIndex={250} onClose={close}>
      <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Review PR #{props.number ?? draft()?.number ?? eligibility()?.number ?? "…"}</text>
        <box height={1} flexShrink={0} flexDirection="row" gap={3} marginTop={1}>
          <For each={available()}>{event => {
            const hover = mouseHover(() => !locked() && !confirmation())
            return <text id={`review-event-${event}`} height={1} selectable={false}
              fg={draft()?.event === event || hover.hovered() ? colors.blue : colors.muted}
              attributes={draft()?.event === event || hover.hovered() ? TextAttributes.BOLD : TextAttributes.NONE}
              {...mouseClick(() => selectEvent(event), () => !locked() && !confirmation(), () => event, hover)}>
              {available().length > 1 ? `${draft()?.event === event ? "●" : "○"} ` : ""}{eventLabels[event]}
            </text>
          }}</For>
        </box>
        <Show when={warning()}>
          <text maxHeight={3} flexShrink={0} wrapMode="word" fg={colors.yellow}>{warning()}</text>
        </Show>
        <box flexGrow={1} minHeight={0} flexDirection="column" marginTop={1} overflow="hidden">
          <KeyTextarea id="review-body" ref={value => { writer = value; value.setText(draft()?.body ?? "") }}
            initialValue={draft()?.body ?? ""} focused={!!draft() && !locked() && !confirmation()}
            flexGrow={1} minHeight={0} width="100%" wrapMode="word" placeholder="Write review feedback…"
            placeholderColor={colors.muted} textColor={colors.text} focusedTextColor={colors.text}
            backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} cursorColor={colors.blue}
            onContentChange={() => {
              if (!writer || locked() || confirmation() || writer.plainText === draft()?.body) return
              try { props.session.setBody(writer.plainText); setLocalError(undefined) }
              catch (error) { setLocalError(error instanceof Error ? error.message : "Could not save draft.") }
            }} />
        </box>
        <box height={1} flexShrink={0} marginTop={1}>
          <Action id="review-submit" disabled={!canSubmit() && !canUseHead() && !canClearLegacy()} onActivate={requestSubmit}>Submit review</Action>
        </box>
      </box>
    </Popup>
    <Show when={confirmation()}>
      <Popup width={72} height={14} placement="center" zIndex={350} onClose={close}>
        <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
          <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>{confirmation() === "submit" ? "Submit review?" : confirmation() === "discard" ? "Discard saved review draft?" : confirmation() === "legacy" ? "Remove old queued inline drafts?" : "Use current commit?"}</text>
          <scrollbox flexGrow={1} minHeight={0} scrollY scrollX={false} focusable={false} ref={value => { confirmationScroll = value; bindScrollbar(value) }}>
            <text flexShrink={0} wrapMode="word" fg={colors.text}>{`PR #${draft()?.number}\nEvent: ${draft() ? eventLabels[draft()!.event] : "…"}\nCommit: ${draft()?.headSha}`}</text>
            <Show when={confirmation() === "head"}><text flexShrink={0} wrapMode="word" fg={colors.yellow}>{`New commit: ${eligibility()?.headSha}\nBy confirming, I acknowledge I inspected the changes at this commit. My review body will be retained.`}</text></Show>
            <Show when={confirmation() === "legacy"}>
              <text flexShrink={0} wrapMode="word" fg={colors.yellow}>Inline comments now post separately. These older drafts will not be sent. Confirming removes only these inline drafts and keeps your overall review body. Copy anything you want to keep before confirming.</text>
              <For each={draft()?.comments}>{comment => <text flexShrink={0} marginTop={1} wrapMode="word" fg={colors.text}>{`${comment.path}:${comment.line}\n${comment.body}`}</text>}</For>
            </Show>
            <Show when={confirmation() === "discard"}><text flexShrink={0} wrapMode="word" fg={colors.yellow}>This removes the local review body and all inline drafts. It does not undo anything on GitHub.</text></Show>
          </scrollbox>
          <box height={1} flexShrink={0} marginTop={1}>
            <Action id="review-confirm" disabled={busy() || (confirmation() === "submit" ? !canSubmit() : confirmation() === "head" ? !canUseHead() : confirmation() === "legacy" ? !canClearLegacy() : locked())} onActivate={() => void confirm()}>
              {confirmation() === "head" ? "I inspected the changes — use current commit" : confirmation() === "discard" ? "Confirm discard" : confirmation() === "legacy" ? "Remove inline drafts" : "Confirm submission"}
            </Action>
          </box>
        </box>
      </Popup>
    </Show>
  </>
}
