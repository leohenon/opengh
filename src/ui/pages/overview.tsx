import { SyntaxStyle, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import type { Repo } from "../../models"
import type { RepositoryDocumentKind, ResourceState } from "../../repository-state"
import { ResourceStateView } from "../components/resource-state"
import { count } from "../format"
import { normalizeGitHubMarkdown } from "../github-markdown"
import { colors } from "../theme"

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

function createMarkdownStyle() {
  return SyntaxStyle.fromStyles({
    default: { fg: colors.text },
    conceal: { fg: colors.muted },
    "markup.heading": { fg: colors.text, bold: true },
    "markup.heading.1": { fg: colors.text, bold: true },
    "markup.heading.2": { fg: colors.text, bold: true },
    "markup.heading.3": { fg: colors.text, bold: true },
    "markup.bold": { fg: colors.text, bold: true },
    "markup.strong": { fg: colors.text, bold: true },
    "markup.italic": { fg: colors.text, italic: true },
    "markup.raw": { fg: colors.green, bg: colors.panel },
    "markup.raw.block": { fg: colors.green, bg: colors.panel },
    "markup.raw.inline": { fg: colors.text, bg: colors.panel },
    "markup.link": { fg: colors.blue },
    "markup.link.label": { fg: colors.blue, underline: true },
    "markup.link.url": { fg: colors.muted },
    "markup.list": { fg: colors.blue },
    "markup.quote": { fg: colors.muted, italic: true },
    comment: { fg: colors.muted, italic: true },
    keyword: { fg: colors.purple },
    string: { fg: colors.green },
    number: { fg: colors.yellow },
    function: { fg: colors.blue },
    variable: { fg: colors.text },
    property: { fg: colors.blue },
    type: { fg: colors.yellow },
    constant: { fg: colors.yellow },
    operator: { fg: colors.muted },
    punctuation: { fg: colors.muted },
  })
}

export type OverviewDocument = {
  kind: RepositoryDocumentKind
  label: string
  resource: ResourceState<string | undefined>
}

export function OverviewScreen(props: {
  repo: Repo
  documents: readonly OverviewDocument[]
  currentDocument: RepositoryDocumentKind
  showScrollbar: boolean
  scrollRef: (value: ScrollBoxRenderable) => void
}) {
  const dimensions = useTerminalDimensions()
  const repo = () => props.repo
  const about = createMemo(() => extractAboutContent(repo().description))
  const document = () => props.documents.find((item) => item.kind === props.currentDocument) ?? props.documents[0]!
  const formattedDocument = createMemo(() => normalizeGitHubMarkdown(document().resource.value ?? ""))
  const hasDocumentTabs = () => props.documents.length > 1
  const documentLabelsWidth = () => props.documents.reduce((width, item) => width + item.label.length, 0)
    + Math.max(0, props.documents.length - 1) * 2
  const compactDocuments = () => hasDocumentTabs()
    && documentLabelsWidth() > Math.max(1, dimensions().width - 40)
  const markdownStyle = createMarkdownStyle()

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
            fallback={<text fg={colors.text} attributes={TextAttributes.BOLD}>{document().label}</text>}
          >
            <Show
              when={!compactDocuments()}
              fallback={(
                <box flexDirection="row" gap={1}>
                  <text fg={colors.muted}>‹</text>
                  <text fg={colors.text} attributes={TextAttributes.BOLD}>{document().label}</text>
                  <text fg={colors.muted}>›</text>
                </box>
              )}
            >
              <For each={props.documents}>
                {(item) => (
                  <text
                    fg={item.kind === props.currentDocument ? colors.text : colors.muted}
                    attributes={item.kind === props.currentDocument ? TextAttributes.BOLD : TextAttributes.NONE}
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
                  <text fg={colors.salmon}>{"─".repeat(document().label.length)}</text>
                </>
              )}
            >
              <text fg={colors.border}>──</text>
              <For each={props.documents}>
                {(item) => (
                  <>
                    <text fg={item.kind === props.currentDocument ? colors.salmon : colors.border}>
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
        <ResourceStateView resource={document().resource} loading="Loading…">
          {(_source) => (
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
                syntaxStyle={markdownStyle}
                fg={colors.text}
                bg={colors.canvas}
                conceal
                internalBlockMode="top-level"
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
          )}
        </ResourceStateView>
      </box>

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
    </box>
  )
}
