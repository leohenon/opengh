import { RGBA, rgbToHex, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useKeyActions } from "../keybindings"
import { createMemo, For, Show } from "solid-js"
import { defaultConfig, type DetailLayout } from "../../config"
import type { CommitDetail, CommitSummary } from "../../models"
import type { ResourceState } from "../../repository-state"
import { ResourceStateView } from "../components/resource-state"
import { ago } from "../format"
import { detailContentWidth } from "../detail-layout"
import { useTheme } from "../theme"
import { useIcons } from "../icon-style"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { LinkedText } from "../components/linked-text"
import { normalizeRepositoryUrl } from "../reference-links"

const fileLabels: Record<string, string> = {
  added: "added", removed: "deleted", modified: "modified", renamed: "renamed",
  copied: "copied", changed: "changed", unchanged: "unchanged",
}

export function CommitScreen(props: {
  sha: string
  summary?: CommitSummary
  resource: ResourceState<CommitDetail>
  interactive: boolean
  showScrollbar: boolean
  detailLayout?: DetailLayout
  repositoryUrl?: string
}) {
  const { colors } = useTheme()
  const icons = useIcons()
  const dimensions = useTerminalDimensions()
  const compact = () => dimensions().width < 60
  const centered = () => (props.detailLayout ?? defaultConfig.detailLayout) === "centered"
  const contentWidth = () => detailContentWidth(props.detailLayout)
  // The list row seeds the header so it fills in rather than swapping a placeholder title.
  const header = () => props.resource.value ?? props.summary
  const committer = () => props.resource.value?.committer
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
  const repositoryUrl = createMemo(() => normalizeRepositoryUrl(props.repositoryUrl))
  const fileTarget = (path: string) => repositoryUrl()
    ? `${repositoryUrl()}/blob/${encodeURIComponent(props.sha)}/${path.split("/").map(encodeURIComponent).join("/")}`
    : undefined
  const changeWidth = createMemo(() => (props.resource.value?.files.items ?? [])
    .reduce((width, file) => Math.max(width, String(file.additions).length, String(file.deletions).length), 1) + 1)
  let scroll: ScrollBoxRenderable | undefined
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)

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

  const fileColor = (status: string) => status === "added" ? colors.green
    : status === "removed" ? colors.red
    : status === "renamed" || status === "copied" ? colors.blue : colors.muted

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" backgroundColor={colors.canvas} paddingX={2}>
      <scrollbox
        focusable={false}
        onMouseScroll={(event) => event.stopPropagation()}
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
            <LinkedText text={header()?.message ?? `Commit ${props.sha.slice(0, 7)}`} repositoryUrl={props.repositoryUrl} />
          </text>
          <Show when={header()}>
            {(commit) => (
              <>
                <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>
                  {icons().user} <b><span style={{ fg: colors.text }}>{commit().author}</span></b> authored {ago(commit().date)} · <Show when={repositoryUrl()} fallback={props.sha.slice(0, 7)}>{(url) => <a href={`${url()}/commit/${props.sha}`}>{props.sha.slice(0, 7)}</a>}</Show>
                </text>
                <Show when={committer() && (committer()!.name !== commit().author || committer()!.date !== commit().date)}>
                  <text width="100%" flexShrink={0} fg={colors.muted}>
                    {icons().user} Committer <b><span style={{ fg: colors.text }}>{committer()?.name}</span></b>
                    <Show when={ago(committer()!.date) !== ago(commit().date)}> · {ago(committer()!.date)}</Show>
                  </text>
                </Show>
              </>
            )}
          </Show>
        </box>
        <ResourceStateView resource={props.resource} hideError>
          {(commit) => (
            <box width="100%" maxWidth={contentWidth()} minWidth={0} flexShrink={0} flexDirection="column">
              <Show when={body()}>
                <box width="100%" minWidth={0} flexShrink={0} backgroundColor={surface()} paddingX={2} paddingY={1}>
                  <text width="100%" flexShrink={0} fg={colors.text}><LinkedText text={body()} repositoryUrl={props.repositoryUrl} /></text>
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
                          <Show when={file.status !== "removed" && fileTarget(file.path)} fallback={file.previousPath ? (compact() ? `→ ${file.path}` : `${file.previousPath} → ${file.path}`) : file.path}>
                            {(href) => <a href={href()}>{file.previousPath ? (compact() ? `→ ${file.path}` : `${file.previousPath} → ${file.path}`) : file.path}</a>}
                          </Show>
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
