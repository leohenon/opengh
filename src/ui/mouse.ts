import { MouseButton, type CliRenderer, type MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, onCleanup } from "solid-js"

type HoverOwner = { setHovered: (value: boolean) => void }
type HoverCoordinator = {
  users: number
  owner?: HoverOwner
  position?: MousePosition
  blocked?: MousePosition
  event?: MouseEvent
  clear: (block?: boolean) => void
  keyboard: () => void
  releaseKeyboard: () => void
}
const hoverCoordinators = new WeakMap<CliRenderer, HoverCoordinator>()

// One pointer owner and keyboard listener per renderer, regardless of list length.
export function mouseHover(enabled: () => boolean = () => true, identity?: () => unknown) {
  const renderer = useRenderer()
  let coordinator = hoverCoordinators.get(renderer)
  if (!coordinator) {
    const limit = renderer.keyInput.getMaxListeners()
    const reserve = limit > 0 && Number.isFinite(limit)
    // Retained pages already use the listener budget. Reserve only our one coordinator listener.
    if (reserve) renderer.keyInput.setMaxListeners(limit + 1)
    const state: HoverCoordinator = {
      users: 0,
      clear(block = false) {
        if (block) state.blocked = state.position
        const owner = state.owner
        state.owner = undefined
        owner?.setHovered(false)
        if (owner && !renderer.isDestroyed) { renderer.setMousePointer("default"); renderer.requestRender() }
      },
      keyboard: () => state.clear(true),
      releaseKeyboard() {
        renderer.keyInput.off("keypress", state.keyboard)
        renderer.keyInput.off("paste", state.keyboard)
        if (reserve && renderer.keyInput.getMaxListeners() === limit + 1) renderer.keyInput.setMaxListeners(limit)
      },
    }
    coordinator = state
    hoverCoordinators.set(renderer, state)
    renderer.keyInput.prependListener("keypress", state.keyboard)
    renderer.keyInput.prependListener("paste", state.keyboard)
  }
  const state = coordinator
  state.users++
  const [hovered, setHovered] = createSignal(false)
  const owner: HoverOwner = { setHovered }
  const release = (block = false) => { if (state.owner === owner) state.clear(block) }
  let previous: unknown
  let initialized = false
  createEffect(() => {
    const key = identity?.()
    if (!enabled() || initialized && key !== previous) release(true)
    previous = key
    initialized = true
  })
  onCleanup(() => {
    release(true)
    if (--state.users === 0) {
      state.releaseKeyboard()
      hoverCoordinators.delete(renderer)
    }
  })
  const samePoint = (point: MousePosition | undefined, event: MouseEvent) => point?.x === event.x && point.y === event.y
  return {
    hovered,
    handlers: {
      onMouseMove(event: MouseEvent) {
        // An event bubbles from the innermost control. Layout only synthesizes over/out, never move.
        if (state.event === event) return
        state.event = event
        state.position = { x: event.x, y: event.y }
        if (samePoint(state.blocked, event)) return
        state.blocked = undefined
        if (!enabled() || event.isDragging) { state.clear(); return }
        if (state.owner !== owner) {
          state.clear()
          state.owner = owner
          setHovered(true)
          if (!renderer.isDestroyed) { renderer.setMousePointer("pointer"); renderer.requestRender() }
        }
      },
      onMouseOut(event: MouseEvent) {
        // Out may be a real exit into noninteractive text, or a stationary layout change.
        if (state.owner && state.owner !== owner) return
        state.position = { x: event.x, y: event.y }
        if (!samePoint(state.blocked, event)) state.blocked = undefined
        release()
      },
      onMouseDrag() { release(true) },
      onMouseScroll() { release(true) },
    },
  }
}

// Controls activate on release, retain input focus, and never pass a click to a parent row.
export function mouseClick(action: (event: MouseEvent) => void, enabled: () => boolean = () => true, identity?: () => unknown, hover = mouseHover(enabled, identity)) {
  let press: { x: number; y: number; identity: unknown } | undefined
  return {
    ...hover.handlers,
    onMouseDown(event: MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
      press = event.button === MouseButton.LEFT && enabled() ? { x: event.x, y: event.y, identity: identity?.() } : undefined
    },
    onMouseUp(event: MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
      const start = press
      press = undefined
      if (start && event.button === MouseButton.LEFT && start.x === event.x && start.y === event.y
        && start.identity === identity?.() && enabled()) action(event)
    },
    onMouseDrag() { press = undefined; hover.handlers.onMouseDrag() },
    onMouseScroll() { press = undefined; hover.handlers.onMouseScroll() },
    onMouseOut(event: MouseEvent) {
      // Hover-out for the previous hit target can arrive at a newly pressed control.
      if (press && (press.x !== event.x || press.y !== event.y)) press = undefined
      hover.handlers.onMouseOut(event)
    },
  }
}

export type MousePosition = { x: number; y: number }

// A context gesture never changes normal left-click/selection behavior.
export function mouseContextMenu(action: (position: MousePosition) => void, enabled: () => boolean, identity?: () => unknown) {
  let press: (MousePosition & { identity: unknown }) | undefined
  const cancel = () => { press = undefined }
  return {
    onMouseDown(event: MouseEvent) {
      cancel()
      if (event.button !== MouseButton.RIGHT) return
      event.preventDefault()
      event.stopPropagation()
      if (enabled()) press = { x: event.x, y: event.y, identity: identity?.() }
    },
    onMouseUp(event: MouseEvent) {
      const start = press
      cancel()
      if (event.button !== MouseButton.RIGHT) return
      event.preventDefault()
      event.stopPropagation()
      if (start && start.x === event.x && start.y === event.y && start.identity === identity?.() && enabled()) action({ x: event.x, y: event.y })
    },
    onMouseDrag: cancel,
    onMouseScroll: cancel,
  }
}

// OpenTUI emits raw down/up pairs, including for double clicks. Leave text selection native.
export function mouseDoubleClick(action: () => void, enabled: () => boolean, identity: () => unknown) {
  let press: (MousePosition & { identity: unknown }) | undefined
  let previous: (MousePosition & { identity: unknown; time: number }) | undefined
  const cancel = () => { press = undefined; previous = undefined }
  return {
    onMouseDown(event: MouseEvent) {
      if (event.button !== MouseButton.LEFT || !enabled() || event.modifiers.ctrl || event.modifiers.alt || event.modifiers.shift) return cancel()
      press = { x: event.x, y: event.y, identity: identity() }
    },
    onMouseUp(event: MouseEvent) {
      const start = press
      press = undefined
      if (!start || event.button !== MouseButton.LEFT || start.x !== event.x || start.y !== event.y || start.identity !== identity() || !enabled()) return cancel()
      const now = Date.now()
      if (previous && previous.identity === start.identity && previous.x === start.x && previous.y === start.y && now - previous.time <= 500) {
        cancel()
        event.stopPropagation()
        action()
      } else previous = { ...start, time: now }
    },
    onMouseDrag: cancel,
    onMouseScroll: cancel,
  }
}

// Passive boundaries observe movement through noninteractive text without claiming hover.
export function mouseSurface() {
  const renderer = useRenderer()
  const hover = mouseHover(() => false)
  const clear = () => hoverCoordinators.get(renderer)?.clear(true)
  return { ...hover.handlers, onMouseDrag: clear, onMouseScroll: clear }
}
