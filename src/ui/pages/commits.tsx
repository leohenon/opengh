import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { CommitSummary, Paginated } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ResourceStateView } from "../components/resource-state"
import { SelectableList } from "../components/selectable-list"
import { ago, fitText } from "../format"
import { colors } from "../theme"

export function CommitsScreen(props: {
  commits: ResourceState<Paginated<CommitSummary>>
  currentBranch: string
  branchCount: number
  active: boolean
  interactive: boolean
  showScrollbar: boolean
  onEndReached?: () => void
}) {
  const dimensions = useTerminalDimensions()
  const messageWidth = () => Math.max(8, dimensions().width - 52 - (props.showScrollbar ? 1 : 0))

  return (
    <PageShell
      header={(
        <box flexDirection="row" gap={1}>
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            Commits ({props.commits.value?.items.length ?? 0})
          </text>
          <text fg={colors.blue}>
             {props.currentBranch} ({props.branchCount} {props.branchCount === 1 ? "branch" : "branches"})
          </text>
        </box>
      )}
    >
      <ResourceStateView resource={props.commits} loading="Loading commits…">
        {(commits) => (
          <SelectableList
            items={commits().items}
            itemKey={(commit) => commit.sha}
            active={props.active && props.interactive}
            showScrollbar={props.showScrollbar}
            resetKey={props.currentBranch}
            empty="No commits"
            onEndReached={props.onEndReached}
            header={(
              <>
                <text width={2}> </text>
                <box width={11} flexShrink={0} paddingRight={1} overflow="hidden">
                  <text fg={colors.muted}>COMMIT</text>
                </box>
                <box width={messageWidth()} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text fg={colors.muted}>MESSAGE</text>
                </box>
                <box width={22} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text fg={colors.muted}>AUTHOR</text>
                </box>
                <box width={12} flexShrink={0} paddingLeft={1} overflow="hidden">
                  <text fg={colors.muted}>UPDATED</text>
                </box>
              </>
            )}
          >
            {(commit, active) => (
              <>
                <box height={1} width={11} flexShrink={0} paddingRight={1} overflow="hidden">
                  <text
                    width="100%"
                    height={1}
                    wrapMode="none"
                    fg={active() ? colors.blue : colors.muted}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {commit().sha.slice(0, 7)}
                  </text>
                </box>
                <box height={1} width={messageWidth()} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text width="100%" height={1} wrapMode="none" fg={colors.text}>
                    {fitText(commit().message, messageWidth() - 2)}
                  </text>
                </box>
                <box height={1} width={22} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text width="100%" height={1} wrapMode="none" fg={colors.muted}>
                    {fitText(commit().author, 20)}
                  </text>
                </box>
                <box height={1} width={12} flexShrink={0} paddingLeft={1} overflow="hidden">
                  <text width="100%" height={1} wrapMode="none" fg={colors.muted}>{ago(commit().date)}</text>
                </box>
              </>
            )}
          </SelectableList>
        )}
      </ResourceStateView>
    </PageShell>
  )
}
