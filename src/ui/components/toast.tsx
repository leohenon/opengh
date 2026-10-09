import { useTerminalDimensions } from "@opentui/solid"
import { onCleanup, onMount } from "solid-js"
import { colors } from "../theme"

export function Toast(props: {
  title: string
  message: string
  duration?: number
  onDismiss: () => void
}) {
  const dimensions = useTerminalDimensions()
  const contentWidth = () => props.title.length + props.message.length + 8
  const width = () => Math.max(1, Math.min(48, dimensions().width - 4, Math.max(28, contentWidth())))

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
      zIndex={150}
      flexDirection="row"
      backgroundColor={colors.panel}
    >
      <box width={1} flexShrink={0} backgroundColor={colors.red} />
      <box
        flexGrow={1}
        minWidth={0}
        flexDirection="column"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        <text flexGrow={1} minWidth={0} fg={colors.text} wrapMode="word">{props.title}: {props.message}</text>
      </box>
    </box>
  )
}
