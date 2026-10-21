import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "../theme"
import { useLoadingGlyph } from "../motion"

export function LoadingText(props: { text: string; color?: string; delay?: number }) {
  const { colors } = useTheme()
  const [visible, setVisible] = createSignal(false)
  const glyph = useLoadingGlyph(visible)
  let delayTimer: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    delayTimer = setTimeout(() => {
      setVisible(true)
    }, props.delay ?? 200)
  })

  onCleanup(() => {
    if (delayTimer !== undefined) clearTimeout(delayTimer)
  })

  return (
    <Show when={visible()}>
      <text fg={props.color ?? colors.muted}>{glyph()} {props.text}</text>
    </Show>
  )
}
