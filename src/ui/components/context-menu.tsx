import { MouseButton, RGBA, parseColor, TextAttributes, type BoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { mouseClick, mouseHover, mouseSurface, type MousePosition } from "../mouse"
import { useKeyActions } from "../keybindings"
import { useTheme } from "../theme"

export type ContextMenuItem = { label: string; run: () => void; disabled?: boolean }

const CLOSE_MARGIN_X = 6
const CLOSE_MARGIN_Y = 3

export function ContextMenu(props: {
  position: MousePosition
  items: readonly ContextMenuItem[]
  onSelect: (item: ContextMenuItem) => void
  onClose: () => void
}) {
  const mouse = mouseSurface()
  const { colors } = useTheme()
  const dimensions = useTerminalDimensions()
  let menu: BoxRenderable | undefined
  let lastPointer = { ...props.position }
  let backdrop: (MousePosition & { button: number }) | undefined
  const panel = createMemo(() => {
    const base = parseColor(colors.panel)
    const lift = parseColor(colors.panelHover)
    return RGBA.fromValues(base.r * 0.8 + lift.r * 0.2, base.g * 0.8 + lift.g * 0.2, base.b * 0.8 + lift.b * 0.2)
  })
  const separateBack = () => props.items.length > 1 && props.items.at(-1)?.label === "Back"
  const width = () => Math.min(dimensions().width, Math.max(0, ...props.items.map((item) => Bun.stringWidth(item.label))) + 2)
  const height = () => Math.min(dimensions().height, Math.max(1, props.items.length + (separateBack() ? 1 : 0)))
  const activate = (index: number) => {
    const item = props.items[index]
    if (item && !item.disabled) props.onSelect(item)
  }
  useKeyActions({ "dialog.close": () => props.onClose() }, { priority: 100, modal: true })

  return (
    <box {...mouse} position="absolute" left={0} top={0} width={dimensions().width} height={dimensions().height} zIndex={200}
      onMouseMove={(event) => {
        mouse.onMouseMove(event)
        const moved = lastPointer.x !== event.x || lastPointer.y !== event.y
        lastPointer = { x: event.x, y: event.y }
        // Measure the rendered menu, including terminal-edge clamping. Over/out from layout never dismiss.
        if (!moved || !menu?.width || !menu.height || event.isDragging) return
        if (event.x < menu.x - CLOSE_MARGIN_X || event.x >= menu.x + menu.width + CLOSE_MARGIN_X
          || event.y < menu.y - CLOSE_MARGIN_Y || event.y >= menu.y + menu.height + CLOSE_MARGIN_Y) {
          backdrop = undefined
          props.onClose()
        }
      }}
      onMouse={(event) => { event.stopPropagation(); if (event.type === "drag" || event.type === "scroll") backdrop = undefined }}
      onMouseDown={(event) => { event.preventDefault(); backdrop = event.button === MouseButton.LEFT || event.button === MouseButton.RIGHT ? { x: event.x, y: event.y, button: event.button } : undefined }}
      onMouseUp={(event) => { const start = backdrop; backdrop = undefined; if (start && start.button === event.button && start.x === event.x && start.y === event.y) props.onClose() }}>
      <box id="context-menu" ref={(value) => { menu = value }} position="absolute" left={Math.max(0, Math.min(props.position.x, dimensions().width - width()))}
        top={Math.max(0, Math.min(props.position.y, dimensions().height - height()))}
        width={width()} height={height()} backgroundColor={panel()} flexDirection="column" overflow="hidden"
        onMouseDown={(event) => { backdrop = undefined; event.stopPropagation() }}
        onMouseUp={(event) => { backdrop = undefined; event.stopPropagation() }}>
        <scrollbox focusable={false} flexGrow={1} minHeight={0} scrollY scrollX={false} scrollbarOptions={{ visible: false }}>
          <For each={props.items}>{(item, index) => {
            const hover = mouseHover(() => !item.disabled, () => item)
            return (
              <>
                <Show when={separateBack() && index() === props.items.length - 1}>
                  <box height={1} flexShrink={0} />
                </Show>
                <box id={`context-menu-row-${index()}`} height={1} flexShrink={0} paddingX={1}
                  backgroundColor={hover.hovered() ? colors.panelHover : panel()}
                  {...mouseClick(() => activate(index()), () => !item.disabled, () => item, hover)}>
                  <text height={1} wrapMode="none" selectable={false}
                    fg={item.disabled ? colors.muted : hover.hovered() ? colors.blue : colors.text}
                    attributes={hover.hovered() ? TextAttributes.BOLD : TextAttributes.NONE}>{item.label}</text>
                </box>
              </>
            )
          }}</For>
        </scrollbox>
      </box>
    </box>
  )
}
