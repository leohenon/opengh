import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { colors } from "../theme"

const frames = ["◐", "◓", "◑", "◒"] as const

export function LoadingText(props: { text: string; color?: string; delay?: number }) {
  const [visible, setVisible] = createSignal(false)
  const [frame, setFrame] = createSignal(0)
  let delayTimer: ReturnType<typeof setTimeout> | undefined
  let frameTimer: ReturnType<typeof setInterval> | undefined

  onMount(() => {
    delayTimer = setTimeout(() => {
      setVisible(true)
      frameTimer = setInterval(() => setFrame((value) => (value + 1) % frames.length), 125)
    }, props.delay ?? 200)
  })

  onCleanup(() => {
    if (delayTimer !== undefined) clearTimeout(delayTimer)
    if (frameTimer !== undefined) clearInterval(frameTimer)
  })

  return (
    <Show when={visible()}>
      <text fg={props.color ?? colors.muted}>{frames[frame()]} {props.text}</text>
    </Show>
  )
}
