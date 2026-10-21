import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useKeyActions } from "../keybindings"
import { createEffect, createSignal, Index, onCleanup, Show, type Accessor, type JSX } from "solid-js"
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
  showScrollbar?: boolean
  resetKey?: string | number
  empty: string
  rowHeight?: number
  endThreshold?: number
  onEndReached?: () => void
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
  const indexOfSelection = () => {
    const key = selectedKey()
    return key === undefined ? -1 : props.items.findIndex((item) => props.itemKey(item) === key)
  }

  const selectIndex = (index: number) => {
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
  }

  const move = (delta: number) => {
    const current = indexOfSelection()
    selectIndex((current < 0 ? 0 : current) + delta)
  }
  const halfPage = () => Math.max(1, Math.floor(listHeight() / rowHeight() / 2))

  const activate = (callback: ((item: T) => void) | undefined) => {
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

  const revealSelection = () => {
    const index = indexOfSelection()
    if (props.active && list && index >= 0) scrollRowIntoView(list, index, rowHeight())
  }
  createEffect(revealSelection)
  onCleanup(() => list?.viewport.off("resize", revealSelection))

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
            {(item) => {
              const active = () => selectedKey() === props.itemKey(item())
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
                  backgroundColor={active() ? colors.panelHover : colors.canvas}
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
