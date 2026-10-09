import { TextAttributes } from "@opentui/core"
import type { IssueSummary, ListState, Paginated, PullRequestSummary } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ResourceStateView } from "../components/resource-state"
import { SelectableList } from "../components/selectable-list"
import { ago } from "../format"
import { useTheme } from "../theme"

export function WorkScreen(props: {
  title: string
  kind: "issue" | "pull"
  state: ListState
  counts: { open: number; closed: number }
  resource: ResourceState<Paginated<IssueSummary | PullRequestSummary>>
  active: boolean
  interactive: boolean
  showScrollbar: boolean
  onEndReached?: () => void
}) {
  const { colors } = useTheme()

  return (
    <PageShell
      header={(
        <box flexDirection="row" alignItems="center" gap={2}>
          <text
            fg={props.state === "open" ? colors.openState : colors.muted}
            attributes={props.state === "open" ? TextAttributes.BOLD : TextAttributes.NONE}
          >
            Open ({props.counts.open})
          </text>
          <text
            fg={props.state === "closed" ? colors.closedState : colors.muted}
            attributes={props.state === "closed" ? TextAttributes.BOLD : TextAttributes.NONE}
          >
            Closed ({props.counts.closed})
          </text>
        </box>
      )}
    >
      <ResourceStateView resource={props.resource}>
        {(page) => (
          <SelectableList
            items={page().items}
            itemKey={(item) => item.number}
            active={props.active && props.interactive}
            showScrollbar={props.showScrollbar}
            resetKey={props.state}
            empty={`No ${props.state} ${props.kind === "issue" ? "issues" : "pull requests"}`}
            onEndReached={props.onEndReached}
          >
            {(entry, active) => (
              <>
                <box height={2} width={3} flexShrink={0} alignItems="flex-start">
                  <text fg={props.state === "closed" ? colors.closedState : colors.openState}>
                    {props.kind === "issue" ? (props.state === "closed" ? "✓" : "●") : "⑂"}
                  </text>
                </box>
                <box height={2} flexGrow={1} minWidth={0} flexDirection="column" overflow="hidden">
                  <text
                    width="100%"
                    height={1}
                    wrapMode="none"
                    fg={colors.text}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {entry().title}
                  </text>
                  <text width="100%" height={1} wrapMode="none" fg={colors.muted}>
                    #{entry().number} · {ago(entry().createdAt)} · {entry().author}
                  </text>
                </box>
              </>
            )}
          </SelectableList>
        )}
      </ResourceStateView>
    </PageShell>
  )
}
