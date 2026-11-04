import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, onCleanup, Show } from "solid-js"
import { defaultConfig, type DetailLayout } from "../../config"
import type { Repo } from "../../models"
import type { RepositoryDocumentState, ResourceState } from "../../repository-state"
import { ResourceStateView } from "../components/resource-state"
import { count } from "../format"
import { detailContentWidth } from "../detail-layout"
import { GitHubMarkdown } from "../components/github-markdown"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { useTheme } from "../theme"
import { useIcons } from "../icon-style"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { mouseClick } from "../mouse"

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

// Auto shows the About sidebar only when the terminal leaves room beside the document.
export type AboutSidebar = "auto" | "show" | "hide"
export const aboutSidebarVisible = (mode: AboutSidebar, width: number) => mode === "show" || mode === "auto" && width >= 100

function InlineAbout(props: { repo: Repo }) {
  const { colors } = useTheme()
  const icons = useIcons()
  const about = createMemo(() => extractAboutContent(props.repo.description))
  return (
    <box width="100%" minWidth={0} flexShrink={0} paddingX={2} paddingBottom={1} flexDirection="column">
      <text width="100%" flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>About · {props.repo.nameWithOwner}</text>
      <text width="100%" flexShrink={0} fg={colors.text}>{about().description}</text>
      <For each={about().urls}>
        {url => <text width="100%" flexShrink={0} fg={colors.blue}>{displayUrl(url)}</text>}
      </For>
      <Show when={props.repo.parentRepository}>
        <text width="100%" flexShrink={0} fg={colors.muted}>Forked from <span style={{ fg: colors.blue }}>{props.repo.parentRepository}</span></text>
      </Show>
      <text width="100%" flexShrink={0} fg={colors.muted}>
        {icons().repository.star} {count(props.repo.stars)} stars{" · "}
        {icons().repository.fork} {count(props.repo.forks)} forks{" · "}
        {icons().repository.watching} {count(props.repo.watchers)} watching
        <Show when={props.repo.language && props.repo.language !== "Unknown"}>{" · "}<span style={{ fg: colors.blue }}>{props.repo.language}</span></Show>
        <Show when={props.repo.license && props.repo.license !== "None"}>{" · "}{props.repo.license}</Show>
      </text>
    </box>
  )
}

export function OverviewScreen(props: {
  repo: Repo
  documents: ResourceState<RepositoryDocumentState[]>
  currentDocument?: string
  interactive?: boolean
  onSelectDocument?: (id: string) => void
  onMoveDocument?: (delta: number) => void
  compactHeader?: boolean
  hideDocumentsTab?: boolean
  showScrollbar: boolean
  aboutSidebar: AboutSidebar
  inlineAbout?: boolean
  detailLayout?: DetailLayout
  scrollRef: (value: ScrollBoxRenderable | undefined) => void
}) {
  const dimensions = useTerminalDimensions()
  const centered = () => (props.detailLayout ?? defaultConfig.detailLayout) === "centered"
  const { colors, theme } = useTheme()
  const icons = useIcons()
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  const repo = () => props.repo
  const about = createMemo(() => extractAboutContent(repo().description))
  const documents = () => props.documents.value ?? []
  const document = () => documents().find((item) => item.id === props.currentDocument) ?? documents()[0]
  // Leave the label empty during the first load so it fills in instead of being replaced.
  const currentLabel = () => document()?.label
    ?? (props.documents.status === "loading" && props.documents.value === undefined ? "" : "Documentation")
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
  // One view spans the document list and the selected document, so the spinner never remounts between them.
  const viewResource = createMemo<ResourceState<unknown>>(() => props.documents.value === undefined ? props.documents
    : document() ? documentResource() : { status: "ready", value: null })
  const hasDocumentTabs = () => documents().length > 1
  const showAboutSidebar = () => !props.inlineAbout && aboutSidebarVisible(props.aboutSidebar, dimensions().width)
  const documentLabelsWidth = () => documents().reduce((width, item) => width + item.label.length, 0)
    + Math.max(0, documents().length - 1) * 2
  const compactDocuments = () => hasDocumentTabs()
    && documentLabelsWidth() > Math.max(1, dimensions().width - (showAboutSidebar() ? 42 : 8))
  const markdownStyle = createReactiveMarkdownStyle(colors, theme)

  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection={props.inlineAbout ? "column" : "row"}
      gap={props.inlineAbout ? 0 : 2}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={colors.canvas}
    >
      <Show when={props.inlineAbout && props.aboutSidebar !== "hide"}>
        <InlineAbout repo={repo()} />
      </Show>
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
                    <text fg={colors.muted} selectable={false}
                      {...mouseClick(() => props.onMoveDocument?.(-1), () => props.interactive !== false && Boolean(props.onMoveDocument))}>‹</text>
                    <text fg={props.compactHeader ? colors.salmon : colors.text} attributes={TextAttributes.BOLD}>{currentLabel()}</text>
                    <text fg={colors.muted} selectable={false}
                      {...mouseClick(() => props.onMoveDocument?.(1), () => props.interactive !== false && Boolean(props.onMoveDocument))}>›</text>
                  </box>
                )}
              >
                <For each={documents()}>
                  {(item) => (
                    <text
                      fg={item.id === document()?.id ? props.compactHeader ? colors.salmon : colors.text : colors.muted}
                      attributes={item.id === document()?.id ? TextAttributes.BOLD : TextAttributes.NONE}
                      selectable={false}
                      {...mouseClick(() => props.onSelectDocument?.(item.id), () => props.interactive !== false && Boolean(props.onSelectDocument))}
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
                        <text fg={item.id === document()?.id ? colors.salmon : colors.border} selectable={false}
                          {...mouseClick(() => props.onSelectDocument?.(item.id), () => props.interactive !== false && Boolean(props.onSelectDocument))}>
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
        <ResourceStateView resource={viewResource()}>
          {() => (
            <Show when={document()} fallback={(
              <box flexGrow={1} alignItems="center" justifyContent="center">
                <text fg={colors.muted}>No repository documentation.</text>
              </box>
            )}>
              {(_) => {
                onCleanup(() => props.scrollRef(undefined))
                return (
                  <scrollbox
                    id="overview-document-scroll"
                    focusable={false}
                    onMouseScroll={(event) => event.stopPropagation()}
                    ref={(value) => { bindScrollbar(value); props.scrollRef(value) }}
                    flexGrow={1}
                    minWidth={0}
                    minHeight={0}
                    backgroundColor={colors.canvas}
                    paddingX={2}
                    paddingY={1}
                    scrollY
                    contentOptions={{ alignItems: centered() ? "center" : "stretch" }}
                  >
                    <box width="100%" maxWidth={detailContentWidth(props.detailLayout)} minWidth={0} flexShrink={0} flexDirection="column">
                      <GitHubMarkdown
                        content={documentResource().value ?? ""}
                        syntaxStyle={markdownStyle()}
                        context={markdownContext()}
                        plainText={plainDocument()}
                        wide={!centered()}
                      />
                    </box>
                  </scrollbox>
                )
              }}
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
