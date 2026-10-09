import { Show, type Accessor, type JSX } from "solid-js"
import type { ResourceState } from "../../repository-state"
import { colors } from "../theme"
import { LoadingText } from "./loading-text"

export function ResourceStateView<T>(props: {
  resource: ResourceState<T>
  children: (value: Accessor<T>) => JSX.Element
}) {
  return (
    <Show
      when={props.resource.value}
      fallback={(
        <box flexGrow={1} minHeight={0} alignItems="center" justifyContent="center">
          <Show
            when={props.resource.status === "error"}
            fallback={<LoadingText text="Loading…" />}
          >
            <text fg={colors.red}>
              × {props.resource.status === "error" ? props.resource.message : "Could not load"} · press r to retry
            </text>
          </Show>
        </box>
      )}
    >
      {(value) => props.children(value)}
    </Show>
  )
}
