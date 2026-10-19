import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Show } from "solid-js"
import type { CommitSummary, Paginated } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ListLine } from "../components/list-line"
import { ResourceStateView } from "../components/resource-state"
import { SelectableList } from "../components/selectable-list"
import { ago, fitText } from "../format"
import { useTheme } from "../theme"
import { useIcons } from "../icon-style"

export function CommitsScreen(props: {
  commits: ResourceState<Paginated<CommitSummary>>
  commitCount: ResourceState<number>
  currentBranch: string
  active: boolean
  interactive: boolean
  showScrollbar: boolean
  onEndReached?: () => void
  onOpenCommit?: (commit: CommitSummary) => void
  onOpenCommitInBrowser?: (commit: CommitSummary) => void
  onCopyCommitSha?: (commit: CommitSummary) => void
}) {
  const { colors } = useTheme()
  const icons = useIcons()
  const dimensions = useTerminalDimensions()
  const loadedCount = () => props.commits.value?.items.length ?? 0
  const countLabel = () => {
    const total = props.commitCount.value
    const loaded = loadedCount().toLocaleString("en-US")
    const quantity = total ?? loadedCount()
    const unit = quantity === 1 ? "commit" : "commits"
    if (total !== undefined) return `${loaded} of ${total.toLocaleString("en-US")} ${unit}`
    if (props.commitCount.status === "loading") return `${loaded} of … ${unit}`
    return `${loaded} ${unit}`
  }

  return (
    <PageShell
      header={(
        <box flexGrow={1} minWidth={0} flexDirection="row" alignItems="center" gap={2}>
          <Show when={props.commits.value !== undefined} fallback={<text fg={colors.text} attributes={TextAttributes.BOLD}>Commits</text>}>
            <text flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>
              {countLabel()}
            </text>
          </Show>
          <box width={Bun.stringWidth(props.currentBranch) + 4} flexShrink={1} minWidth={0} flexDirection="row" overflow="hidden">
            <box flexGrow={1} flexBasis={0} minWidth={0}>
              <ListLine fg={colors.blue} attributes={TextAttributes.BOLD}>
                {(width) => fitText(`${icons().branch} ${props.currentBranch}`, width)}
              </ListLine>
            </box>
            <text flexShrink={0} fg={colors.muted}> ▾</text>
          </box>
        </box>
      )}
    >
      <ResourceStateView resource={props.commits}>
        {(commits) => (
          <SelectableList
            items={commits().items}
            itemKey={(commit) => commit.sha}
            active={props.active && props.interactive}
            showScrollbar={props.showScrollbar}
            resetKey={props.currentBranch}
            empty="No commits"
            onEndReached={props.onEndReached}
            onActivate={props.onOpenCommit}
            onOpenInBrowser={props.onOpenCommitInBrowser}
            onCopy={props.onCopyCommitSha}
          >
            {(commit, active) => (
              <>
                <box height={2} flexGrow={1} flexBasis={0} minWidth={0} flexDirection="column" overflow="hidden">
                  <ListLine
                    fg={colors.text}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {(width) => fitText(commit().message, width)}
                  </ListLine>
                  <ListLine fg={colors.muted}>
                    {(width) => fitText(`${commit().author} committed ${ago(commit().date)}`, width)}
                  </ListLine>
                </box>
                <Show when={dimensions().width >= 60}>
                  <box height={2} width={10} flexShrink={0} alignItems="center" justifyContent="flex-end" overflow="hidden">
                    <text fg={colors.blue}>{commit().sha.slice(0, 7)}</text>
                  </box>
                </Show>
              </>
            )}
          </SelectableList>
        )}
      </ResourceStateView>
    </PageShell>
  )
}
