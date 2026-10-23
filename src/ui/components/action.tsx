import { TextAttributes } from "@opentui/core"
import type { JSX } from "solid-js"
import { mouseClick, mouseHover } from "../mouse"
import { useTheme } from "../theme"

export function Action(props: {
  children: JSX.Element
  id?: string
  onActivate: () => void
  disabled?: boolean
  fg?: string
  identity?: () => unknown
}) {
  const { colors } = useTheme()
  const hover = mouseHover(() => !props.disabled, props.identity)
  return (
    <text id={props.id} height={1} flexShrink={0} selectable={false} wrapMode="none"
      bg={hover.hovered() ? colors.panelHover : undefined}
      attributes={hover.hovered() ? TextAttributes.BOLD : TextAttributes.NONE}
      fg={props.disabled ? colors.muted : props.fg ?? colors.blue}
      {...mouseClick(() => props.onActivate(), () => !props.disabled, props.identity, hover)}>
      {props.children}
    </text>
  )
}
