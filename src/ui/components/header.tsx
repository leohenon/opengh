import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import type { Repo } from "../../models"
import type { Page } from "../../navigation"
import { colors } from "../theme"

export function Header(props: {
  repo: Repo
  page: Page
  tabs: ReadonlyArray<{ page: Page; label: string }>
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
          {props.repo.nameWithOwner}
        </text>
        <box flexGrow={1} />
      </box>
      <box height={2} flexDirection="row" paddingLeft={2} gap={3}>
        <For each={props.tabs}>
          {(tab, index) => (
            <text
              fg={props.page === tab.page ? colors.text : colors.muted}
              attributes={props.page === tab.page
                ? TextAttributes.BOLD | TextAttributes.UNDERLINE
                : TextAttributes.NONE}
            >
              {index() + 1} {tab.label}
            </text>
          )}
        </For>
      </box>
    </box>
  )
}
