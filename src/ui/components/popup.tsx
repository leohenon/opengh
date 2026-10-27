import { MouseButton, RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "solid-js"
import { mouseSurface } from "../mouse"
import { useTheme } from "../theme"

export function Popup(props: {
  visible?: boolean
  fullscreen?: boolean
  reserveStatusBar?: boolean
  width?: number
  height: number
  zIndex?: number
  placement?: "upper" | "center"
  onClose?: () => void
  children: JSX.Element
}) {
  const mouse = mouseSurface()
  const dimensions = useTerminalDimensions()
  const { colors } = useTheme()
  let dismissOnRelease = false
  const width = () => props.fullscreen ? dimensions().width : Math.max(1, Math.min(props.width ?? 64, dimensions().width - 2))
  // Reserve the application status row only when it is meant to be visible.
  const height = () => props.fullscreen ? Math.max(1, dimensions().height - (props.reserveStatusBar === false ? 0 : 1)) : Math.max(1, Math.min(props.height, dimensions().height - 2))
  const top = () => props.fullscreen ? 0 : props.placement === "center"
    ? Math.max(0, Math.floor((dimensions().height - height()) / 2))
    : Math.max(0, Math.min(Math.floor(dimensions().height / 4), dimensions().height - height() - 1))

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
        onMouseDown={(event) => {
          dismissOnRelease = false
          event.stopPropagation()
        }}
        onMouseUp={(event) => {
          dismissOnRelease = false
          event.stopPropagation()
        }}
      >
        {props.children}
      </box>
    </box>
  )
}
