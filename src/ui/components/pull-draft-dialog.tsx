import { TextAttributes } from "@opentui/core"
import { createEffect, onCleanup, Show } from "solid-js"
import { useKeyActions, useKeybindings } from "../keybindings"
import { useTheme } from "../theme"
import { Action } from "./action"
import { Popup } from "./popup"

export function PullDraftDialog(props: {
  number: number
  draft: boolean
  disabled: boolean
  onSubmit(): void
  onClose(): void
  onHintChange(hint: string | undefined): void
}) {
  const { colors } = useTheme()
  const keys = useKeybindings()
  const submit = () => { if (!props.disabled) props.onSubmit() }
  createEffect(() => props.onHintChange(keys.hints(["dialog.confirm", "confirm"], ["dialog.close", "cancel"])))
  onCleanup(() => props.onHintChange(undefined))
  useKeyActions({ "dialog.confirm": submit, "dialog.close": props.onClose }, { priority: 150, modal: true })

  return (
    <Popup width={64} height={(props.draft ? 6 : 8) + (props.disabled ? 2 : 0)} placement="center" zIndex={250} onClose={props.onClose}>
      <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
        <text fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="word">
          Mark PR #{props.number} {props.draft ? "as draft" : "ready for review"}?
        </text>
        <Show when={!props.draft}>
          <text marginTop={1} fg={colors.muted} wrapMode="word">This may request code-owner reviews and trigger automation.</text>
        </Show>
        <Show when={props.disabled}>
          <text marginTop={1} fg={colors.yellow} wrapMode="word">This action is no longer available. Refresh the PR.</text>
        </Show>
        <box flexGrow={1} minHeight={1} />
        <box height={1} flexShrink={0}>
          <Action id="pull-draft-confirm" disabled={props.disabled} onActivate={submit}>Confirm</Action>
        </box>
      </box>
    </Popup>
  )
}
