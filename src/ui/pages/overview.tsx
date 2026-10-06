import { SyntaxStyle, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import type { Repo } from "../../models"
import type { ResourceState } from "../../repository-state"
import { ResourceStateView } from "../components/resource-state"
import { count } from "../format"
import { colors } from "../theme"

function createMarkdownStyle() {
  return SyntaxStyle.fromStyles({
    default: { fg: colors.text },
    conceal: { fg: colors.muted },
    "markup.heading": { fg: colors.blue, bold: true },
    "markup.heading.1": { fg: colors.blue, bold: true },
    "markup.heading.2": { fg: colors.blue, bold: true },
    "markup.heading.3": { fg: colors.text, bold: true },
    "markup.bold": { fg: colors.text, bold: true },
    "markup.strong": { fg: colors.text, bold: true },
    "markup.italic": { fg: colors.text, italic: true },
    "markup.raw": { fg: colors.green, bg: colors.panel },
    "markup.raw.block": { fg: colors.green, bg: colors.panel },
    "markup.raw.inline": { fg: colors.green, bg: colors.panel },
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

export function OverviewScreen(props: {
  repo: Repo
  currentBranch: string
  readme: ResourceState<string>
  showScrollbar: boolean
  scrollRef: (value: ScrollBoxRenderable) => void
}) {
  const repo = () => props.repo
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
          height={3}
          flexShrink={0}
          flexDirection="row"
          alignItems="center"
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={colors.panel}
        >
          <text fg={colors.text} attributes={TextAttributes.BOLD}>README</text>
          <box flexGrow={1} />
          <text fg={colors.blue}> {props.currentBranch}</text>
        </box>
        <ResourceStateView resource={props.readme} loading="Loading README…">
          {(readme) => (
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
                content={readme()}
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

      <box width={36} flexShrink={0} minHeight={0} flexDirection="column">
        <box
          height={3}
          flexShrink={0}
          flexDirection="row"
          alignItems="center"
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={colors.panel}
        >
          <text fg={colors.text} attributes={TextAttributes.BOLD}>About</text>
        </box>
        <box flexGrow={1} minHeight={0} flexDirection="column" padding={2} gap={1}>
          <text fg={colors.text} wrapMode="word">{repo().description}</text>
          <box height={1} />
          <text fg={colors.muted}>LANGUAGE</text>
          <text fg={colors.blue}>{repo().language}</text>
          <box height={1} />
          <text fg={colors.muted}>REPOSITORY</text>
          <text fg={colors.text}>{count(repo().stars)} stars</text>
          <text fg={colors.text}>{count(repo().forks)} forks</text>
          <text fg={colors.text}>{count(repo().watchers)} watching</text>
          <box height={1} />
          <text fg={colors.muted}>LICENSE</text>
          <text fg={colors.text}>{repo().license}</text>
        </box>
      </box>
    </box>
  )
}
