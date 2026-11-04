import { For, Show, type JSX } from "solid-js"
import { useTheme } from "../theme"

export function MetadataField(props: { label: string; compact: boolean; muted?: boolean; children: JSX.Element }) {
  const { colors } = useTheme()
  return (
    <box width="100%" minWidth={0} flexShrink={0} marginTop={props.compact ? 0 : 1}>
      <Show when={props.compact} fallback={(
        <>
          <text width="100%" flexShrink={0} fg={colors.muted}>{props.label}</text>
          <text width="100%" flexShrink={0} fg={props.muted ? colors.muted : colors.text}>{props.children}</text>
        </>
      )}>
        <text width="100%" flexShrink={0} fg={colors.muted}>{props.label} <span style={{ fg: props.muted ? colors.muted : colors.text }}>{props.children}</span></text>
      </Show>
    </box>
  )
}

export function MetadataSummary(props: { labels: readonly string[]; assignees: readonly string[]; repositoryUrl?: string; kind?: "issue" | "pull" }) {
  const { colors } = useTheme()
  return (
    <Show when={props.labels.length || props.assignees.length}>
      <text width="100%" flexShrink={0} fg={colors.muted}>
        <Show when={props.labels.length}>Labels <span style={{ fg: colors.text }}>
          <For each={props.labels}>{(label, index) => <>{index() > 0 ? " · " : ""}<Show when={props.repositoryUrl} fallback={label}>{(url) => <a href={`${url()}/${props.kind === "pull" ? "pulls" : "issues"}?q=${encodeURIComponent(`is:${props.kind === "pull" ? "pr" : "issue"} label:"${label}"`)}`}>{label}</a>}</Show></>}</For>
        </span></Show>
        <Show when={props.labels.length && props.assignees.length}>{" · "}</Show>
        <Show when={props.assignees.length}>Assignees <span style={{ fg: colors.text }}>
          <For each={props.assignees}>{(login, index) => <>{index() > 0 ? ", " : ""}<a href={`https://github.com/${login}`}>{login}</a></>}</For>
        </span></Show>
      </text>
    </Show>
  )
}
