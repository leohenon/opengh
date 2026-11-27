import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, Index, onCleanup, Show } from "solid-js"
import { useKeyActions, useKeybindings } from "../keybindings"
import { mouseClick, mouseHover } from "../mouse"
import { scrollRowIntoView } from "../scroll-selection"
import { useTheme } from "../theme"
import { LoadingText } from "./loading-text"
import { Popup } from "./popup"

export function TemplatePicker<T>(props: {
  idPrefix: string
  heading: string
  blank: string
  templates?: readonly T[]
  label(template: T): string
  about?(template: T): string
  onSelect(template: T | undefined): void
  onClose(): void
  onHintChange(hint: string | undefined): void
}) {
  const { colors } = useTheme()
  const keys = useKeybindings()
  const [selected, setSelected] = createSignal(0)
  const items = createMemo(() => [
    ...(props.templates ?? []).map((template) => ({ template, label: props.label(template), about: props.about?.(template) ?? "" })),
    { template: undefined, label: props.blank, about: "" },
  ])
  const active = () => Math.min(selected(), items().length - 1)
  let list: ScrollBoxRenderable | undefined
  const revealSelection = () => scrollRowIntoView(list, active(), 1)
  createEffect(revealSelection)
  onCleanup(() => list?.viewport.off("resize", revealSelection))
  const move = (delta: number) => setSelected(Math.max(0, Math.min(items().length - 1, active() + delta)))
  const activate = (index = active()) => {
    if (!props.templates) return
    props.onSelect(items()[index]?.template)
  }
  createEffect(() =>
    props.onHintChange(
      props.templates ? keys.hints(["navigation.activate", "select"], ["dialog.close", "close"]) : keys.hints(["dialog.close", "close"]),
    ),
  )
  onCleanup(() => props.onHintChange(undefined))
  useKeyActions(
    {
      "dialog.close": () => props.onClose(),
      "navigation.up": () => move(-1),
      "navigation.down": () => move(1),
      "navigation.activate": () => activate(),
    },
    { priority: 100, modal: true },
  )

  return (
    <Popup
      width={Math.min(
        100,
        Math.max(72, ...items().map((item) => Bun.stringWidth(item.label) + (item.about ? Bun.stringWidth(item.about) + 2 : 0) + 12)),
      )}
      height={(props.templates ? items().length : 1) + 5}
      placement="center"
      zIndex={250}
      onClose={props.onClose}
    >
      <box id={`${props.idPrefix}-templates`} flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} wrapMode="none" fg={colors.text} attributes={TextAttributes.BOLD}>
          {props.heading}
        </text>
        <box height={1} flexShrink={0} />
        <Show when={props.templates} fallback={<LoadingText text="Loading templates…" />}>
          <scrollbox
            ref={(value) => {
              list = value
              list.viewport.on("resize", revealSelection)
            }}
            flexGrow={1}
            flexShrink={1}
            minHeight={0}
            focusable={false}
            scrollX={false}
            scrollY
          >
            <Index each={items()}>
              {(item, index) => {
                const hover = mouseHover(
                  () => true,
                  () => index,
                )
                return (
                  <box
                    id={`${props.idPrefix}-template-${index}`}
                    height={1}
                    flexShrink={0}
                    flexDirection="row"
                    backgroundColor={active() === index || hover.hovered() ? colors.panelHover : colors.panel}
                    {...mouseClick(
                      () => {
                        setSelected(index)
                        activate(index)
                      },
                      () => true,
                      () => index,
                      hover,
                    )}
                  >
                    <text
                      flexShrink={1}
                      minWidth={0}
                      wrapMode="none"
                      truncate
                      selectable={false}
                      fg={active() === index || hover.hovered() ? colors.blue : colors.text}
                      attributes={hover.hovered() ? TextAttributes.BOLD : TextAttributes.NONE}
                    >
                      {active() === index ? "› " : "  "}
                      {item().label}
                    </text>
                    <Show when={item().about}>
                      <text
                        flexGrow={1}
                        flexBasis={0}
                        minWidth={Math.min(Bun.stringWidth(item().about) + 2, 16)}
                        wrapMode="none"
                        truncate
                        selectable={false}
                        fg={colors.muted}
                      >
                        {"  "}
                        {item().about}
                      </text>
                    </Show>
                  </box>
                )
              }}
            </Index>
          </scrollbox>
        </Show>
      </box>
    </Popup>
  )
}
