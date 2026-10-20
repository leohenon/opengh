import { TextAttributes, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, Index, Show, type JSX } from "solid-js"
import { useTheme } from "../theme"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { Popup } from "./popup"

type Match = number | undefined

export function SearchablePicker<T>(props: {
  title: string
  placeholder: string
  items: readonly T[]
  itemKey: (item: T) => string | number
  match: (item: T, query: string) => Match
  preferred?: (item: T) => boolean
  titleMeta?: string
  width?: number
  height: number
  placement?: "upper" | "center"
  showScrollbar?: boolean
  listTitle?: string
  empty?: string
  error?: string
  onQueryChange?: (query: string) => void
  onSelect: (item: T) => void
  onSubmit?: (query: string, selected: T | undefined) => void
  onClose: () => void
  children: (item: T, active: () => boolean, index: () => number) => JSX.Element
}) {
  const { colors } = useTheme()
  const [query, setQuery] = createSignal("")
  const [selectedKey, setSelectedKey] = createSignal<string | number>()
  const [listReady, setListReady] = createSignal(false)
  let list: ScrollBoxRenderable | undefined
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar === true)

  const items = createMemo(() => {
    const needle = query().trim()
    return props.items
      .map((item, index) => ({ item, index, score: props.match(item, needle) }))
      .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== undefined)
      .sort((left, right) => {
        if (!needle && props.preferred) {
          if (props.preferred(left.item)) return -1
          if (props.preferred(right.item)) return 1
        }
        return left.score - right.score || left.index - right.index
      })
      .map((entry) => entry.item)
  })

  const selected = () => {
    const index = items().findIndex((item) => props.itemKey(item) === selectedKey())
    return index < 0 ? 0 : index
  }
  const move = (delta: number) => {
    if (!items().length) return
    const index = Math.max(0, Math.min(items().length - 1, selected() + delta))
    const item = items()[index]
    if (item) setSelectedKey(props.itemKey(item))
  }

  createEffect(() => {
    listReady()
    const available = items()
    let index = available.findIndex((item) => props.itemKey(item) === selectedKey())
    if (index < 0) {
      const first = available[0]
      if (!first) return
      setSelectedKey(props.itemKey(first))
      index = 0
    }
    list?.scrollChildIntoView(`picker-row-${index}`)
  })

  const handleKey = (event: KeyEvent) => {
    const escape = event.name === "escape" || event.name === "esc" || event.raw === "\u001b" || event.sequence === "\u001b"
    if (escape) {
      event.preventDefault()
      event.stopPropagation()
      return props.onClose()
    }
    if (event.name === "up") {
      event.preventDefault()
      return move(-1)
    }
    if (event.name === "down") {
      event.preventDefault()
      return move(1)
    }
    if (event.name === "return" || event.name === "enter") {
      event.preventDefault()
      const item = items()[selected()]
      if (props.onSubmit) props.onSubmit(query(), item)
      else if (item) props.onSelect(item)
    }
  }

  return (
    <Popup
      width={props.width ?? 64}
      height={props.height}
      placement={props.placement}
      zIndex={100}
    >
      <box flexGrow={1} minHeight={0} flexDirection="column" gap={1} paddingBottom={1}>
        <box flexShrink={0} paddingLeft={4} paddingRight={4}>
          <box height={1} flexDirection="row" justifyContent="space-between">
            <text fg={colors.text} attributes={TextAttributes.BOLD}>{props.title}</text>
            <text fg={colors.muted}>{props.titleMeta}</text>
          </box>
          <box height={2} flexShrink={0} paddingTop={1}>
            <input
              width="100%"
              focused
              value={query()}
              placeholder={props.placeholder}
              placeholderColor={colors.muted}
              focusedBackgroundColor={colors.panel}
              textColor={colors.text}
              cursorColor={colors.blue}
              onInput={(value) => {
                setQuery(value)
                setSelectedKey(undefined)
                props.onQueryChange?.(value)
              }}
              onKeyDown={handleKey}
            />
          </box>
          <Show when={props.error}>
            {(message) => <text height={1} fg={colors.red}>× {message()}</text>}
          </Show>
        </box>
        <Show when={items().length > 0 || props.empty}>
          <box flexGrow={1} minHeight={0} flexDirection="column">
            <Show when={props.listTitle}>
              {(title) => (
                <box height={1} flexShrink={0} paddingLeft={4}>
                  <text fg={colors.text} attributes={TextAttributes.BOLD}>{title()}</text>
                </box>
              )}
            </Show>
            <scrollbox
              ref={(value) => {
                list = value
                bindScrollbar(value)
                setListReady(true)
              }}
              flexGrow={1}
              minHeight={0}
              paddingLeft={1}
              paddingRight={1}
              scrollY
            >
              <Show
                when={items().length > 0}
                fallback={<box height={1} paddingLeft={3}><text fg={colors.muted}>{props.empty}</text></box>}
              >
                <Index each={items()}>
                  {(item, index) => {
                    const active = () => props.itemKey(item()) === selectedKey()
                    const rowIndex = () => index
                    return (
                      <box
                        id={`picker-row-${index}`}
                        height={1}
                        flexShrink={0}
                        flexDirection="row"
                        paddingLeft={3}
                        paddingRight={3}
                        backgroundColor={active() ? colors.panelHover : colors.panel}
                      >
                        <text width={2} fg={colors.blue}>{active() ? "›" : " "}</text>
                        {props.children(item(), active, rowIndex)}
                      </box>
                    )
                  }}
                </Index>
              </Show>
            </scrollbox>
          </box>
        </Show>
      </box>
    </Popup>
  )
}
