import { TextAttributes } from "@opentui/core"
import type { Paginated, WorkflowRunSummary } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ResourceStateView } from "../components/resource-state"
import { SelectableList } from "../components/selectable-list"
import { ago } from "../format"
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
  const runCount = () => props.runs.value?.items.length ?? 0

  return (
    <PageShell
      header={(
        <box flexDirection="row" alignItems="center">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            {runCount()} {runCount() === 1 ? "workflow run" : "workflow runs"}
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
          >
            {(run, active) => (
              <>
                <box height={2} width={3} flexShrink={0} alignItems="flex-start">
                  <text fg={runColor(run())}>{runIcon(run())}</text>
                </box>
                <box height={2} flexGrow={1} minWidth={0} flexDirection="column" overflow="hidden">
                  <text
                    width="100%"
                    height={1}
                    wrapMode="none"
                    fg={colors.text}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {run().title}
                  </text>
                  <box height={1} flexDirection="row" overflow="hidden">
                    <text fg={colors.muted}>{run().name} · </text>
                    <text fg={runColor(run())}>{runState(run())}</text>
                    <text fg={colors.muted}> · {ago(run().createdAt)}</text>
                  </box>
                </box>
              </>
            )}
          </SelectableList>
        )}
      </ResourceStateView>
    </PageShell>
  )
}
