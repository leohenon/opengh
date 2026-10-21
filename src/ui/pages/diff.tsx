import { BoxRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { HUNK_DIFF_THEME_NAMES, type HunkDiffBodyProps, type HunkDiffThemeName } from "hunkdiff/opentui"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import type { DiffContent, DiffTarget } from "../../models"
import type { ResourceState } from "../../repository-state"
import { SelectableList } from "../components/selectable-list"
import { parseDiff, type DiffFile } from "../diff-model"
import { mountHunk } from "../hunk-host"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { useTheme } from "../theme"

// opengh and Shiki use different IDs for some of the same theme families.
const themeAliases: Partial<Record<string, HunkDiffThemeName>> = {
  ayu: "ayu-dark", catppuccin: "catppuccin-mocha", everforest: "everforest-dark",
  github: "github-dark-default", gruvbox: "gruvbox-dark-medium", kanagawa: "kanagawa-wave",
  material: "material-theme", nightowl: "night-owl", "one-dark": "one-dark-pro",
  opengh: "github-dark-default", palenight: "material-theme-palenight", rosepine: "rose-pine",
  solarized: "solarized-dark", synthwave84: "synthwave-84", tokyonight: "tokyo-night",
}

const lightThemeAliases: Partial<Record<string, HunkDiffThemeName>> = {
  ayu: "ayu-light", catppuccin: "catppuccin-latte",
  "catppuccin-frappe": "catppuccin-latte", "catppuccin-macchiato": "catppuccin-latte",
  everforest: "everforest-light", github: "github-light-default", gruvbox: "gruvbox-light-medium",
  kanagawa: "kanagawa-lotus", material: "material-theme-lighter", nightowl: "night-owl-light",
  "one-dark": "one-light", opengh: "github-light-default", rosepine: "rose-pine-dawn", solarized: "solarized-light",
}

export type DiffFocus = "files" | "diff"

export function DiffScreen(props: {
  target: DiffTarget
  resource: ResourceState<DiffContent>
  interactive: boolean
  active?: boolean
  showScrollbar: boolean
  onLoadFiles: () => void
  onMovePage?: (delta: number) => void
  onFocusChange?: (focus: DiffFocus) => void
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const active = () => props.active !== false
  const { colors, selected: selectedTheme, mode } = useTheme()
  const content = createMemo(() => props.resource.value)
  const parsed = createMemo<ReturnType<typeof parseDiff>>(() => {
    const value = content()
    return value ? parseDiff(value) : { files: [] }
  })
  const [path, setPath] = createSignal<string>()
  const selected = createMemo(() => parsed().files.find((file) => file.path === path()) ?? parsed().files[0])
  const [focus, setFocus] = createSignal<DiffFocus>(dimensions().width < 80 ? "diff" : "files")
  createEffect(() => props.onFocusChange?.(focus()))
  const [sidebarHidden, setSidebarHidden] = createSignal(false)
  const [layout, setLayout] = createSignal<"split" | "unified">()
  const [wrap, setWrap] = createSignal(false)
  const [offset, setOffset] = createSignal(0)
  const [hunk, setHunk] = createSignal(0)
  const [width, setWidth] = createSignal(1)
  const [host, setHost] = createSignal<BoxRenderable>()
  const narrow = () => dimensions().width < 80
  const showFiles = () => !sidebarHidden() && (!narrow() || focus() === "files")
  const targetKey = () => props.target.kind === "commit" ? props.target.sha : `PR #${props.target.number}`
  const label = () => props.target.kind === "commit" ? props.target.sha.slice(0, 7) : `PR #${props.target.number}`
  const error = () => props.resource.status === "error" ? props.resource.message : parsed().error
  const message = () => selected()?.message ?? (selected() && !selected()?.body ? "Patch unavailable for this file. Press r to retry or o to open GitHub." : undefined)
  const renderFile = () => message() ? undefined : selected()?.body
  const theme = createMemo(() => {
    if (mode() === "light") return lightThemeAliases[selectedTheme()] ?? "github-light-default"
    return HUNK_DIFF_THEME_NAMES.find((name) => name === selectedTheme()) ?? themeAliases[selectedTheme()] ?? "github-dark-default"
  })
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  let scroll: ScrollBoxRenderable | undefined
  let wrapper: BoxRenderable | undefined
  let pane: ReturnType<typeof mountHunk> | undefined
  let disposed = false
  let rememberedScroll = 0
  let pending: { file: DiffFile | undefined; index: number | null; scrollTop?: number } | undefined
  let waiting = false

  // Only navigation schedules a layout wait. Layout/commit callbacks never feed a reactive effect.
  const revealPending = () => {
    if (!pending || waiting || disposed || !active()) return
    waiting = true
    void renderer.idle().then(() => {
      waiting = false
      if (disposed || !pending || !scroll || !active()) return
      const navigation = pending
      pending = undefined
      if (navigation.file !== selected()) return
      if (navigation.index === null) scroll.scrollTo(navigation.scrollTop ?? 0)
      else {
        const body = navigation.file?.body
        const anchor = body && host()?.findDescendantById(`diff-hunk:${body.id}:${navigation.index}`)
        if (anchor) scroll.scrollTo(anchor.y - scroll.content.y)
      }
    }).catch(() => { waiting = false })
  }
  const measure = () => { if (active()) setWidth(Math.max(1, scroll?.viewport.width ?? 1)) }

  createEffect(on(selected, (file) => {
    rememberedScroll = 0
    setHunk(0)
    setOffset(0)
    scroll?.scrollTo(0)
    pending = { file, index: null }
  }))

  createEffect(on(active, (visible) => {
    if (!visible) {
      rememberedScroll = scroll?.scrollTop ?? rememberedScroll
      return
    }
    measure()
    pending = { file: selected(), index: null, scrollTop: rememberedScroll }
    revealPending()
  }))

  createEffect(() => {
    const container = host()
    const bodyProps: HunkDiffBodyProps = {
      file: renderFile(), width: width(), theme: theme(),
      canonicalLayout: layout() ?? (narrow() ? "unified" : "split"),
      wrapLines: wrap(), horizontalOffset: offset(), selectedHunkIndex: hunk(),
      highlight: true, showLineNumbers: true, showHunkHeaders: true,
    }
    if (!container) return
    if (!bodyProps.file) { pane?.dispose(); pane = undefined; return }
    if (pane) pane.update(bodyProps)
    else pane = mountHunk(renderer, container, bodyProps, revealPending)
  })

  onMount(() => {
    if (!wrapper) return
    const container = new BoxRenderable(renderer, { id: "embedded-diff-host", width: "100%", flexDirection: "column", flexShrink: 0 })
    wrapper.add(container)
    setHost(container)
    measure()
  })
  onCleanup(() => {
    disposed = true
    pending = undefined
    scroll?.viewport.off("resize", measure)
    // React must release the portal before Solid removes its containing renderable.
    pane?.dispose()
    const container = host()
    if (container && !renderer.isDestroyed && !container.isDestroyed) {
      wrapper?.remove(container)
      container.destroyRecursively()
    }
  })

  const jump = (direction: number) => {
    const file = selected()
    const count = renderFile()?.metadata.hunks.length ?? 0
    if (!count) return
    const index = Math.max(0, Math.min(count - 1, hunk() + direction))
    pending = { file, index }
    if (index === hunk()) revealPending()
    else setHunk(index)
  }
  useKeyboard((event) => {
    if (!active() || !props.interactive || event.ctrl || event.meta) return
    if (event.name === "tab") {
      if (focus() === "diff") { setSidebarHidden(false); setFocus("files") }
      else setFocus("diff")
      event.stopPropagation()
      return
    }
    if (event.name === "b") {
      const hide = showFiles()
      setSidebarHidden(hide)
      setFocus(hide ? "diff" : "files")
      event.stopPropagation()
      return
    }
    if (focus() === "files" && (event.name === "h" || event.name === "left" || event.name === "l" || event.name === "right")) {
      event.stopPropagation()
      props.onMovePage?.(event.name === "h" || event.name === "left" ? -1 : 1)
      return
    }
    if ((event.name === "enter" || event.name === "return") && error()) {
      props.onLoadFiles()
      event.stopPropagation()
      return
    }
    if (event.name === "t") setLayout((value) => (value ?? (narrow() ? "unified" : "split")) === "split" ? "unified" : "split")
    else if (event.name === "w") setWrap((value) => !value)
    else if (event.name === "[" || event.sequence === "[") { setFocus("diff"); jump(-1) }
    else if (event.name === "]" || event.sequence === "]") { setFocus("diff"); jump(1) }
    else if (focus() !== "diff" || !scroll) return
    else if (event.name === "h" || event.name === "left") setOffset((value) => Math.max(0, value - 4))
    else if (event.name === "l" || event.name === "right") setOffset((value) => value + 4)
    else if (event.name === "up" || event.name === "k") scroll.scrollBy(-1)
    else if (event.name === "down" || event.name === "j") scroll.scrollBy(1)
    else if (event.name === "u") scroll.scrollBy(-Math.max(1, Math.floor(scroll.viewport.height / 2)))
    else if (event.name === "d") scroll.scrollBy(Math.max(1, Math.floor(scroll.viewport.height / 2)))
    else if (event.name === "G" || (event.name === "g" && event.shift)) scroll.scrollTo(Math.max(0, scroll.scrollHeight - scroll.viewport.height))
    else if (event.name === "g") scroll.scrollTo(0)
    else return
    event.stopPropagation()
  })

  return (
    <box flexGrow={1} minHeight={0} minWidth={0} flexDirection="column" backgroundColor={colors.canvas}>
      <box height={1} flexShrink={0} flexDirection="row" backgroundColor={colors.header} overflow="hidden">
        <text flexShrink={0} fg={colors.blue}>{label()} </text>
        <text flexGrow={1} minWidth={0} height={1} wrapMode="none" truncate fg={colors.text}>
          {selected()?.previousPath ? `${selected()!.previousPath} → ${selected()!.path}` : selected()?.path ?? "Diff"}
        </text>
        <Show when={selected()}>
          <text flexShrink={0} fg={colors.green}> +{selected()?.additions ?? 0}</text>
          <text flexShrink={0} fg={colors.red}> −{selected()?.deletions ?? 0}</text>
        </Show>
      </box>
      <Show when={props.resource.status === "loading"}>
        <text height={1} flexShrink={0} fg={colors.muted}>Loading diff…</text>
      </Show>
      <Show when={error()}>
        <text width="100%" flexShrink={0} fg={colors.red}>{error()} · r retry · Enter file list</text>
      </Show>
      <Show when={parsed().notice}>
        <text width="100%" flexShrink={0} fg={colors.muted}>{parsed().notice}</text>
      </Show>
      <box flexGrow={1} minHeight={0} minWidth={0} flexDirection="row">
        <box
          id="diff-files-pane"
          visible={showFiles()}
          border={["left"]} borderColor={focus() === "files" ? colors.blue : colors.border}
          width={narrow() ? "100%" : 30}
          flexShrink={0} minHeight={0} minWidth={0} flexDirection="column"
        >
          <text height={1} fg={colors.muted}>
            Files{props.resource.value !== undefined && !parsed().error ? ` (${parsed().files.length})` : ""}
          </text>
          <SelectableList
            items={parsed().files} itemKey={(file) => file.path} resetKey={targetKey()}
            active={active() && props.interactive && focus() === "files" && !error()}
            showScrollbar={props.showScrollbar} rowHeight={1}
            empty={props.resource.status === "ready" && !error() ? "No changed files." : ""}
            onSelect={(file) => setPath(file.path)}
            onActivate={(file) => { setPath(file.path); setFocus("diff") }}
          >
            {(file) => <text height={1} flexGrow={1} minWidth={0} wrapMode="none" truncate fg={colors.text}>{file().path}</text>}
          </SelectableList>
        </box>
        <box id="diff-content-pane" visible={!narrow() || focus() === "diff"}
          border={["left"]} borderColor={focus() === "diff" ? colors.blue : colors.border}
          flexGrow={1} minHeight={0} minWidth={0} flexDirection="column">
          <scrollbox
            id="diff-body-scroll"
            ref={(value) => { scroll = value; bindScrollbar(value); value.viewport.on("resize", measure); measure() }}
            flexGrow={1} minHeight={0} minWidth={0} scrollY scrollX={false}
          >
            <Show when={message()}>
              <text width="100%" flexShrink={0} fg={colors.muted}>{message()}</text>
            </Show>
            <Show when={!selected() && props.resource.status === "ready" && !error()}>
              <text fg={colors.muted}>No changed files.</text>
            </Show>
            <box ref={(value) => { wrapper = value }} width="100%" minWidth={0} flexShrink={0} flexDirection="column" />
          </scrollbox>
        </box>
      </box>
    </box>
  )
}
