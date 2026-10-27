import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, Show } from "solid-js"
import { normalizeRepository } from "../../repository-name"
import { StatusBar } from "../components/status-bar"
import { SearchablePicker } from "../components/searchable-picker"
import { useKeybindings } from "../keybindings"
import { useTheme } from "../theme"

export function SwitchRepositoryScreen(props: {
  recent: readonly string[]
  current?: string
  showScrollbar?: boolean
  showStatusBarHints: boolean
  renderStatusBar?: boolean
  onOpen: (repository: string) => void
  onClose: () => void
}) {
  const { colors } = useTheme()
  const keys = useKeybindings()
  const [error, setError] = createSignal("")
  const repositories = createMemo(() => {
    const seen = new Set<string>()
    return [...(props.current ? [props.current] : []), ...props.recent].filter((repository) => {
      const key = repository.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })
  const submit = (query: string, selected?: string) => {
    const repository = normalizeRepository(query) ?? selected
    if (!repository) return setError("Enter owner/repository or a GitHub URL")
    props.onOpen(repository)
  }

  return (
    <>
      <SearchablePicker
        placement="center"
        width={80}
        height={7 + Math.max(1, Math.min(20, repositories().length)) + (error() ? 1 : 0)}
        title="Switch repository"
        placeholder="Search recent repositories, owner/repository or GitHub URL"
        items={repositories()}
        itemKey={(repository) => repository}
        match={(repository, query) => {
          const index = repository.toLowerCase().indexOf(query.toLowerCase())
          return index < 0 ? undefined : index
        }}
        listTitle="Recent repositories"
        empty="No matching repositories — enter owner/repository or a GitHub URL"
        showScrollbar={props.showScrollbar}
        error={error()}
        onQueryChange={() => setError("")}
        onSelect={props.onOpen}
        onSubmit={submit}
        onClose={props.onClose}
      >
        {(repository) => {
          const [owner, ...nameParts] = repository.split("/")
          return (
            <>
              <box flexGrow={1} minWidth={0} flexDirection="row" overflow="hidden">
                <text flexShrink={0} fg={colors.muted}>{owner} / </text>
                <text minWidth={0} flexShrink={1} height={1} wrapMode="none" truncate fg={colors.blue} attributes={TextAttributes.BOLD}>{nameParts.join("/")}</text>
              </box>
              <text width={10} flexShrink={0} fg={colors.green}>{repository.toLowerCase() === props.current?.toLowerCase() ? "✓ current" : ""}</text>
            </>
          )
        }}
      </SearchablePicker>
      <Show when={props.renderStatusBar !== false && props.showStatusBarHints}>
        <box position="absolute" left={0} bottom={0} width="100%" height={1} zIndex={101}>
          <StatusBar hint={keys.hints(["picker.accept", "open"], [["picker.up", "picker.down"], "select"], ["dialog.close", "close"])} />
        </box>
      </Show>
    </>
  )
}
