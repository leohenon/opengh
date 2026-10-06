import type { JSX } from "solid-js"
import { colors } from "../theme"

export function PageShell(props: { header: JSX.Element; children: JSX.Element }) {
  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection="column"
      backgroundColor={colors.canvas}
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={2}
      paddingRight={2}
    >
      <box
        height={2}
        flexShrink={0}
        flexDirection="row"
        alignItems="center"
        backgroundColor={colors.canvas}
      >
        {props.header}
      </box>
      <box height={1} flexShrink={0} backgroundColor={colors.canvas} />
      <box flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">
        {props.children}
      </box>
    </box>
  )
}
