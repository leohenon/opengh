import { createContext, Show, useContext, type Accessor, type JSX } from "solid-js"
import { useTheme } from "../theme"

const LastTimelineItem = createContext<Accessor<boolean>>(() => false)

export function TimelineItem(props: { last: boolean; children: JSX.Element }) {
  const last = () => props.last
  return <LastTimelineItem.Provider value={last}>{props.children}</LastTimelineItem.Provider>
}

export function TimelineEntry(props: { icon: string; color?: string; nodeOffset?: number; children: JSX.Element }) {
  const { colors } = useTheme()
  const last = useContext(LastTimelineItem)
  return (
    <box width="100%" minWidth={0} flexShrink={0} flexDirection="row">
      <Show when={props.icon}>
        <box width={3} flexShrink={0} alignSelf="stretch">
          <Show when={last()} fallback={<box position="absolute" left={1} top={0} bottom={0} width={1} border={["left"]} borderColor={colors.border} />}>
            <box position="absolute" left={1} top={0} height={props.nodeOffset ?? 1} width={1} border={["left"]} borderColor={colors.border} />
          </Show>
          <text position="absolute" zIndex={1} left={1} top={props.nodeOffset ?? 1} width={1} height={1} fg={props.color ?? colors.muted} bg={colors.canvas}>{props.icon}</text>
        </box>
      </Show>
      <box flexGrow={1} flexBasis={0} minWidth={0} paddingTop={1} flexDirection="column">
        {props.children}
      </box>
    </box>
  )
}

export function TimelineHeader(props: { children: JSX.Element }) {
  const { colors } = useTheme()
  return <text width="100%" flexShrink={0} fg={colors.muted}>{props.children}</text>
}
