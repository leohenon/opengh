import { SyntaxStyle, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, onCleanup, Show } from "solid-js"
import type { AboutSidebar } from "../../config"
import type { Repo } from "../../models"
import type { RepositoryDocumentState, ResourceState } from "../../repository-state"
import type { AppColors, ResolvedTheme } from "../../theme"
import { ResourceStateView } from "../components/resource-state"
import { count } from "../format"
import { normalizeGitHubMarkdown } from "../github-markdown"
import { useTheme } from "../theme"

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

function createMarkdownStyle(colors: AppColors, theme: ResolvedTheme) {
  return SyntaxStyle.fromStyles({
    default: { fg: theme.markdownText },
    conceal: { fg: colors.muted },
    "markup.heading": { fg: theme.markdownHeading, bold: true },
    "markup.heading.1": { fg: theme.markdownHeading, bold: true },
    "markup.heading.2": { fg: theme.markdownHeading, bold: true },
    "markup.heading.3": { fg: theme.markdownHeading, bold: true },
    "markup.bold": { fg: theme.markdownStrong, bold: true },
    "markup.strong": { fg: theme.markdownStrong, bold: true },
    "markup.italic": { fg: theme.markdownEmph, italic: true },
    "markup.raw": { fg: theme.markdownCode, bg: colors.panel },
    "markup.raw.block": { fg: theme.markdownCodeBlock, bg: colors.panel },
    "markup.raw.inline": { fg: theme.markdownText, bg: colors.panel },
    "markup.link": { fg: theme.markdownLink },
    "markup.link.label": { fg: theme.markdownLinkText, underline: true },
    "markup.link.url": { fg: colors.muted },
    "markup.list": { fg: theme.markdownListItem },
    "markup.quote": { fg: theme.markdownBlockQuote, italic: true },
    comment: { fg: theme.syntaxComment, italic: true },
    keyword: { fg: theme.syntaxKeyword },
    string: { fg: theme.syntaxString },
    number: { fg: theme.syntaxNumber },
    function: { fg: theme.syntaxFunction },
    variable: { fg: theme.syntaxVariable },
    property: { fg: theme.syntaxFunction },
    type: { fg: theme.syntaxType },
    constant: { fg: theme.syntaxNumber },
    operator: { fg: theme.syntaxOperator },
    punctuation: { fg: theme.syntaxPunctuation },
  })
}

function createReactiveMarkdownStyle(colors: AppColors, theme: ResolvedTheme) {
  const renderer = useRenderer()
  let current: SyntaxStyle | undefined
  const release = (style: SyntaxStyle) => {
    queueMicrotask(() => {
      if (!renderer.isDestroyed) renderer.requestRender()
      void renderer.idle().catch(() => {}).finally(() => style.destroy())
    })
  }
  const style = createMemo(() => {
    const previous = current
    current = createMarkdownStyle(colors, theme)
    if (previous) release(previous)
    return current
  })
  onCleanup(() => {
    if (current) release(current)
  })
  return style
}

export function OverviewScreen(props: {
  repo: Repo
  documents: ResourceState<RepositoryDocumentState[]>
  currentDocument?: string
  showScrollbar: boolean
  aboutSidebar: AboutSidebar
  scrollRef: (value: ScrollBoxRenderable | undefined) => void
}) {
  const dimensions = useTerminalDimensions()
  const { colors, theme } = useTheme()
  const repo = () => props.repo
  const about = createMemo(() => extractAboutContent(repo().description))
  const documents = () => props.documents.value ?? []
  const document = () => documents().find((item) => item.id === props.currentDocument) ?? documents()[0]
  const currentLabel = () => document()?.label ?? "Documentation"
  const documentResource = createMemo<ResourceState<string>>(() => document()?.resource ?? { status: "loading", phase: "load" })
  const formattedDocument = createMemo(() => normalizeGitHubMarkdown(documentResource().value ?? ""))
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
        <box
          height={1}
          flexShrink={0}
          flexDirection="row"
          alignItems="center"
          gap={2}
          paddingLeft={2}
          paddingRight={2}
        >
          <Show
            when={hasDocumentTabs()}
            fallback={<text fg={colors.text} attributes={TextAttributes.BOLD}>{currentLabel()}</text>}
          >
            <Show
              when={!compactDocuments()}
              fallback={(
                <box flexDirection="row" gap={1}>
                  <text fg={colors.muted}>‹</text>
                  <text fg={colors.text} attributes={TextAttributes.BOLD}>{currentLabel()}</text>
                  <text fg={colors.muted}>›</text>
                </box>
              )}
            >
              <For each={documents()}>
                {(item) => (
                  <text
                    fg={item.id === document()?.id ? colors.text : colors.muted}
                    attributes={item.id === document()?.id ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {item.label}
                  </text>
                )}
              </For>
            </Show>
          </Show>
        </box>
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
                      ref={props.scrollRef}
                      flexGrow={1}
                      minWidth={0}
                      minHeight={0}
                      backgroundColor={colors.canvas}
                      verticalScrollbarOptions={{ visible: props.showScrollbar }}
                      paddingX={2}
                      paddingY={1}
                      scrollY
                    >
                      <markdown
                        content={formattedDocument()}
                        syntaxStyle={markdownStyle()}
                        fg={colors.text}
                        bg={colors.canvas}
                        conceal
                        tableOptions={{
                          style: "grid",
                          widthMode: "full",
                          wrapMode: "word",
                          cellPaddingX: 1,
                          borderColor: colors.border,
                        }}
                        width="100%"
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
              <text width={2} fg={colors.muted}>★</text>
              <text fg={colors.text}>{count(repo().stars)} stars</text>
            </box>
            <box height={1} flexShrink={0} flexDirection="row">
              <text width={2} fg={colors.muted}>⑂</text>
              <text fg={colors.text}>{count(repo().forks)} forks</text>
            </box>
            <box height={1} flexShrink={0} flexDirection="row">
              <text width={2} fg={colors.muted}>◉</text>
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
