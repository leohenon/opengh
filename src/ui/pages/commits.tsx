import { TextAttributes } from "@opentui/core"
import type { CommitSummary, Paginated } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ResourceStateView } from "../components/resource-state"
import { SelectableList } from "../components/selectable-list"
import { ago } from "../format"
import { colors } from "../theme"

export function CommitsScreen(props: {
  commits: ResourceState<Paginated<CommitSummary>>
  currentBranch: string
  active: boolean
  interactive: boolean
  showScrollbar: boolean
  onEndReached?: () => void
}) {
  const commitCount = () => props.commits.value?.items.length ?? 0

  return (
    <PageShell
      header={(
        <box flexGrow={1} minWidth={0} flexDirection="row" alignItems="center" gap={2}>
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            {commitCount()} {commitCount() === 1 ? "commit" : "commits"}
          </text>
          <box flexShrink={0} flexDirection="row">
            <text fg={colors.blue} attributes={TextAttributes.BOLD}> {props.currentBranch}</text>
            <text fg={colors.muted}> ▾</text>
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
          >
            {(commit, active) => (
              <>
                <box height={2} flexGrow={1} minWidth={0} flexDirection="column" overflow="hidden">
                  <text
                    width="100%"
                    height={1}
                    wrapMode="none"
                    fg={colors.text}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {commit().message}
                  </text>
                  <text width="100%" height={1} wrapMode="none" fg={colors.muted}>
                    {commit().author} committed {ago(commit().date)}
                  </text>
                </box>
                <box height={2} width={10} flexShrink={0} alignItems="center" justifyContent="flex-end" overflow="hidden">
                  <text fg={colors.blue}>{commit().sha.slice(0, 7)}</text>
                </box>
              </>
            )}
          </SelectableList>
        )}
      </ResourceStateView>
    </PageShell>
  )
}
