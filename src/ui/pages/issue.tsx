import { RGBA, rgbToHex, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useKeyActions } from "../keybindings"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { defaultConfig, type DetailLayout } from "../../config"
import type { IssueDetail, IssueReference } from "../../models"
import type { IssueDetailState, ResourceState } from "../../repository-state"
import { DetailActivity } from "../components/detail-activity"
import { MetadataField } from "../components/detail-metadata"
import { GitHubMarkdown } from "../components/github-markdown"
import type { GitHubMarkdownContext } from "../github-markdown"
import { ResourceStateView } from "../components/resource-state"
import { ago, relativeTime } from "../format"
import { detailContentWidth } from "../detail-layout"
import { issueIcon, referenceColor, referenceIcon, referenceState, referencedPulls } from "../issue-references"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { useTheme } from "../theme"
import { useIcons } from "../icon-style"
import { createScrollbarVisibility } from "../scrollbar-visibility"

function IssueMetadata(props: { issue: IssueDetail; compact: boolean }) {
  const { colors } = useTheme()
  return (
    <box width="100%" minWidth={0} flexShrink={0} flexDirection="column">
      <Show when={!props.compact}>
        <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Details</text>
      </Show>
      <MetadataField label="Labels" compact={props.compact} muted={!props.issue.labels.length}>{props.issue.labels.join(" · ") || "none"}</MetadataField>
      <MetadataField label="Assignees" compact={props.compact} muted={!props.issue.assignees.length}>{props.issue.assignees.join(", ") || "none"}</MetadataField>
      <Show when={props.issue.milestone}>
        <MetadataField label="Milestone" compact={props.compact}>
          {props.issue.milestone?.title}
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

function ReferencedPulls(props: { resource: ResourceState<IssueReference[]>; repository: string }) {
  const { colors } = useTheme()
  const icons = useIcons()
  const pulls = createMemo(() => referencedPulls(props.resource.value ?? []))
  return (
    <Show when={pulls().length > 0 || props.resource.status === "error"}>
      <box width="100%" minWidth={0} flexShrink={0} marginTop={1} flexDirection="column">
        <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>Referenced PRs</text>
        <For each={pulls().slice(0, 3)}>
          {(reference) => (
            <box width="100%" minWidth={0} flexShrink={0} marginTop={1}>
              <text width="100%" flexShrink={0} fg={referenceColor(colors, reference)}>
                <a href={reference.url}>{referenceIcon(reference, icons())} #{reference.number} · {referenceState(reference)}</a>
              </text>
              <Show when={reference.repository !== props.repository}>
                <text width="100%" flexShrink={0} fg={colors.muted}>{reference.repository}</text>
              </Show>
              <text width="100%" flexShrink={0} fg={colors.text}>{reference.title}</text>
            </box>
          )}
        </For>
        <Show when={props.resource.status === "error"}>
          <text width="100%" flexShrink={0} fg={colors.red}>References unavailable</text>
        </Show>
      </box>
    </Show>
  )
}

export function IssueScreen(props: {
  number: number
  detail: IssueDetailState
  revealActivity?: number
  interactive: boolean
  showScrollbar: boolean
  defaultBranch?: string
  detailLayout?: DetailLayout
}) {
  const { colors, theme } = useTheme()
  const icons = useIcons()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const wide = () => dimensions().width >= 112
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
  const repository = () => issue()?.url.split("/").slice(3, 5).join("/") ?? ""
  const markdownContext = (): GitHubMarkdownContext => ({
    repositoryUrl: issue()?.url.replace(/\/issues\/\d+$/, "") ?? "",
    ref: props.defaultBranch,
    sourceUrl: issue()?.url,
  })
  const failure = (resource: ResourceState<unknown>) => resource.status === "error" ? resource.message : ""
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
            {issue()?.title ?? "Issue"} <span style={{ fg: colors.muted }}>#{props.number}</span>
          </text>
          <Show when={issue()}>
            <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>
              <span style={{ fg: issue()?.state === "open" ? colors.openState : colors.closedState }}>
                {issueIcon(issue()!.state, icons())} {issue()?.state === "open" ? "Open" : "Closed"}
              </span>
              {issue()?.stateReason ? ` · ${issue()!.stateReason!.replaceAll("_", " ")}` : ""}
              {issue()?.locked ? " · locked" : ""}
              {" · "}<span style={{ fg: colors.text }}>{issue()?.author}</span> opened {ago(issue()!.createdAt)}
            </text>
          </Show>
        </box>
        <ResourceStateView resource={props.detail.resource}>
          {(current) => (
            <>
              <box width="100%" maxWidth={contentWidth()} minWidth={0} flexShrink={0} flexDirection="row" alignItems="flex-start">
                <box flexGrow={1} flexBasis={0} minWidth={0} flexShrink={1} flexDirection="column" paddingRight={wide() ? 2 : 0}>
                  <Show when={current().permissionsError}>
                    {(message) => <text width="100%" flexShrink={0} paddingBottom={1} fg={colors.yellow} wrapMode="word">Issue actions unavailable: {message()}</text>}
                  </Show>
                  <Show when={!wide()}>
                    <box width="100%" minWidth={0} flexShrink={0} paddingBottom={1}>
                      <IssueMetadata issue={current()} compact />
                    </box>
                  </Show>
                  <box width="100%" minWidth={0} flexShrink={0} backgroundColor={surface()} paddingX={2} paddingY={1} flexDirection="column">
                    <text width="100%" flexShrink={0} fg={colors.muted}>
                      {icons().user} <b><span style={{ fg: colors.text }}>{current().author}</span></b> · author
                    </text>
                    <box width="100%" minWidth={0} flexShrink={0} marginTop={1}>
                      <Show when={current().body.trim()} fallback={<text fg={colors.muted}>No description provided.</text>}>
                        <GitHubMarkdown content={current().body} syntaxStyle={markdownStyle()} backgroundColor={surface()} context={markdownContext()} preserveImages codePanels />
                      </Show>
                    </box>
                  </box>
                  <Show when={props.detail.resource.status === "error"}>
                    <text width="100%" flexShrink={0} marginTop={1} fg={colors.red}>× {failure(props.detail.resource)}</text>
                  </Show>
                  <box width="100%" minWidth={0} flexShrink={0} flexDirection="column">
                    <DetailActivity
                      commentCount={current().commentCount}
                      comments={props.detail.comments}
                      references={props.detail.references}
                      events={props.detail.events}
                      subject="issue"
                      repository={repository()}
                      syntaxStyle={markdownStyle()}
                      backgroundColor={surface()}
                      context={markdownContext()}
                    />
                    <Show when={!wide() && (current().closedAt || current().milestone?.dueAt)}>
                      <box width="100%" minWidth={0} flexShrink={0} marginTop={1}>
                        <IssueDates issue={current()} compact />
                      </box>
                    </Show>
                  </box>
                </box>
                <Show when={wide()}>
                  <box width={32} flexShrink={0} minWidth={0} backgroundColor={surface()} paddingX={2} paddingY={1} flexDirection="column">
                    <IssueMetadata issue={current()} compact={false} />
                    <ReferencedPulls resource={props.detail.references} repository={repository()} />
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
