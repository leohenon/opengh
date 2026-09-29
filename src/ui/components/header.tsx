import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import type { GitHubData } from "../../models"
import { colors } from "../theme"

export function Header(props: {
  data: GitHubData
  tab: number
  tabs: readonly string[]
}) {
  return (
    <box flexDirection="column" flexShrink={0} backgroundColor={colors.panel}>
      <box
        height={3}
        flexDirection="row"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
        gap={1}
      >
        <text fg={colors.blue} attributes={TextAttributes.BOLD}>
          {props.data.repo.nameWithOwner}
        </text>
        <box flexGrow={1} />
      </box>
      <box height={2} flexDirection="row" paddingLeft={2} gap={3}>
        <For each={props.tabs}>
          {(tab, index) => (
            <text
              fg={props.tab === index() ? colors.text : colors.muted}
              attributes={
                props.tab === index()
                  ? TextAttributes.BOLD | TextAttributes.UNDERLINE
                  : TextAttributes.NONE
              }
            >
              {index() + 1} {tab}
            </text>
          )}
        </For>
      </box>
    </box>
  );
}

