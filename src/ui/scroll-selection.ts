import type { ScrollBoxRenderable } from "@opentui/core"

export function scrollRowIntoView(list: ScrollBoxRenderable | undefined, index: number, rowHeight: number) {
  if (!list) return
  const rowTop = index * rowHeight
  const rowBottom = rowTop + rowHeight
  const viewportTop = list.scrollTop
  const viewportBottom = viewportTop + list.viewport.height

  if (rowTop < viewportTop) list.scrollTo(rowTop)
  else if (rowBottom > viewportBottom) list.scrollTo(Math.max(0, rowBottom - list.viewport.height))
}
