import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import type { CommitDetail } from "../../models"
import type { ResourceState } from "../../repository-state"
import { PageShell } from "../components/page-shell"
import { ResourceStateView } from "../components/resource-state"
import { useTheme } from "../theme"

function exactDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toISOString().replace("T", " ").replace(".000Z", " UTC")
}

const fileLabels: Record<string, string> = {
  added: "added", removed: "deleted", modified: "modified", renamed: "renamed",
  copied: "copied", changed: "changed", unchanged: "unchanged",
}

export function CommitScreen(props: {
  sha: string
  resource: ResourceState<CommitDetail>
  interactive: boolean
  showScrollbar: boolean
}) {
  const { colors } = useTheme()
  const dimensions = useTerminalDimensions()
  const compact = () => dimensions().width < 60
  const body = createMemo(() => {
    const message = props.resource.value?.fullMessage ?? ""
    const newline = message.indexOf("\n")
    return newline < 0 ? "" : message.slice(newline + 1).trim()
  })
  let scroll: ScrollBoxRenderable | undefined

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
    <PageShell header={(
      <box flexGrow={1} minWidth={0} flexDirection="row" justifyContent="space-between">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>Commit <span style={{ fg: colors.blue }}>{props.sha.slice(0, 7)}</span></text>
      </box>
    )}>
      <ResourceStateView resource={props.resource}>
        {(commit) => (
          <scrollbox
            id="commit-detail-scroll"
            ref={(value) => { scroll = value }}
            flexGrow={1}
            minHeight={0}
            scrollY
            verticalScrollbarOptions={{ visible: props.showScrollbar }}
            contentOptions={{ paddingTop: 1, paddingBottom: 1 }}
          >
            <text width="100%" flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>{commit().message}</text>
            <text width="100%" flexShrink={0} wrapMode="word" fg={colors.muted}>
              Author <span style={{ fg: colors.text }}>{commit().author}</span>
              {compact() ? "\n  " : " · "}{exactDate(commit().date)}
            </text>
            <Show when={commit().committer && (commit().committer!.name !== commit().author || commit().committer!.date !== commit().date)}>
              <text width="100%" flexShrink={0} wrapMode="word" fg={colors.muted}>
                Committer <span style={{ fg: colors.text }}>{commit().committer?.name}</span>
                {compact() ? "\n  " : " · "}{exactDate(commit().committer?.date ?? "")}
              </text>
            </Show>
            <text width="100%" flexShrink={0} wrapMode="char" fg={colors.muted}>SHA {commit().sha}</text>
            <Show when={body()}>
              <text width="100%" flexShrink={0} marginTop={1} fg={colors.text}>{body()}</text>
            </Show>
            <text width="100%" flexShrink={0} marginTop={1} fg={colors.text} attributes={TextAttributes.BOLD}>
              {commit().files.items.length} {commit().files.items.length === 1 ? "file" : "files"}{commit().files.hasMore ? " loaded" : commit().filesTruncated ? " shown" : " changed"}
              {" · "}<span style={{ fg: colors.green }}>+{commit().additions}</span>{" "}<span style={{ fg: colors.red }}>−{commit().deletions}</span>
            </text>
            <For each={commit().files.items} fallback={<text fg={colors.muted}>No changed files.</text>}>
              {(file) => (
                <box width="100%" flexShrink={0} minHeight={1} flexDirection="row" alignItems="flex-start">
                  <text width={compact() ? 2 : 10} flexShrink={0} fg={fileColor(file.status)}>
                    {compact() ? (fileLabels[file.status] ?? file.status).slice(0, 1).toUpperCase() : fileLabels[file.status] ?? file.status}
                  </text>
                  <box minWidth={0} flexDirection="column">
                    <Show when={compact() && file.previousPath}>
                      <text flexShrink={0} wrapMode="char" fg={colors.muted}>{file.previousPath}</text>
                    </Show>
                    <box minWidth={0} flexDirection="row" alignItems="flex-start">
                      <box minWidth={0} paddingRight={1}>
                        <text wrapMode="char" fg={colors.text}>
                          {file.previousPath ? (compact() ? `→ ${file.path}` : `${file.previousPath} → ${file.path}`) : file.path}
                        </text>
                      </box>
                      <text flexShrink={0} fg={colors.green}>+{file.additions}</text>
                      <text flexShrink={0} fg={colors.red}> −{file.deletions}</text>
                    </box>
                  </box>
                </box>
              )}
            </For>
            <Show when={props.resource.status === "error"}>
              <text width="100%" flexShrink={0} marginTop={1} fg={colors.red}>
                × {props.resource.status === "error" ? props.resource.message : ""} · r to retry
              </text>
            </Show>
            <Show when={commit().files.hasMore && props.resource.status !== "loading"}>
              <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>enter load more files</text>
            </Show>
            <Show when={commit().filesTruncated}>
              <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>GitHub's 3,000-file limit reached · o open on GitHub</text>
            </Show>
          </scrollbox>
        )}
      </ResourceStateView>
    </PageShell>
  )
}
