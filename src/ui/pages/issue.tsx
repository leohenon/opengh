import { RGBA, rgbToHex, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useKeyActions } from "../keybindings"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { defaultConfig, type DetailLayout } from "../../config"
import type { IssueDetail, IssueReference, IssueSummary } from "../../models"
import type { IssueDetailState, ResourceState } from "../../repository-state"
import { Reactions, messageReactionMouse, type ReactionControls } from "../components/reactions"
import { DetailActivity } from "../components/detail-activity"
import { ActivityCommentComposer, focusActivityComment, type ActivityComment } from "../components/activity-comment-composer"
import { MetadataField, MetadataSummary } from "../components/detail-metadata"
import { GitHubMarkdown } from "../components/github-markdown"
import type { GitHubMarkdownContext } from "../github-markdown"
import { ResourceStateView } from "../components/resource-state"
import { ago, relativeTime } from "../format"
import { mouseClick } from "../mouse"
import { detailContentWidth } from "../detail-layout"
import { issueIcon, referenceColor, referenceIcon, referenceState, referencedPulls } from "../issue-references"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { useTheme } from "../theme"
import { useIcons } from "../icon-style"
import { iconPrefix } from "../icons"
import { createScrollbarVisibility } from "../scrollbar-visibility"

function IssueMetadata(props: { issue: IssueDetail; compact: boolean; inline?: boolean }) {
  const { colors } = useTheme()
  return (
    <box width="100%" minWidth={0} flexShrink={0} flexDirection="column">
      <Show when={!props.compact}>
        <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Details</text>
      </Show>
      <Show when={props.inline} fallback={<>
      <MetadataField label="Labels" compact={props.compact} muted={!props.issue.labels.length}>
        <For each={props.issue.labels} fallback="none">{(label, index) => <>{index() > 0 ? " · " : ""}<a href={`${props.issue.url.replace(/\/issues\/\d+$/, "")}/issues?q=${encodeURIComponent(`is:issue label:"${label}"`)}`}>{label}</a></>}</For>
      </MetadataField>
      <MetadataField label="Assignees" compact={props.compact} muted={!props.issue.assignees.length}>
        <For each={props.issue.assignees} fallback="none">{(login, index) => <>{index() > 0 ? ", " : ""}<a href={`https://github.com/${login}`}>{login}</a></>}</For>
      </MetadataField>
      </>}>
        <MetadataSummary labels={props.issue.labels} assignees={props.issue.assignees} repositoryUrl={props.issue.url.replace(/\/issues\/\d+$/, "")} kind="issue" />
      </Show>
      <Show when={props.issue.milestone}>
        <MetadataField label="Milestone" compact={props.compact}>
          <Show when={props.issue.milestone?.url} fallback={props.issue.milestone?.title}>{(url) => <a href={url()}>{props.issue.milestone?.title}</a>}</Show>
        </MetadataField>
      </Show>
    </box>
  )
}

function IssueDates(props: { issue: IssueDetail; compact: boolean }) {
  return (
    <box width="100%" minWidth={0} flexShrink={0} flexDirection="column">
      <Show when={props.issue.closedAt}>
        <MetadataField label="Closed" compact={props.compact} muted>{relativeTime(props.issue.closedAt!)}</MetadataField>
      </Show>
      <Show when={props.issue.milestone?.dueAt}>
        <MetadataField label="Due" compact={props.compact} muted>{relativeTime(props.issue.milestone!.dueAt!)}</MetadataField>
      </Show>
    </box>
  )
}

function ReferencedPulls(props: { resource: ResourceState<IssueReference[]>; repository: string; interactive: boolean; onOpenReference?: (reference: IssueReference) => void }) {
  const { colors, theme } = useTheme()
  const icons = useIcons()
  const pulls = createMemo(() => referencedPulls(props.resource.value ?? []))
  return (
    <Show when={pulls().length > 0}>
      <box width="100%" minWidth={0} flexShrink={0} marginTop={1} flexDirection="column">
        <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Referenced PRs</text>
        <For each={pulls().slice(0, 3)}>
          {(reference) => (
            <box width="100%" minWidth={0} flexShrink={0} marginTop={1}>
              <Show when={props.onOpenReference} fallback={(
                <text width="100%" flexShrink={0} fg={referenceColor(colors, reference)}>
                  <Show when={props.interactive} fallback={<>{iconPrefix(referenceIcon(reference, icons()))}#{reference.number} · {referenceState(reference)}</>}>
                    <a href={reference.url}>{iconPrefix(referenceIcon(reference, icons()))}<span style={{ fg: theme.markdownLink }}>#{reference.number}</span> · {referenceState(reference)}</a>
                  </Show>
                </text>
              )}>
                <text width="100%" flexShrink={0} fg={referenceColor(colors, reference)}
                  {...mouseClick(() => props.onOpenReference?.(reference), () => props.interactive && Boolean(props.onOpenReference), () => reference)}>
                  <Show when={props.interactive} fallback={<>{iconPrefix(referenceIcon(reference, icons()))}#{reference.number} · {referenceState(reference)}</>}>
                    <a href={reference.url}>{iconPrefix(referenceIcon(reference, icons()))}<span style={{ fg: theme.markdownLink }}>#{reference.number}</span> · {referenceState(reference)}</a>
                  </Show>
                </text>
              </Show>
              <Show when={reference.repository !== props.repository}>
                <text width="100%" flexShrink={0} fg={colors.muted}>
                  <Show when={props.interactive} fallback={reference.repository}><a href={reference.url.replace(/\/pull\/\d+.*$/, "")}>{reference.repository}</a></Show>
                </text>
              </Show>
              <Show when={props.onOpenReference} fallback={(
                <text width="100%" flexShrink={0} fg={theme.markdownLink}>
                  <Show when={props.interactive} fallback={reference.title}><a href={reference.url}>{reference.title}</a></Show>
                </text>
              )}>
                <text width="100%" flexShrink={0} fg={theme.markdownLink}
                  {...mouseClick(() => props.onOpenReference?.(reference), () => props.interactive && Boolean(props.onOpenReference), () => reference)}>
                  <Show when={props.interactive} fallback={reference.title}><a href={reference.url}>{reference.title}</a></Show>
                </text>
              </Show>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

export function IssueScreen(props: {
  number: number
  summary?: IssueSummary
  reactionControls?: ReactionControls
  onOpenReference?: (reference: IssueReference) => void
  detail: IssueDetailState
  revealActivity?: number
  timelineCollapsed?: boolean
  comment?: ActivityComment
  interactive: boolean
  showScrollbar: boolean
  defaultBranch?: string
  detailLayout?: DetailLayout
  inlineMetadata?: boolean
}) {
  const { colors, theme } = useTheme()
  const icons = useIcons()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const wide = () => !props.inlineMetadata && dimensions().width >= 112
  const centered = () => (props.detailLayout ?? defaultConfig.detailLayout) === "centered"
  const contentWidth = () => detailContentWidth(props.detailLayout, wide() ? 32 : 0)
  const surface = createMemo(() => {
    const panel = RGBA.fromHex(colors.header)
    const canvas = RGBA.fromHex(colors.canvas)
    return rgbToHex(RGBA.fromValues(
      panel.r * 0.4 + canvas.r * 0.6,
      panel.g * 0.4 + canvas.g * 0.6,
      panel.b * 0.4 + canvas.b * 0.6,
      panel.a * 0.4 + canvas.a * 0.6,
    ))
  })
  const markdownStyle = createReactiveMarkdownStyle(colors, theme)
  const issue = () => props.detail.resource.value
  // The list row seeds the header so it fills in rather than swapping a placeholder title.
  const header = () => issue() ?? props.summary
  const reactionMouse = messageReactionMouse(() => issue() ? ({ kind: "issue", number: props.number, nodeId: issue()?.nodeId }) : undefined,
    issue, () => issue()?.body ?? "", () => props.reactionControls, () => props.interactive)
  const repository = () => issue()?.url.split("/").slice(3, 5).join("/") ?? ""
  const markdownContext = (): GitHubMarkdownContext => ({
    repositoryUrl: issue()?.url.replace(/\/issues\/\d+$/, "") ?? "",
    ref: props.defaultBranch,
    sourceUrl: issue()?.url,
  })
  let scroll: ScrollBoxRenderable | undefined
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  const revealActivity = () => scroll?.scrollTo(scroll.scrollHeight)
  createEffect(() => {
    if (props.revealActivity === undefined) return
    // Wait for layout before scrolling to the newly posted activity.
    renderer.once("frame", revealActivity)
    renderer.requestRender()
    onCleanup(() => renderer.off("frame", revealActivity))
  })

  useKeyActions({
    "navigation.up": () => scroll!.scrollBy(-1),
    "navigation.down": () => scroll!.scrollBy(1),
    "navigation.halfPageUp": () => scroll!.scrollBy(-Math.max(1, Math.floor(scroll!.viewport.height / 2))),
    "navigation.halfPageDown": () => scroll!.scrollBy(Math.max(1, Math.floor(scroll!.viewport.height / 2))),
    "navigation.pageUp": () => scroll!.scrollBy(-scroll!.viewport.height),
    "navigation.pageDown": () => scroll!.scrollBy(scroll!.viewport.height),
    "navigation.last": () => scroll!.scrollTo(Math.max(0, scroll!.scrollHeight - scroll!.viewport.height)),
    "navigation.first": () => scroll!.scrollTo(0),
  }, { when: () => props.interactive && Boolean(scroll) })

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" backgroundColor={colors.canvas} paddingX={2}>
      <scrollbox
        focusable={false}
        onMouseScroll={(event) => event.stopPropagation()}
        onMouseDown={event => { if (props.interactive) focusActivityComment(event, "issue-comment", props.comment) }}
        id="issue-detail-scroll"
        ref={(value) => { scroll = value; bindScrollbar(value) }}
        flexGrow={1}
        minWidth={0}
        minHeight={0}
        scrollY
        scrollX={false}
        contentOptions={{ paddingTop: 0, paddingBottom: 1, alignItems: centered() ? "center" : "stretch" }}
      >
        <box width="100%" maxWidth={contentWidth()} minWidth={0} flexShrink={0} flexDirection="column" paddingTop={1} paddingBottom={1}>
          <text width="100%" flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>
            {header()?.title ?? "Issue"} <span style={{ fg: colors.muted }}><Show when={issue()?.url} fallback={`#${props.number}`}>{(url) => <a href={url()}><span style={{ fg: props.interactive ? theme.markdownLink : colors.muted }}>#{props.number}</span></a>}</Show></span>
          </text>
          <Show when={header()}>
            {(current) => (
              <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>
                <span style={{ fg: current().state === "open" ? colors.openState : colors.closedState }}>
                  {iconPrefix(issueIcon(current().state, icons()))}{current().state === "open" ? "Open" : "Closed"}
                </span>
                {issue()?.stateReason ? ` · ${issue()!.stateReason!.replaceAll("_", " ")}` : ""}
                {issue()?.locked ? " · locked" : ""}
                {" · "}<span style={{ fg: colors.text }}><a href={`https://github.com/${current().author}`}>{current().author}</a></span> opened <Show when={issue()?.url} fallback={ago(current().createdAt)}>{(url) => <a href={url()}>{ago(current().createdAt)}</a>}</Show>
              </text>
            )}
          </Show>
        </box>
        <ResourceStateView resource={props.detail.resource} hideError>
          {(current) => (
            <>
              <box width="100%" maxWidth={contentWidth()} minWidth={0} flexShrink={0} flexDirection="row" alignItems="flex-start">
                <box flexGrow={1} flexBasis={0} minWidth={0} flexShrink={1} flexDirection="column" paddingRight={wide() ? 2 : 0}>
                  <Show when={!wide()}>
                    <box width="100%" minWidth={0} flexShrink={0} paddingBottom={1}>
                      <IssueMetadata issue={current()} compact inline={props.inlineMetadata} />
                      <Show when={props.inlineMetadata}><IssueDates issue={current()} compact /></Show>
                    </box>
                  </Show>
                  <box id="issue-detail-description" {...reactionMouse} width="100%" minWidth={0} flexShrink={0} backgroundColor={surface()} paddingX={2} paddingY={1} flexDirection="column">
                    <text width="100%" flexShrink={0} fg={colors.muted}>
                      {iconPrefix(icons().user)}<b><span style={{ fg: colors.text }}><a href={`https://github.com/${current().author}`}>{current().author}</a></span></b> · author
                    </text>
                    <box width="100%" minWidth={0} flexShrink={0} marginTop={1}>
                      <Show when={current().body.trim()} fallback={<text fg={colors.muted}>No description provided.</text>}>
                        <GitHubMarkdown content={current().body} syntaxStyle={markdownStyle()} backgroundColor={surface()} context={markdownContext()} preserveImages codePanels />
                      </Show>
                    </box>
                    <Reactions counts={current().reactions} viewerReactions={current().viewerReactions} canReact={current().canReact}
                      target={{ kind: "issue", number: props.number, nodeId: current().nodeId }} controls={props.reactionControls} interactive={props.interactive} />
                  </box>
                  <box width="100%" minWidth={0} flexShrink={0} flexDirection="column">
                    <DetailActivity
                      number={props.number} reactionControls={props.reactionControls} interactive={props.interactive}
                      collapsed={props.timelineCollapsed}
                      commentCount={current().commentCount}
                      comments={props.detail.comments}
                      references={props.detail.references}
                      onOpenReference={props.onOpenReference}
                      events={props.detail.events}
                      subject="issue"
                      repository={repository()}
                      syntaxStyle={markdownStyle()}
                      backgroundColor={surface()}
                      context={markdownContext()}
                    />
                    <Show when={!props.inlineMetadata && !wide() && (current().closedAt || current().milestone?.dueAt)}>
                      <box width="100%" minWidth={0} flexShrink={0} marginTop={1}>
                        <IssueDates issue={current()} compact />
                      </box>
                    </Show>
                    <Show when={props.comment}>
                      {comment => <ActivityCommentComposer comment={comment()} idPrefix="issue-comment" interactive={props.interactive}
                        repositoryUrl={markdownContext().repositoryUrl} sourceUrl={markdownContext().sourceUrl} defaultBranch={props.defaultBranch} scroll={() => scroll} />}
                    </Show>
                  </box>
                </box>
                <Show when={wide()}>
                  <box width={32} flexShrink={0} minWidth={0} backgroundColor={surface()} paddingX={2} paddingY={1} flexDirection="column">
                    <IssueMetadata issue={current()} compact={false} />
                    <ReferencedPulls resource={props.detail.references} repository={repository()} interactive={props.interactive} onOpenReference={props.onOpenReference} />
                    <IssueDates issue={current()} compact={false} />
                  </box>
                </Show>
              </box>

            </>
          )}
        </ResourceStateView>
      </scrollbox>
    </box>
  )
}
