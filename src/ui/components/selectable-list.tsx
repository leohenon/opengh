import { MouseButton, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useKeyActions } from "../keybindings"
import { createEffect, createMemo, createSignal, Index, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import { mouseHover, type MousePosition } from "../mouse"
import { fitText } from "../format"
import { scrollRowIntoView } from "../scroll-selection"
import { ListLine } from "./list-line"
import { useTheme } from "../theme"
import { createScrollbarVisibility } from "../scrollbar-visibility"

type ItemKey = string | number

export function SelectableList<T>(props: {
  items: readonly T[]
  itemKey: (item: T) => ItemKey
  active: boolean
  mouseActive?: boolean
  onMouseFocus?: () => void
  showScrollbar?: boolean
  resetKey?: string | number
  empty: string
  rowHeight?: number
  endThreshold?: number
  onEndReached?: () => void
  onContextMenu?: (item: T, position: MousePosition) => void
  onActivate?: (item: T) => void
  onOpenInBrowser?: (item: T) => void
  onCopy?: (item: T) => void
  onDiff?: (item: T) => void
  onSelect?: (item: T) => void
  children: (item: Accessor<T>, active: Accessor<boolean>) => JSX.Element
}) {
  const { colors } = useTheme()
  const [selectedKey, setSelectedKey] = createSignal<ItemKey>()
  const [containerHeight, setContainerHeight] = createSignal(0)
  let selectedIndex = 0
  let mousePress: { key: ItemKey; x: number; y: number; button: number } | undefined
  const mouseActive = () => props.mouseActive ?? props.active
  let followSelection = true
  let previousResetKey = props.resetKey
  let container: BoxRenderable | undefined
  let list: ScrollBoxRenderable | undefined
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar === true)

  const rowHeight = () => props.rowHeight ?? 3
  const listHeight = () => Math.floor(Math.max(0, containerHeight()) / rowHeight()) * rowHeight()
  const updateContainerHeight = () => {
    const height = container?.height ?? 0
    setContainerHeight((current) => current === height ? current : height)
  }
  // Appending a page must not reveal an unchanged selection after wheel browsing.
  const indexOfSelection = createMemo(() => {
    const key = selectedKey()
    return key === undefined ? -1 : props.items.findIndex((item) => props.itemKey(item) === key)
  })

  const revealSelection = () => {
    const index = indexOfSelection()
    if (followSelection && props.active && list && index >= 0) {
      scrollRowIntoView(list, index, rowHeight())
      // Selection-driven scrolling emits the same native change event as the mouse.
      followSelection = true
    }
  }

  const selectIndex = (index: number) => {
    mousePress = undefined
    followSelection = true
    if (!props.items.length) {
      selectedIndex = 0
      setSelectedKey(undefined)
      return
    }
    selectedIndex = Math.max(0, Math.min(props.items.length - 1, index))
    const item = props.items[selectedIndex]
    if (!item) return
    setSelectedKey(props.itemKey(item))
    props.onSelect?.(item)
    revealSelection()
  }

  const move = (delta: number) => {
    const current = indexOfSelection()
    selectIndex((current < 0 ? 0 : current) + delta)
  }
  const halfPage = () => Math.max(1, Math.floor(listHeight() / rowHeight() / 2))

  createEffect(() => { if (!mouseActive()) mousePress = undefined })
  useKeyboard(() => { mousePress = undefined })

  const activate = (callback: ((item: T) => void) | undefined) => {
    mousePress = undefined
    const item = props.items[indexOfSelection()]
    if (!callback || item === undefined) return false
    callback(item)
  }
  useKeyActions({
    "navigation.up": () => move(-1),
    "navigation.down": () => move(1),
    "navigation.halfPageUp": () => move(-halfPage()),
    "navigation.halfPageDown": () => move(halfPage()),
    "navigation.pageUp": () => move(-Math.max(1, Math.floor(listHeight() / rowHeight()))),
    "navigation.pageDown": () => move(Math.max(1, Math.floor(listHeight() / rowHeight()))),
    "navigation.first": () => selectIndex(0),
    "navigation.last": () => selectIndex(props.items.length - 1),
    "navigation.activate": () => activate(props.onActivate),
    "item.open": () => activate(props.onOpenInBrowser),
    "item.copy": () => activate(props.onCopy),
    "item.diff": () => activate(props.onDiff),
  }, { when: () => props.active })

  createEffect(() => {
    const items = props.items
    const resetKey = props.resetKey
    if (resetKey !== previousResetKey) {
      previousResetKey = resetKey
      selectIndex(0)
      return
    }

    const current = indexOfSelection()
    if (current >= 0) selectedIndex = current
    else selectIndex(Math.min(selectedIndex, Math.max(0, items.length - 1)))
  })

  createEffect(revealSelection)

  const onScrollChange = () => {
    // Native wheel/scrollbar browsing may intentionally leave the selected row offscreen.
    followSelection = false
    if (!props.active || !list || list.viewport.height <= 0 || !props.items.length) return
    const lastVisibleIndex = Math.ceil((list.scrollTop + list.viewport.height) / rowHeight()) - 1
    if (lastVisibleIndex >= props.items.length - (props.endThreshold ?? 3)) props.onEndReached?.()
  }
  onCleanup(() => {
    list?.viewport.off("resize", revealSelection)
    list?.verticalScrollBar.off("change", onScrollChange)
  })

  createEffect(() => {
    const index = indexOfSelection()
    const threshold = props.endThreshold ?? 3
    if (props.active && (props.items.length === 0 || index >= props.items.length - threshold))
      props.onEndReached?.()
  })

  return (
    <box
      ref={(value) => {
        container = value
        updateContainerHeight()
      }}
      onSizeChange={updateContainerHeight}
      flexGrow={1}
      minWidth={0}
      minHeight={0}
      flexDirection="column"
      overflow="hidden"
    >
      <scrollbox
        ref={(value) => {
          list = value
          bindScrollbar(value)
          // Resize events run after ScrollBox updates its viewport and scrollbar bounds.
          list.viewport.on("resize", revealSelection)
          list.verticalScrollBar.on("change", onScrollChange)
        }}
        focusable={false}
        scrollbarOptions={{ trackOptions: { onMouse: (event) => {
          if (event.type === "down" && event.button === MouseButton.LEFT && mouseActive()) props.onMouseFocus?.()
        } } }}
        onMouse={(event) => {
          // The previous hit target's hover-out can arrive after a new press at these cells.
          if (event.type === "out" && mousePress?.x === event.x && mousePress?.y === event.y) return
          if (event.type === "down" || event.type === "up" || event.type === "drag"
            || event.type === "scroll" || event.type === "out") mousePress = undefined
        }}
        onMouseScroll={(event) => {
          if (mouseActive()) props.onMouseFocus?.()
          event.stopPropagation()
          // An underfilled list or a wheel at the bottom may not emit a position change.
          if (event.scroll?.direction === "down" && !event.modifiers.shift && list
            && list.scrollTop + list.viewport.height >= list.scrollHeight) onScrollChange()
        }}
        height={listHeight()}
        flexShrink={0}
        minHeight={0}
        backgroundColor={colors.canvas}
        scrollX={false}
        scrollY
      >
        <Show
          when={props.items.length > 0}
          fallback={(
            <box width="100%" minWidth={0} height={rowHeight()} alignItems="center" paddingLeft={2}>
              <ListLine fg={colors.muted}>{(width) => fitText(props.empty, width)}</ListLine>
            </box>
          )}
        >
          <Index each={props.items}>
            {(item, index) => {
              const active = () => selectedKey() === props.itemKey(item())
              const hover = mouseHover(mouseActive, () => props.itemKey(item()))
              return (
                <box
                  width="100%"
                  minWidth={0}
                  overflow="hidden"
                  height={rowHeight()}
                  flexShrink={0}
                  flexDirection="row"
                  alignItems="flex-start"
                  paddingRight={1}
                  {...hover.handlers}
                  backgroundColor={active() ? colors.panelHover : hover.hovered() ? colors.panel : colors.canvas}
                  onMouseDown={(event) => {
                    mousePress = undefined
                    if (!mouseActive() || (event.button !== MouseButton.LEFT && (event.button !== MouseButton.RIGHT || !props.onContextMenu))) return
                    event.preventDefault()
                    event.stopPropagation()
                    props.onMouseFocus?.()
                    mousePress = { key: props.itemKey(item()), x: event.x, y: event.y, button: event.button }
                  }}
                  onMouseUp={(event) => {
                    const press = mousePress
                    mousePress = undefined
                    const clicked = item()
                    if (!press || !mouseActive() || event.button !== press.button
                      || press.key !== props.itemKey(clicked) || press.x !== event.x || press.y !== event.y) return
                    event.preventDefault()
                    event.stopPropagation()
                    selectIndex(index)
                    if (event.button === MouseButton.RIGHT) props.onContextMenu?.(clicked, { x: event.x, y: event.y })
                    else props.onActivate?.(clicked)
                  }}
                >
                  <text width={2} fg={colors.blue}>{active() ? "▌" : " "}</text>
                  {props.children(item, active)}
                </box>
              )
            }}
          </Index>
        </Show>
      </scrollbox>
      <box flexGrow={1} minHeight={0} />
    </box>
  )
}
