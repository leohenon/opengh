import { TextAttributes } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createSignal, Index, Show } from "solid-js"
import { normalizeRepository } from "../repository-name"
import { parseGitHubLink, type LaunchLocation } from "../launch-target"
import { LoadingLabel, LoadingText } from "./components/loading-text"
import { Popup, popupWidth } from "./components/popup"
import { wrappedRows } from "./format"
import { Action } from "./components/action"
import { SearchablePicker } from "./components/searchable-picker"
import { useKeyActions, useKeybindings } from "./keybindings"
import { mouseClick, mouseHover } from "./mouse"
import { StatusBar } from "./components/status-bar"
import { useTheme } from "./theme"

// One screen covers every startup stage; only the message changes, so the dots never remount.
export function LoadingScreen(props: { message: string; immediate?: boolean; onSwitchRepository?: () => void }) {
  const dimensions = useTerminalDimensions()
  const { colors } = useTheme()
  useKeyActions({
    "global.switchRepository": () => {
      if (!props.onSwitchRepository) return false
      props.onSwitchRepository()
    },
  })
  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={colors.canvas}
      alignItems="center"
      justifyContent="center"
    >
      <Show when={props.immediate} fallback={<LoadingText text={props.message} />}>
        <LoadingLabel text={props.message} />
      </Show>
    </box>
  )
}

export function RepositoryLoadError(props: {
  title?: string
  repository: string
  message: string
  onRetry: () => void
  onSwitchRepository?: () => void
  onQuit?: () => void
  showStatusBarHints?: boolean
}) {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const { colors } = useTheme()
  const quit = () => (props.onQuit ? props.onQuit() : renderer.destroy())

  const keys = useKeybindings()
  useKeyActions({
    "view.refresh": () => props.onRetry(),
    "global.switchRepository": () => {
      if (!props.onSwitchRepository) return false
      props.onSwitchRepository()
    },
    "global.quit": quit,
  })

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={colors.canvas}>
      <Popup
        width={64}
        height={
          7 +
          wrappedRows(props.repository, popupWidth(dimensions().width, 64) - 8) +
          wrappedRows(props.message, popupWidth(dimensions().width, 64) - 8)
        }
        placement="center"
        onClose={props.onSwitchRepository}
      >
        <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={4} paddingRight={4} paddingBottom={1} gap={1}>
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            {props.title ?? "Repository unavailable"}
          </text>
          <text fg={colors.text}>{props.repository}</text>
          <text flexGrow={1} minHeight={0} fg={colors.red} wrapMode="word">
            {props.message}
          </text>
          <box height={1} flexShrink={0} flexDirection="row">
            <Action id="repository-retry" onActivate={props.onRetry}>
              Retry
            </Action>
          </box>
        </box>
      </Popup>
      <Show when={props.showStatusBarHints}>
        <box position="absolute" bottom={0} width="100%" zIndex={101}>
          <StatusBar
            hint={keys.hints(
              ["view.refresh", "retry"],
              ...(props.onSwitchRepository ? [["global.switchRepository", "switch repository"] as const] : []),
              ["global.quit", "quit"],
            )}
          />
        </box>
      </Show>
    </box>
  )
}

export function UnsupportedPage(props: {
  title: string
  url: string
  destination: string
  onOpenGitHub: () => Promise<void>
  onContinue: () => void
  onSwitchRepository?: () => void
  onQuit?: () => void
  showStatusBarHints?: boolean
}) {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const { colors } = useTheme()
  const keys = useKeybindings()
  const quit = () => (props.onQuit ? props.onQuit() : renderer.destroy())
  const [browser, setBrowser] = createSignal<{ status: "idle" | "opening" | "opened" } | { status: "error"; message: string }>({
    status: "idle",
  })
  const openGitHub = () => {
    if (browser().status === "opening") return
    setBrowser({ status: "opening" })
    props.onOpenGitHub().then(
      () => setBrowser({ status: "opened" }),
      (error) => setBrowser({ status: "error", message: error instanceof Error ? error.message : String(error) }),
    )
  }
  const choices = () => [
    { id: "continue", label: props.destination, run: () => props.onContinue() },
    { id: "github", label: "Open on GitHub", run: openGitHub },
  ]
  const [selected, setSelected] = createSignal(0)
  const move = (delta: number) => setSelected((index) => Math.max(0, Math.min(choices().length - 1, index + delta)))
  const activate = (index = selected()) => {
    setSelected(index)
    choices()[index]?.run()
  }
  useKeyActions({
    "navigation.up": () => move(-1),
    "navigation.down": () => move(1),
    "navigation.activate": () => activate(),
    "navigation.back": () => props.onContinue(),
    "global.switchRepository": () => {
      if (!props.onSwitchRepository) return false
      props.onSwitchRepository()
    },
    "global.quit": quit,
  })
  const link = () => {
    try {
      const url = new URL(props.url)
      return url.host + url.pathname + url.hash
    } catch {
      return props.url
    }
  }
  const status = () => {
    const current = browser()
    if (current.status === "opened") return { text: "Opened in your browser.", color: colors.green }
    if (current.status === "error") return { text: current.message, color: colors.red }
    return undefined
  }

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={colors.canvas}>
      <Popup width={64} height={status() ? 10 : 8} placement="center" onClose={props.onContinue}>
        <box flexGrow={1} minHeight={0} paddingX={2} paddingBottom={1} flexDirection="column">
          <text height={1} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
            {props.title}
          </text>
          <text height={1} flexShrink={0} fg={colors.muted} wrapMode="none" truncate>
            {link()}
          </text>
          <box height={1} flexShrink={0} />
          <Index each={choices()}>
            {(choice, index) => {
              const hover = mouseHover(
                () => true,
                () => choice().id,
              )
              return (
                <box
                  id={`unsupported-${choice().id}`}
                  height={1}
                  flexShrink={0}
                  backgroundColor={selected() === index || hover.hovered() ? colors.panelHover : colors.panel}
                  {...mouseClick(
                    () => activate(index),
                    () => true,
                    () => choice().id,
                    hover,
                  )}
                >
                  <text
                    selectable={false}
                    fg={selected() === index || hover.hovered() ? colors.blue : colors.text}
                    attributes={hover.hovered() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {selected() === index ? "› " : "  "}
                    {choice().label}
                  </text>
                </box>
              )
            }}
          </Index>
          <Show when={status()}>
            {(current) => (
              <text marginTop={1} height={1} flexShrink={0} fg={current().color} wrapMode="none" truncate>
                {current().text}
              </text>
            )}
          </Show>
        </box>
      </Popup>
      <Show when={props.showStatusBarHints}>
        <box position="absolute" bottom={0} width="100%" zIndex={101}>
          <StatusBar
            hint={keys.hints(
              ["navigation.activate", "select"],
              ...(props.onSwitchRepository ? [["global.switchRepository", "switch repository"] as const] : []),
              ["global.quit", "quit"],
            )}
          />
        </box>
      </Show>
    </box>
  )
}

export function destinationLabel(location: LaunchLocation): string {
  const detail = location.initialDetail
  if (detail?.kind === "number") return `Open #${detail.number}`
  if (detail?.kind === "issue") return `Open issue #${detail.number}`
  if (detail?.kind === "pull") return `Open PR #${detail.number}`
  if (detail?.kind === "commit") return `Open commit ${detail.sha.slice(0, 7)}`
  if (detail?.kind === "run") return `Open run #${detail.id}`
  const pages = { overview: "the repository", issues: "Issues", pulls: "Pull requests", commits: "Commits", actions: "Actions" }
  return `Open ${pages[location.initialPage ?? "overview"]}`
}

export function pastedLink(value: string): { location: LaunchLocation } | { error: string } | undefined {
  try {
    const location = parseGitHubLink(value)
    return location ? { location } : undefined
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function RepositoryPicker(props: {
  recent: string[]
  error?: string
  onOpen: (repository: string) => void
  onOpenLink?: (location: LaunchLocation) => void
  onQuit?: () => void
}) {
  const renderer = useRenderer()
  const { colors } = useTheme()
  const quit = () => (props.onQuit ? props.onQuit() : renderer.destroy())
  const [error, setError] = createSignal(props.error ?? "")
  const dimensions = useTerminalDimensions()
  const recent = () => props.recent

  const open = (candidate: string) => {
    const repository = normalizeRepository(candidate)
    const link = repository ? undefined : pastedLink(candidate)
    if (link && "error" in link) return setError(link.error)
    if (link && props.onOpenLink) {
      setError("")
      return props.onOpenLink(link.location)
    }
    const target = repository ?? link?.location.repositoryArgument
    if (!target) return setError("Enter owner/repository or a GitHub URL")
    setError("")
    props.onOpen(target)
  }

  const errorLines = () => (error() ? 1 + Math.ceil((error().length + 2) / Math.max(1, Math.min(80, dimensions().width - 2) - 8)) : 0)
  const height = () => 7 + Math.min(20, recent().length) + errorLines()

  return (
    <SearchablePicker
      title="Open a GitHub repository"
      placeholder={
        dimensions().width < 70 ? "Search, owner/repository or URL" : "Search recent repositories, owner/repository or GitHub URL"
      }
      items={recent()}
      itemKey={(repository) => repository}
      match={(repository, query) => {
        if (!query) return 0
        const index = repository.toLowerCase().indexOf(query.toLowerCase())
        return index < 0 ? undefined : index
      }}
      height={height()}
      width={80}
      placement="center"
      listTitle={recent().length ? "Recent repositories" : undefined}
      empty={recent().length ? "No matching repositories" : undefined}
      error={error()}
      onQueryChange={() => setError("")}
      onSelect={open}
      onSubmit={(query, selected) => open(normalizeRepository(query) ?? selected ?? query)}
      onClose={quit}
    >
      {(repository) => {
        const [owner, ...nameParts] = repository.split("/")
        return (
          <box flexGrow={1} flexBasis={0} flexShrink={1} minWidth={0} flexDirection="row" overflow="hidden">
            <text flexShrink={0} maxWidth="50%" marginRight={1} wrapMode="none" truncate fg={colors.muted}>
              {owner} /
            </text>
            <text height={1} flexShrink={1} minWidth={0} wrapMode="none" truncate fg={colors.blue} attributes={TextAttributes.BOLD}>
              {nameParts.join("/")}
            </text>
          </box>
        )
      }}
    </SearchablePicker>
  )
}
