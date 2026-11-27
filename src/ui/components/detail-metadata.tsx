import type { TextRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { For, Show, type JSX } from "solid-js"
import { useTheme } from "../theme"
import { wrapAtWhitespace } from "../whitespace-wrap"

export function MetadataField(props: { label: string; compact: boolean; muted?: boolean; children: JSX.Element }) {
  const { colors } = useTheme()
  const renderer = useRenderer()
  const wrap = (node: TextRenderable) => wrapAtWhitespace(renderer, node, "/-")
  return (
    <box width="100%" minWidth={0} flexShrink={0} marginTop={props.compact ? 0 : 1}>
      <Show
        when={props.compact}
        fallback={
          <>
            <text width="100%" flexShrink={0} fg={colors.muted}>
              {props.label}
            </text>
            <text ref={wrap} width="100%" flexShrink={0} fg={props.muted ? colors.muted : colors.text}>
              {props.children}
            </text>
          </>
        }
      >
        <box width="100%" minWidth={0} flexShrink={0} flexDirection="row">
          <text flexShrink={0} fg={colors.muted}>
            {props.label}{" "}
          </text>
          <text ref={wrap} flexGrow={1} flexBasis={0} minWidth={0} fg={props.muted ? colors.muted : colors.text}>
            {props.children}
          </text>
        </box>
      </Show>
    </box>
  )
}

export function MetadataSummary(props: {
  labels: readonly string[]
  assignees: readonly string[]
  repositoryUrl?: string
  kind?: "issue" | "pull"
}) {
  const { colors } = useTheme()
  const renderer = useRenderer()
  return (
    <Show when={props.labels.length || props.assignees.length}>
      <text ref={(node: TextRenderable) => wrapAtWhitespace(renderer, node, "/-")} width="100%" flexShrink={0} fg={colors.muted}>
        <Show when={props.labels.length}>
          Labels{" "}
          <span style={{ fg: colors.text }}>
            <For each={props.labels}>
              {(label, index) => (
                <>
                  {index() > 0 ? "\u00a0· " : ""}
                  <Show when={props.repositoryUrl} fallback={label}>
                    {(url) => (
                      <a
                        href={`${url()}/${props.kind === "pull" ? "pulls" : "issues"}?q=${encodeURIComponent(`is:${props.kind === "pull" ? "pr" : "issue"} label:"${label}"`)}`}
                      >
                        {label}
                      </a>
                    )}
                  </Show>
                </>
              )}
            </For>
          </span>
        </Show>
        <Show when={props.labels.length && props.assignees.length}>{"\u00a0· "}</Show>
        <Show when={props.assignees.length}>
          Assignees{" "}
          <span style={{ fg: colors.text }}>
            <For each={props.assignees}>
              {(login, index) => (
                <>
                  {index() > 0 ? ", " : ""}
                  <a href={`https://github.com/${login}`}>{login}</a>
                </>
              )}
            </For>
          </span>
        </Show>
      </text>
    </Show>
  )
}
