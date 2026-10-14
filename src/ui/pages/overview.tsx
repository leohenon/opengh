import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, onCleanup, Show } from "solid-js"
import type { AboutSidebar } from "../../config"
import type { Repo } from "../../models"
import type { RepositoryDocumentState, ResourceState } from "../../repository-state"
import { ResourceStateView } from "../components/resource-state"
import { count } from "../format"
import { GitHubMarkdown } from "../components/github-markdown"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { useTheme } from "../theme"
import { useIcons } from "../icon-style"
import { createScrollbarVisibility } from "../scrollbar-visibility"

function extractAboutContent(value: string) {
  const urls: string[] = []
  const description = value
    .replace(/https?:\/\/[^\s]+/g, (match) => {
      const url = match.replace(/[),.;!?]+$/, "")
      if (url) urls.push(url)
      return match.slice(url.length)
    })
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
  return { description, urls }
}

function displayUrl(value: string) {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

export function OverviewScreen(props: {
  repo: Repo
  documents: ResourceState<RepositoryDocumentState[]>
  currentDocument?: string
  compactHeader?: boolean
  hideDocumentsTab?: boolean
  showScrollbar: boolean
  aboutSidebar: AboutSidebar
  scrollRef: (value: ScrollBoxRenderable | undefined) => void
}) {
  const dimensions = useTerminalDimensions()
  const { colors, theme } = useTheme()
  const icons = useIcons()
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  const repo = () => props.repo
  const about = createMemo(() => extractAboutContent(repo().description))
  const documents = () => props.documents.value ?? []
  const document = () => documents().find((item) => item.id === props.currentDocument) ?? documents()[0]
  const currentLabel = () => document()?.label ?? "Documentation"
  const markdownContext = () => {
    const source = document()
    return source ? {
      repositoryUrl: new URL(`/${source.repository}`, repo().url).href.replace(/\/$/, ""),
      ref: source.ref,
      path: source.path,
    } : undefined
  }
  const plainDocument = () => /(?:^|\/)(?:licen[sc]e|copying|unlicense)(?:$|[._-])/i.test(document()?.path ?? "")
    && !/\.(?:md|markdown|mdown|mkd)$/i.test(document()?.path ?? "")
  const documentResource = createMemo<ResourceState<string>>(() => document()?.resource ?? { status: "loading", phase: "load" })
  const hasDocumentTabs = () => documents().length > 1
  const showAboutSidebar = () => props.aboutSidebar === "show"
    || props.aboutSidebar === "auto" && dimensions().width >= 100
  const documentLabelsWidth = () => documents().reduce((width, item) => width + item.label.length, 0)
    + Math.max(0, documents().length - 1) * 2
  const compactDocuments = () => hasDocumentTabs()
    && documentLabelsWidth() > Math.max(1, dimensions().width - (showAboutSidebar() ? 42 : 8))
  const markdownStyle = createReactiveMarkdownStyle(colors, theme)

  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection="row"
      gap={2}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={colors.canvas}
    >
      <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column">
        <Show when={!props.hideDocumentsTab}>
          <box
            height={1}
            flexShrink={0}
            flexDirection="row"
            alignItems="center"
            gap={2}
            paddingLeft={2}
            paddingRight={2}
            minWidth={0}
            overflow="hidden"
          >
            <Show
              when={hasDocumentTabs()}
              fallback={<text fg={props.compactHeader ? colors.salmon : colors.text} attributes={TextAttributes.BOLD}>{currentLabel()}</text>}
            >
              <Show
                when={!compactDocuments()}
                fallback={(
                  <box flexDirection="row" gap={1}>
                    <text fg={colors.muted}>‹</text>
                    <text fg={props.compactHeader ? colors.salmon : colors.text} attributes={TextAttributes.BOLD}>{currentLabel()}</text>
                    <text fg={colors.muted}>›</text>
                  </box>
                )}
              >
                <For each={documents()}>
                  {(item) => (
                    <text
                      fg={item.id === document()?.id ? props.compactHeader ? colors.salmon : colors.text : colors.muted}
                      attributes={item.id === document()?.id ? TextAttributes.BOLD : TextAttributes.NONE}
                    >
                      {item.label}
                    </text>
                  )}
                </For>
              </Show>
            </Show>
          </box>
          <Show when={!props.compactHeader}>
            <box height={1} flexShrink={0} flexDirection="row">
              <Show when={hasDocumentTabs()}>
                <Show
                  when={!compactDocuments()}
                  fallback={(
                    <>
                      <text fg={colors.border}>{"─".repeat(4)}</text>
                      <text fg={colors.salmon}>{"─".repeat(currentLabel().length)}</text>
                    </>
                  )}
                >
                  <text fg={colors.border}>──</text>
                  <For each={documents()}>
                    {(item) => (
                      <>
                        <text fg={item.id === document()?.id ? colors.salmon : colors.border}>
                          {"─".repeat(item.label.length)}
                        </text>
                        <text fg={colors.border}>──</text>
                      </>
                    )}
                  </For>
                </Show>
              </Show>
              <box flexGrow={1} height={1} border={["bottom"]} borderColor={colors.border} />
            </box>
          </Show>
        </Show>
        <ResourceStateView resource={props.documents}>
          {() => (
            <Show when={document()} fallback={(
              <box flexGrow={1} alignItems="center" justifyContent="center">
                <text fg={colors.muted}>No repository documentation.</text>
              </box>
            )}>
              <ResourceStateView resource={documentResource()}>
                {() => {
                  onCleanup(() => props.scrollRef(undefined))
                  return (
                    <scrollbox
                      ref={(value) => { bindScrollbar(value); props.scrollRef(value) }}
                      flexGrow={1}
                      minWidth={0}
                      minHeight={0}
                      backgroundColor={colors.canvas}
                      paddingX={2}
                      paddingY={1}
                      scrollY
                    >
                      <GitHubMarkdown
                        content={documentResource().value ?? ""}
                        syntaxStyle={markdownStyle()}
                        context={markdownContext()}
                        plainText={plainDocument()}
                      />
                    </scrollbox>
                  )
                }}
              </ResourceStateView>
            </Show>
          )}
        </ResourceStateView>
      </box>

      <Show when={showAboutSidebar()}>
        <box width={32} flexShrink={0} minHeight={0} flexDirection="column">
          <box
            height={1}
            flexShrink={0}
            flexDirection="row"
            alignItems="center"
            paddingLeft={2}
            paddingRight={2}
          >
            <text fg={colors.text} attributes={TextAttributes.BOLD}>About</text>
          </box>
          <box height={1} flexShrink={0} border={["bottom"]} borderColor={colors.border} />
          <box
            flexGrow={1}
            minHeight={0}
            flexDirection="column"
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
          >
            <Show when={repo().parentRepository}>
              <text height={1} flexShrink={0} fg={colors.muted}>Forked from</text>
              <text flexShrink={0} fg={colors.blue} wrapMode="word">{repo().parentRepository}</text>
              <box height={1} flexShrink={0} />
            </Show>
            <text flexShrink={0} fg={colors.text} wrapMode="word">{about().description}</text>
            <Show when={about().urls.length > 0}>
              <box height={1} flexShrink={0} />
              <For each={about().urls}>
                {(url) => <text height={1} flexShrink={0} fg={colors.blue}>{displayUrl(url)}</text>}
              </For>
            </Show>
            <box height={1} flexShrink={0} />
            <text height={1} flexShrink={0} fg={colors.muted}>Language</text>
            <text height={1} flexShrink={0} fg={colors.blue}>{repo().language}</text>
            <box height={1} flexShrink={0} />
            <box height={1} flexShrink={0} flexDirection="row">
              <text width={2} fg={colors.muted}>{icons().repository.star}</text>
              <text fg={colors.text}>{count(repo().stars)} stars</text>
            </box>
            <box height={1} flexShrink={0} flexDirection="row">
              <text width={2} fg={colors.muted}>{icons().repository.fork}</text>
              <text fg={colors.text}>{count(repo().forks)} forks</text>
            </box>
            <box height={1} flexShrink={0} flexDirection="row">
              <text width={2} fg={colors.muted}>{icons().repository.watching}</text>
              <text fg={colors.text}>{count(repo().watchers)} watching</text>
            </box>
            <box height={1} flexShrink={0} />
            <text height={1} flexShrink={0} fg={colors.muted}>License</text>
            <text height={1} flexShrink={0} fg={colors.text}>{repo().license}</text>
          </box>
        </box>
      </Show>
    </box>
  )
}
