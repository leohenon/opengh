import { RGBA, rgbToHex, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useKeyActions } from "../keybindings"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { defaultConfig, type DetailLayout } from "../../config"
import type { PullRequestDetail, PullRequestSummary, PullContext, IssueTimelineEvent, IssueReference } from "../../models"
import type { PullDetailState, ResourceState } from "../../repository-state"
import { DetailActivity } from "../components/detail-activity"
import { TimelineEntry } from "../components/timeline-entry"
import { MetadataField, MetadataSummary } from "../components/detail-metadata"
import { GitHubMarkdown } from "../components/github-markdown"
import { ResourceStateView } from "../components/resource-state"
import { Reactions, messageReactionMouse, type ReactionControls } from "../components/reactions"
import { PullContextMetadata, PullReadinessPanel } from "../components/pull-context-panel"
import { PullReviewSummary } from "../components/pull-review-summary"
import { detailContentWidth } from "../detail-layout"
import { ago, relativeTime } from "../format"
import type { GitHubMarkdownContext } from "../github-markdown"
import { useIcons } from "../icon-style"
import { iconPrefix } from "../icons"
import { pullRequestIcon } from "../issue-references"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { useTheme } from "../theme"

function PullMetadata(props: { pull: PullRequestDetail; compact: boolean; inline?: boolean; context: ResourceState<PullContext>; events: readonly IssueTimelineEvent[] }) {
  const { colors } = useTheme()
  const repositoryUrl = () => props.pull.url.replace(/\/pull\/\d+$/, "")
  const headLabel = () => {
    const repository = props.pull.url.split("/").slice(3, 5).join("/")
    return props.pull.headRepository && props.pull.headRepository !== repository
      ? `${props.pull.headRepository}:${props.pull.headBranch}` : props.pull.headBranch
  }
  return (
    <box width="100%" minWidth={0} flexShrink={0} flexDirection="column">
      <Show when={!props.compact}>
        <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Details</text>
      </Show>
      <Show when={props.inline} fallback={<>
      <MetadataField label="Labels" compact={props.compact} muted={!props.pull.labels.length}>
        <For each={props.pull.labels} fallback="none">{(label, index) => <>{index() > 0 ? " · " : ""}<a href={`${repositoryUrl()}/pulls?q=${encodeURIComponent(`is:pr label:"${label}"`)}`}>{label}</a></>}</For>
      </MetadataField>
      <MetadataField label="Assignees" compact={props.compact} muted={!props.pull.assignees.length}>
        <For each={props.pull.assignees} fallback="none">{(login, index) => <>{index() > 0 ? ", " : ""}<a href={`https://github.com/${login}`}>{login}</a></>}</For>
      </MetadataField>
      </>}>
        <MetadataSummary labels={props.pull.labels} assignees={props.pull.assignees} repositoryUrl={repositoryUrl()} kind="pull" />
      </Show>
      <Show when={!props.inline || props.events.some(event => event.kind === "review")}>
        <PullReviewSummary events={props.events} compact={props.compact} />
      </Show>
      <Show when={props.pull.reviewers.length > 0}>
        <MetadataField label="Review requested" compact={props.compact}>
          <For each={props.pull.reviewers}>{(name, index) => <>{index() > 0 ? ", " : ""}<Show when={props.pull.reviewerLinks?.find((reviewer) => reviewer.name === name)?.url} fallback={name}>{(url) => <a href={url()}>{name}</a>}</Show></>}</For>
        </MetadataField>
      </Show>
      <MetadataField label="Branches" compact={props.compact}>
        <span style={{ fg: colors.blue }}><a href={`${repositoryUrl()}/tree/${encodeURIComponent(props.pull.baseBranch)}`}>{props.pull.baseBranch}</a></span>{" ← "}
        <Show when={props.pull.headRepository} fallback={headLabel()}>
          {(repository) => <a href={`${repositoryUrl().split("/").slice(0, 3).join("/")}/${repository()}/tree/${encodeURIComponent(props.pull.headBranch)}`}>{headLabel()}</a>}
        </Show>
      </MetadataField>
      <MetadataField label="Changes" compact={props.compact}>
        {props.pull.commitCount} {props.pull.commitCount === 1 ? "commit" : "commits"}
        {" · "}{props.pull.changedFiles} {props.pull.changedFiles === 1 ? "file" : "files"}
        <Show when={props.compact} fallback={<br />}>{" · "}</Show>
        <span style={{ fg: colors.green }}>+{props.pull.additions}</span>{" "}<span style={{ fg: colors.red }}>−{props.pull.deletions}</span>
      </MetadataField>
      <Show when={props.pull.state === "open" && props.pull.mergeable === false}>
        <text width="100%" flexShrink={0} marginTop={props.compact ? 0 : 1} fg={colors.red}>Branch has merge conflicts</text>
      </Show>
      <Show when={!props.compact && props.context.value}>
        {(context) => <PullContextMetadata context={context()} compact={false} repository={props.pull.url.split("/").slice(3, 5).join("/")} />}
      </Show>
      <Show when={props.pull.mergedAt || props.pull.closedAt}>
        <MetadataField label={props.pull.mergedAt ? "Merged" : "Closed"} compact={props.compact} muted>
          {relativeTime(props.pull.mergedAt ?? props.pull.closedAt)}
        </MetadataField>
      </Show>
    </box>
  )
}

export function PullScreen(props: {
  number: number
  summary?: PullRequestSummary
  reactionControls?: ReactionControls
  onOpenReference?: (reference: IssueReference) => void
  detail: PullDetailState
  revealActivity?: number
  timelineCollapsed?: boolean
  interactive: boolean
  showScrollbar: boolean
  defaultBranch?: string
  detailLayout?: DetailLayout
  inlineMetadata?: boolean
}) {
  const { colors, theme } = useTheme()
  const icons = useIcons()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const wide = () => !props.inlineMetadata && dimensions().width >= 112
  const centered = () => (props.detailLayout ?? defaultConfig.detailLayout) === "centered"
  const contentWidth = () => detailContentWidth(props.detailLayout, wide() ? 32 : 0)
  const pull = () => props.detail.resource.value
  // The list row seeds the header so it fills in rather than swapping a placeholder title.
  const header = () => pull() ?? props.summary
  const state = () => header()?.merged ? "Merged"
    : header()?.state === "closed" ? "Closed" : header()?.draft ? "Draft" : "Open"
  const stateColor = () => header()?.merged ? colors.purple
    : header()?.state === "closed" ? colors.red : header()?.draft ? colors.muted : colors.openState
  const reactionMouse = messageReactionMouse(() => pull() ? ({ kind: "pull", number: props.number, nodeId: pull()?.nodeId }) : undefined,
    pull, () => pull()?.body ?? "", () => props.reactionControls, () => props.interactive)
  const repository = () => pull()?.url.split("/").slice(3, 5).join("/") ?? ""
  const markdownContext = (): GitHubMarkdownContext => ({
    repositoryUrl: pull()?.url.replace(/\/pull\/\d+$/, "") ?? "",
    ref: props.defaultBranch,
    sourceUrl: pull()?.url,
  })
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
  let scroll: ScrollBoxRenderable | undefined
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  const revealActivity = () => scroll?.scrollTo(scroll.scrollHeight)
  createEffect(() => {
    if (props.revealActivity === undefined) return
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
        id="pull-detail-scroll"
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
            {header()?.title ?? "Pull request"} <span style={{ fg: colors.muted }}><Show when={pull()?.url} fallback={`#${props.number}`}>{(url) => <a href={url()}><span style={{ fg: props.interactive ? theme.markdownLink : colors.muted }}>#{props.number}</span></a>}</Show></span>
          </text>
          <Show when={header()}>
            {(current) => (
              <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>
                <span style={{ fg: stateColor() }}>{iconPrefix(pullRequestIcon(current(), icons()))}{state()}</span>
                {" · "}<span style={{ fg: colors.text }}><a href={`https://github.com/${current().author}`}>{current().author}</a></span> opened <Show when={pull()?.url} fallback={ago(current().createdAt)}>{(url) => <a href={url()}>{ago(current().createdAt)}</a>}</Show>
              </text>
            )}
          </Show>
        </box>
        <ResourceStateView resource={props.detail.resource} hideError>
          {(current) => (
            <box width="100%" maxWidth={contentWidth()} minWidth={0} flexShrink={0} flexDirection="row" alignItems="flex-start">
              <box flexGrow={1} flexBasis={0} minWidth={0} flexShrink={1} flexDirection="column" paddingRight={wide() ? 2 : 0}>
                <Show when={!wide()}>
                  <box width="100%" minWidth={0} flexShrink={0} paddingBottom={1}>
                    <PullMetadata pull={current()} compact inline={props.inlineMetadata} context={props.detail.context} events={props.detail.events ?? []} />
                    <Show when={props.inlineMetadata && props.detail.context.value}>
                      {context => <PullContextMetadata context={context()} compact omitEmpty repository={repository()} />}
                    </Show>
                  </box>
                </Show>
                <box {...reactionMouse} id="pull-detail-description" width="100%" minWidth={0} flexShrink={0} backgroundColor={surface()} paddingX={2} paddingY={1} flexDirection="column">
                  <text width="100%" flexShrink={0} fg={colors.muted}>
                    {iconPrefix(icons().user)}<b><span style={{ fg: colors.text }}><a href={`https://github.com/${current().author}`}>{current().author}</a></span></b> · author
                  </text>
                  <box width="100%" minWidth={0} flexShrink={0} marginTop={1}>
                    <Show when={current().body.trim()} fallback={<text fg={colors.muted}>No description provided.</text>}>
                      <GitHubMarkdown content={current().body} syntaxStyle={markdownStyle()} backgroundColor={surface()} context={markdownContext()} preserveImages codePanels />
                    </Show>
                  </box>
                  <Reactions counts={current().reactions} viewerReactions={current().viewerReactions} canReact={current().canReact}
                    target={{ kind: "pull", number: props.number, nodeId: current().nodeId }} controls={props.reactionControls} interactive={props.interactive} />
                </box>
                <Show when={props.detail.context.value && !wide() && !props.inlineMetadata}>
                  <box id="pull-detail-context" width="100%" minWidth={0} flexShrink={0} marginTop={1}>
                    <PullContextMetadata context={props.detail.context.value!} compact repository={repository()} />
                  </box>
                </Show>
                <DetailActivity
                  number={props.number} reactionControls={props.reactionControls} interactive={props.interactive}
                  commits={props.detail.commits}
                  commitTotal={current().commitCount}
                  pullUrl={current().url}
                  collapsed={props.timelineCollapsed}
                  commentCount={current().commentCount}
                  comments={props.detail.comments}
                  references={props.detail.references}
                  onOpenReference={props.onOpenReference}
                  events={props.detail.events}
                  threads={props.detail.context.value?.threads}
                  threadsLoading={props.detail.context.status === "loading"}
                  threadsUnavailable={props.detail.context.status === "error"}
                  subject="pull"
                  hasFollowingItem={current().state === "open" && props.detail.context.status !== "error"}
                  repository={repository()}
                  syntaxStyle={markdownStyle()}
                  backgroundColor={surface()}
                  context={markdownContext()}
                >
                  <Show when={current().state === "open" && props.detail.context.status !== "error"}>
                    <Show when={props.detail.context.value && props.detail.context.status === "ready"} fallback={(
                      <TimelineEntry icon={props.detail.context.status === "loading" ? icons().workflow.clock : icons().workflow.attention} color={colors.muted} nodeOffset={2}>
                        <box width="100%" minWidth={0} flexShrink={0} backgroundColor={surface()} paddingX={2} paddingY={1}>
                          <text width="100%" flexShrink={0} fg={colors.muted}>
                            {props.detail.context.status === "loading" ? "Loading merge readiness…" : "Merge readiness unavailable."}
                          </text>
                        </box>
                      </TimelineEntry>
                    )}>
                      <PullReadinessPanel context={props.detail.context.value!} expectedHeadSha={current().headSha} backgroundColor={surface()} />
                    </Show>
                  </Show>
                </DetailActivity>
              </box>
              <Show when={wide()}>
                <box id="pull-detail-sidebar" width={32} flexShrink={0} minWidth={0} backgroundColor={surface()} paddingX={2} paddingY={1}>
                  <PullMetadata pull={current()} compact={false} context={props.detail.context} events={props.detail.events ?? []} />
                </box>
              </Show>
            </box>
          )}
        </ResourceStateView>
      </scrollbox>
    </box>
  )
}
