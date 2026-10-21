import { useTerminalDimensions } from "@opentui/solid"
import { onCleanup, onMount } from "solid-js"
import { useTheme } from "../theme"

export function Toast(props: {
  title: string
  message: string
  duration?: number
  zIndex?: number
  tone?: "error" | "success" | "info"
  onDismiss: () => void
}) {
  const dimensions = useTerminalDimensions()
  const { colors } = useTheme()
  const content = () => props.title + (props.message ? `: ${props.message}` : "")
  const width = () => Math.max(1, Math.min(48, dimensions().width - 4, Bun.stringWidth(content()) + 5))

  onMount(() => {
    const timeout = setTimeout(props.onDismiss, props.duration ?? 5000)
    onCleanup(() => clearTimeout(timeout))
  })

  return (
    <box
      position="absolute"
      top={2}
      right={2}
      width={width()}
      minHeight={3}
      zIndex={props.zIndex ?? 150}
      flexDirection="row"
      backgroundColor={colors.panel}
    >
      <box width={1} flexShrink={0} backgroundColor={props.tone === "success" ? colors.green : props.tone === "info" ? colors.blue : colors.red} />
      <box
        flexGrow={1}
        minWidth={0}
        flexDirection="column"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        <text flexGrow={1} minWidth={0} fg={colors.text} wrapMode="word">{content()}</text>
      </box>
    </box>
  )
}
