import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import type { Repo } from "../../models"
import type { Page } from "../../navigation"
import type { RepositoryData } from "../../repository-state"
import { useTheme } from "../theme"

function RepositoryName(props: { repo: Repo; short?: boolean }) {
  const { colors } = useTheme()
  return (
    <box flexDirection="row" flexShrink={0}>
      <Show when={!props.short}>
        <text fg={colors.muted}>{props.repo.nameWithOwner.split("/")[0]}/</text>
      </Show>
      <text fg={colors.blue} attributes={TextAttributes.BOLD}>
        {props.repo.nameWithOwner.split("/").slice(1).join("/")}
      </text>
    </box>
  )
}

export function Header(props: {
  repo: Repo
  page: Page
  compact?: boolean
  workCounts?: RepositoryData["workCounts"]
  tabs: ReadonlyArray<{ page: Page; label: string }>
}) {
  const { colors } = useTheme()
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => {
    const width = Math.max(0, dimensions().width - 4)
    const tabs = props.tabs.map((tab, index) => {
      const label = `${index + 1} ${tab.label}`
      if (tab.page !== "issues" && tab.page !== "pulls") return { ...tab, label, counted: label }
      const count = props.workCounts?.value?.[tab.page]
      const placeholder = props.workCounts?.status === "error" ? "—" : "…"
      return { ...tab, label, counted: `${label} (${count ?? placeholder})` }
    })
    const totalWidth = (labels: string[]) => labels.reduce((sum, label) => sum + Bun.stringWidth(label), 0)
      + Math.max(0, labels.length - 1) * 3
    const countedWidth = totalWidth(tabs.map((tab) => tab.counted))
    // Navigation takes priority: shorten the repository, then hide it, before
    // dropping counts or windowing tabs. The expanded header has its own repo row.
    const fullRepo = props.repo.nameWithOwner
    const shortRepo = fullRepo.split("/").slice(1).join("/")
    const repository = !props.compact ? "hidden"
      : countedWidth + 2 + Bun.stringWidth(fullRepo) <= width ? "full"
      : countedWidth + 2 + Bun.stringWidth(shortRepo) <= width ? "short" : "hidden"
    const available = width - (repository === "hidden" ? 0 : 2 + Bun.stringWidth(repository === "full" ? fullRepo : shortRepo))
    const labels = tabs.map((tab) => ({ ...tab, label: countedWidth <= available ? tab.counted : tab.label }))
    const active = Math.max(0, labels.findIndex((tab) => tab.page === props.page))
    const windowWidth = (start: number, end: number) => totalWidth(labels.slice(start, end).map((tab) => tab.label))
      + (start > 0 ? 2 : 0) + (end < labels.length ? 2 : 0)
    let start = active
    let end = Math.min(active + 1, labels.length)
    // Keep the largest contiguous set of whole tabs containing the active tab.
    // Earliest-window ties keep the strip stable until navigation reaches its edge.
    for (let left = 0; left <= active; left++) {
      for (let right = active + 1; right <= labels.length; right++) {
        if (windowWidth(left, right) <= available && (right - left > end - start
          || right - left === end - start && left < start)) {
          start = left
          end = right
        }
      }
    }
    const visible = labels.slice(start, end)
    // At exceptionally small widths, use a complete short name, never a partial tab.
    if (windowWidth(start, end) > available && visible[0]) {
      const shortLabels: Record<Page, string> = { overview: "Repo", commits: "Commits", issues: "Issues", pulls: "PRs", actions: "CI" }
      visible[0] = { ...visible[0], label: `${active + 1} ${shortLabels[visible[0].page]}` }
      if (Bun.stringWidth(visible[0].label) + (start > 0 ? 2 : 0) + (end < labels.length ? 2 : 0) > available)
        visible[0] = { ...visible[0], label: String(active + 1) }
    }
    return { tabs: visible, before: start > 0, after: end < labels.length, repository }
  })

  return (
    <box flexDirection="column" flexShrink={0} backgroundColor={colors.header}>
      <Show when={!props.compact}>
        <box height={3} flexDirection="row" alignItems="center" paddingLeft={2} paddingRight={2}>
          <RepositoryName repo={props.repo} />
        </box>
      </Show>
      <box height={props.compact ? 1 : 2} minWidth={0} flexDirection="row" paddingLeft={2} paddingRight={2} gap={2}>
        <box minWidth={0} overflow="hidden" flexGrow={1} flexDirection="row">
          <Show when={layout().before}>
            <text height={1} width={2} flexShrink={0} fg={colors.muted}>‹ </text>
          </Show>
          <box flexDirection="row" gap={3} flexShrink={0}>
            <For each={layout().tabs}>
              {(tab) => {
                const active = () => props.page === tab.page
                return (
                  <box height={props.compact ? 1 : 2} width={Bun.stringWidth(tab.label)} flexShrink={0} flexDirection="column">
                    <text
                      height={1}
                      wrapMode="none"
                      fg={active() ? props.compact ? colors.salmon : colors.text : colors.muted}
                      attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                    >
                      {tab.label}
                    </text>
                    <Show when={!props.compact}>
                      <text fg={colors.salmon}>{active() ? "─".repeat(Bun.stringWidth(tab.label)) : " ".repeat(Bun.stringWidth(tab.label))}</text>
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
          <Show when={layout().after}>
            <text height={1} width={2} flexShrink={0} fg={colors.muted}> ›</text>
          </Show>
        </box>
        <Show when={layout().repository !== "hidden"}>
          <RepositoryName repo={props.repo} short={layout().repository === "short"} />
        </Show>
      </box>
    </box>
  )
}
