import { TextAttributes } from "@opentui/core"
import { useKeyActions } from "../keybindings"
import { createMemo, createSignal, For } from "solid-js"
import type { IssueReference } from "../../models"
import { fitText } from "../format"
import { referenceColor, referenceIcon, referenceState, referenceKey, referenceIdentifier, referencedItems, type IssueLinkReference } from "../issue-references"
import { useTheme } from "../theme"
import { useIcons } from "../icon-style"
import { ListLine } from "./list-line"
import { Popup } from "./popup"
import { SelectableList } from "./selectable-list"
import { mouseClick } from "../mouse"

export function IssueReferencesPicker(props: {
  references: readonly IssueReference[]
  currentIssue?: { repository: string; number: number }
  showScrollbar: boolean
  onOpen: (reference: IssueLinkReference) => void
  onCopy: (reference: IssueLinkReference) => void
  onClose: () => void
}) {
  const { colors } = useTheme()
  const icons = useIcons()
  const items = createMemo(() => referencedItems(props.references, props.currentIssue))
  const pulls = createMemo(() => items().filter((reference) => reference.kind === "pull"))
  const issues = createMemo(() => items().filter((reference) => reference.kind === "issue"))
  const commits = createMemo(() => items().filter((reference) => reference.kind === "commit"))
  const kinds = ["pull", "issue", "commit"] as const
  const forKind = (kind: typeof kinds[number]) => kind === "pull" ? pulls() : kind === "issue" ? issues() : commits()
  const label = (kind: typeof kinds[number]) => kind === "pull" ? "PRs" : kind === "issue" ? "Issues" : "Commits"
  const [tab, setTab] = createSignal<typeof kinds[number]>(kinds.find((kind) => forKind(kind).length) ?? "pull")

  useKeyActions({
    "references.switchTab": (event) => {
      const direction = event.shift || event.name === "left" || event.name === "h" ? -1 : 1
      setTab((current) => kinds[(kinds.indexOf(current) + direction + kinds.length) % kinds.length]!)
    },
  }, { priority: 100 })
  return (
    <Popup width={80} height={20} zIndex={200} placement="center" onClose={props.onClose}>
      <box flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <box height={1} flexShrink={0}>
          <text fg={colors.text} attributes={TextAttributes.BOLD}>References</text>
        </box>
        <box height={1} flexShrink={0} />
        <box height={2} flexShrink={0} flexDirection="row" gap={2}>
          <For each={kinds}>
            {(kind) => {
              const active = () => tab() === kind
              const tabLabel = () => `${label(kind)} (${forKind(kind).length})`
              return (
                <box id={`references-tab-${kind}`} height={2} flexShrink={0} flexDirection="column" {...mouseClick(() => setTab(kind))}>
                  <text selectable={false} fg={active() ? colors.blue : colors.muted} attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}>
                    {label(kind)}
                    <span style={{ fg: colors.muted }}>{` (${forKind(kind).length})`}</span>
                  </text>
                  <text height={1} selectable={false} fg={colors.blue}>{active() ? "─".repeat(tabLabel().length) : ""}</text>
                </box>
              )
            }}
          </For>
        </box>
        <box height={1} flexShrink={0} />
        <For each={kinds}>
          {(kind) => (
            <box visible={tab() === kind} flexGrow={1} minHeight={0}>
              <SelectableList<IssueLinkReference>
                items={forKind(kind)}
                itemKey={referenceKey}
                active={tab() === kind}
                empty={`No referenced ${kind === "pull" ? "pull requests" : kind === "issue" ? "issues" : "commits"}`}
                showScrollbar={props.showScrollbar}
                backgroundColor={colors.panel}
                onActivate={props.onOpen}
                onOpenInBrowser={props.onOpen}
                onCopy={props.onCopy}
              >
                {(reference, selected) => (
                  <>
                    <text width={3} flexShrink={0} fg={referenceColor(colors, reference())}>{referenceIcon(reference(), icons())}</text>
                    <box height={2} flexGrow={1} flexBasis={0} minWidth={0}>
                      <ListLine fg={colors.text} attributes={selected() ? TextAttributes.BOLD : TextAttributes.NONE}>
                        {(width) => fitText(`${referenceIdentifier(reference())} ${reference().title}`, width)}
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
