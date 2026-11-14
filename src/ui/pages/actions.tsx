import { TextAttributes } from "@opentui/core"
import { createMemo, Show } from "solid-js"
import type { Paginated, WorkflowRunSummary } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ListLine } from "../components/list-line"
import { ResourceStateView } from "../components/resource-state"
import { SelectableList } from "../components/selectable-list"
import { ago, fitText } from "../format"
import { useTheme } from "../theme"
import { useIcons } from "../icon-style"
import type { MousePosition } from "../mouse"
import { runColor, runIcon, runState } from "../workflow-status"
import { useSpinner } from "../motion"

export function ActionsScreen(props: {
  runs: ResourceState<Paginated<WorkflowRunSummary>>
  active: boolean
  interactive: boolean
  showScrollbar: boolean
  onEndReached?: () => void
  onContextMenu?: (run: WorkflowRunSummary, position: MousePosition) => void
  onOpenRun?: (run: WorkflowRunSummary) => void
  onOpenRunInBrowser?: (run: WorkflowRunSummary) => void
  onCopyRunUrl?: (run: WorkflowRunSummary) => void
}) {
  const { colors } = useTheme()
  const icons = useIcons()
  const runCount = () => props.runs.value?.items.length ?? 0
  const working = createMemo(() => props.active && props.interactive && Boolean(icons().workflow.clock)
    && Boolean(props.runs.value?.items.some((run) => run.status === "in_progress")))
  const spinner = useSpinner(working)

  return (
    <PageShell
      header={(
        <box flexDirection="row" alignItems="center">
          <Show when={props.runs.value !== undefined} fallback={<text fg={colors.text} attributes={TextAttributes.BOLD}>Workflow runs</text>}>
            <text fg={colors.text} attributes={TextAttributes.BOLD}>
              {runCount()} {runCount() === 1 ? "workflow run" : "workflow runs"}
            </text>
          </Show>
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
            onActivate={props.onOpenRun}
            onContextMenu={props.onContextMenu}
            onOpenInBrowser={props.onOpenRunInBrowser}
            onCopy={props.onCopyRunUrl}
          >
            {(run, active) => (
              <>
                <box height={2} width={runIcon(run(), icons().workflow) ? 3 : 0} flexShrink={0} alignItems="flex-start">
                  <text fg={runColor(run(), colors)}>{run().status === "in_progress" && icons().workflow.clock ? spinner() : runIcon(run(), icons().workflow)}</text>
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
                      return <>{value.slice(0, stateStart)}<span style={{ fg: runColor(run(), colors) }}>{value.slice(stateStart, stateEnd)}</span>{value.slice(stateEnd)}</>
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
