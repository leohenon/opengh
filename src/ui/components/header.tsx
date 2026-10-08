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
    <box flexDirection="column" flexShrink={0} backgroundColor={colors.header}>
      <box
        height={3}
        flexDirection="row"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
        gap={1}
      >
        <box flexDirection="row">
          <text fg={colors.muted}>
            {props.repo.nameWithOwner.split("/")[0]}/
          </text>
          <text fg={colors.blue} attributes={TextAttributes.BOLD}>
            {props.repo.nameWithOwner.split("/").slice(1).join("/")}
          </text>
        </box>
        <box flexGrow={1} />
      </box>
      <box height={2} flexDirection="row" paddingLeft={2} gap={3}>
        <For each={props.tabs}>
          {(tab, index) => {
            const active = () => props.page === tab.page
            const label = () => `${index() + 1} ${tab.label}`
            return (
              <box height={2} flexDirection="column">
                <text
                  fg={active() ? colors.text : colors.muted}
                  attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                >
                  {label()}
                </text>
                <text fg={colors.salmon}>{active() ? "─".repeat(label().length) : " ".repeat(label().length)}</text>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}
