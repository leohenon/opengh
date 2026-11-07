import { Show } from "solid-js"
import { KeyInput } from "../keybindings"
import { useTheme } from "../theme"

export function SearchBar(props: { query: string; editing: boolean; current: number; total: number; zIndex?: number; onInput(query: string): void }) {
  const { colors } = useTheme()
  return <box height={1} minWidth={0} flexShrink={0} flexDirection="row" overflow="hidden" backgroundColor={colors.canvas} zIndex={props.zIndex ?? 0}>
    <text height={1} width={2} flexShrink={0} wrapMode="none" fg={colors.blue}> /</text>
    <box height={1} flexGrow={1} flexBasis={0} minWidth={0} overflow="hidden">
      <Show when={props.editing} fallback={<text width="100%" height={1} wrapMode="none" truncate fg={colors.text}>{props.query}</text>}>
        <KeyInput width="100%" height={1} focused value={props.query} onInput={props.onInput}
          textColor={colors.text} backgroundColor={colors.canvas} />
      </Show>
    </box>
    <text height={1} flexShrink={0} wrapMode="none" fg={colors.muted}>{props.query ? props.total ? `${props.current}/${props.total} ` : "No matches " : ""}</text>
  </box>
}
