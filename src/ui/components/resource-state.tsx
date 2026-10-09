import { Show, type Accessor, type JSX } from "solid-js"
import type { ResourceState } from "../../repository-state"
import { useTheme } from "../theme"
import { LoadingText } from "./loading-text"

export function ResourceStateView<T>(props: {
  resource: ResourceState<T>
  children: (value: Accessor<T>) => JSX.Element
}) {
  const { colors } = useTheme()
  const value = () => props.resource.value === undefined
    ? undefined
    : { current: props.resource.value as T }

  return (
    <Show
      when={value()}
      fallback={(
        <box flexGrow={1} minHeight={0} alignItems="center" justifyContent="center">
          <Show
            when={props.resource.status === "error"}
            fallback={<LoadingText text="Loading…" />}
          >
            <text fg={colors.red}>
              × {props.resource.status === "error" ? props.resource.message : "Load failed"} · r to retry
            </text>
          </Show>
        </box>
      )}
    >
      {(current) => props.children(() => current().current)}
    </Show>
  )
}
