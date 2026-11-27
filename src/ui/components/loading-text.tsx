import { createEffect, createMemo, createSignal, onCleanup, Show, useContext, type Accessor } from "solid-js"
import { useTheme } from "../theme"
import { PaneVisible } from "./retained-pane"
import { useLoadingDots } from "../motion"

export function createLoadingVisibility(pending: Accessor<boolean>, delay = 200) {
  const active = createMemo(pending)
  const [visible, setVisible] = createSignal(false)
  createEffect(() => {
    if (!active()) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), delay)
    onCleanup(() => clearTimeout(timer))
  })
  return visible
}

export function LoadingLabel(props: { text: string; color?: string }) {
  const { colors } = useTheme()
  const dots = useLoadingDots(() => true)
  return (
    <text fg={props.color ?? colors.muted}>
      {props.text.replace(/(?:…|\.{1,3})$/, "")}
      {dots()}
    </text>
  )
}

export function LoadingText(props: { text: string; color?: string; delay?: number }) {
  const visible = createLoadingVisibility(useContext(PaneVisible), props.delay)
  return (
    <Show when={visible()}>
      <LoadingLabel text={props.text} color={props.color} />
    </Show>
  )
}
