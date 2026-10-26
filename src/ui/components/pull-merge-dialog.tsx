import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import type { PullMergeDraft, PullMergeMessage, PullMergeMethod } from "../../models"
import { KeyInput, KeyTextarea, useKeyActions, useKeybindings } from "../keybindings"
import { mouseClick, mouseHover } from "../mouse"
import { useTheme } from "../theme"
import { Action } from "./action"
import { Popup } from "./popup"

const labels: Record<PullMergeMethod, string> = {
  merge: "Merge pull request",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
}

export function PullMergeDialog(props: {
  number: number
  headSha: string
  methods: PullMergeMethod[]
  reason?: string
  checking?: boolean
  onLoadMessage(): Promise<PullMergeDraft>
  onSubmit(method: PullMergeMethod, headSha: string, message?: PullMergeMessage): void
  onHintChange(hint: string | undefined): void
  onClose(): void
}) {
  const { colors } = useTheme()
  const keys = useKeybindings()
  const [selected, setSelected] = createSignal(0)
  const [method, setMethod] = createSignal<PullMergeMethod>()
  const [stage, setStage] = createSignal<"methods" | "edit" | "confirm">("methods")
  const [message, setMessage] = createSignal<PullMergeDraft>()
  const [field, setField] = createSignal<"headline" | "body">("headline")
  const [loading, setLoading] = createSignal(false)
  const [loadError, setLoadError] = createSignal<string>()
  let disposed = false
  let writer: TextareaRenderable | undefined
  let preview: ScrollBoxRenderable | undefined
  const active = () => Math.min(selected(), Math.max(0, props.methods.length - 1))
  const validMessage = () => !!message()?.headline.trim() && !/[\r\n]/.test(message()!.headline)
  const available = () => !props.reason && !!method() && props.methods.includes(method()!)
  const canConfirm = () => available() && (method() !== "squash" || validMessage() && message()?.headSha === props.headSha)
  const changeMessage = (update: Partial<PullMergeDraft>) => {
    const current = message()
    if (!current || loading()) return
    const next = { ...current, ...update }
    setMessage(next)
  }
  const loadMessage = async () => {
    if (loading() || message()) return
    setLoading(true)
    setLoadError(undefined)
    try {
      const draft = await props.onLoadMessage()
      if (!disposed) setMessage(draft)
    } catch (error) {
      if (!disposed) setLoadError(error instanceof Error ? error.message : "Could not load GitHub's commit message.")
    } finally {
      if (!disposed) setLoading(false)
    }
  }
  const choose = () => {
    const next = props.methods[active()]
    if (props.reason || !next) return
    setMethod(next)
    setStage(next === "squash" ? "edit" : "confirm")
    if (next === "squash") void loadMessage()
  }
  const reviewMessage = () => {
    if (!available() || loading() || !validMessage()) return
    setStage("confirm")
  }
  const close = () => {
    if (stage() === "confirm") setStage(method() === "squash" ? "edit" : "methods")
    else if (stage() === "edit") {
      setStage("methods")
      setMessage(undefined)
      setField("headline")
      setLoadError(undefined)
    }
    else props.onClose()
  }
  const submit = () => {
    if (!canConfirm()) return
    props.onSubmit(method()!, props.headSha, method() === "squash"
      ? { headline: message()!.headline, body: message()!.body } : undefined)
  }
  createEffect(() => props.onHintChange(stage() === "confirm"
    ? keys.hints(["dialog.confirm", "merge"], ["dialog.close", "back"])
    : stage() === "edit" ? loading() ? keys.hints(["dialog.close", "back"])
      : loadError() ? keys.hints(["dialog.submit", "retry"], ["dialog.close", "back"])
      : keys.hints(["dialog.submit", "review"], [["dialog.nextField", "dialog.previousField"], "field"], ["dialog.close", "back"])
    : keys.hints([["navigation.up", "navigation.down"], "method"], ["navigation.activate", "select"], ["dialog.close", "cancel"])))
  onCleanup(() => { disposed = true; props.onHintChange(undefined) })
  useKeyActions({
    "dialog.close": close,
    "navigation.up": () => setSelected(Math.max(0, active() - 1)),
    "navigation.down": () => setSelected(Math.min(props.methods.length - 1, active() + 1)),
    "navigation.activate": choose,
    "dialog.submit": choose,
  }, { when: () => stage() === "methods", priority: 100, modal: true })
  const nextField = () => setField((current) => current === "headline" ? "body" : "headline")
  useKeyActions({ "dialog.close": close, "dialog.submit": () => loadError() ? void loadMessage() : reviewMessage(),
    "dialog.nextField": nextField, "dialog.previousField": nextField,
  }, { when: () => stage() === "edit", priority: 100, modal: true })
  useKeyActions({ "dialog.close": close, "dialog.confirm": submit,
    "navigation.up": () => preview?.scrollBy(-1), "navigation.down": () => preview?.scrollBy(1),
    "navigation.pageUp": () => preview?.scrollBy(-(preview.viewport.height || 1)),
    "navigation.pageDown": () => preview?.scrollBy(preview.viewport.height || 1),
  }, { when: () => stage() === "confirm", priority: 150, modal: true })

  return (
    <Popup width={64} height={(stage() === "edit" ? 22 : stage() === "confirm" ? method() === "squash" ? 18 : 10 : props.methods.length + 6)
      + (props.reason && !props.checking ? 4 : 0)} placement="center" zIndex={250} onClose={close}>
      <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} attributes={TextAttributes.BOLD} fg={colors.text}>Merge PR #{props.number}</text>
        <text height={1} flexShrink={0} marginTop={1} fg={colors.muted}>Head commit: {props.headSha.slice(0, 12)}</text>
        <Show when={stage() === "methods"}>
          <box marginTop={1} flexDirection="column" flexShrink={0}>
            <For each={props.methods}>{(item, index) => {
              const hover = mouseHover(() => !props.reason, () => item)
              return <box id={`merge-method-${item}`} height={1} flexShrink={0}
                backgroundColor={active() === index() || hover.hovered() ? colors.panelHover : colors.panel}
                {...mouseClick(() => { setSelected(index()); choose() }, () => !props.reason, () => item, hover)}>
                <text selectable={false} fg={props.reason ? colors.muted : active() === index() || hover.hovered() ? colors.blue : colors.text}
                  attributes={hover.hovered() ? TextAttributes.BOLD : TextAttributes.NONE}>{active() === index() ? "› " : "  "}{labels[item]}</text>
              </box>
            }}</For>
          </box>
        </Show>
        <Show when={stage() !== "methods" && method() === "squash"}>
          <box visible={stage() === "edit"} flexGrow={1} minHeight={0} flexDirection="column">
            <Show when={loading()}><text marginTop={1} fg={colors.muted}>Loading GitHub's commit message…</text></Show>
            <Show when={loadError()}>
              <text marginTop={1} fg={colors.red} wrapMode="word">{loadError()}</text>
              <Action id="merge-message-retry" onActivate={() => void loadMessage()}>Retry loading message</Action>
            </Show>
            <Show when={!!message() && !loading()}>
              <text height={1} flexShrink={0} marginTop={1} fg={colors.muted}>Commit title</text>
              <KeyInput id="merge-message-headline" width="100%" value={message()?.headline ?? ""}
                focused={stage() === "edit" && field() === "headline"} onMouseDown={() => setField("headline")} onSubmit={() => setField("body")}
                textColor={colors.text} focusedTextColor={colors.text} backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} cursorColor={colors.blue}
                onInput={(headline) => changeMessage({ headline })} />
              <text height={1} flexShrink={0} marginTop={1} fg={colors.muted}>Description (optional)</text>
              <KeyTextarea id="merge-message-body" ref={(value) => { writer = value }} initialValue={message()?.body ?? ""}
                flexGrow={1} minHeight={1} width="100%" wrapMode="word" focused={stage() === "edit" && field() === "body"} onMouseDown={() => setField("body")}
                textColor={colors.text} focusedTextColor={colors.text} backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} cursorColor={colors.blue}
                onContentChange={() => { if (writer && stage() === "edit") changeMessage({ body: writer.plainText }) }} />
            </Show>
            <box flexGrow={message() ? 0 : 1} minHeight={1} />
            <box height={1} flexShrink={0}>
              <Action id="merge-message-continue" disabled={!available() || loading() || !validMessage()} onActivate={reviewMessage}>Continue</Action>
            </box>
          </box>
        </Show>
        <Show when={stage() === "confirm"}>
          <text marginTop={1} flexShrink={0} fg={colors.text} wrapMode="word">{method() === "merge" ? "Merge pull request" : `${labels[method()!]} PR`} #{props.number}?</text>
          <Show when={method() === "squash"}>
            <scrollbox ref={(value) => { preview = value }} marginTop={1} flexGrow={1} minHeight={0} scrollY focusable={false}>
              <text fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="word">{message()?.headline}</text>
              <Show when={message()?.body}><text marginTop={1} fg={colors.text} wrapMode="word">{message()?.body}</text></Show>
            </scrollbox>
          </Show>
        </Show>
        <Show when={props.reason && !props.checking}>
          <text marginTop={1} flexShrink={0} fg={colors.yellow} wrapMode="word">{props.reason}</text>
        </Show>
        <Show when={stage() === "confirm"}>
          <box flexGrow={method() === "squash" ? 0 : 1} minHeight={1} />
          <box height={1} flexShrink={0} flexDirection="row">
            <Action id="merge-confirm" disabled={!canConfirm()} onActivate={submit}>Confirm merge</Action>
          </box>
        </Show>
      </box>
    </Popup>
  )
}
