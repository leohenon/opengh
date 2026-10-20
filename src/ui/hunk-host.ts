import { CliRenderEvents, type BoxRenderable, type CliRenderer } from "@opentui/core"
import { createPortal, createRoot, flushSync } from "@opentui/react"
import { createElement, useLayoutEffect, useSyncExternalStore } from "react"
import { HunkDiffBody, type HunkDiffBodyProps } from "hunkdiff/opentui"

type Pane = { host: BoxRenderable; props: HunkDiffBodyProps; id: number; onCommit?: () => void }
type Bridge = { mount(host: BoxRenderable, props: HunkDiffBodyProps, onCommit?: () => void): {
  update(props: HunkDiffBodyProps): void
  dispose(): void
} }
const bridges = new WeakMap<CliRenderer, Bridge>()

/** Bootstrap before Solid attaches ANY root children. React owns only portals thereafter.
 * OpenTUI's root.render creates a reconciler container each time, so call it exactly once.
 * Keep this boundary pinned/tested with OpenTUI 0.6.6 and Hunk 0.24.0.
 */
export function initializeHunk(renderer: CliRenderer) {
  if (bridges.has(renderer)) return
  if (renderer.isDestroyed || renderer.root.getChildren().length)
    throw new Error("Hunk must be initialized before the Solid application mounts")
  let pane: Pane | null = null
  let nextId = 0
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  const snapshot = () => pane
  function Portal() {
    const value = useSyncExternalStore(subscribe, snapshot, snapshot)
    useLayoutEffect(() => { value?.onCommit?.() }, [value])
    return value ? createPortal(createElement(HunkDiffBody, { ...value.props, highlight: false }), value.host, null, String(value.id)) : null
  }
  const root = createRoot(renderer)
  flushSync(() => root.render(createElement(Portal)))
  const publish = (value: Pane | null) => {
    if (renderer.isDestroyed) { pane = null; return }
    flushSync(() => { pane = value; for (const listener of listeners) listener() })
  }
  renderer.once(CliRenderEvents.DESTROY, () => {
    // React's root already registers its own renderer-destroy cleanup.
    pane = null
    listeners.clear()
    bridges.delete(renderer)
  })
  bridges.set(renderer, {
    mount(host, props, onCommit) {
      if (pane) throw new Error("A Hunk pane is already mounted")
      if (host.isDestroyed || renderer.isDestroyed) throw new Error("Cannot mount Hunk into a destroyed host")
      const id = ++nextId
      publish({ host, props, id, onCommit })
      let disposed = false
      return {
        update(props) {
          if (!disposed && pane?.id === id && !host.isDestroyed) publish({ ...pane, props })
        },
        dispose() {
          if (disposed) return
          disposed = true
          if (pane?.id === id) publish(null)
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
