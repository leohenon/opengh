import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, Index, onCleanup, Show } from "solid-js"
import type { IssueTemplate } from "../../models"
import { useKeyActions, useKeybindings } from "../keybindings"
import { mouseClick, mouseHover } from "../mouse"
import { scrollRowIntoView } from "../scroll-selection"
import { useTheme } from "../theme"
import { LoadingText } from "./loading-text"
import { Popup } from "./popup"

export function NewIssueTemplatePicker(props: {
  repository: string
  templates?: IssueTemplate[]
  onSelect(template: IssueTemplate | undefined): void
  onClose(): void
  onHintChange(hint: string | undefined): void
}) {
  const { colors } = useTheme()
  const keys = useKeybindings()
  const [selected, setSelected] = createSignal(0)
  const items = createMemo(() => [
    ...(props.templates ?? []).map((template) => ({ template, label: template.name, about: template.about })),
    { template: undefined, label: "Blank issue", about: "" },
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
    <Popup width={72} height={(props.templates ? items().length : 1) + 5} placement="center" zIndex={250} onClose={props.onClose}>
      <box id="new-issue-templates" flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} wrapMode="none" fg={colors.text} attributes={TextAttributes.BOLD}>
          New issue · {props.repository}
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
                    id={`new-issue-template-${index}`}
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
                      flexShrink={0}
                      selectable={false}
                      fg={active() === index || hover.hovered() ? colors.blue : colors.text}
                      attributes={hover.hovered() ? TextAttributes.BOLD : TextAttributes.NONE}
                    >
                      {active() === index ? "› " : "  "}
                      {item().label}
                    </text>
                    <Show when={item().about}>
                      <text flexGrow={1} minWidth={0} wrapMode="none" selectable={false} fg={colors.muted}>
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
