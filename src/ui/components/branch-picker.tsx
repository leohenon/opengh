import { TextAttributes, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { Paginated } from "../../models"
import type { ResourceState } from "../../repository-state"
import { colors } from "../theme"
import { Popup } from "./popup"

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

type BranchRow = { kind: "branch"; key: string; branch: string }
type LoadRow = { kind: "load"; key: string; label: string; action?: "load-more" | "retry" }
type PickerRow = BranchRow | LoadRow

export function BranchPicker(props: {
  branches: ResourceState<Paginated<string>>
  current: string
  showScrollbar: boolean
  onSelect: (branch: string) => void
  onLoadMore: () => Promise<void>
  onRetry: () => void
  onClose: () => void
}) {
  const [query, setQuery] = createSignal("")
  const [selectedKey, setSelectedKey] = createSignal(`branch:${props.current}`)
  const [listReady, setListReady] = createSignal(false)
  let list: ScrollBoxRenderable | undefined

  const branchSummary = () => {
    const count = props.branches.value?.items.length ?? 0
    if (props.branches.value?.hasMore) return `${count} loaded`
    return `${count} ${count === 1 ? "branch" : "branches"}`
  }

  const branches = createMemo(() => {
    const needle = query().trim()
    const loaded = props.branches.value?.items ?? []
    const source = loaded.includes(props.current) ? loaded : [props.current, ...loaded]
    return source
      .map((branch, index) => ({ branch, index, score: fuzzyScore(branch, needle) }))
      .filter((entry): entry is { branch: string; index: number; score: number } => entry.score !== undefined)
      .sort((left, right) => {
        if (!needle) {
          if (left.branch === props.current) return -1
          if (right.branch === props.current) return 1
        }
        return left.score - right.score || left.index - right.index
      })
  })

  const loadRow = (): LoadRow | undefined => {
    if (props.branches.status === "error") {
      const pagination = props.branches.phase === "pagination"
      return {
        kind: "load",
        key: "load-more",
        label: pagination ? "Failed to load — Enter to retry" : "Failed to refresh — Enter to retry",
        action: pagination ? "load-more" : "retry",
      }
    }
    if (!props.branches.value?.hasMore) return undefined
    if (props.branches.status === "loading") {
      const label = props.branches.phase === "pagination" ? "Loading more branches…" : "Loading branches…"
      return { kind: "load", key: "load-more", label }
    }
    return { kind: "load", key: "load-more", label: "Load more branches…", action: "load-more" }
  }

  const rows = createMemo<PickerRow[]>(() => [
    ...branches().map((entry) => ({ kind: "branch" as const, key: `branch:${entry.branch}`, branch: entry.branch })),
    ...(loadRow() ? [loadRow()!] : []),
  ])

  const selected = () => Math.max(0, rows().findIndex((row) => row.key === selectedKey()))
  const move = (delta: number) => {
    const available = rows()
    if (!available.length) return
    const index = Math.max(0, available.findIndex((row) => row.key === selectedKey()))
    const next = available[Math.max(0, Math.min(available.length - 1, index + delta))]
    if (next) setSelectedKey(next.key)
  }

  createEffect(() => {
    listReady()
    const available = rows()
    let index = available.findIndex((row) => row.key === selectedKey())
    if (index < 0) {
      const first = available[0]
      if (!first) return
      setSelectedKey(first.key)
      index = 0
    }
    list?.scrollChildIntoView(`branch-${index}`)
  })

  const handleKey = (event: KeyEvent) => {
    if (event.name === "escape" || event.name === "esc" || event.raw === "\u001b" || event.sequence === "\u001b")
      return props.onClose()
    if (event.name === "up") return move(-1)
    if (event.name === "down") return move(1)
    if (event.name === "return" || event.name === "enter") {
      const row = rows()[selected()]
      if (row?.kind === "branch") return props.onSelect(row.branch)
      if (row?.kind === "load" && row.action === "load-more") void props.onLoadMore()
      if (row?.kind === "load" && row.action === "retry") props.onRetry()
    }
  }

  return (
    <Popup width={64} height={22} zIndex={100}>
      <box flexGrow={1} minHeight={0} flexDirection="column" gap={1} paddingBottom={1}>
        <box flexShrink={0} paddingLeft={4} paddingRight={4}>
          <box height={1} flexDirection="row" justifyContent="space-between">
            <text fg={colors.text} attributes={TextAttributes.BOLD}>Switch branch ({branchSummary()})</text>
            <text fg={colors.muted}>esc</text>
          </box>
          <box height={2} flexShrink={0} paddingTop={1}>
            <input
              width="100%"
              focused
              value={query()}
              placeholder="Search branches"
              placeholderColor={colors.muted}
              focusedBackgroundColor={colors.panel}
              textColor={colors.text}
              cursorColor={colors.blue}
              onInput={(value) => {
                setQuery(value)
                setSelectedKey(rows()[0]?.key ?? "")
              }}
              onKeyDown={handleKey}
            />
          </box>
        </box>
        <scrollbox
          ref={(value) => {
            list = value
            setListReady(true)
          }}
          flexGrow={1}
          minHeight={0}
          paddingLeft={1}
          paddingRight={1}
          verticalScrollbarOptions={{ visible: props.showScrollbar }}
          scrollY
        >
          <Show when={branches().length === 0}>
            <box height={1} paddingLeft={3}>
              <text fg={colors.muted}>No matches</text>
            </box>
          </Show>
          <For each={rows()}>
            {(row, index) => {
              const active = () => selectedKey() === row.key
              return (
                <box
                  id={`branch-${index()}`}
                  height={1}
                  flexShrink={0}
                  flexDirection="row"
                  paddingLeft={3}
                  paddingRight={3}
                  backgroundColor={active() ? colors.panelHover : colors.panel}
                >
                  <text width={2} fg={colors.blue}>{active() ? "›" : " "}</text>
                  <box height={1} flexGrow={1} minWidth={0} overflow="hidden">
                    <text
                      width="100%"
                      height={1}
                      wrapMode="none"
                      fg={row.kind === "load" ? colors.muted : active() ? colors.blue : colors.text}
                      attributes={active() && row.kind === "branch" ? TextAttributes.BOLD : TextAttributes.NONE}
                    >
                      {row.kind === "branch" ? row.branch : row.label}
                    </text>
                  </box>
                  <text width={10} flexShrink={0} fg={colors.green}>
                    {row.kind === "branch" && row.branch === props.current
                      ? "✓ current"
                      : row.kind === "load" && row.action ? "enter" : ""}
                  </text>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </box>
    </Popup>
  )
}
