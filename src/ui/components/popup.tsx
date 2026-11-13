import { MouseButton, RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "solid-js"
import { mouseSurface } from "../mouse"
import { useHyperlinkMouse } from "../hyperlinks"
import { useTheme } from "../theme"

export function Popup(props: {
  visible?: boolean
  fullscreen?: boolean
  expanded?: boolean
  reserveStatusBar?: boolean
  width?: number
  height: number
  zIndex?: number
  placement?: "upper" | "center"
  onClose?: () => void
  children: JSX.Element
}) {
  const mouse = mouseSurface()
  const links = useHyperlinkMouse(() => props.visible !== false)
  const dimensions = useTerminalDimensions()
  const { colors } = useTheme()
  let dismissOnRelease = false
  const availableHeight = () => Math.max(1, dimensions().height - ((props.reserveStatusBar ?? props.fullscreen) ? 1 : 0))
  const insetSize = (available: number, requested: number) => Math.max(1, Math.min(
    props.expanded ? Math.max(requested, Math.floor(available * 0.9)) : requested,
    available - 2,
  ))
  const width = () => props.fullscreen ? dimensions().width : insetSize(dimensions().width, props.width ?? 64)
  const height = () => props.fullscreen ? availableHeight() : insetSize(availableHeight(), props.height)
  const top = () => props.fullscreen ? 0 : props.expanded || props.placement === "center"
    ? Math.max(0, Math.floor((availableHeight() - height()) / 2))
    : Math.max(0, Math.min(Math.floor(availableHeight() / 4), availableHeight() - height() - 1))

  return (
    <box
      {...mouse}
      visible={props.visible !== false}
      position="absolute"
      left={0}
      top={0}
      width={dimensions().width}
      height={props.fullscreen ? height() : dimensions().height}
      zIndex={props.zIndex ?? 100}
      alignItems="center"
      paddingTop={top()}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      onMouse={(event) => {
        event.stopPropagation()
        if (event.type === "drag" || event.type === "scroll") dismissOnRelease = false
      }}
      onMouseDown={(event) => {
        event.preventDefault()
        dismissOnRelease = event.button === MouseButton.LEFT
      }}
      onMouseUp={(event) => {
        const dismiss = dismissOnRelease && event.button === MouseButton.LEFT
        dismissOnRelease = false
        // Keep the backdrop mounted through the whole click to avoid release click-through.
        if (dismiss) props.onClose?.()
      }}
    >
      <box
        width={width()}
        height={height()}
        minHeight={0}
        flexDirection="column"
        overflow="hidden"
        paddingTop={1}
        backgroundColor={colors.panel}
        onMouseMove={links.onMouseMove}
        onMouseOut={links.onMouseOut}
        onMouseDrag={links.onMouseDrag}
        onMouseScroll={links.onMouseScroll}
        onMouseDown={(event) => {
          dismissOnRelease = false
          links.onMouseDown(event)
          event.stopPropagation()
        }}
        onMouseUp={(event) => {
          dismissOnRelease = false
          links.onMouseUp(event)
          event.stopPropagation()
        }}
      >
        {props.children}
      </box>
    </box>
  )
}
