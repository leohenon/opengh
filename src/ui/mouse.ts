import { MouseButton, type MouseEvent } from "@opentui/core"

// Controls activate on release, retain input focus, and never pass a click to a parent row.
export function mouseClick(action: (event: MouseEvent) => void, enabled: () => boolean = () => true, identity?: () => unknown) {
  let press: { x: number; y: number; identity: unknown } | undefined
  return {
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
    onMouseDrag() { press = undefined },
    onMouseScroll() { press = undefined },
    onMouseOut(event: MouseEvent) {
      // Hover-out for the previous hit target can arrive at a newly pressed control.
      if (press && (press.x !== event.x || press.y !== event.y)) press = undefined
    },
  }
}
