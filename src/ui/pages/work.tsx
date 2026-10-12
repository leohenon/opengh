import { TextAttributes } from "@opentui/core"
import type { IssueSummary, ListState, Paginated, PullRequestSummary } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ListLine } from "../components/list-line"
import { ResourceStateView } from "../components/resource-state"
import { SelectableList } from "../components/selectable-list"
import { ago, fitText } from "../format"
import { useTheme } from "../theme"

export function WorkScreen(props: {
  kind: "issue" | "pull"
  state: ListState
  counts: { open: number; closed: number }
  resource: ResourceState<Paginated<IssueSummary | PullRequestSummary>>
  active: boolean
  interactive: boolean
  showScrollbar: boolean
  onEndReached?: () => void
  onOpen?: (entry: IssueSummary | PullRequestSummary) => void
  onOpenInBrowser?: (entry: IssueSummary | PullRequestSummary) => void
  onCopy?: (entry: IssueSummary | PullRequestSummary) => void
}) {
  const { colors } = useTheme()
  const merged = (entry: IssueSummary | PullRequestSummary) => props.kind === "pull" && "merged" in entry && entry.merged
  const entryColor = (entry: IssueSummary | PullRequestSummary) => {
    if (merged(entry)) return colors.purple
    if (entry.state === "open") return colors.openState
    return props.kind === "pull" ? colors.red : colors.closedState
  }
  const entryIcon = (entry: IssueSummary | PullRequestSummary) => {
    if (props.kind === "issue") return entry.state === "closed" ? "✓" : "◉"
    if (merged(entry)) return "⑃"
    return entry.state === "closed" ? "×" : "⑂"
  }

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
            empty={`No ${props.state} ${props.kind === "issue" ? "issues" : "pull requests"}${page().hasMore ? " loaded yet" : ""}`}
            onEndReached={props.onEndReached}
            onActivate={props.onOpen}
            onOpenInBrowser={props.onOpenInBrowser}
            onCopy={props.onCopy}
          >
            {(entry, active) => (
              <>
                <box height={2} width={2} flexShrink={0} alignItems="flex-start">
                  <text fg={entryColor(entry())}>{entryIcon(entry())}</text>
                </box>
                <box height={2} flexGrow={1} flexBasis={0} minWidth={0} flexDirection="column" overflow="hidden">
                  <ListLine
                    fg={colors.text}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {(width) => fitText(entry().title, width)}
                  </ListLine>
                  <ListLine fg={colors.muted}>
                    {(width) => fitText(`#${entry().number} opened ${ago(entry().createdAt)} by ${entry().author}`, width)}
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
