import { RGBA, rgbToHex, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { defaultConfig, type DetailLayout } from "../../config"
import type { CommitDetail } from "../../models"
import type { ResourceState } from "../../repository-state"
import { ResourceStateView } from "../components/resource-state"
import { ago } from "../format"
import { detailContentWidth } from "../detail-layout"
import { useTheme } from "../theme"
import { createScrollbarVisibility } from "../scrollbar-visibility"

const fileLabels: Record<string, string> = {
  added: "added", removed: "deleted", modified: "modified", renamed: "renamed",
  copied: "copied", changed: "changed", unchanged: "unchanged",
}

export function CommitScreen(props: {
  sha: string
  resource: ResourceState<CommitDetail>
  interactive: boolean
  showScrollbar: boolean
  detailLayout?: DetailLayout
}) {
  const { colors } = useTheme()
  const dimensions = useTerminalDimensions()
  const compact = () => dimensions().width < 60
  const centered = () => (props.detailLayout ?? defaultConfig.detailLayout) === "centered"
  const contentWidth = () => detailContentWidth(props.detailLayout)
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
  const body = createMemo(() => {
    const message = props.resource.value?.fullMessage ?? ""
    const newline = message.indexOf("\n")
    return newline < 0 ? "" : message.slice(newline + 1).trim()
  })
  const changeWidth = createMemo(() => (props.resource.value?.files.items ?? [])
    .reduce((width, file) => Math.max(width, String(file.additions).length, String(file.deletions).length), 1) + 1)
  let scroll: ScrollBoxRenderable | undefined
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)

  useKeyboard((event) => {
    if (!props.interactive || !scroll || event.ctrl || event.meta) return
    if (event.name === "up" || event.name === "k") scroll.scrollBy(-1)
    else if (event.name === "down" || event.name === "j") scroll.scrollBy(1)
    else if (event.name === "u") scroll.scrollBy(-Math.max(1, Math.floor(scroll.viewport.height / 2)))
    else if (event.name === "d") scroll.scrollBy(Math.max(1, Math.floor(scroll.viewport.height / 2)))
    else if (event.name === "G" || (event.name === "g" && event.shift)) scroll.scrollTo(Math.max(0, scroll.scrollHeight - scroll.viewport.height))
    else if (event.name === "g") scroll.scrollTo(0)
  })

  const fileColor = (status: string) => status === "added" ? colors.green
    : status === "removed" ? colors.red
    : status === "renamed" || status === "copied" ? colors.blue : colors.muted

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" backgroundColor={colors.canvas} paddingX={2}>
      <scrollbox
        id="commit-detail-scroll"
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
            {props.resource.value?.message ?? `Commit ${props.sha.slice(0, 7)}`}
          </text>
          <Show when={props.resource.value}>
            {(commit) => (
              <>
                <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>
                   <b><span style={{ fg: colors.text }}>{commit().author}</span></b> committed {ago(commit().date)} · {props.sha.slice(0, 7)}
                </text>
                <Show when={commit().committer && (commit().committer!.name !== commit().author || commit().committer!.date !== commit().date)}>
                  <text width="100%" flexShrink={0} fg={colors.muted}>
                     Committer <b><span style={{ fg: colors.text }}>{commit().committer?.name}</span></b> · {ago(commit().committer!.date)}
                  </text>
                </Show>
              </>
            )}
          </Show>
        </box>
        <ResourceStateView resource={props.resource}>
          {(commit) => (
            <box width="100%" maxWidth={contentWidth()} minWidth={0} flexShrink={0} flexDirection="column">
              <Show when={body()}>
                <box width="100%" minWidth={0} flexShrink={0} backgroundColor={surface()} paddingX={2} paddingY={1}>
                  <text width="100%" flexShrink={0} fg={colors.text}>{body()}</text>
                </box>
              </Show>
              <text width="100%" flexShrink={0} marginTop={body() ? 1 : 0} fg={colors.muted}>
                <b><span style={{ fg: colors.text }}>Files changed</span></b> · {commit().files.items.length} {commit().files.items.length === 1 ? "file" : "files"}{commit().files.hasMore ? " loaded" : commit().filesTruncated ? " shown" : ""}
                {" · "}<span style={{ fg: colors.green }}>+{commit().additions}</span>{" "}<span style={{ fg: colors.red }}>−{commit().deletions}</span>
              </text>
              <box width="100%" minWidth={0} flexShrink={0} marginTop={1} flexDirection="column">
                <For each={commit().files.items} fallback={<text fg={colors.muted}>No changed files.</text>}>
                  {(file) => (
                    <box width="100%" minWidth={0} flexShrink={0} minHeight={1} flexDirection="row" alignItems="flex-start">
                      <text width={compact() ? 2 : 10} flexShrink={0} fg={fileColor(file.status)}>
                        {compact() ? (fileLabels[file.status] ?? file.status).slice(0, 1).toUpperCase() : fileLabels[file.status] ?? file.status}
                      </text>
                      <box flexGrow={1} flexBasis={0} minWidth={0} paddingRight={1} flexDirection="column">
                        <Show when={compact() && file.previousPath}>
                          <text width="100%" flexShrink={0} wrapMode="char" fg={colors.muted}>{file.previousPath}</text>
                        </Show>
                        <text width="100%" flexShrink={0} wrapMode="char" fg={colors.text}>
                          {file.previousPath ? (compact() ? `→ ${file.path}` : `${file.previousPath} → ${file.path}`) : file.path}
                        </text>
                      </box>
                      <box flexShrink={0} flexDirection="row" gap={1}>
                        <text width={changeWidth()} height={1} fg={colors.green}>{(file.additions ? `+${file.additions}` : "").padStart(changeWidth())}</text>
                        <text width={changeWidth()} height={1} fg={colors.red}>{(file.deletions ? `−${file.deletions}` : "").padStart(changeWidth())}</text>
                      </box>
                    </box>
                  )}
                </For>
              </box>
              <Show when={props.resource.status === "error"}>
                <text width="100%" flexShrink={0} marginTop={1} fg={colors.red}>
                  × {props.resource.status === "error" ? props.resource.message : ""}
                </text>
              </Show>
              <Show when={commit().filesTruncated}>
                <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>GitHub's 3,000-file limit reached.</text>
              </Show>
            </box>
          )}
        </ResourceStateView>
      </scrollbox>
    </box>
  )
}
