import type { ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { plainCommandOutput, type CommandSpec, type CommandTask } from "../../command-actions"
import { Popup } from "./popup"
import { useTheme } from "../theme"
import { KeyInput, useKeyActions, useKeybindings } from "../keybindings"

export type CommandAction = { title: string; destination?: string; command(destination: string): CommandSpec }

export function CommandDialog(props: {
  action: CommandAction
  onRun(spec: CommandSpec, output: (chunk: string) => void, signal: AbortSignal): Promise<CommandTask>
  onCopy?: (output: string) => Promise<boolean>
  onCaptureCancel?: (cancel: (() => void) | undefined) => void
  onHintChange?: (hint: string | undefined) => void
  onConfirmationChange?: (confirming: boolean) => void
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
  const hint = () => phase() === "Preview"
    ? keys.hints(...(props.action.destination !== undefined && !editing() ? [["command.editPath", "edit path"] as const] : []), ["dialog.confirm", "confirm"], ["dialog.close", "close"])
    : keys.hints([["navigation.up", "navigation.down"], "scroll"], ["command.copyOutput", "copy output"], [running() ? "global.interrupt" : "dialog.close", running() ? "cancel" : "close"])
  createEffect(() => props.onHintChange?.(hint()))
  createEffect(() => props.onConfirmationChange?.(phase() === "Preview"))
  onCleanup(() => { props.onHintChange?.(undefined); props.onConfirmationChange?.(false) })
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
    try {
      const text = plainCommandOutput(output())
      const copied = await props.onCopy?.(text)
      if (!copied && !renderer.copyToClipboardOSC52(text)) throw new Error("Clipboard unavailable")
      setNotice(copied ? "Output copied" : "Output sent to terminal clipboard (OSC 52)")
    } catch (error) { setNotice(String(error)) }
  }
  useKeyActions({
    "dialog.close": () => props.onClose(),
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
    "dialog.close": () => { if (!running()) props.onClose() },
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
    <Popup width={76} height={phase() === "Preview" ? 7 : 20} placement="center" zIndex={250}>
      <box flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} fg={colors.text}>{props.action.title}{phase() === "Preview" ? "?" : ` — ${phase()}`}</text>
        <Show when={phase() === "Preview"}>
          <box height={2} flexShrink={0} paddingTop={1}>
            <Show when={editing()} fallback={<text fg={colors.muted}>{props.action.destination !== undefined ? `Into ${destination()}` : preview()?.cwd}</text>}>
              <KeyInput value={destination()} onInput={setDestination} focused textColor={colors.text} focusedTextColor={colors.text} backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} cursorColor={colors.blue} />
            </Show>
          </box>
        </Show>
        <Show when={phase() !== "Preview"} fallback={<box flexGrow={1} />}>
          <scrollbox ref={(value) => { scroll = value }} flexGrow={1} minHeight={0} scrollX={false} scrollY stickyScroll stickyStart="bottom">
            <text fg={colors.text}>{plainCommandOutput(output())}</text>
          </scrollbox>
        </Show>
        <Show when={notice()}><text height={1} flexShrink={0} fg={colors.muted}>{notice()}</text></Show>
        <Show when={phase() === "Preview"}>
          <text height={1} flexShrink={0} fg={colors.muted}>{hint()}</text>
        </Show>
      </box>
    </Popup>
  )
}
