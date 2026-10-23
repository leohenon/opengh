import type { CliRenderer } from "@opentui/core"

export type ClipboardNotice = {
  title: string
  message: string
  duration?: number
  tone?: "error" | "success" | "info"
}

const clipboardWrites = new WeakMap<CliRenderer, Promise<void>>()

// A terminal write is only a dispatch, not confirmation that OSC 52 was accepted.
export function copyText(
  renderer: CliRenderer,
  copyToHost: ((value: string) => Promise<boolean>) | undefined,
  value: string,
  label: "SHA" | "URL" | "Text",
  isActive: () => boolean = () => true,
): Promise<ClipboardNotice | undefined> {
  // Manual copies and mouse selections share ordering for this renderer.
  const previous = clipboardWrites.get(renderer) ?? Promise.resolve()
  const write = previous.then(async (): Promise<ClipboardNotice | undefined> => {
    if (renderer.isDestroyed || !isActive()) return
    try {
      let copied = false
      let hostError: unknown
      try { copied = await copyToHost?.(value) ?? false } catch (error) { hostError = error }
      if (renderer.isDestroyed || !isActive()) return
      if (!copied && !renderer.copyToClipboardOSC52(value))
        throw hostError ?? new Error(`Clipboard unavailable. Enable OSC 52 or copy the ${label} manually.`)
      return copied
        ? { title: `${label} copied to clipboard`, message: "", duration: 2000, tone: "success" }
        : { title: `${label} sent to terminal`, message: "Copy could not be confirmed. Your terminal/tmux must allow OSC 52 clipboard requests.", duration: 4000, tone: "info" }
    } catch (error) {
      if (!renderer.isDestroyed && isActive()) return {
        title: `Could not copy ${label}`,
        message: error instanceof Error ? error.message : "Unknown error",
      }
    }
  })
  const settled = write.then(() => {}, () => {})
  clipboardWrites.set(renderer, settled)
  void settled.then(() => {
    if (clipboardWrites.get(renderer) === settled) clipboardWrites.delete(renderer)
  })
  return write
}
