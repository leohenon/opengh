import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { Paginated, WorkflowRunSummary } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ResourceStateView } from "../components/resource-state"
import { SelectableList } from "../components/selectable-list"
import { ago, fitText } from "../format"
import { colors } from "../theme"

function runColor(run: WorkflowRunSummary) {
  if (run.status !== "completed") return colors.yellow
  return run.conclusion === "success" ? colors.green : colors.red
}

function runIcon(run: WorkflowRunSummary) {
  if (run.status !== "completed") return "◌"
  return run.conclusion === "success" ? "✓" : "×"
}

function runState(run: WorkflowRunSummary) {
  if (run.status !== "completed") return run.status.replaceAll("_", " ")
  return run.conclusion || "completed"
}

export function ActionsScreen(props: {
  runs: ResourceState<Paginated<WorkflowRunSummary>>
  active: boolean
  interactive: boolean
  showScrollbar: boolean
  onEndReached?: () => void
}) {
  const dimensions = useTerminalDimensions()
  const workflowWidth = () => Math.max(18, Math.min(30, Math.floor(dimensions().width * 0.18)))
  const titleWidth = () => Math.max(8, dimensions().width - 41 - workflowWidth() - (props.showScrollbar ? 1 : 0))

  return (
    <PageShell
      header={(
        <box flexDirection="row" alignItems="center">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            Workflow runs ({props.runs.value?.items.length ?? 0})
          </text>
        </box>
      )}
    >
      <ResourceStateView resource={props.runs} loading="Loading workflow runs…">
        {(runs) => (
          <SelectableList
            items={runs().items}
            itemKey={(run) => run.id}
            active={props.active && props.interactive}
            showScrollbar={props.showScrollbar}
            empty="No workflow runs"
            onEndReached={props.onEndReached}
            header={(
              <>
                <text width={2}> </text>
                <text width={4}> </text>
                <box width={18} flexShrink={0} paddingRight={1} overflow="hidden">
                  <text fg={colors.muted}>STATUS</text>
                </box>
                <box width={workflowWidth()} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text fg={colors.muted}>WORKFLOW</text>
                </box>
                <box width={titleWidth()} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text fg={colors.muted}>RUN</text>
                </box>
                <box width={12} flexShrink={0} paddingLeft={1} overflow="hidden">
                  <text fg={colors.muted}>STARTED</text>
                </box>
              </>
            )}
          >
            {(run) => (
              <>
                <text width={4} flexShrink={0} fg={runColor(run())}>{runIcon(run())}</text>
                <box height={1} width={18} flexShrink={0} paddingRight={1} overflow="hidden">
                  <text width="100%" height={1} wrapMode="none" fg={runColor(run())}>
                    {fitText(runState(run()), 17)}
                  </text>
                </box>
                <box height={1} width={workflowWidth()} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text width="100%" height={1} wrapMode="none" fg={colors.muted}>
                    {fitText(run().name, workflowWidth() - 2)}
                  </text>
                </box>
                <box height={1} width={titleWidth()} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text width="100%" height={1} wrapMode="none" fg={colors.text}>
                    {fitText(run().title, titleWidth() - 2)}
                  </text>
                </box>
                <box height={1} width={12} flexShrink={0} paddingLeft={1} overflow="hidden">
                  <text width="100%" height={1} wrapMode="none" fg={colors.muted}>{ago(run().createdAt)}</text>
                </box>
              </>
            )}
          </SelectableList>
        )}
      </ResourceStateView>
    </PageShell>
  )
}
