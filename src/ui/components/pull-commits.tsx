import { For } from "solid-js"
import type { ActivityCommit } from "../activity"
import { relativeTime } from "../format"
import { useIcons } from "../icon-style"
import { useTheme } from "../theme"
import { TimelineEntry, TimelineHeader } from "./timeline-entry"

export function TimelineCommits(props: { commits: readonly ActivityCommit[] }) {
  const { colors } = useTheme()
  const icons = useIcons()
  return (
    <TimelineEntry icon={icons().commit}>
      <box width="100%" minWidth={0} flexShrink={0} paddingX={2} flexDirection="column">
        <TimelineHeader>{props.commits.length} {props.commits.length === 1 ? "commit" : "commits"}</TimelineHeader>
        <For each={props.commits}>
          {(commit) => (
            <box width="100%" minWidth={0} flexShrink={0} flexDirection="column">
              <text width="100%" flexShrink={0} fg={colors.text}>
                <span style={{ fg: colors.blue }}><a href={commit.url}>{commit.sha.slice(0, 7)}</a></span>{"  "}{commit.message}
              </text>
              <text width="100%" flexShrink={0} fg={colors.muted}>{commit.author} committed {relativeTime(commit.createdAt)}</text>
            </box>
          )}
        </For>
      </box>
    </TimelineEntry>
  )
}
