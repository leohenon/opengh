import type { ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { plainCommandOutput, type CommandSpec, type CommandTask } from "../../command-actions"
import { copyText } from "../clipboard"
import { mouseClick } from "../mouse"
import { Popup } from "./popup"
import { Action } from "./action"
import { useTheme } from "../theme"
import { KeyInput, useKeyActions, useKeybindings } from "../keybindings"

export type CommandAction = { title: string; destination?: string; command(destination: string): CommandSpec }

export function CommandDialog(props: {
  action: CommandAction
  onRun(spec: CommandSpec, output: (chunk: string) => void, signal: AbortSignal): Promise<CommandTask>
  onCopy?: (output: string) => Promise<boolean>
  onCaptureCancel?: (cancel: (() => void) | undefined) => void
  onHintChange?: (hint: string | undefined) => void
  onClose(): void
}) {
  const { colors } = useTheme()
  const renderer = useRenderer()
  const keys = useKeybindings()
  const [destination, setDestination] = createSignal(props.action.destination ?? "")
  const [phase, setPhase] = createSignal("Preview")
  const [output, setOutput] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [editing, setEditing] = createSignal(false)
  const abort = new AbortController()
  let task: CommandTask | undefined
  let cancelled = false
  let disposed = false
  let scroll: ScrollBoxRenderable | undefined
  const running = () => phase() === "Running" || phase() === "Cancelling"
  const requestClose = () => { if (!running()) props.onClose() }
  const hint = () => phase() === "Preview"
    ? keys.hints(["dialog.confirm", "confirm"], ...(props.action.destination !== undefined && !editing() ? [["command.editPath", "edit path"] as const] : []), ["dialog.close", "close"])
    : keys.hints([running() ? "global.interrupt" : "dialog.close", running() ? "cancel" : "close"], ["command.copyOutput", "copy output"], [["navigation.up", "navigation.down"], "scroll"])
  createEffect(() => props.onHintChange?.(hint()))
  onCleanup(() => props.onHintChange?.(undefined))
  const preview = () => {
    try { return props.action.command(destination()) } catch { return undefined }
  }
  const append = (chunk: string) => { if (!disposed) setOutput((value) => value + chunk) }
  const cancel = () => {
    if (!running()) return
    cancelled = true
    abort.abort()
    setPhase("Cancelling")
    task?.cancel()
  }
  createEffect(() => props.onCaptureCancel?.(running() ? cancel : undefined))
  onCleanup(() => { disposed = true; abort.abort(); task?.cancel(); props.onCaptureCancel?.(undefined) })
  const run = async () => {
    if (phase() !== "Preview") return
    try {
      const command = props.action.command(destination())
      setPhase("Running")
      task = await props.onRun(command, append, abort.signal)
      if (cancelled || disposed) task.cancel()
      const result = await task.result
      if (disposed) return
      setPhase(`${result.cancelled ? "Cancelled" : result.exitCode === 0 ? "Succeeded" : "Failed"} (exit ${result.exitCode ?? "unavailable"})`)
    } catch (error) {
      append(`\n${error instanceof Error ? error.message : String(error)}\n`)
      setPhase(cancelled ? "Cancelled (exit unavailable)" : "Failed (exit unavailable)")
    }
  }
  const copy = async () => {
    const result = await copyText(renderer, props.onCopy, plainCommandOutput(output()), "Text", () => !disposed)
    if (result) setNotice(result.tone === "success" ? "Output copied"
      : result.tone === "info" ? "Output sent to terminal clipboard (OSC 52)" : result.message)
  }
  useKeyActions({
    "dialog.close": requestClose,
    "dialog.confirm": () => { void run() },
    "command.editPath": () => {
      if (editing() || props.action.destination === undefined) return false
      setEditing(true)
    },
  }, { when: () => phase() === "Preview", priority: 100, modal: true })
  const scrollPage = (direction: number, half = false) => {
    scroll?.scrollBy(direction * Math.max(1, Math.floor((scroll?.viewport.height ?? 1) / (half ? 2 : 1))))
  }
  useKeyActions({
    "global.interrupt": cancel,
    "dialog.close": requestClose,
    "command.copyOutput": () => { void copy() },
    "navigation.up": () => { scroll?.scrollBy(-1) },
    "navigation.down": () => { scroll?.scrollBy(1) },
    "navigation.halfPageUp": () => scrollPage(-1, true),
    "navigation.halfPageDown": () => scrollPage(1, true),
    "navigation.pageUp": () => scrollPage(-1),
    "navigation.pageDown": () => scrollPage(1),
    "navigation.first": () => { scroll?.scrollTo(0) },
    "navigation.last": () => { if (scroll) scroll.scrollTo(scroll.scrollHeight) },
  }, { when: () => phase() !== "Preview", priority: 100, modal: true })
  return (
    <Popup width={76} height={phase() === "Preview" ? 7 : 20} placement="center" zIndex={250} onClose={requestClose}>
      <box flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} fg={colors.text}>{props.action.title}{phase() === "Preview" ? "?" : ` — ${phase()}`}</text>
        <Show when={phase() === "Preview"}>
          <box height={2} flexShrink={0} paddingTop={1}>
            <Show when={editing()} fallback={<text id="command-destination" fg={colors.muted} {...mouseClick(() => setEditing(true), () => phase() === "Preview" && props.action.destination !== undefined && !editing())}>{props.action.destination !== undefined ? `Into ${destination()}` : preview()?.cwd}</text>}>
              <KeyInput value={destination()} onInput={setDestination} focused textColor={colors.text} focusedTextColor={colors.text} backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} cursorColor={colors.blue} />
            </Show>
          </box>
        </Show>
        <Show when={phase() !== "Preview"}>
          <scrollbox ref={(value) => { scroll = value }} focusable={false} flexGrow={1} minHeight={0} scrollX={false} scrollY stickyScroll stickyStart="bottom">
            <text fg={colors.text}>{plainCommandOutput(output())}</text>
          </scrollbox>
        </Show>
        <Show when={notice()}><text height={1} flexShrink={0} fg={colors.muted}>{notice()}</text></Show>
        <Show when={phase() === "Preview" || running()}>
          <box height={2} paddingTop={1} flexShrink={0} flexDirection="row" gap={2}>
            <Show when={phase() === "Preview"} fallback={
              <Action id="command-cancel" disabled={phase() === "Cancelling"} onActivate={cancel}>Cancel</Action>
            }>
              <Action id="command-confirm" onActivate={() => void run()}>Confirm</Action>
            </Show>
          </box>
        </Show>
      </box>
    </Popup>
  )
}
