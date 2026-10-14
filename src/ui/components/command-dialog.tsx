import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { plainCommandOutput, type CommandSpec, type CommandTask } from "../../command-actions"
import { Popup } from "./popup"
import { useTheme } from "../theme"

export type CommandAction = { title: string; destination?: string; command(destination: string): CommandSpec }

export function CommandDialog(props: {
  action: CommandAction
  onRun(spec: CommandSpec, output: (chunk: string) => void, signal: AbortSignal): Promise<CommandTask>
  onCopy?: (output: string) => Promise<boolean>
  onCaptureCancel?: (cancel: (() => void) | undefined) => void
  onClose(): void
}) {
  const { colors } = useTheme()
  const renderer = useRenderer()
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
  onMount(() => props.onCaptureCancel?.(cancel))
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
  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") { event.stopPropagation(); cancel(); return }
    if (event.name === "escape" || event.name === "esc") {
      event.stopPropagation()
      if (!running()) props.onClose()
      return
    }
    if (event.name === "return" || event.name === "enter") { event.stopPropagation(); void run(); return }
    // While editing the destination, printable keys belong to the input, not the log viewer.
    if (phase() === "Preview" && props.action.destination !== undefined) {
      if (editing()) return
      event.stopPropagation()
      if (event.name === "e" && !event.ctrl && !event.meta) setEditing(true)
      return
    }
    event.stopPropagation()
    if (event.name === "y" && !event.ctrl && !event.meta) void copy()
    else if (event.name === "up" || event.name === "k") scroll?.scrollBy(-1)
    else if (event.name === "down" || event.name === "j") scroll?.scrollBy(1)
    else if (event.name === "u" || event.name === "pageup") scroll?.scrollBy(-Math.max(1, Math.floor((scroll?.viewport.height ?? 1) / 2)))
    else if (event.name === "d" || event.name === "pagedown") scroll?.scrollBy(Math.max(1, Math.floor((scroll?.viewport.height ?? 1) / 2)))
    else if (event.name === "g" && !event.shift) scroll?.scrollTo(0)
    else if (event.name === "G" || event.name === "g" && event.shift) scroll?.scrollTo(scroll.scrollHeight)
  })
  return (
    <Popup width={76} height={phase() === "Preview" ? 7 : 20} placement="center" zIndex={250}>
      <box flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} fg={colors.text}>{props.action.title}{phase() === "Preview" ? "?" : ` — ${phase()}`}</text>
        <Show when={phase() === "Preview"}>
          <box height={2} flexShrink={0} paddingTop={1}>
            <Show when={editing()} fallback={<text fg={colors.muted}>{props.action.destination !== undefined ? `Into ${destination()}` : preview()?.cwd}</text>}>
              <input value={destination()} onInput={setDestination} focused textColor={colors.text} backgroundColor={colors.panel} />
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
          <text height={1} flexShrink={0} fg={colors.muted}>{props.action.destination !== undefined && !editing() ? "e edit path · enter confirm" : "enter confirm"}</text>
        </Show>
      </box>
    </Popup>
  )
}
