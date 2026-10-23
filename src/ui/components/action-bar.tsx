import { For } from "solid-js"
import { Action } from "./action"

export type ActionItem = { id?: string; label: string; run: () => void; disabled?: boolean }

export function ActionBar(props: { id?: string; actions: readonly ActionItem[]; disabled?: boolean }) {
  return (
    <box id={props.id ?? "page-actions"} flexDirection="row" flexWrap="wrap" flexShrink={0} paddingX={2}>
      <For each={props.actions}>{(action) => (
        <box width={Bun.stringWidth(action.label) + 2} height={1} flexShrink={0}>
          <Action id={action.id ?? `page-action-${action.label.toLowerCase().replaceAll(" ", "-")}`} disabled={props.disabled || action.disabled} onActivate={action.run}>{action.label}</Action>
        </box>
      )}</For>
    </box>
  )
}
