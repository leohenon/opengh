import { CliRenderEvents, type Selection } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createSignal, onCleanup, Show } from "solid-js"
import { copyText, type ClipboardNotice } from "../clipboard"
import { Toast } from "./toast"

export function SelectionClipboard(props: {
  onCopy: (value: string) => Promise<boolean>
}) {
  const renderer = useRenderer()
  const [notice, setNotice] = createSignal<ClipboardNotice>()
  let disposed = false
  let request = 0
  const selected = (selection: Selection) => {
    if (selection.isDragging || selection.isStart && selection.behavior === "cell") return
    // Snapshot now: the selection/renderables may change before a clipboard write completes.
    const text = selection.getSelectedText()
    if (!text) return
    renderer.clearSelection()
    renderer.requestRender()
    const id = ++request
    const active = () => !disposed
    void copyText(renderer, props.onCopy, text, "Text", active).then((result) => {
      if (active() && !renderer.isDestroyed && id === request && result) setNotice(result)
    })
  }
  renderer.on(CliRenderEvents.SELECTION, selected)
  onCleanup(() => {
    disposed = true
    renderer.off(CliRenderEvents.SELECTION, selected)
  })
  return <Show when={notice()} keyed>{(current) => (
    <Toast {...current} duration={current.tone === "success" ? 1000 : current.duration} zIndex={300} onDismiss={() => setNotice(undefined)} />
  )}</Show>
}
