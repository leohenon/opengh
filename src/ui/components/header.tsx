import { TextAttributes } from "@opentui/core"
import { For, Show } from "solid-js"
import type { Repo } from "../../models"
import type { Page } from "../../navigation"
import { useTheme } from "../theme"

function RepositoryName(props: { repo: Repo }) {
  const { colors } = useTheme()
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={colors.muted}>{props.repo.nameWithOwner.split("/")[0]}/</text>
      <text fg={colors.blue} attributes={TextAttributes.BOLD}>
        {props.repo.nameWithOwner.split("/").slice(1).join("/")}
      </text>
    </box>
  )
}

export function Header(props: {
  repo: Repo
  page: Page
  compact?: boolean
  tabs: ReadonlyArray<{ page: Page; label: string }>
}) {
  const { colors } = useTheme()

  return (
    <box flexDirection="column" flexShrink={0} backgroundColor={colors.header}>
      <Show when={!props.compact}>
        <box height={3} flexDirection="row" alignItems="center" paddingLeft={2} paddingRight={2}>
          <RepositoryName repo={props.repo} />
        </box>
      </Show>
      <box height={props.compact ? 1 : 2} minWidth={0} flexDirection="row" paddingLeft={2} paddingRight={2} gap={2}>
        <box minWidth={0} overflow="hidden" flexGrow={1} flexDirection="row" gap={3}>
          <For each={props.tabs}>
            {(tab, index) => {
              const active = () => props.page === tab.page
              const label = () => `${index() + 1} ${tab.label}`
              return (
                <box height={props.compact ? 1 : 2} flexDirection="column">
                  <text
                    height={1}
                    wrapMode="none"
                    fg={active() ? props.compact ? colors.salmon : colors.text : colors.muted}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {label()}
                  </text>
                  <Show when={!props.compact}>
                    <text fg={colors.salmon}>{active() ? "─".repeat(label().length) : " ".repeat(label().length)}</text>
                  </Show>
                </box>
              )
            }}
          </For>
        </box>
        <Show when={props.compact}>
          <RepositoryName repo={props.repo} />
        </Show>
      </box>
    </box>
  )
}
