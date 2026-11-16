import { createSignal, onCleanup } from "solid-js"
import { useKeyActions } from "../keybindings"
import { useStatusPrompt } from "../status-prompt"

export function WorkFindPrompt(props: {
  kind: "issues" | "pulls"
  query: string
  disabled: boolean
  onApply(query: string): void
  onClose(): void
}) {
  const statusPrompt = useStatusPrompt()
  const [draft, setDraft] = createSignal(props.query)
  if (statusPrompt)
    onCleanup(
      statusPrompt.open({
        id: "work-find-query",
        prefix: "Find:",
        placeholder: props.kind === "issues" ? "label:bug author:@me assignee:@me" : "label:bug review-requested:@me -is:draft",
        value: draft,
        onInput: setDraft,
        detail: () => (props.disabled ? "repository busy" : ""),
      }),
    )
  useKeyActions(
    {
      "dialog.close": () => props.onClose(),
      "input.submit": () => {
        if (!props.disabled) props.onApply(draft().trim())
      },
    },
    { when: () => !!statusPrompt, priority: 200, modal: true },
  )
  return null
}
