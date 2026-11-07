import { MouseButton, RGBA, TargetChannel, type MouseEvent, type Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createContext, createEffect, onCleanup, useContext, type JSX } from "solid-js"
import { mouseHover } from "./mouse"
import { useTheme } from "./theme"

type Press = { x: number; y: number; url: string; target: Renderable | null; identity: unknown }
type HoveredLink = { x: number; y: number; target: Renderable; url: string; identity: unknown }
type Links = {
  identity: unknown
  open: (url: string) => void
  press?: Press
  move: (event: MouseEvent, url: string | null) => void
  leave: (event: MouseEvent) => void
  clearHover: (block?: boolean) => void
}
const Hyperlinks = createContext<Links>()

export function HyperlinkProvider(props: { identity: unknown; onOpen: (url: string) => void; children: JSX.Element }) {
  const renderer = useRenderer()
  const { theme } = useTheme()
  let hovered: HoveredLink | undefined
  let blocked: { x: number; y: number } | undefined
  const links: Links = {
    get identity() { return props.identity },
    open: (url) => props.onOpen(url),
    clearHover(block = true) {
      if (!hovered) return
      if (block) blocked = { x: hovered.x, y: hovered.y }
      hovered = undefined
      if (!renderer.isDestroyed) renderer.requestRender()
    },
    move(event, url) {
      if (blocked?.x === event.x && blocked.y === event.y) return
      blocked = undefined
      const next = url && event.target && !event.isDragging
        ? { x: event.x, y: event.y, target: event.target, url, identity: props.identity } : undefined
      const changed = hovered?.target !== next?.target || hovered?.url !== next?.url
      hovered = next
      if (changed && !renderer.isDestroyed) renderer.requestRender()
    },
    leave(event) { if (hovered?.target === event.target) links.clearHover() },
  }
  let mask = new Float32Array(0)
  const matrix = new Float32Array(16)
  let tintColor = ""
  const paintHover: Parameters<typeof renderer.addPostProcessFn>[0] = (buffer) => {
    const point = hovered
    if (!point) return
    if (point.target.isDestroyed || point.identity !== props.identity
      || renderer.hitTest(point.x, point.y) !== point.target.num || renderer.getLinkAt(point.x, point.y) !== point.url) {
      links.clearHover()
      return
    }
    const selection = renderer.getSelection()
    if (selection && (selection.isDragging || !selection.isStart || selection.behavior !== "cell")) return
    const link = renderer.getLinkIdAt(point.x, point.y)
    if (!link) return
    if (mask.length < buffer.width * buffer.height * 3) mask = new Float32Array(buffer.width * buffer.height * 3)
    let used = 0
    const left = Math.max(0, point.target.x)
    const top = Math.max(0, point.target.y)
    const right = Math.min(buffer.width, point.target.x + point.target.width)
    const bottom = Math.min(buffer.height, point.target.y + point.target.height)
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      if (renderer.getLinkIdAt(x, y) === link && renderer.hitTest(x, y) === point.target.num) {
        mask[used++] = x
        mask[used++] = y
        mask[used++] = 1
      }
    }
    if (tintColor !== theme.markdownLink) {
      tintColor = theme.markdownLink
      const tint = RGBA.fromHex(tintColor)
      matrix.set([0, 0, 0, tint.r, 0, 0, 0, tint.g, 0, 0, 0, tint.b, 0, 0, 0, 1])
    }
    // Color-only transforms preserve wide glyphs and hyperlink IDs.
    if (used) buffer.colorMatrix(matrix, mask.subarray(0, used), 0.06, TargetChannel.BG)
  }
  renderer.addPostProcessFn(paintHover)
  const cancel = () => { links.press = undefined; links.clearHover() }
  createEffect(() => { props.identity; cancel() })
  renderer.keyInput.prependListener("keypress", cancel)
  renderer.keyInput.prependListener("paste", cancel)
  onCleanup(() => {
    renderer.removePostProcessFn(paintHover)
    cancel()
    renderer.keyInput.off("keypress", cancel)
    renderer.keyInput.off("paste", cancel)
  })
  return <Hyperlinks.Provider value={links}>{props.children}</Hyperlinks.Provider>
}

// Native selection marks stationary releases as dragging; cancel only on drag events.
export function useHyperlinkMouse(enabled: () => boolean = () => true) {
  const renderer = useRenderer()
  const links = useContext(Hyperlinks)
  let pointedUrl: string | null = null
  const hover = mouseHover(() => !!links && enabled() && !!pointedUrl, () => links?.identity)
  const cancel = () => { if (links) links.press = undefined }
  const plain = (event: MouseEvent) => !event.modifiers.ctrl && !event.modifiers.alt && !event.modifiers.shift
  return {
    onMouseDown(event: MouseEvent) {
      cancel()
      links?.clearHover()
      if (!links || !enabled() || event.button !== MouseButton.LEFT || !plain(event)) return
      const url = renderer.getLinkAt(event.x, event.y)
      const selection = renderer.getSelection()
      if (!url || selection && selection.behavior !== "cell") return
      links.press = { x: event.x, y: event.y, url, target: event.target, identity: links.identity }
      event.stopPropagation()
    },
    onMouseUp(event: MouseEvent) {
      const start = links?.press
      cancel()
      if (!links || !start || !enabled() || event.button !== MouseButton.LEFT || !plain(event)
        || start.x !== event.x || start.y !== event.y || start.target !== event.target || start.target?.isDestroyed
        || start.identity !== links.identity || renderer.getLinkAt(event.x, event.y) !== start.url) return
      const selection = renderer.getSelection()
      if (selection && selection.behavior !== "cell") return
      event.stopPropagation()
      links.open(start.url)
    },
    onMouseMove(event: MouseEvent) {
      if (links?.press && (links.press.x !== event.x || links.press.y !== event.y)) cancel()
      pointedUrl = renderer.getLinkAt(event.x, event.y)
      links?.move(event, enabled() ? pointedUrl : null)
      hover.handlers.onMouseMove(event)
    },
    onMouseOut(event: MouseEvent) {
      if (links?.press && (links.press.x !== event.x || links.press.y !== event.y)) cancel()
      pointedUrl = null
      links?.leave(event)
      hover.handlers.onMouseOut(event)
    },
    onMouseDrag() { cancel(); links?.clearHover(); hover.handlers.onMouseDrag() },
    onMouseScroll() { cancel(); links?.clearHover(); hover.handlers.onMouseScroll() },
  }
}

export function HyperlinkSurface(props: { enabled?: boolean; children: JSX.Element }) {
  const mouse = useHyperlinkMouse(() => props.enabled !== false)
  return <box {...mouse} width="100%" height="100%" flexDirection="column">{props.children}</box>
}
