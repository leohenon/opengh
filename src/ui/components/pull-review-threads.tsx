import type { SyntaxStyle } from "@opentui/core"
import { For, Show } from "solid-js"
import type { PullReviewThread, ReviewThreadComment } from "../../models"
import { relativeTime } from "../format"
import type { GitHubMarkdownContext } from "../github-markdown"
import { useIcons } from "../icon-style"
import { useTheme } from "../theme"
import { GitHubMarkdown } from "./github-markdown"
import { type ReactionControls, Reactions, messageReactionMouse } from "./reactions"
import { TimelineEntry, TimelineHeader } from "./timeline-entry"

function ThreadComment(props: {
  comment: ReviewThreadComment
  reply: boolean
  number?: number
  reactionControls?: ReactionControls
  interactive?: boolean
  syntaxStyle: SyntaxStyle
  backgroundColor: string
  context: GitHubMarkdownContext
}) {
  const { colors } = useTheme()
  const reactionMouse = messageReactionMouse(() => props.number ? { kind: "review-comment", number: props.number, id: props.comment.id,
    nodeId: props.comment.id } : undefined, () => props.comment, () => props.comment.body,
    () => props.reactionControls, () => props.interactive === true)
  const association = () => props.comment.authorAssociation && props.comment.authorAssociation !== "NONE"
    ? props.comment.authorAssociation.toLowerCase().replaceAll("_", " ") : ""
  return (
    <box id={`message-review-${props.number}-${props.comment.id}`} {...reactionMouse} width="100%" minWidth={0} flexShrink={0} paddingLeft={props.reply ? 2 : 0} marginTop={1} flexDirection="column">
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
      <Reactions counts={props.comment.reactions} viewerReactions={props.comment.viewerReactions} canReact={props.comment.canReact}
        target={props.number ? { kind: "review-comment", number: props.number, id: props.comment.id, nodeId: props.comment.id } : undefined}
        controls={props.reactionControls} interactive={props.interactive} />
    </box>
  )
}

export function ReviewThread(props: {
  thread: PullReviewThread
  number?: number
  reactionControls?: ReactionControls
  interactive?: boolean
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
        <For each={props.thread.comments.map((comment) => comment.id)} fallback={<text fg={colors.muted}>No comments available.</text>}>
          {(id, index) => {
            const comment = () => props.thread.comments.find((comment) => comment.id === id)!
            return (
              <ThreadComment number={props.number} reactionControls={props.reactionControls} interactive={props.interactive} comment={comment()} reply={!!comment().replyToId || index() > 0} syntaxStyle={props.syntaxStyle} backgroundColor={props.backgroundColor} context={props.context} />
            )
          }}
        </For>
      </box>
    </TimelineEntry>
  )
}
