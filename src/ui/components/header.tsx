import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import type { KeyAction } from "../../keybindings"
import { useKeybindings } from "../keybindings"
import type { Repo } from "../../models"
import type { Page } from "../../navigation"
import type { RepositoryData } from "../../repository-state"
import { useTheme } from "../theme"
import { mouseClick } from "../mouse"

function RepositoryName(props: { repo: Repo; short?: boolean; interactive?: boolean; onOpen?: () => void }) {
  const { colors } = useTheme()
  return (
    <box id="repository-dropdown" flexDirection="row" flexShrink={1} minWidth={0} maxWidth="100%"
      {...mouseClick(() => props.onOpen?.(), () => props.interactive !== false && Boolean(props.onOpen))}>
      <box flexDirection="row" flexShrink={1} minWidth={0} overflow="hidden">
        <Show when={!props.short}>
          <text height={1} wrapMode="none" flexShrink={0} selectable={!props.onOpen} fg={colors.muted}>{props.repo.nameWithOwner.split("/")[0]}/</text>
        </Show>
        <text height={1} wrapMode="none" truncate flexShrink={1} minWidth={0} selectable={!props.onOpen}
          fg={props.interactive === false && props.onOpen ? colors.muted : colors.blue} attributes={TextAttributes.BOLD}>
          {props.repo.nameWithOwner.split("/").slice(1).join("/")}
        </text>
      </box>
      <Show when={props.onOpen}><text flexShrink={0} height={1} selectable={false} fg={colors.muted}> ▾</text></Show>
    </box>
  )
}

export function Header(props: {
  repo: Repo
  page: Page
  interactive?: boolean
  onSelect?: (page: Page) => void
  onOpenRepository?: () => void
  compact?: boolean
  showTabCounts?: boolean
  workCounts?: RepositoryData["workCounts"]
  tabs: ReadonlyArray<{ page: Page; label: string }>
}) {
  const { colors } = useTheme()
  const dimensions = useTerminalDimensions()
  const keys = useKeybindings()
  const tabKey = (index: number) => index < 5 ? keys.key(`navigation.tab${index + 1}` as KeyAction) : ""
  const tabLabel = (index: number, label: string) => [tabKey(index), label].filter(Boolean).join(" ")
  const layout = createMemo(() => {
    const width = Math.max(0, dimensions().width - 4)
    const tabs = props.tabs.map((tab, index) => {
      const label = tabLabel(index, tab.label)
      if (props.showTabCounts === false || tab.page !== "issues" && tab.page !== "pulls") return { ...tab, label, counted: label }
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
    const dropdownWidth = props.onOpenRepository ? 2 : 0
    const switchLabel = width < 24 ? "▾" : "Repo ▾"
    const repository = !props.compact ? "hidden"
      : countedWidth + 2 + Bun.stringWidth(fullRepo) + dropdownWidth <= width ? "full"
      : countedWidth + 2 + Bun.stringWidth(shortRepo) + dropdownWidth <= width ? "short"
      : props.onOpenRepository ? "button" : "hidden"
    const repositoryWidth = repository === "button" ? Bun.stringWidth(switchLabel)
      : Bun.stringWidth(repository === "full" ? fullRepo : shortRepo) + dropdownWidth
    const available = width - (repository === "hidden" ? 0 : 2 + repositoryWidth)
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
      visible[0] = { ...visible[0], label: tabLabel(active, shortLabels[visible[0].page]) }
      if (Bun.stringWidth(visible[0].label) + (start > 0 ? 2 : 0) + (end < labels.length ? 2 : 0) > available)
        visible[0] = { ...visible[0], label: tabKey(active) || shortLabels[visible[0].page] }
    }
    return { tabs: visible, before: start > 0, after: end < labels.length, previous: labels[start - 1]?.page, next: labels[end]?.page, repository, switchLabel }
  })

  return (
    <box flexDirection="column" flexShrink={0} backgroundColor={colors.header}>
      <Show when={!props.compact}>
        <box height={3} flexDirection="row" alignItems="center" paddingLeft={2} paddingRight={2}>
          <RepositoryName repo={props.repo} interactive={props.interactive} onOpen={props.onOpenRepository} />
        </box>
      </Show>
      <box height={props.compact ? 1 : 2} minWidth={0} flexDirection="row" paddingLeft={2} paddingRight={2} gap={2}>
        <box minWidth={0} overflow="hidden" flexGrow={1} flexDirection="row">
          <Show when={layout().before}>
            <text height={1} width={2} flexShrink={0} fg={colors.muted} selectable={false}
              {...mouseClick(() => { const page = layout().previous; if (page) props.onSelect?.(page) }, () => props.interactive !== false)}>‹ </text>
          </Show>
          <box flexDirection="row" gap={3} flexShrink={0}>
            <For each={layout().tabs}>
              {(tab) => {
                const active = () => props.page === tab.page
                return (
                  <box height={props.compact ? 1 : 2} width={Bun.stringWidth(tab.label)} flexShrink={0} flexDirection="column"
                    {...mouseClick(() => props.onSelect?.(tab.page), () => props.interactive !== false)}>
                    <text
                      height={1}
                      wrapMode="none"
                      selectable={false}
                      fg={active() ? props.compact ? colors.salmon : colors.text : colors.muted}
                      attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                    >
                      {tab.label}
                    </text>
                    <Show when={!props.compact}>
                      <text selectable={false} fg={colors.salmon}>{active() ? "─".repeat(Bun.stringWidth(tab.label)) : " ".repeat(Bun.stringWidth(tab.label))}</text>
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
          <Show when={layout().after}>
            <text height={1} width={2} flexShrink={0} fg={colors.muted} selectable={false}
              {...mouseClick(() => { const page = layout().next; if (page) props.onSelect?.(page) }, () => props.interactive !== false)}> ›</text>
          </Show>
        </box>
        <Show when={layout().repository !== "hidden"}>
          <Show when={layout().repository !== "button"} fallback={
            <text id="repository-dropdown" height={1} flexShrink={0} selectable={false} fg={props.interactive === false ? colors.muted : colors.blue}
              {...mouseClick(() => props.onOpenRepository?.(), () => props.interactive !== false)}>{layout().switchLabel}</text>
          }>
            <RepositoryName repo={props.repo} short={layout().repository === "short"} interactive={props.interactive} onOpen={props.onOpenRepository} />
          </Show>
        </Show>
      </box>
    </box>
  )
}
