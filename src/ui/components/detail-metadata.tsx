import { Show, type JSX } from "solid-js"
import { useTheme } from "../theme"

export function MetadataField(props: { label: string; compact: boolean; muted?: boolean; children: JSX.Element }) {
  const { colors } = useTheme()
  return (
    <box width="100%" minWidth={0} flexShrink={0} marginTop={props.compact ? 0 : 1}>
      <Show when={props.compact} fallback={(
        <>
          <text width="100%" flexShrink={0} fg={colors.muted}>{props.label}</text>
          <text width="100%" flexShrink={0} fg={props.muted ? colors.muted : colors.text}>{props.children}</text>
        </>
      )}>
        <text width="100%" flexShrink={0} fg={colors.muted}>{props.label} <span style={{ fg: props.muted ? colors.muted : colors.text }}>{props.children}</span></text>
      </Show>
    </box>
  )
}
