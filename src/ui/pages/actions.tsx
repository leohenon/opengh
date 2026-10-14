import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { Paginated, WorkflowRunSummary } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ListLine } from "../components/list-line"
import { ResourceStateView } from "../components/resource-state"
import { SelectableList } from "../components/selectable-list"
import { ago, fitText } from "../format"
import { useTheme } from "../theme"
import { workflowIcons } from "../icons"

const spinnerFrames = ["◐", "◓", "◑", "◒"] as const

function runIcon(run: WorkflowRunSummary) {
  if (run.status !== "completed") return workflowIcons.clock
  switch (run.conclusion) {
    case "success": return workflowIcons.success
    case "failure":
    case "timed_out": return workflowIcons.failure
    case "cancelled":
    case "stale": return workflowIcons.cancelled
    case "skipped": return workflowIcons.skipped
    case "action_required": return workflowIcons.attention
    default: return workflowIcons.neutral
  }
}

function runState(run: WorkflowRunSummary) {
  if (run.status !== "completed") return run.status.replaceAll("_", " ")
  return run.conclusion.replaceAll("_", " ") || "completed"
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
  const [frame, setFrame] = createSignal(0)
  const spinning = createMemo(() => props.active && props.interactive
    && Boolean(props.runs.value?.items.some((run) => run.status === "in_progress")))
  createEffect(() => {
    if (!spinning()) return
    const timer = setInterval(() => setFrame((value) => (value + 1) % spinnerFrames.length), 125)
    onCleanup(() => clearInterval(timer))
  })
  const runColor = (run: WorkflowRunSummary) => {
    if (run.status === "in_progress" || run.status === "waiting") return colors.yellow
    if (run.status !== "completed") return colors.muted
    if (run.conclusion === "success") return colors.green
    if (run.conclusion === "failure" || run.conclusion === "timed_out") return colors.red
    return run.conclusion === "action_required" ? colors.yellow : colors.muted
  }

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
          >
            {(run, active) => (
              <>
                <box height={2} width={3} flexShrink={0} alignItems="flex-start">
                  <text fg={runColor(run())}>{run().status === "in_progress" ? spinnerFrames[frame()] : runIcon(run())}</text>
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
