import { TextAttributes, type SyntaxStyle } from "@opentui/core"
import { createMemo, For, Match, Show, Switch, type JSX } from "solid-js"
import type { CommitSummary, IssueCloser, IssueComment, IssueReference, IssueStateEvent, IssueTimelineEvent, Paginated, PullForcePushEvent, PullReviewEvent, PullReviewDismissedEvent, PullDraftEvent, PullReviewRequestEvent, PullReviewThread } from "../../models"
import type { ResourceState } from "../../repository-state"
import type { GitHubMarkdownContext } from "../github-markdown"
import { relativeTime } from "../format"
import { buildActivity } from "../activity"
import { useIcons } from "../icon-style"
import { referenceColor, referenceIcon, referenceState } from "../issue-references"
import { useTheme } from "../theme"
import { GitHubMarkdown } from "./github-markdown"
import { Reactions } from "./reactions"
import { ReviewThread } from "./pull-review-threads"
import { reviewColor } from "../pull-reviews"
import { TimelineEntry, TimelineHeader, TimelineItem } from "./timeline-entry"
import { TimelineCommits } from "./pull-commits"
import { LoadingText } from "./loading-text"

function Comment(props: { comment: IssueComment; syntaxStyle: SyntaxStyle; backgroundColor: string; context: GitHubMarkdownContext }) {
  const { colors } = useTheme()
  const icons = useIcons()
  const association = () => props.comment.authorAssociation === "NONE"
    ? "" : props.comment.authorAssociation.toLowerCase().replaceAll("_", " ")
  return (
    <TimelineEntry icon={icons().user} nodeOffset={2}>
      <box width="100%" minWidth={0} flexShrink={0} backgroundColor={props.backgroundColor} paddingX={2} paddingY={1} flexDirection="column">
        <TimelineHeader>
          <b><span style={{ fg: colors.text }}>{props.comment.author}</span></b> · {relativeTime(props.comment.createdAt)}
          {association() ? ` · ${association()}` : ""}
          {props.comment.updatedAt !== props.comment.createdAt ? " · edited" : ""}
        </TimelineHeader>
        <box width="100%" minWidth={0} flexShrink={0} marginTop={1}>
          <Show when={props.comment.body.trim()} fallback={<text fg={colors.muted}>No comment text.</text>}>
            <GitHubMarkdown content={props.comment.body} syntaxStyle={props.syntaxStyle} backgroundColor={props.backgroundColor} context={props.context} preserveImages codePanels />
          </Show>
        </box>
        <Reactions counts={props.comment.reactions} />
      </box>
    </TimelineEntry>
  )
}

function ReferenceMention(props: { reference: IssueReference; repository: string }) {
  const { colors } = useTheme()
  const icons = useIcons()
  const identifier = () => {
    const reference = props.reference
    const id = reference.kind === "commit" ? reference.sha.slice(0, 7) : `#${reference.number}`
    return reference.repository === props.repository ? id : `${reference.repository}${reference.kind === "commit" ? "@" : ""}${id}`
  }
  const kind = () => props.reference.kind === "pull" ? "PR" : props.reference.kind
  return (
    <TimelineEntry icon={referenceIcon(props.reference, icons())} color={referenceColor(colors, props.reference)}>
      <box width="100%" minWidth={0} flexShrink={0} paddingX={2} flexDirection="column">
        <TimelineHeader>
          <b><span style={{ fg: colors.text }}>{props.reference.actor}</span></b> referenced this in {kind()} {identifier()}
          <Show when={props.reference.kind !== "commit"}>
            {" · "}<span style={{ fg: referenceColor(colors, props.reference) }}>{referenceState(props.reference)}</span>
          </Show>
        </TimelineHeader>
        <box width="100%" minWidth={0} flexShrink={0} paddingLeft={2}>
          <text width="100%" flexShrink={0} fg={colors.blue}>
            <a href={props.reference.url}>{props.reference.title}</a>
          </text>
        </box>
      </box>
    </TimelineEntry>
  )
}

function StateChange(props: { event: IssueStateEvent; subject: "issue" | "pull"; repository: string }) {
  const { colors } = useTheme()
  const icons = useIcons()
  const color = () => props.event.event === "merged" ? colors.purple
    : props.event.event === "reopened" ? colors.openState
    : props.subject === "pull" ? colors.red : colors.closedState
  const icon = () => props.event.event === "merged" ? icons().pullRequest.merged
    : props.event.event === "reopened" ? (props.subject === "pull" ? icons().pullRequest.open : icons().issue.open)
    : props.subject === "pull" ? icons().pullRequest.closed : icons().issue.closed
  const closer = () => props.event.event === "closed" ? props.event.closer : undefined
  const identifier = (source: IssueCloser) => {
    const local = source.repository === props.repository
    return source.kind === "pull" ? `${local ? "" : source.repository}#${source.number}`
      : `${local ? "" : `${source.repository}@`}${source.sha.slice(0, 7)}`
  }
  const action = () => props.event.event === "merged" ? "merged this pull request"
    : closer() ? props.subject === "issue" ? "closed this as completed in" : "closed this pull request in"
    : `${props.event.event} this ${props.subject === "pull" ? "pull request" : "issue"}`
  return (
    <TimelineEntry icon={icon()} color={color()}>
      <box width="100%" minWidth={0} flexShrink={0} paddingX={2}>
        <TimelineHeader>
          <b><span style={{ fg: colors.text }}>{props.event.actor}</span></b>{" "}
          <span style={{ fg: color() }}>{action()}</span>
          <Show when={closer()} keyed>
            {(source) => <>{" "}<span style={{ fg: colors.blue }}><a href={source.url}>{identifier(source)}</a></span></>}
          </Show>
          {" · "}{relativeTime(props.event.createdAt)}
        </TimelineHeader>
        <Show when={closer()} keyed>
          {(source) => <text width="100%" flexShrink={0} fg={colors.muted}>{source.title}</text>}
        </Show>
      </box>
    </TimelineEntry>
  )
}

function ForcePush(props: { event: PullForcePushEvent }) {
  const { colors } = useTheme()
  const icons = useIcons()
  return (
    <TimelineEntry icon={icons().branch} color={colors.blue}>
      <box width="100%" minWidth={0} flexShrink={0} paddingX={2} flexDirection="column">
        <TimelineHeader>
          <b><span style={{ fg: colors.text }}>{props.event.actor}</span></b> force-pushed this branch
          {" · "}{relativeTime(props.event.createdAt)}
        </TimelineHeader>
        <Show when={props.event.beforeCommit || props.event.afterCommit}>
          <text width="100%" flexShrink={0} fg={colors.muted}>
            <Show when={props.event.beforeCommit} keyed>
              {(commit) => <>from <span style={{ fg: colors.blue }}><a href={commit.url}>{commit.sha.slice(0, 7)}</a></span></>}
            </Show>
            <Show when={props.event.afterCommit} keyed>
              {(commit) => <>{props.event.beforeCommit ? " to " : "to "}<span style={{ fg: colors.blue }}><a href={commit.url}>{commit.sha.slice(0, 7)}</a></span></>}
            </Show>
          </text>
        </Show>
      </box>
    </TimelineEntry>
  )
}

function Review(props: { review: PullReviewEvent; syntaxStyle: SyntaxStyle; backgroundColor: string; context: GitHubMarkdownContext }) {
  const { colors } = useTheme()
  const icons = useIcons()
  const action = () => {
    const state = props.review.state === "dismissed" ? props.review.originalState : props.review.state
    const text = state === "approved" ? "approved these changes" : state === "changes_requested" ? "requested changes" : "reviewed"
    return props.review.state === "dismissed" ? `${text} · dismissed` : text
  }
  const icon = () => props.review.state === "approved" ? icons().workflow.success
    : props.review.state === "changes_requested" ? icons().workflow.attention
    : props.review.state === "dismissed" ? icons().workflow.neutral : icons().user
  return (
    <TimelineEntry icon={icon()} color={reviewColor(colors, props.review.state)} nodeOffset={2}>
      <box width="100%" minWidth={0} flexShrink={0} backgroundColor={props.backgroundColor} paddingX={2} paddingY={1} flexDirection="column">
        <TimelineHeader>
          <b><span style={{ fg: colors.text }}><a href={props.review.url}>{props.review.actor}</a></span></b>{" "}
          <span style={{ fg: reviewColor(colors, props.review.state) }}>{action()}</span>{" · "}{relativeTime(props.review.createdAt)}
        </TimelineHeader>
        <Show when={props.review.body.trim()}>
          <box width="100%" minWidth={0} flexShrink={0} marginTop={1}>
            <GitHubMarkdown content={props.review.body} syntaxStyle={props.syntaxStyle} backgroundColor={props.backgroundColor} context={props.context} preserveImages codePanels />
          </box>
        </Show>
      </box>
    </TimelineEntry>
  )
}

function ReviewDismissal(props: { event: PullReviewDismissedEvent }) {
  const { colors } = useTheme()
  const icons = useIcons()
  const target = () => props.event.reviewer === props.event.actor ? "their review"
    : props.event.reviewer ? `${props.event.reviewer}'s review` : "a review"
  return (
    <TimelineEntry icon={icons().workflow.neutral}>
      <box width="100%" minWidth={0} flexShrink={0} paddingX={2}>
        <TimelineHeader><b><span style={{ fg: colors.text }}>{props.event.actor}</span></b> dismissed {target()}{" · "}{relativeTime(props.event.createdAt)}</TimelineHeader>
        <Show when={props.event.body.trim()}><text width="100%" flexShrink={0} fg={colors.muted}>{props.event.body}</text></Show>
      </box>
    </TimelineEntry>
  )
}

function DraftTransition(props: { event: PullDraftEvent }) {
  const { colors } = useTheme()
  const icons = useIcons()
  const ready = () => props.event.event === "ready_for_review"
  return (
    <TimelineEntry icon={ready() ? icons().pullRequest.open : icons().pullRequest.draft} color={ready() ? colors.openState : colors.muted}>
      <box width="100%" minWidth={0} flexShrink={0} paddingX={2}>
        <TimelineHeader>
          <b><span style={{ fg: colors.text }}>{props.event.actor}</span></b> marked this pull request {ready() ? "ready for review" : "as draft"}
          {" · "}{relativeTime(props.event.createdAt)}
        </TimelineHeader>
      </box>
    </TimelineEntry>
  )
}

function ReviewRequest(props: { event: PullReviewRequestEvent }) {
  const { colors } = useTheme()
  const icons = useIcons()
  const name = () => props.event.target.kind === "user" ? props.event.target.login : `team ${props.event.target.name}`
  const action = () => props.event.event === "review_request_removed" ? "removed the review request for"
    : props.event.reRequested ? "requested another review from" : "requested a review from"
  return (
    <TimelineEntry icon={icons().user} color={colors.blue}>
      <box width="100%" minWidth={0} flexShrink={0} paddingX={2}>
        <TimelineHeader>
          <b><span style={{ fg: colors.text }}>{props.event.actor}</span></b> {action()}{" "}<span style={{ fg: colors.text }}>{name()}</span>
          {" · "}{relativeTime(props.event.createdAt)}
        </TimelineHeader>
      </box>
    </TimelineEntry>
  )
}

export function DetailActivity(props: {
  commentCount: number
  commits?: ResourceState<CommitSummary[]>
  commitTotal?: number
  pullUrl?: string
  comments: ResourceState<Paginated<IssueComment>>
  references: ResourceState<IssueReference[]>
  events?: readonly IssueTimelineEvent[]
  threads?: readonly PullReviewThread[]
  threadsLoading?: boolean
  threadsUnavailable?: boolean
  subject?: "issue" | "pull"
  repository: string
  syntaxStyle: SyntaxStyle
  backgroundColor: string
  context: GitHubMarkdownContext
  children?: JSX.Element
  hasFollowingItem?: boolean
}) {
  const { colors } = useTheme()
  const comments = () => props.comments
  const references = () => props.references
  const reviewCount = () => props.events?.filter((event) => event.kind === "review").length ?? 0
  const activity = createMemo(() => buildActivity({
    comments: comments().value?.items ?? [], references: references().value ?? [],
    events: props.events ?? [], threads: props.threads ?? [], commits: props.commits?.value, pullUrl: props.pullUrl,
  }))
  const loadedCommits = () => new Set([
    ...(props.commits?.value?.map((commit) => commit.sha.toLowerCase()) ?? []),
    ...(props.events?.filter((event) => event.kind === "commit-added").map((commit) => commit.sha.toLowerCase()) ?? []),
  ]).size
  const failure = (resource: ResourceState<unknown>) => resource.status === "error" ? resource.message : ""
  return (
    <box width="100%" minWidth={0} flexShrink={0} flexDirection="column">
      <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>
        <b><span style={{ fg: colors.text }}>Activity</span></b>
        {props.commitTotal === undefined ? "" : ` · ${props.commitTotal} ${props.commitTotal === 1 ? "commit" : "commits"}`}
        {" · "}{props.commentCount} {props.commentCount === 1 ? "comment" : "comments"}
        {comments().value && (comments().value!.hasMore || comments().value!.items.length !== props.commentCount)
          ? ` · ${comments().value!.items.length} loaded` : ""}
        {references().value?.length ? ` · ${references().value!.length} ${references().value!.length === 1 ? "reference" : "references"}` : ""}
        {reviewCount() ? ` · ${reviewCount()} ${reviewCount() === 1 ? "review" : "reviews"}` : ""}
        {props.threads?.length ? ` · ${props.threads.length} ${props.threads.length === 1 ? "thread" : "threads"}` : ""}
      </text>
      <Show when={props.commits?.status === "loading" && !props.commits.value}>
        <box width="100%" flexShrink={0} marginTop={1}><LoadingText text="Loading commits…" /></box>
      </Show>
      <For each={activity()}>
        {(entry, index) => (
          <TimelineItem last={index() === activity().length - 1 && !props.hasFollowingItem}>
            <Show when={index() === 0 || relativeTime(entry.createdAt) !== relativeTime(activity()[index() - 1]?.createdAt)}>
              <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted} attributes={TextAttributes.BOLD}>
                {relativeTime(entry.createdAt)}
              </text>
            </Show>
            <Switch>
              <Match when={"kind" in entry && entry.kind === "commit-group" ? entry : undefined}>
                {(group) => <TimelineCommits commits={group().commits} />}
              </Match>
              <Match when={"kind" in entry && entry.kind === "state" ? entry : undefined}>
                {(event) => <StateChange event={event()} subject={props.subject ?? "issue"} repository={props.repository} />}
              </Match>
              <Match when={"kind" in entry && entry.kind === "force-push" ? entry : undefined}>
                {(event) => <ForcePush event={event()} />}
              </Match>
              <Match when={"kind" in entry && entry.kind === "review" ? entry : undefined}>
                {(review) => <Review review={review()} syntaxStyle={props.syntaxStyle} backgroundColor={props.backgroundColor} context={props.context} />}
              </Match>
              <Match when={"kind" in entry && entry.kind === "review-dismissed" ? entry : undefined}>
                {(event) => <ReviewDismissal event={event()} />}
              </Match>
              <Match when={"kind" in entry && entry.kind === "draft" ? entry : undefined}>
                {(event) => <DraftTransition event={event()} />}
              </Match>
              <Match when={"kind" in entry && entry.kind === "review-request" ? entry : undefined}>
                {(event) => <ReviewRequest event={event()} />}
              </Match>
              <Match when={"kind" in entry && entry.kind === "review-thread" ? entry : undefined}>
                {(thread) => <ReviewThread thread={thread()} syntaxStyle={props.syntaxStyle} backgroundColor={props.backgroundColor} context={props.context} />}
              </Match>
              <Match when={"kind" in entry && (entry.kind === "pull" || entry.kind === "issue" || entry.kind === "commit") ? entry : undefined}>
                {(reference) => <ReferenceMention reference={reference()} repository={props.repository} />}
              </Match>
              <Match when={"author" in entry ? entry : undefined}>
                {(comment) => <Comment comment={comment()} syntaxStyle={props.syntaxStyle} backgroundColor={props.backgroundColor} context={props.context} />}
              </Match>
            </Switch>
          </TimelineItem>
        )}
      </For>
      <Show when={comments().status === "ready" && references().status === "ready" && (!props.commits || props.commits.status === "ready") && !props.threadsLoading && !props.threadsUnavailable && activity().length === 0}>
        <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>No comments or references yet.</text>
      </Show>
      <Show when={props.commits?.status === "error"}>
        <text width="100%" flexShrink={0} marginTop={1} fg={colors.red}>× {props.commits?.status === "error" ? props.commits.message : ""} · r to retry commits</text>
      </Show>
      <Show when={(props.commits?.value?.length ?? 0) >= 250 && (props.commitTotal ?? 0) > loadedCommits()}>
        <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>Commit history may be incomplete. GitHub's PR commits endpoint returns at most 250 commits.</text>
      </Show>
      <Show when={comments().status === "error"}>
        <text width="100%" flexShrink={0} fg={colors.red}>× {failure(comments())}</text>
      </Show>
      <Show when={references().status === "error"}>
        <text width="100%" flexShrink={0} fg={colors.red}>× {failure(references())}</text>
      </Show>
      <TimelineItem last>{props.children}</TimelineItem>
    </box>
  )
}
