import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js"
import type { PullReviewSession, ReviewAnchor, ReviewEvent } from "../../review-types"
import { replaceEditorText, useKeyActions, useKeybindings } from "../keybindings"
import { createMarkdownComposer, type ComposerPresentation } from "../markdown-composer"
import { MarkdownTextarea } from "./markdown-textarea"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { mouseClick, mouseHover } from "../mouse"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { useTheme } from "../theme"
import { reviewAnchorLabel } from "../review-lines"
import { Action } from "./action"
import { GitHubMarkdown } from "./github-markdown"
import { Popup } from "./popup"

export type ReviewCommentDialogProps = ComposerPresentation & {
  anchor: ReviewAnchor
  body?: string
  repositoryUrl: string
  headSha: string
  onChange?(body: string): void
  onSave(body: string): void
  onClose(): void
  onHintChange(hint: string | undefined): void
  showScrollbar: boolean
}

// Kept mounted while previewing: hiding the native editor preserves cursor and undo.
function ReviewEditor(props: ComposerPresentation & {
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
  const [error, setError] = createSignal<string>()
  const [confirming, setConfirming] = createSignal(false)
  let writer: TextareaRenderable | undefined
  onMount(() => writer?.gotoBufferEnd())
  let scroll: ScrollBoxRenderable | undefined
  const composer = createMarkdownComposer(props, {
    editor: () => writer, scroll: () => scroll, blocked: () => confirming(), onError: setError,
  })
  const blocked = () => confirming() || composer.externalEditing()
  const save = () => { if (!blocked() && (props.allowEmpty || body().trim())) setConfirming(true) }
  const clear = () => {
    if (blocked()) return
    if (writer && !writer.isDestroyed) replaceEditorText(writer, "")
    setBody("")
    try { props.onChange?.(""); setError(undefined) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not clear comment text.") }
  }
  const confirm = () => {
    if (!props.allowEmpty && !body().trim()) return
    setConfirming(false)
    setError(undefined)
    try { props.onSave(body()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit comment.") }
  }
  const close = () => {
    if (composer.externalEditing()) return
    if (confirming()) setConfirming(false)
    else props.onClose()
  }
  createEffect(() => props.onHintChange(confirming()
    ? keys.hints(["dialog.confirm", "confirm"], ["dialog.close", "back"])
    : keys.hints(...(props.allowEmpty || body().trim() ? [["dialog.submit", "post"] as const] : []), ["dialog.togglePreview", composer.preview() ? "write" : "preview"],
      ["dialog.toggleExpanded", composer.expanded() ? "restore" : "expand"], ["dialog.externalEditor", "editor"],
      ["dialog.discard", "clear"], ["dialog.close", "back"])))
  onCleanup(() => props.onHintChange(undefined))
  useKeyActions({ "dialog.close": close, "dialog.confirm": confirm }, { when: confirming, priority: 180, modal: true })
  useKeyActions({
    "dialog.close": close,
    "dialog.submit": save,
    "dialog.discard": clear,
    ...composer.actions,
  }, { when: () => !blocked(), priority: 160, modal: true })
  return <><Popup expanded={composer.expanded()} reserveStatusBar={props.showStatusBarHints} width={86} height={27} placement="center" zIndex={300} onClose={close}>
    <box width="100%" alignSelf="center" flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
      <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
        <text flexGrow={1} minWidth={0} wrapMode="none" fg={colors.text} attributes={TextAttributes.BOLD}>{props.title}</text>
        <text fg={colors.muted}>{composer.preview() ? "Preview" : ""}</text>
      </box>
      <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="column" overflow="hidden">
        <MarkdownTextarea id="review-editor-body" ref={value => { writer = value }} initialValue={props.body}
          visible={!composer.preview()} focused={!composer.preview() && !blocked()} flexGrow={1} minHeight={0} width="100%" wrapMode="word"
          placeholder="Write a comment…" placeholderColor={colors.muted} textColor={colors.text}
          focusedTextColor={colors.text} backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} cursorColor={colors.blue}
          onContentChange={() => {
            if (!writer || composer.preview() || blocked() || writer.plainText === body()) return
            setBody(writer.plainText)
            try { props.onChange?.(writer.plainText); setError(undefined) }
            catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save draft.") }
          }} />
        <Show when={composer.preview()}>
          <scrollbox ref={value => { scroll = value; bindScrollbar(value) }} flexGrow={1} minHeight={0} scrollY scrollX={false} focusable={false}>
            <Show when={body().trim()} fallback={<text fg={colors.muted}>Nothing to preview.</text>}>
              <GitHubMarkdown content={body()} syntaxStyle={markdownStyle()} backgroundColor={colors.panel} preserveImages codePanels wide
                context={{ repositoryUrl: props.repositoryUrl, ref: props.headSha }} />
            </Show>
          </scrollbox>
        </Show>
      </box>
      <Show when={error()}><text height={2} flexShrink={0} wrapMode="word" fg={colors.red}>{error()}</text></Show>
      <box height={1} flexShrink={0} marginTop={1}>
        <Action id="review-editor-save" disabled={blocked() || !props.allowEmpty && !body().trim()} onActivate={save}>{props.saveLabel}</Action>
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
  return <ReviewEditor title={reviewAnchorLabel(props.anchor)}
    body={props.body ?? ""} repositoryUrl={props.repositoryUrl} headSha={props.headSha} showScrollbar={props.showScrollbar}
    expanded={props.expanded} onExpandedChange={props.onExpandedChange} showStatusBarHints={props.showStatusBarHints}
    saveLabel="Post" onChange={props.onChange} onSave={props.onSave} onClose={props.onClose} onHintChange={props.onHintChange} />
}

export type PullReviewDialogProps = ComposerPresentation & {
  number?: number
  onEditorActiveChange?(active: boolean): void
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
  const { colors, theme } = useTheme()
  const markdownStyle = createReactiveMarkdownStyle(colors, theme)
  const keys = useKeybindings()
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  const [stage, setStage] = createSignal<"choose" | "edit">("choose")
  const [editorOpened, setEditorOpened] = createSignal(false)
  const [choice, setChoice] = createSignal<ReviewEvent>()
  createEffect(() => props.onEditorActiveChange?.(stage() === "edit"))
  onCleanup(() => props.onEditorActiveChange?.(false))
  const [confirmation, setConfirmation] = createSignal<"submit" | "head" | "legacy">()
  const [localError, setLocalError] = createSignal<string>()
  let writer: TextareaRenderable | undefined
  let confirmationScroll: ScrollBoxRenderable | undefined
  let previewScroll: ScrollBoxRenderable | undefined
  const composer = createMarkdownComposer(props, {
    editor: () => writer, scroll: () => previewScroll,
    blocked: () => stage() !== "edit" || busy() || !!confirmation(), editable: () => !!draft() && !locked(), onError: setLocalError,
  })
  const state = () => props.session.state()
  const draft = () => state().draft
  const eligibility = () => state().eligibility
  const busy = () => state().status === "submitting" || composer.externalEditing()
  const locked = () => busy() || state().status === "loading" || state().status === "idle" || !!state().uncertain || !!draft()?.submission
  const mismatch = () => !!draft() && !!eligibility() && (draft()!.headSha !== eligibility()!.headSha
    || draft()!.baseSha !== eligibility()!.baseSha || (!!draft()!.comments.length && !draft()!.baseSha))
  const allowed = (event: ReviewEvent) => {
    const value = eligibility()
    return !!value && (event === "COMMENT" ? value.canComment : event === "APPROVE" ? value.canApprove : value.canRequestChanges)
  }
  const canChoose = (event: ReviewEvent) => !!draft() && !locked() && !eligibility()?.pendingReviewUrl && allowed(event)
  const available = createMemo(() => events.filter(canChoose))
  const activeChoice = () => {
    const preferred = choice() ?? draft()?.event
    return available().find(event => event === preferred) ?? available()[0]
  }
  const moveChoice = (direction: number) => {
    const options = available()
    if (!options.length) return
    const index = Math.max(0, options.indexOf(activeChoice()!))
    setChoice(options[(index + direction + options.length) % options.length])
  }
  const validFeedback = () => draft()?.event === "APPROVE" || !!draft()?.body.trim()
  const canClearLegacy = () => !!draft()?.comments.length && !locked()
  const canSubmit = () => state().status === "ready" && !locked() && !!draft() && !mismatch()
    && !eligibility()?.pendingReviewUrl && !draft()!.comments.length && allowed(draft()!.event) && validFeedback()
  const canUseHead = () => (state().status === "ready" || state().status === "error") && !locked() && mismatch() && draft()?.comments.length === 0
  const choose = (event = activeChoice()) => {
    if (!event || !canChoose(event)) return
    try {
      props.session.setEvent(event)
      setChoice(event)
      setLocalError(undefined)
      setEditorOpened(true)
      setStage("edit")
    } catch (error) { setLocalError(error instanceof Error ? error.message : "Could not select review type.") }
  }
  createEffect(() => {
    const body = draft()?.body ?? ""
    if (writer && !writer.isDestroyed && writer.plainText !== body) untrack(() => writer?.setText(body))
  })
  const requestSubmit = () => {
    if (stage() !== "edit") return
    if (canSubmit()) setConfirmation("submit")
    else if (canUseHead()) setConfirmation("head")
    else if (canClearLegacy()) setConfirmation("legacy")
  }
  const close = () => {
    if (busy()) return
    if (confirmation()) setConfirmation(undefined)
    else if (stage() === "edit") setStage("choose")
    else props.onClose()
  }
  // Written for another repository that used this name: it can never be submitted here.
  const foreign = () => draft()?.repositoryId !== undefined && !!eligibility() && draft()!.repositoryId !== eligibility()!.repositoryId
  const clearBody = () => {
    if (stage() !== "edit" || !draft() || locked() || confirmation()) return
    // Clearing a foreign draft removes it, inline comments included; the editor then shows the new blank draft.
    if (foreign()) return void props.session.discard().then(() => {
      if (writer && !writer.isDestroyed) replaceEditorText(writer, props.session.state().draft?.body ?? "")
    })
    try {
      if (writer && !writer.isDestroyed) replaceEditorText(writer, "")
      props.session.setBody("")
      setLocalError(undefined)
    } catch (error) { setLocalError(error instanceof Error ? error.message : "Could not clear review text.") }
  }
  const confirm = () => {
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
    }
  }
  createEffect(() => props.onHintChange(busy() ? "Saving…" : confirmation()
    ? keys.hints(["dialog.confirm", "confirm"], ["dialog.close", "back"])
    : stage() === "choose" ? keys.hints(
      ...(available().length ? [["navigation.activate", "select"]] as const : []),
      ["dialog.close", "close"])
    : keys.hints(
      ...(canSubmit() || canUseHead() || canClearLegacy() ? [["dialog.submit", canSubmit() ? "submit review" : canUseHead() ? "use current commit" : "review old comments"] as const] : []),
      ["dialog.togglePreview", composer.preview() ? "write" : "preview"],
      ["dialog.toggleExpanded", composer.expanded() ? "restore" : "expand"],
      ...(draft() && !locked() ? [["dialog.externalEditor", "editor"] as const] : []),
      ...(draft() && !locked() ? [["dialog.discard", "clear"] as const] : []), ["dialog.close", "back"])))
  onCleanup(() => props.onHintChange(undefined))
  useKeyActions({}, { when: busy, priority: 200, modal: true })
  useKeyActions({
    "dialog.close": close,
    "navigation.activate": () => choose(),
    "navigation.up": () => moveChoice(-1),
    "navigation.down": () => moveChoice(1),
  }, { when: () => stage() === "choose" && !busy(), priority: 100, modal: true })
  useKeyActions({
    "dialog.close": close, "dialog.confirm": () => void confirm(),
    "navigation.up": () => confirmationScroll?.scrollBy(-1), "navigation.down": () => confirmationScroll?.scrollBy(1),
    "navigation.pageUp": () => confirmationScroll?.scrollBy(-confirmationScroll.viewport.height),
    "navigation.pageDown": () => confirmationScroll?.scrollBy(confirmationScroll.viewport.height),
  }, { when: () => !!confirmation() && !busy(), priority: 180, modal: true })
  useKeyActions({
    "dialog.close": close, "dialog.submit": requestSubmit,
    "dialog.discard": clearBody,
    ...composer.actions,
  }, { when: () => stage() === "edit" && !confirmation() && !busy(), priority: 100, modal: true })
  const warning = () => [...new Set([
    state().message && (state().status === "error" || state().message !== eligibility()?.reason && state().message !== "Review submitted.") ? state().message : undefined,
    localError(),
    !eligibility()?.canComment || (stage() === "choose" && !eligibility()?.canApprove) ? eligibility()?.reason : undefined,
    state().uncertain || draft()?.submission ? "Submission outcome uncertain. Draft preserved; check GitHub before retrying." : undefined,
    mismatch() ? "The diff changed. Inspect the latest changes before using the current commit." : undefined,
  ].filter(Boolean))].join("\n")
  return <>
    <Show when={stage() === "choose"}>
      <Popup width={52} height={8 + (warning() ? 4 : 0)} placement="center" zIndex={250} onClose={close}>
        <box id="review-type-menu" flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
          <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Review PR #{props.number ?? draft()?.number ?? eligibility()?.number ?? "…"}</text>
          <box height={1} flexShrink={0} />
          <For each={events}>{event => {
            const hover = mouseHover(() => canChoose(event), () => event)
            return <box id={`review-type-${event}`} height={1} flexShrink={0}
              backgroundColor={activeChoice() === event || hover.hovered() ? colors.panelHover : colors.panel}
              {...mouseClick(() => choose(event), () => canChoose(event), () => event, hover)}>
              <text selectable={false} fg={!canChoose(event) ? colors.muted : activeChoice() === event || hover.hovered() ? colors.blue : colors.text}
                attributes={hover.hovered() ? TextAttributes.BOLD : TextAttributes.NONE}>{activeChoice() === event ? "› " : "  "}{eventLabels[event]}…</text>
            </box>
          }}</For>
          <Show when={warning()}><text maxHeight={3} flexShrink={0} marginTop={1} fg={colors.yellow} wrapMode="word">{warning()}</text></Show>
        </box>
      </Popup>
    </Show>
    <Show when={editorOpened()}>
    <Popup visible={stage() === "edit"} expanded={composer.expanded()} reserveStatusBar={props.showStatusBarHints} width={86} height={27} placement="center" zIndex={250} onClose={close}>
      <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
          <text minWidth={0} wrapMode="none" truncate fg={colors.text} attributes={TextAttributes.BOLD}>{draft()?.event === "APPROVE" ? "Approve" : draft()?.event === "REQUEST_CHANGES" ? "Request changes on" : "Comment on"} PR #{props.number ?? draft()?.number ?? eligibility()?.number ?? "…"}</text>
          <text fg={colors.muted}>{composer.preview() ? "Preview" : ""}</text>
        </box>
        <Show when={warning()}>
          <text maxHeight={3} flexShrink={0} wrapMode="word" fg={colors.yellow}>{warning()}</text>
        </Show>
        <box flexGrow={1} minHeight={0} flexDirection="column" marginTop={1} overflow="hidden">
          <MarkdownTextarea id="review-body" ref={value => { writer = value; value.setText(draft()?.body ?? "") }}
            initialValue={draft()?.body ?? ""} visible={!composer.preview()} focused={stage() === "edit" && !!draft() && !locked() && !confirmation() && !composer.preview()}
            flexGrow={1} minHeight={0} width="100%" wrapMode="word" placeholder={draft()?.event === "APPROVE" ? "Add an optional message…" : "Write review feedback…"}
            placeholderColor={colors.muted} textColor={colors.text} focusedTextColor={colors.text}
            backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} cursorColor={colors.blue}
            onContentChange={() => {
              if (!writer || stage() !== "edit" || locked() || confirmation() || composer.preview() || writer.plainText === draft()?.body) return
              try { props.session.setBody(writer.plainText); setLocalError(undefined) }
              catch (error) { setLocalError(error instanceof Error ? error.message : "Could not save draft.") }
            }} />
          <Show when={composer.preview()}>
            <scrollbox ref={value => { previewScroll = value; bindScrollbar(value) }} flexGrow={1} minHeight={0} scrollY scrollX={false} focusable={false}>
              <Show when={draft()?.body.trim()} fallback={<text fg={colors.muted}>Nothing to preview.</text>}>
                <GitHubMarkdown content={draft()?.body ?? ""} syntaxStyle={markdownStyle()} backgroundColor={colors.panel} preserveImages codePanels wide
                  context={{ repositoryUrl: props.repositoryUrl, ref: draft()?.headSha }} />
              </Show>
            </scrollbox>
          </Show>
        </box>
        <box height={1} flexShrink={0} marginTop={1}>
          <Action id="review-submit" disabled={!canSubmit() && !canUseHead() && !canClearLegacy()} onActivate={requestSubmit}>Submit review</Action>
        </box>
      </box>
    </Popup>
    </Show>
    <Show when={confirmation()}>
      <Popup width={72} height={14} placement="center" zIndex={350} onClose={close}>
        <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
          <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>{confirmation() === "submit" ? "Submit review?" : confirmation() === "legacy" ? "Remove old queued inline drafts?" : "Use current commit?"}</text>
          <scrollbox flexGrow={1} minHeight={0} scrollY scrollX={false} focusable={false} ref={value => { confirmationScroll = value; bindScrollbar(value) }}>
            <text flexShrink={0} wrapMode="word" fg={colors.text}>{`PR #${draft()?.number}\nEvent: ${draft() ? eventLabels[draft()!.event] : "…"}`}</text>
            <Show when={confirmation() === "head"}><text flexShrink={0} wrapMode="word" fg={colors.yellow}>{`New commit: ${eligibility()?.headSha}\nBy confirming, I acknowledge I inspected the changes at this commit. My review body will be retained.`}</text></Show>
            <Show when={confirmation() === "legacy"}>
              <text flexShrink={0} wrapMode="word" fg={colors.yellow}>Inline comments now post separately. These older drafts will not be sent. Confirming removes only these inline drafts and keeps your overall review body. Copy anything you want to keep before confirming.</text>
              <For each={draft()?.comments}>{comment => <text flexShrink={0} marginTop={1} wrapMode="word" fg={colors.text}>{`${comment.path}:${comment.line}\n${comment.body}`}</text>}</For>
            </Show>
          </scrollbox>
          <box height={1} flexShrink={0} marginTop={1}>
            <Action id="review-confirm" disabled={busy() || (confirmation() === "submit" ? !canSubmit() : confirmation() === "head" ? !canUseHead() : confirmation() === "legacy" ? !canClearLegacy() : locked())} onActivate={() => void confirm()}>
              {confirmation() === "head" ? "I inspected the changes — use current commit" : confirmation() === "legacy" ? "Remove inline drafts" : "Confirm submission"}
            </Action>
          </box>
        </box>
      </Popup>
    </Show>
  </>
}
