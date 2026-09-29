import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, For } from "solid-js"
import type { GitHubData } from "../../models"
import { ago } from "../format"
import { colors } from "../theme"

export function CommitsScreen(props: {
  data: GitHubData
  selected: number
}) {
  let list: ScrollBoxRenderable | undefined

  createEffect(() => {
    list?.scrollChildIntoView(`commit-${props.selected}`)
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
        <box flexDirection="column" flexGrow={1} minWidth={0}>
          <box height={1} flexDirection="row" gap={1}>
            <text fg={colors.text} attributes={TextAttributes.BOLD}>Commits ({props.data.commits.length})</text>
            <text fg={colors.blue}>
               {props.data.currentBranch} ({props.data.branches.length} {props.data.branches.length === 1 ? "branch" : "branches"})
            </text>
          </box>
        </box>
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
        <text width={10} flexShrink={0} fg={colors.muted}>COMMIT</text>
        <text flexGrow={1} flexShrink={1} minWidth={0} fg={colors.muted}>MESSAGE</text>
        <text width={20} flexShrink={0} fg={colors.muted}>AUTHOR</text>
        <text width={10} flexShrink={0} fg={colors.muted}>UPDATED</text>
      </box>

      <scrollbox
        ref={(value) => (list = value)}
        flexGrow={1}
        minHeight={0}
        backgroundColor={colors.canvas}
        scrollY
      >
        <For each={props.data.commits}>
          {(commit, index) => {
            const active = () => props.selected === index()
            return (
              <box
                id={`commit-${index()}`}
                height={3}
                flexShrink={0}
                flexDirection="row"
                alignItems="center"
                paddingRight={1}
                backgroundColor={active() ? colors.panelHover : colors.canvas}
              >
                <text width={2} fg={colors.blue}>{active() ? "▌" : " "}</text>
                <text
                  width={10}
                  flexShrink={0}
                  fg={active() ? colors.blue : colors.muted}
                  attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                >
                  {commit.sha}
                </text>
                <box height={1} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                  <text width="100%" height={1} wrapMode="none" truncate fg={colors.text}>
                    {commit.message}
                  </text>
                </box>
                <text height={1} width={20} flexShrink={0} wrapMode="none" truncate fg={colors.muted}>
                  {commit.author}
                </text>
                <text height={1} width={10} flexShrink={0} wrapMode="none" fg={colors.muted}>
                  {ago(commit.date)}
                </text>
              </box>
            )
          }}
        </For>
      </scrollbox>

    </box>
  )
}
