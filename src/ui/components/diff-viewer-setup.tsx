import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, onCleanup } from "solid-js"
import { configPath } from "../../config"
import { useKeyActions, useKeybindings } from "../keybindings"
import { useTheme } from "../theme"
import { createReactiveMarkdownStyle } from "../markdown-style"
import { GitHubMarkdown } from "./github-markdown"
import { Popup } from "./popup"

const viewerConfig = '{\n  "diffViewerCommand": ["less", "{patch}"]\n}'

export function DiffViewerSetupDialog(props: { showScrollbar: boolean; onClose(): void; onHintChange(hint: string | undefined): void }) {
  const { colors, theme } = useTheme()
  const markdownStyle = createReactiveMarkdownStyle(colors, theme)
  const keys = useKeybindings()
  const body = () =>
    [
      "Replace `less` with your viewer's executable and arguments.",
      "",
      "Keep `{patch}`; it is a temporary patch file, not a checkout.",
      "",
      `After editing config, press \`${keys.key("global.reloadConfig")}\` to reload.`,
    ].join("\n")
  let scroll: ScrollBoxRenderable | undefined
  const hint = () => keys.hints(["dialog.close", "back"])
  createEffect(() => props.onHintChange(hint()))
  onCleanup(() => props.onHintChange(undefined))
  useKeyActions(
    {
      "dialog.close": props.onClose,
      "navigation.up": () => scroll?.scrollBy(-1),
      "navigation.down": () => scroll?.scrollBy(1),
      "navigation.pageUp": () => scroll?.scrollBy(-scroll.viewport.height),
      "navigation.pageDown": () => scroll?.scrollBy(scroll.viewport.height),
    },
    { priority: 180, modal: true },
  )

  return (
    <Popup width={76} height={18} placement="center" zIndex={300} onClose={props.onClose}>
      <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>
          Set up an external diff viewer
        </text>
        <scrollbox
          id="diff-viewer-setup-body"
          ref={(value) => {
            scroll = value
          }}
          flexGrow={1}
          minHeight={0}
          marginTop={1}
          scrollY
          scrollX={false}
          focusable={false}
          scrollbarOptions={{ visible: props.showScrollbar }}
        >
          <GitHubMarkdown content={`Add to \`${configPath()}\`:`} syntaxStyle={markdownStyle()} backgroundColor={colors.panel} wide />
          <box
            flexDirection="column"
            flexShrink={0}
            marginTop={1}
            marginBottom={1}
            paddingX={1}
            paddingY={1}
            backgroundColor={colors.canvas}
          >
            <GitHubMarkdown
              content={`\`\`\`json\n${viewerConfig}\n\`\`\``}
              syntaxStyle={markdownStyle()}
              backgroundColor={colors.canvas}
              codePanels={false}
              wide
            />
          </box>
          <GitHubMarkdown content={body()} syntaxStyle={markdownStyle()} backgroundColor={colors.panel} wide />
        </scrollbox>
      </box>
    </Popup>
  )
}
