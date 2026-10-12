import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, For } from "solid-js"
import type { IssueReference } from "../../models"
import { fitText } from "../format"
import { referenceColor, referenceIcon, referenceState, referencedItems, type IssueLinkReference } from "../issue-references"
import { useTheme } from "../theme"
import { ListLine } from "./list-line"
import { Popup } from "./popup"
import { SelectableList } from "./selectable-list"

export function IssueReferencesPicker(props: {
  references: readonly IssueReference[]
  currentIssue: { repository: string; number: number }
  showScrollbar: boolean
  onOpen: (reference: IssueLinkReference) => void
  onCopy: (reference: IssueLinkReference) => void
}) {
  const { colors } = useTheme()
  const items = createMemo(() => referencedItems(props.references, props.currentIssue))
  const pulls = createMemo(() => items().filter((reference) => reference.kind === "pull"))
  const issues = createMemo(() => items().filter((reference) => reference.kind === "issue"))
  const [tab, setTab] = createSignal<"pull" | "issue">(pulls().length ? "pull" : "issue")

  useKeyboard((event) => {
    if (event.name === "tab" || event.name === "left" || event.name === "right") {
      event.stopPropagation()
      setTab((current) => current === "pull" ? "issue" : "pull")
    }
  })
  return (
    <Popup width={80} height={20} zIndex={200} placement="center">
      <box flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <box height={1} flexShrink={0}>
          <text fg={colors.text} attributes={TextAttributes.BOLD}>References</text>
        </box>
        <box height={1} flexShrink={0} />
        <box height={2} flexShrink={0} flexDirection="row" gap={2}>
          <For each={["pull", "issue"] as const}>
            {(kind) => {
              const active = () => tab() === kind
              const label = () => `${kind === "pull" ? "PRs" : "Issues"} (${kind === "pull" ? pulls().length : issues().length})`
              return (
                <box height={2} flexShrink={0} flexDirection="column">
                  <text fg={active() ? colors.blue : colors.muted} attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}>
                    {kind === "pull" ? "PRs" : "Issues"}
                    <span style={{ fg: colors.muted }}>{` (${kind === "pull" ? pulls().length : issues().length})`}</span>
                  </text>
                  <text height={1} fg={colors.blue}>{active() ? "─".repeat(label().length) : ""}</text>
                </box>
              )
            }}
          </For>
        </box>
        <box height={1} flexShrink={0} />
        <For each={["pull", "issue"] as const}>
          {(kind) => (
            <box visible={tab() === kind} flexGrow={1} minHeight={0}>
              <SelectableList<IssueLinkReference>
                items={kind === "pull" ? pulls() : issues()}
                itemKey={(reference) => `${reference.repository}#${reference.number}`}
                active={tab() === kind}
                empty={kind === "pull" ? "No referenced pull requests" : "No referenced issues"}
                showScrollbar={props.showScrollbar}
                onActivate={props.onOpen}
                onOpenInBrowser={props.onOpen}
                onCopy={props.onCopy}
              >
                {(reference, selected) => (
                  <>
                    <text width={3} flexShrink={0} fg={referenceColor(colors, reference())}>{referenceIcon(reference())}</text>
                    <box height={2} flexGrow={1} flexBasis={0} minWidth={0}>
                      <ListLine fg={colors.text} attributes={selected() ? TextAttributes.BOLD : TextAttributes.NONE}>
                        {(width) => fitText(`#${reference().number} ${reference().title}`, width)}
                      </ListLine>
                      <ListLine fg={colors.muted}>
                        {(width) => fitText(`${reference().repository} · ${referenceState(reference())}`, width)}
                      </ListLine>
                    </box>
                  </>
                )}
              </SelectableList>
            </box>
          )}
        </For>
      </box>
    </Popup>
  )
}
