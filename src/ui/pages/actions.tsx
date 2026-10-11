import { TextAttributes } from "@opentui/core"
import type { Paginated, WorkflowRunSummary } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ListLine } from "../components/list-line"
import { ResourceStateView } from "../components/resource-state"
import { SelectableList } from "../components/selectable-list"
import { ago, fitText } from "../format"
import { useTheme } from "../theme"

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
  const { colors } = useTheme()
  const runCount = () => props.runs.value?.items.length ?? 0
  const runColor = (run: WorkflowRunSummary) => {
    if (run.status !== "completed") return colors.yellow
    return run.conclusion === "success" ? colors.green : colors.red
  }

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
      <ResourceStateView resource={props.runs}>
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
                <box height={2} flexGrow={1} flexBasis={0} minWidth={0} flexDirection="column" overflow="hidden">
                  <ListLine
                    fg={colors.text}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {(width) => fitText(run().title, width)}
                  </ListLine>
                  <ListLine fg={colors.muted}>
                    {(width) => {
                      const prefix = `${run().name} · `
                      const state = runState(run())
                      const value = fitText(`${prefix}${state} · ${ago(run().createdAt)}`, width)
                      const stateStart = Math.min(prefix.length, value.length)
                      const stateEnd = Math.min(prefix.length + state.length, value.length)
                      return <>{value.slice(0, stateStart)}<span style={{ fg: runColor(run()) }}>{value.slice(stateStart, stateEnd)}</span>{value.slice(stateEnd)}</>
                    }}
                  </ListLine>
                </box>
              </>
            )}
          </SelectableList>
        )}
      </ResourceStateView>
    </PageShell>
  )
}
