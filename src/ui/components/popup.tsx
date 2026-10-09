import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "solid-js"
import { useTheme } from "../theme"

export function Popup(props: {
  width?: number
  height: number
  zIndex?: number
  placement?: "upper" | "center"
  children: JSX.Element
}) {
  const dimensions = useTerminalDimensions()
  const { colors } = useTheme()
  const width = () => Math.max(1, Math.min(props.width ?? 64, dimensions().width - 2))
  const height = () => Math.max(1, Math.min(props.height, dimensions().height - 2))
  const top = () => props.placement === "center"
    ? Math.max(0, Math.floor((dimensions().height - height()) / 2))
    : Math.max(0, Math.min(Math.floor(dimensions().height / 4), dimensions().height - height() - 1))

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      zIndex={props.zIndex ?? 100}
      alignItems="center"
      paddingTop={top()}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        width={width()}
        height={height()}
        minHeight={0}
        flexDirection="column"
        overflow="hidden"
        paddingTop={1}
        backgroundColor={colors.panel}
      >
        {props.children}
      </box>
    </box>
  )
}
