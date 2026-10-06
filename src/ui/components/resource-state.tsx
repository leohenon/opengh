import { Show, type Accessor, type JSX } from "solid-js"
import type { ResourceState } from "../../repository-state"
import { colors } from "../theme"

export function ResourceStateView<T>(props: {
  resource: ResourceState<T>
  loading?: string
  children: (value: Accessor<T>) => JSX.Element
}) {
  return (
    <Show
      when={props.resource.value}
      fallback={(
        <box flexGrow={1} minHeight={0} alignItems="center" justifyContent="center">
          <text fg={props.resource.status === "error" ? colors.red : colors.muted}>
            {props.resource.status === "error"
              ? `× ${props.resource.message} · press r to retry`
              : `◌ ${props.loading ?? "Loading…"}`}
          </text>
        </box>
      )}
    >
      {(value) => props.children(value)}
    </Show>
  )
}
