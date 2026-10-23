import type { JSX } from "solid-js"
import { mouseClick } from "../mouse"
import { useTheme } from "../theme"

export function Action(props: {
  children: JSX.Element
  id?: string
  onActivate: () => void
  disabled?: boolean
  fg?: string
}) {
  const { colors } = useTheme()
  return (
    <text id={props.id} height={1} flexShrink={0} selectable={false} wrapMode="none"
      fg={props.disabled ? colors.muted : props.fg ?? colors.blue}
      {...mouseClick(() => props.onActivate(), () => !props.disabled)}>
      {props.children}
    </text>
  )
}
