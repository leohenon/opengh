import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, For, Show } from "solid-js"
import type { Run } from "../../models"
import { ago } from "../format"
import { colors } from "../theme"

function runColor(run: Run) {
  if (run.status !== "completed") return colors.yellow
  return run.conclusion === "success" ? colors.green : colors.red
}

function runIcon(run: Run) {
  if (run.status !== "completed") return "◌"
  return run.conclusion === "success" ? "✓" : "×"
}

function runState(run: Run) {
  if (run.status !== "completed") return run.status.replaceAll("_", " ")
  return run.conclusion || "completed"
}

function ellipsis(value: string, width: number) {
  if (value.length <= width) return value
  return `${value.slice(0, Math.max(0, width - 3)).trimEnd()}...`
}

export function ActionsScreen(props: {
  runs: Run[]
  selected: number
}) {
  const dimensions = useTerminalDimensions()
  const titleWidth = () => Math.max(20, Math.min(88, dimensions().width - 56))
  let list: ScrollBoxRenderable | undefined

  createEffect(() => {
    list?.scrollChildIntoView(`workflow-run-${props.selected}`)
  })

  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection="column"
      backgroundColor={colors.canvas}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <box height={3} flexShrink={0} flexDirection="row" alignItems="center">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>Workflow runs ({props.runs.length})</text>
      </box>

      <box
        height={3}
        flexShrink={0}
        flexDirection="row"
        alignItems="center"
        backgroundColor={colors.panel}
        paddingRight={1}
      >
        <text width={2}> </text>
        <text width={4}> </text>
        <text width={16} fg={colors.muted}>STATUS</text>
        <text width={18} fg={colors.muted}> WORKFLOW</text>
        <text flexGrow={1} minWidth={0} fg={colors.muted}> RUN</text>
        <text width={10} flexShrink={0} fg={colors.muted}> STARTED</text>
      </box>

      <scrollbox
        ref={(value) => (list = value)}
        flexGrow={1}
        minHeight={0}
        backgroundColor={colors.canvas}
        scrollY
      >
        <Show
          when={props.runs.length > 0}
          fallback={<box height={3} alignItems="center" paddingLeft={2}><text fg={colors.muted}>No workflow runs</text></box>}
        >
          <For each={props.runs}>
            {(run, index) => {
              const active = () => props.selected === index()
              return (
                <box
                  id={`workflow-run-${index()}`}
                  height={3}
                  flexShrink={0}
                  flexDirection="row"
                  alignItems="center"
                  paddingRight={1}
                  backgroundColor={active() ? colors.panelHover : colors.canvas}
                >
                  <text width={2} fg={colors.blue}>{active() ? "▌" : " "}</text>
                  <text width={4} fg={runColor(run)}>{runIcon(run)}</text>
                  <text height={1} width={16} wrapMode="none" truncate fg={runColor(run)}>{runState(run)}</text>
                  <text height={1} width={18} flexShrink={0} wrapMode="none" truncate fg={colors.muted}> {run.name}</text>
                  <box height={1} width={titleWidth()} flexShrink={0} overflow="hidden">
                    <text width="100%" height={1} wrapMode="none" fg={colors.text}>
                      {ellipsis(run.title, titleWidth())}
                    </text>
                  </box>
                  <box flexGrow={1} />
                  <text height={1} width={10} flexShrink={0} wrapMode="none" fg={colors.muted}> {ago(run.createdAt)}</text>
                </box>
              )
            }}
          </For>
        </Show>
      </scrollbox>
    </box>
  )
}
