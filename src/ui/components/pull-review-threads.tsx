import type { SyntaxStyle } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import type { PullReviewThread, ReviewThreadComment } from "../../models"
import { relativeTime } from "../format"
import type { GitHubMarkdownContext } from "../github-markdown"
import { useIcons } from "../icon-style"
import { useTheme } from "../theme"
import { GitHubMarkdown } from "./github-markdown"
import { type ReactionControls, Reactions, messageReactionMouse } from "./reactions"
import { TimelineEntry, TimelineHeader } from "./timeline-entry"
import { reviewSnippet } from "../review-snippet"

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
  collapsed?: boolean
  number?: number
  reactionControls?: ReactionControls
  interactive?: boolean
  syntaxStyle: SyntaxStyle
  backgroundColor: string
  context: GitHubMarkdownContext
}) {
  const { colors, theme } = useTheme()
  const icons = useIcons()
  const line = () => props.thread.line ?? props.thread.originalLine
  const snippet = createMemo(() => reviewSnippet(props.thread))
  const gutterWidth = () => Math.max(3, ...snippet().flatMap(line => [String(line.oldLine ?? "").length, String(line.newLine ?? "").length]))
  return (
    <TimelineEntry icon={icons().user} color={props.thread.isResolved ? colors.muted : colors.yellow}>
      <box width="100%" minWidth={0} flexShrink={0} overflow="hidden"
        backgroundColor={props.backgroundColor} flexDirection="column">
        <box height={1} flexShrink={0} paddingX={1} flexDirection="row" backgroundColor={colors.header}>
          <text flexGrow={1} flexBasis={0} minWidth={0} height={1} wrapMode="none" truncate fg={colors.text}>
            <Show when={props.collapsed}><span style={{ fg: colors.muted }}>Review thread · </span></Show>
            <b>{props.thread.path}</b>{props.collapsed && line() !== undefined ? `:${line()}` : ""}
            <Show when={props.collapsed}><span style={{ fg: colors.muted }}> · {props.thread.comments.length} {props.thread.comments.length === 1 ? "comment" : "comments"}</span></Show>
          </text>
          <Show when={props.thread.isResolved}><text flexShrink={0} fg={colors.muted}> Resolved</text></Show>
          <Show when={props.thread.isOutdated}><text flexShrink={0} fg={colors.muted}> Outdated</text></Show>
        </box>
        <Show when={!props.collapsed && snippet().length}>
          <box id={`review-code-${props.thread.id}`} width="100%" minWidth={0} flexShrink={0} flexDirection="column" overflow="hidden" backgroundColor={theme.diffContextBg ?? colors.canvas}>
            <For each={snippet()}>{line => {
              const background = () => line.prefix === "+" ? theme.diffAddedBg : line.prefix === "-" ? theme.diffRemovedBg : theme.diffContextBg
              const gutterBackground = () => line.prefix === "+" ? theme.diffAddedLineNumberBg : line.prefix === "-" ? theme.diffRemovedLineNumberBg : theme.diffContextBg
              return <box width="100%" minHeight={1} flexShrink={0} flexDirection="row" minWidth={0} overflow="hidden"
                backgroundColor={background() ?? colors.canvas}>
                <box width={gutterWidth() + 1} flexShrink={0} alignSelf="stretch" backgroundColor={gutterBackground() ?? background()}>
                  <text height={1} fg={colors.muted}>{String(line.oldLine ?? "").padStart(gutterWidth())} </text>
                </box>
                <box width={gutterWidth() + 1} flexShrink={0} alignSelf="stretch" backgroundColor={gutterBackground() ?? background()}>
                  <text height={1} fg={colors.muted}>{String(line.newLine ?? "").padStart(gutterWidth())} </text>
                </box>
                <box width={2} flexShrink={0} alignSelf="stretch"><text height={1} fg={colors.text}>{line.prefix} </text></box>
                <text flexGrow={1} flexShrink={1} flexBasis={0} minWidth={0} paddingRight={1} wrapMode="word" fg={colors.text}>{line.text}</text>
              </box>
            }}</For>
          </box>
        </Show>
        <Show when={!props.collapsed}>
          <box width="100%" minWidth={0} flexShrink={0} paddingX={2} paddingBottom={1} flexDirection="column">
            <For each={props.thread.comments.map((comment) => comment.id)} fallback={<text fg={colors.muted}>No comments available.</text>}>
              {(id, index) => {
                const comment = () => props.thread.comments.find((comment) => comment.id === id)!
                return (
                  <ThreadComment number={props.number} reactionControls={props.reactionControls} interactive={props.interactive} comment={comment()} reply={!!comment().replyToId || index() > 0} syntaxStyle={props.syntaxStyle} backgroundColor={props.backgroundColor} context={props.context} />
                )
              }}
            </For>
          </box>
        </Show>
      </box>
    </TimelineEntry>
  )
}
