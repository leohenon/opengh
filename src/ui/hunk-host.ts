import { CliRenderEvents, type BoxRenderable, type CliRenderer } from "@opentui/core"
import { createPortal, createRoot, flushSync } from "@opentui/react"
import { createElement, Fragment, useLayoutEffect, useSyncExternalStore } from "react"
import { configureHunkHighlightWorker, HunkDiffBody, type HunkDiffBodyProps } from "hunkdiff/opentui"

type Pane = { host: BoxRenderable; props: HunkDiffBodyProps; id: number; onCommit?: () => void }
type Bridge = { mount(host: BoxRenderable, props: HunkDiffBodyProps, onCommit?: () => void): {
  update(props: HunkDiffBodyProps): void
  dispose(): void
} }
const bridges = new WeakMap<CliRenderer, Bridge>()

/** Bootstrap before Solid attaches ANY root children. React owns only portals thereafter.
 * OpenTUI's root.render creates a reconciler container each time, so call it exactly once.
 * Keep this boundary pinned/tested with OpenTUI 0.6.6 and Hunk 0.24.0.
 * The default worker URL is only valid when this module runs from source. A compiled
 * executable bundles every module into its entry, so the entry passes the URL instead.
 */
export function initializeHunk(renderer: CliRenderer, highlightWorker = new URL("./workers/hunk-highlight.js", import.meta.url)) {
  if (bridges.has(renderer)) return
  if (renderer.isDestroyed || renderer.root.getChildren().length)
    throw new Error("Hunk must be initialized before the Solid application mounts")
  configureHunkHighlightWorker(highlightWorker)
  let panes: Pane[] = []
  let nextId = 0
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  const snapshot = () => panes
  function PanePortal({ value }: { value: Pane }) {
    useLayoutEffect(() => { value.onCommit?.() }, [value])
    return createPortal(createElement(HunkDiffBody, value.props), value.host, null, String(value.id))
  }
  function Portals() {
    const value = useSyncExternalStore(subscribe, snapshot, snapshot)
    return createElement(Fragment, null, ...value.map((pane) => createElement(PanePortal, { key: pane.id, value: pane })))
  }
  const root = createRoot(renderer)
  flushSync(() => root.render(createElement(Portals)))
  const publish = (value: Pane[]) => {
    if (renderer.isDestroyed) { panes = []; return }
    flushSync(() => { panes = value; for (const listener of listeners) listener() })
  }
  renderer.once(CliRenderEvents.DESTROY, () => {
    // React's root already registers its own renderer-destroy cleanup.
    panes = []
    listeners.clear()
    bridges.delete(renderer)
  })
  bridges.set(renderer, {
    mount(host, props, onCommit) {
      if (host.isDestroyed || renderer.isDestroyed) throw new Error("Cannot mount Hunk into a destroyed host")
      const id = ++nextId
      publish([...panes, { host, props, id, onCommit }])
      let disposed = false
      return {
        update(props) {
          if (!disposed && !host.isDestroyed && panes.some((pane) => pane.id === id))
            publish(panes.map((pane) => pane.id === id ? { ...pane, props } : pane))
        },
        dispose() {
          if (disposed) return
          disposed = true
          if (panes.some((pane) => pane.id === id)) publish(panes.filter((pane) => pane.id !== id))
        },
      }
    },
  })
}

export function mountHunk(renderer: CliRenderer, host: BoxRenderable, props: HunkDiffBodyProps, onCommit?: () => void) {
  const bridge = bridges.get(renderer)
  if (!bridge) throw new Error("Hunk was not initialized before application startup")
  return bridge.mount(host, props, onCommit)
}
