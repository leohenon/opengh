import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal } from "solid-js"
import type { Paginated } from "../../models"
import type { ResourceState } from "../../repository-state"
import { colors } from "../theme"
import { SearchablePicker } from "./searchable-picker"

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
  const source = createMemo(() => {
    const loaded = props.branches.value?.items ?? []
    return loaded.includes(props.current) ? loaded : [props.current, ...loaded]
  })
  const hasBranchMatch = () => source().some((branch) => fuzzyScore(branch, query()) !== undefined)
  const branchSummary = () => {
    const count = props.branches.value?.items.length ?? 0
    if (props.branches.value?.hasMore) return `${count} loaded`
    return `${count} ${count === 1 ? "branch" : "branches"}`
  }
  const loadRow = (): LoadRow | undefined => {
    if (props.branches.status === "error") {
      const pagination = props.branches.phase === "pagination"
      return {
        kind: "load",
        key: "load-more",
        label: pagination ? "Load failed — Enter to retry" : "Refresh failed — Enter to retry",
        action: pagination ? "load-more" : "retry",
      }
    }
    if (!props.branches.value?.hasMore) return undefined
    if (props.branches.status === "loading") {
      const label = props.branches.phase === "pagination" ? "Loading more branches…" : "Loading branches…"
      return { kind: "load", key: "load-more", label }
    }
    const label = query().trim() && !hasBranchMatch()
      ? "No matches loaded — Enter to load more"
      : "Load more branches…"
    return { kind: "load", key: "load-more", label, action: "load-more" }
  }
  const rows = createMemo<PickerRow[]>(() => [
    ...source().map((branch) => ({ kind: "branch" as const, key: `branch:${branch}`, branch })),
    ...(loadRow() ? [loadRow()!] : []),
  ])

  const select = (row: PickerRow) => {
    if (row.kind === "branch") return props.onSelect(row.branch)
    if (row.action === "load-more") void props.onLoadMore()
    if (row.action === "retry") props.onRetry()
  }

  return (
    <SearchablePicker
      title={`Switch branch (${branchSummary()})`}
      placeholder="Search branches"
      items={rows()}
      itemKey={(row) => row.key}
      match={(row, needle) => row.kind === "branch" ? fuzzyScore(row.branch, needle) : Number.MAX_SAFE_INTEGER}
      preferred={(row) => row.kind === "branch" && row.branch === props.current}
      height={22}
      showScrollbar={props.showScrollbar}
      empty="No matching branches"
      onQueryChange={setQuery}
      onSelect={select}
      onClose={props.onClose}
    >
      {(row, active) => (
        <>
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
        </>
      )}
    </SearchablePicker>
  )
}
