import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Index, onCleanup, Show } from "solid-js"
import type { Paginated } from "../../models"
import type { IssueActionState, ResourceState } from "../../repository-state"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { useTheme } from "../theme"
import { Popup } from "./popup"

export function IssueAssigneesPicker(props: {
  number: number
  state: IssueActionState
  users?: ResourceState<Paginated<string>>
  showScrollbar?: boolean
  onChange(logins: string[]): void
  onLoadMore(): void
  onSubmit(): void
  onHintChange(hint: string | undefined): void
  onClose(): void
}) {
  const { colors } = useTheme()
  const dimensions = useTerminalDimensions()
  const [selectionError, setSelectionError] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(0)
  const [listReady, setListReady] = createSignal(false)
  // Keep initial assignees available even after deselecting users missing from the API.
  const initial = [...(props.state.selectedAssignees ?? [])]
  const selected = () => props.state.selectedAssignees ?? []
  const pending = () => props.state.operation.status === "loading"
  const loading = () => props.users?.status === "loading"
  const canLoad = () => !props.users || props.users.status === "error" || props.users.value?.hasMore === true
  const candidates = createMemo(() => {
    const seen = new Set<string>()
    return [...initial, ...(props.users?.value?.items ?? []), ...selected()].filter((login) => {
      const key = login.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })
  const filtered = createMemo(() => {
    const needle = query().trim().replace(/^@/, "").toLowerCase()
    return candidates().filter((login) => login.toLowerCase().includes(needle))
  })
  const isSelected = (login: string) => selected().some((value) => value.toLowerCase() === login.toLowerCase())
  const toggle = (login: string) => {
    if (pending()) return
    if (!isSelected(login) && selected().length >= 10) {
      setSelectionError("Maximum 10 assignees. Remove one to select another.")
      return
    }
    setSelectionError(undefined)
    props.onChange(isSelected(login) ? selected().filter((value) => value.toLowerCase() !== login.toLowerCase()) : [...selected(), login])
  }
  const rowCount = () => filtered().length + (canLoad() || loading() ? 1 : 0)
  const currentRow = () => Math.min(active(), Math.max(0, rowCount() - 1))
  const loadMore = () => { if (!pending() && !loading() && canLoad()) props.onLoadMore() }
  const activate = () => {
    const login = filtered()[currentRow()]
    if (login) toggle(login)
    else loadMore()
  }
  let list: ScrollBoxRenderable | undefined
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar === true)
  createEffect(() => {
    listReady()
    filtered()
    list?.scrollChildIntoView(`assignee-row-${currentRow()}`)
  })
  createEffect(() => props.onHintChange(pending() ? "Saving assignees…" : "↑/↓ navigate · enter toggle · ctrl+s save · esc cancel"))
  onCleanup(() => props.onHintChange(undefined))
  usePaste((event) => {
    if (pending()) { event.preventDefault(); event.stopPropagation() }
  })
  useKeyboard((event) => {
    const consume = () => { event.preventDefault(); event.stopPropagation() }
    if (pending()) { consume(); return }
    if (event.name === "escape" || event.name === "esc") { consume(); props.onClose() }
    else if (event.ctrl && event.name === "s") { consume(); props.onSubmit() }
    else if (event.name === "up" || event.name === "down") {
      consume()
      setActive(Math.max(0, Math.min(rowCount() - 1, currentRow() + (event.name === "up" ? -1 : 1))))
    } else if (event.name === "return" || event.name === "enter") {
      consume()
      activate()
    } else if (event.name === "tab") consume()
  })

  const error = () => [
    selectionError(),
    props.users?.status === "error" ? props.users.message : undefined,
    props.state.operation.status === "error" ? props.state.operation.message : undefined,
  ].filter(Boolean).join("\n")
  const errorHeight = () => {
    if (!error()) return 0
    const width = Math.max(1, Math.min(44, dimensions().width - 2) - 8)
    return Math.min(6, error().split("\n").reduce((rows, line) => rows + Math.ceil(Bun.stringWidth(line) / width) + 1, 0))
  }
  const popupHeight = () => Math.min(16, Math.max(1, rowCount() + (!filtered().length && !loading() ? 1 : 0)) + 6 + errorHeight())

  return (
    <Popup width={44} height={popupHeight()} placement="center" zIndex={250}>
      <box flexGrow={1} minHeight={0} flexDirection="column" paddingBottom={1}>
        <box flexShrink={0} paddingX={4} flexDirection="column">
          <text height={1} fg={colors.text} attributes={TextAttributes.BOLD}>Assignees · #{props.number}</text>
          <box height={2} flexShrink={0} paddingTop={1}>
            <input flexGrow={1} minWidth={0} focused={!pending()} value={query()}
              placeholderColor={colors.muted} textColor={colors.text} focusedTextColor={colors.text} cursorColor={colors.blue}
              focusedBackgroundColor={colors.panel}
              onInput={(value) => { if (!pending()) { setQuery(value); setActive(0) } }} />
          </box>
        </box>
        <box height={1} flexShrink={0} />
        <scrollbox ref={(value) => { list = value; bindScrollbar(value); setListReady(true) }}
          flexGrow={1} minHeight={0} paddingX={1} scrollY>
          <Show when={!filtered().length && !loading()}>
            <text height={1} paddingLeft={3} fg={colors.muted}>No matching users.</text>
          </Show>
          <Index each={filtered()}>{(login, index) => (
            <box id={`assignee-row-${index}`} height={1} flexShrink={0} flexDirection="row" paddingX={3}
              backgroundColor={currentRow() === index ? colors.panelHover : colors.panel}
              onMouseDown={(event) => { event.preventDefault(); if (event.button === 0 && !pending()) { setActive(index); toggle(login()) } }}>
              <text width={2} flexShrink={0} fg={colors.blue}>{currentRow() === index ? "›" : " "}</text>
              <text height={1} wrapMode="none" flexGrow={1} fg={colors.muted}>
                [{isSelected(login()) ? "x" : " "}] <span style={{ fg: colors.blue }}>@{login()}</span>
              </text>
            </box>
          )}</Index>
          <Show when={canLoad() || loading()}>
            <box id={`assignee-row-${filtered().length}`} height={1} flexShrink={0} flexDirection="row" paddingX={3}
              backgroundColor={currentRow() === filtered().length ? colors.panelHover : colors.panel}
              onMouseDown={(event) => { event.preventDefault(); if (event.button === 0) loadMore() }}>
              <text fg={colors.blue}>{currentRow() === filtered().length ? "› " : "  "}{loading() ? "Loading users…" : props.users?.status === "error" ? "Retry loading users" : "Load more users…"}</text>
            </box>
          </Show>
        </scrollbox>
        <Show when={error()}>
          <scrollbox height={errorHeight()} flexShrink={0} paddingX={4} scrollY>
            <text width="100%" wrapMode="word" fg={colors.red}>{error()}</text>
          </scrollbox>
        </Show>
      </box>
    </Popup>
  )
}
