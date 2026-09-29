import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, For, Show } from "solid-js"
import type { Issue, PullRequest } from "../../models"
import { ago } from "../format"
import { colors } from "../theme"

function ellipsis(value: string, width: number) {
  if (value.length <= width) return value
  return `${value.slice(0, Math.max(0, width - 3)).trimEnd()}...`
}

export function WorkScreen(props: {
  title: string
  kind: "issue" | "pull"
  state: "open" | "closed"
  counts: { open: number; closed: number }
  items: Array<Issue | PullRequest>
  selected: number
}) {
  const dimensions = useTerminalDimensions()
  const titleWidth = () => Math.max(
    20,
    Math.min(88, dimensions().width - (props.kind === "issue" ? 46 : 50)),
  )
  let list: ScrollBoxRenderable | undefined

  createEffect(() => {
    list?.scrollChildIntoView(`work-item-${props.selected}`)
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
      <box height={3} flexShrink={0} flexDirection="row" alignItems="center" gap={2}>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{props.title}</text>
        <text
          fg={props.state === "open" ? colors.green : colors.muted}
          attributes={props.state === "open" ? TextAttributes.BOLD : TextAttributes.NONE}
        >
          Open ({props.counts.open})
        </text>
        <text
          fg={props.state === "closed" ? colors.purple : colors.muted}
          attributes={props.state === "closed" ? TextAttributes.BOLD : TextAttributes.NONE}
        >
          Closed ({props.counts.closed})
        </text>
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
        <text width={10} fg={colors.muted}>{props.kind === "issue" ? "ISSUE" : "PULL"}</text>
        <text flexGrow={1} minWidth={0} fg={colors.muted}>TITLE</text>
        <text width={props.kind === "issue" ? 24 : 18} flexShrink={0} fg={colors.muted}> AUTHOR</text>
        <Show when={props.kind === "pull"}>
          <text width={10} fg={colors.muted}> OPENED</text>
        </Show>
      </box>

      <scrollbox
        ref={(value) => (list = value)}
        flexGrow={1}
        minHeight={0}
        backgroundColor={colors.canvas}
        scrollY
      >
        <Show
          when={props.items.length > 0}
          fallback={<box height={3} alignItems="center" paddingLeft={2}><text fg={colors.muted}>Nothing {props.state ?? "open"}</text></box>}
        >
          <For each={props.items}>
            {(entry, index) => {
              const active = () => props.selected === index()
              return (
                <box
                  id={`work-item-${index()}`}
                  height={3}
                  flexShrink={0}
                  flexDirection="row"
                  alignItems="center"
                  paddingRight={1}
                  backgroundColor={active() ? colors.panelHover : colors.canvas}
                >
                  <text width={2} fg={colors.blue}>{active() ? "▌" : " "}</text>
                  <text width={4} fg={props.state === "closed" ? colors.purple : colors.green}>
                    {props.kind === "issue" ? (props.state === "closed" ? "✓" : "●") : "⑂"}
                  </text>
                  <text
                    width={10}
                    fg={active() ? colors.blue : colors.muted}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    #{entry.number}
                  </text>
                  <box height={1} width={titleWidth()} flexShrink={0} overflow="hidden">
                    <text width="100%" height={1} wrapMode="none" fg={colors.text}>
                      {ellipsis(entry.title, titleWidth())}
                    </text>
                  </box>
                  <box flexGrow={1} />
                  <text height={1} width={props.kind === "issue" ? 24 : 18} flexShrink={0} wrapMode="none" truncate fg={colors.muted}> {entry.author}</text>
                  <Show when={props.kind === "pull"}>
                    <text height={1} width={10} wrapMode="none" fg={colors.muted}> {ago(entry.createdAt)}</text>
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
      </scrollbox>
    </box>
  )
}
