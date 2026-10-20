import type { BoxRenderable } from "@opentui/core"
import { createSignal, type JSX } from "solid-js"

// Measure the allocated row width, not the terminal or the text's intrinsic width.
export function ListLine(props: {
  fg: string
  attributes?: number
  children: (width: number) => JSX.Element
}) {
  const [width, setWidth] = createSignal(0)
  let box: BoxRenderable | undefined
  const updateWidth = () => setWidth(box?.width ?? 0)

  return (
    <box
      ref={(value) => { box = value; updateWidth() }}
      onSizeChange={updateWidth}
      width="100%"
      height={1}
      flexShrink={0}
      overflow="hidden"
    >
      <text width="100%" height={1} wrapMode="none" truncate fg={props.fg} attributes={props.attributes}>
        {props.children(width())}
      </text>
    </box>
  )
}
