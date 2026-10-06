import { TextAttributes, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { colors } from "../theme"

function fuzzyScore(value: string, query: string) {
  const target = value.toLowerCase()
  const needle = query.trim().toLowerCase()
  if (!needle) return 0

  let cursor = 0
  let score = 0
  for (const character of needle) {
    const index = target.indexOf(character, cursor)
    if (index < 0) return undefined
    score += index - cursor
    cursor = index + 1
  }

  return score + (target.startsWith(needle) ? -100 : 0)
}

export function BranchPicker(props: {
  branches: string[]
  current: string
  showScrollbar: boolean
  onSelect: (branch: string) => void
  onClose: () => void
}) {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  let list: ScrollBoxRenderable | undefined

  const branches = createMemo(() => props.branches
    .map((branch, index) => ({ branch, index, score: fuzzyScore(branch, query()) }))
    .filter((entry): entry is { branch: string; index: number; score: number } => entry.score !== undefined)
    .sort((left, right) => left.score - right.score || left.index - right.index))

  const move = (delta: number) => {
    const length = branches().length
    if (!length) return
    setSelected((value) => Math.max(0, Math.min(length - 1, value + delta)))
  }

  createEffect(() => {
    const max = branches().length
    if (selected() >= max) setSelected(Math.max(0, max - 1))
    list?.scrollChildIntoView(`branch-${selected()}`)
  })

  const handleKey = (event: KeyEvent) => {
    if (event.name === "escape" || event.name === "esc" || event.raw === "\u001b" || event.sequence === "\u001b")
      return props.onClose()
    if (event.name === "up") return move(-1)
    if (event.name === "down") return move(1)
    if (event.name === "return" || event.name === "enter") {
      const branch = branches()[selected()]?.branch
      if (branch) props.onSelect(branch)
    }
  }

  const width = () => Math.max(1, Math.min(72, dimensions().width - 4))
  const height = () => Math.max(8, Math.min(22, dimensions().height - 4))

  return (
    <box
      position="absolute"
      left={Math.max(0, Math.floor((dimensions().width - width()) / 2))}
      top={Math.max(0, Math.floor((dimensions().height - height()) / 2))}
      width={width()}
      height={height()}
      zIndex={100}
      border
      borderStyle="rounded"
      borderColor={colors.blue}
      backgroundColor={colors.panel}
      flexDirection="column"
      padding={1}
      title=" Switch branch "
    >
      <box height={3} flexShrink={0} border borderColor={colors.border} paddingLeft={1} paddingRight={1} alignItems="center">
        <input
          width="100%"
          focused
          value={query()}
          placeholder="Search branches"
          textColor={colors.text}
          cursorColor={colors.blue}
          onInput={(value) => {
            setQuery(value)
            setSelected(0)
          }}
          onKeyDown={handleKey}
        />
      </box>
      <scrollbox
        ref={(value) => (list = value)}
        flexGrow={1}
        minHeight={0}
        verticalScrollbarOptions={{ visible: props.showScrollbar }}
        scrollY
      >
        <Show
          when={branches().length > 0}
          fallback={<box height={2} paddingLeft={1} alignItems="center"><text fg={colors.muted}>No matching branches</text></box>}
        >
          <For each={branches()}>
            {(entry, index) => {
              const active = () => selected() === index()
              return (
                <box
                  id={`branch-${index()}`}
                  height={2}
                  flexShrink={0}
                  flexDirection="row"
                  alignItems="center"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active() ? colors.panelHover : colors.panel}
                >
                  <text width={3} fg={entry.branch === props.current ? colors.green : colors.muted}>
                    {entry.branch === props.current ? "✓" : active() ? "›" : " "}
                  </text>
                  <text
                    fg={active() ? colors.blue : colors.text}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {entry.branch}
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </scrollbox>
    </box>
  )
}
