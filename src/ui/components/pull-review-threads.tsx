import type { SyntaxStyle } from "@opentui/core"
import { For, Show } from "solid-js"
import type { PullReviewThread, ReviewThreadComment } from "../../models"
import { relativeTime } from "../format"
import type { GitHubMarkdownContext } from "../github-markdown"
import { useIcons } from "../icon-style"
import { useTheme } from "../theme"
import { GitHubMarkdown } from "./github-markdown"
import { Reactions } from "./reactions"
import { TimelineEntry, TimelineHeader } from "./timeline-entry"

function ThreadComment(props: {
  comment: ReviewThreadComment
  reply: boolean
  syntaxStyle: SyntaxStyle
  backgroundColor: string
  context: GitHubMarkdownContext
}) {
  const { colors } = useTheme()
  const association = () => props.comment.authorAssociation && props.comment.authorAssociation !== "NONE"
    ? props.comment.authorAssociation.toLowerCase().replaceAll("_", " ") : ""
  return (
    <box width="100%" minWidth={0} flexShrink={0} paddingLeft={props.reply ? 2 : 0} marginTop={1} flexDirection="column">
      <TimelineHeader>
        <b><span style={{ fg: colors.text }}>{props.comment.author || "ghost"}</span></b>
        {" · "}<a href={props.comment.url}>{relativeTime(props.comment.createdAt)}</a>
        {association() ? ` · ${association()}` : ""}
        {props.comment.updatedAt !== props.comment.createdAt ? " · edited" : ""}
        {props.reply ? " · reply" : ""}
      </TimelineHeader>
      <box width="100%" minWidth={0} flexShrink={0} marginTop={1}>
        <Show when={props.comment.body.trim()} fallback={<text fg={colors.muted}>No comment text.</text>}>
          <GitHubMarkdown content={props.comment.body} syntaxStyle={props.syntaxStyle} backgroundColor={props.backgroundColor} context={props.context} preserveImages codePanels />
        </Show>
      </box>
      <Reactions counts={props.comment.reactions} />
    </box>
  )
}

export function ReviewThread(props: {
  thread: PullReviewThread
  syntaxStyle: SyntaxStyle
  backgroundColor: string
  context: GitHubMarkdownContext
}) {
  const { colors } = useTheme()
  const icons = useIcons()
  const location = () => {
    const line = props.thread.line ?? props.thread.originalLine
    return `${props.thread.path}${line === undefined ? "" : `:${line}`}`
  }
  return (
    <TimelineEntry icon={icons().user} color={props.thread.isResolved ? colors.muted : colors.yellow}>
      <box width="100%" minWidth={0} flexShrink={0} backgroundColor={props.backgroundColor} paddingX={2} paddingY={1} flexDirection="column">
        <text width="100%" flexShrink={0} fg={colors.text}>
          <b>{location()}</b>{" · "}
          <span style={{ fg: props.thread.isResolved ? colors.muted : colors.yellow }}>
            {props.thread.isResolved ? "[Resolved]" : "[Unresolved]"}
          </span>
          <Show when={props.thread.isOutdated}><span style={{ fg: colors.muted }}>{" [Outdated]"}</span></Show>
          <Show when={props.thread.resolvedBy}><span style={{ fg: colors.muted }}>{` · resolved by ${props.thread.resolvedBy}`}</span></Show>
        </text>
        <For each={props.thread.comments} fallback={<text fg={colors.muted}>No comments available.</text>}>
          {(comment, index) => (
            <ThreadComment comment={comment} reply={!!comment.replyToId || index() > 0} syntaxStyle={props.syntaxStyle} backgroundColor={props.backgroundColor} context={props.context} />
          )}
        </For>
      </box>
    </TimelineEntry>
  )
}
