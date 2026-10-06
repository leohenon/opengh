import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { IssueSummary, ListState, Paginated, PullRequestSummary } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ResourceStateView } from "../components/resource-state"
import { SelectableList } from "../components/selectable-list"
import { ago, fitText } from "../format"
import { colors } from "../theme"

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
  const dimensions = useTerminalDimensions()
  const authorWidth = () => props.kind === "issue" ? 26 : 20
  const titleAuthorGap = 4
  const titleWidth = () => Math.max(8, dimensions().width - (props.kind === "issue" ? 61 : 55) - titleAuthorGap - (props.showScrollbar ? 1 : 0))

  return (
    <PageShell
      header={(
        <box flexDirection="row" alignItems="center" gap={2}>
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
      )}
    >
      <ResourceStateView resource={props.resource} loading={`Loading ${props.title.toLowerCase()}…`}>
        {(page) => (
          <SelectableList
            items={page().items}
            itemKey={(item) => item.number}
            active={props.active && props.interactive}
            showScrollbar={props.showScrollbar}
            resetKey={props.state}
            empty={`Nothing ${props.state}`}
            onEndReached={props.onEndReached}
            header={(
              <>
                <text width={2}> </text>
                <box width={4} flexShrink={0} paddingRight={1} />
                <box width={12} flexShrink={0} paddingRight={1} overflow="hidden">
                  <text fg={colors.muted}>{props.kind === "issue" ? "ISSUE" : "PULL"}</text>
                </box>
                <box width={titleWidth()} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text fg={colors.muted}>TITLE</text>
                </box>
                <box width={titleAuthorGap} flexShrink={0} />
                <box width={authorWidth()} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text fg={colors.muted}>AUTHOR</text>
                </box>
                <box width={12} flexShrink={0} paddingLeft={1} overflow="hidden">
                  <text fg={colors.muted}>OPENED</text>
                </box>
              </>
            )}
          >
            {(entry, active) => (
              <>
                <box height={1} width={4} flexShrink={0} paddingRight={1} overflow="hidden">
                  <text fg={props.state === "closed" ? colors.purple : colors.green}>
                    {props.kind === "issue" ? (props.state === "closed" ? "✓" : "●") : "⑂"}
                  </text>
                </box>
                <box height={1} width={12} flexShrink={0} paddingRight={1} overflow="hidden">
                  <text
                    width="100%"
                    height={1}
                    wrapMode="none"
                    fg={active() ? colors.blue : colors.muted}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    #{entry().number}
                  </text>
                </box>
                <box height={1} width={titleWidth()} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text width="100%" height={1} wrapMode="none" fg={colors.text}>
                    {fitText(entry().title, titleWidth() - 2)}
                  </text>
                </box>
                <box height={1} width={titleAuthorGap} flexShrink={0} />
                <box height={1} width={authorWidth()} flexShrink={0} paddingLeft={1} paddingRight={1} overflow="hidden">
                  <text width="100%" height={1} wrapMode="none" fg={colors.muted}>
                    {fitText(entry().author, authorWidth() - 2)}
                  </text>
                </box>
                <box height={1} width={12} flexShrink={0} paddingLeft={1} overflow="hidden">
                  <text width="100%" height={1} wrapMode="none" fg={colors.muted}>{ago(entry().createdAt)}</text>
                </box>
              </>
            )}
          </SelectableList>
        )}
      </ResourceStateView>
    </PageShell>
  )
}
