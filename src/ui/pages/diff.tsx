import { BoxRenderable, MouseButton, type MouseEvent, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useKeyActions } from "../keybindings"
import { HUNK_DIFF_THEME_NAMES, type HunkDiffBodyProps, type HunkDiffThemeName } from "hunkdiff/opentui"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import type { DiffContent, DiffTarget } from "../../models"
import type { ResourceState } from "../../repository-state"
import { SelectableList } from "../components/selectable-list"
import { mouseClick, mouseContextMenu, type MousePosition } from "../mouse"
import type { ContextMenuItem } from "../components/context-menu"
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
const TAB_WIDTH = 4

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
  onContextMenu?: (position: MousePosition, items: ContextMenuItem[]) => void
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const active = () => props.active !== false
  const interactive = () => active() && props.interactive
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
  const showBody = () => !narrow() || focus() === "diff"
  const currentLayout = () => layout() ?? (narrow() ? "unified" : "split")
  const targetKey = () => props.target.kind === "commit" ? props.target.sha : `PR #${props.target.number}`
  const label = () => props.target.kind === "commit" ? props.target.sha.slice(0, 7) : `PR #${props.target.number}`
  const error = () => props.resource.status === "error" ? props.resource.message : parsed().error
  const message = () => selected()?.message ?? (selected() && !selected()?.body ? "Patch unavailable for this file." : undefined)
  const renderFile = () => message() ? undefined : selected()?.body
  const hunkCount = () => renderFile()?.metadata.hunks.length ?? 0
  const maxOffset = createMemo(() => {
    const metadata = renderFile()?.metadata
    let longest = 0
    if (metadata) for (const lines of [metadata.deletionLines, metadata.additionLines]) for (const line of lines) {
      const cells = line.split("\t").reduce((column, part, index) =>
        column + (index ? TAB_WIDTH - column % TAB_WIDTH : 0) + Bun.stringWidth(part), 0)
      longest = Math.max(longest, cells)
    }
    // Bound panning by source columns without duplicating Hunk's private gutter geometry.
    return Math.max(0, longest - 1)
  })
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
  const measure = () => { if (active() && showBody()) setWidth(Math.max(1, scroll?.viewport.width ?? 1)) }

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
      canonicalLayout: currentLayout(), tabWidth: TAB_WIDTH,
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
    setFocus("diff")
    const file = selected()
    const count = hunkCount()
    if (!count) return
    const index = Math.max(0, Math.min(count - 1, hunk() + direction))
    pending = { file, index }
    if (index === hunk()) revealPending()
    else setHunk(index)
  }
  const scrollBody = (callback: (body: ScrollBoxRenderable) => void) => {
    if (focus() !== "diff" || !scroll) return false
    pending = undefined
    bodyMouse.onMouseDrag()
    callback(scroll)
  }
  const focusFiles = () => { setSidebarHidden(false); setFocus("files") }
  const toggleSidebar = () => {
    const hide = showFiles()
    setSidebarHidden(hide)
    setFocus(hide ? "diff" : "files")
  }
  const toggleLayout = () => setLayout(currentLayout() === "split" ? "unified" : "split")
  const toggleWrap = () => setWrap((value) => !value)
  const contextMouse = mouseContextMenu((position) => props.onContextMenu?.(position, [
    { label: "Change layout", run: toggleLayout, get disabled() { return !renderFile() } },
    { label: "Toggle files", run: toggleSidebar },
  ]), interactive, targetKey)
  const pan = (delta: number) => {
    if (wrap() || !renderFile()) return
    pending = undefined
    setFocus("diff")
    setOffset((value) => Math.max(0, Math.min(maxOffset(), value + delta)))
  }
  const clickedHunk = (target: Renderable | null) => {
    const body = renderFile()
    if (!body) return
    const header = `diff-hunk:${body.id}:`
    const row = `review-row:diff-row:${body.id}:`
    for (let node = target; node && node !== host(); node = node.parent) {
      // Hunk 0.24.0 anchors headers and tags flat split/unified rows with their hunk index.
      const raw = node.id.startsWith(header) ? node.id.slice(header.length)
        : node.id.startsWith(row) ? /^(?:split|unified):(\d+):/.exec(node.id.slice(row.length))?.[1] : undefined
      const index = raw === undefined ? NaN : Number(raw)
      if (Number.isInteger(index) && index >= 0 && index < hunkCount()) return index
    }
  }
  const bodyMouse = mouseClick((event) => {
    const index = clickedHunk(event.target)
    if (index !== undefined) setHunk(index)
  }, interactive, selected)
  const focusBody = (event: MouseEvent) => {
    if (event.button !== MouseButton.LEFT || !interactive()) return
    pending = undefined
    setFocus("diff")
  }
  const bodyWheel = (event: MouseEvent) => {
    contextMouse.onMouseScroll()
    bodyMouse.onMouseScroll()
    if (!interactive()) { event.stopPropagation(); return }
    pending = undefined
    setFocus("diff")
    const direction = event.scroll?.direction
    if (direction === "left" || direction === "right" || event.modifiers.shift) {
      event.stopPropagation()
      const sign = direction === "left" || direction === "up" ? -1 : 1
      pan(sign * Math.max(1, Math.round((event.scroll?.delta ?? 1) * 4)))
    }
  }
  createEffect(() => { if (!interactive()) { bodyMouse.onMouseDrag(); contextMouse.onMouseDrag() } })
  useKeyboard(() => {
    contextMouse.onMouseDrag()
    bodyMouse.onMouseDrag()
  })
  const keys = useKeyActions({
    "diff.focus": () => {
      bodyMouse.onMouseDrag()
      contextMouse.onMouseDrag()
      if (focus() === "diff") focusFiles()
      else setFocus("diff")
    },
    "diff.toggleFiles": toggleSidebar,
    "navigation.activate": () => {
      if (!error()) return false
      props.onLoadFiles()
    },
    "diff.toggleLayout": toggleLayout,
    "diff.toggleWrap": toggleWrap,
    "diff.previousHunk": () => {
      if (!renderFile()?.metadata.hunks.length) return false
      setFocus("diff"); jump(-1)
    },
    "diff.nextHunk": () => {
      if (!renderFile()?.metadata.hunks.length) return false
      setFocus("diff"); jump(1)
    },
    "navigation.up": () => scrollBody((body) => body.scrollBy(-1)),
    "navigation.down": () => scrollBody((body) => body.scrollBy(1)),
    "navigation.halfPageUp": () => scrollBody((body) => body.scrollBy(-Math.max(1, Math.floor(body.viewport.height / 2)))),
    "navigation.halfPageDown": () => scrollBody((body) => body.scrollBy(Math.max(1, Math.floor(body.viewport.height / 2)))),
    "navigation.pageUp": () => scrollBody((body) => body.scrollBy(-body.viewport.height)),
    "navigation.pageDown": () => scrollBody((body) => body.scrollBy(body.viewport.height)),
    "navigation.first": () => scrollBody((body) => body.scrollTo(0)),
    "navigation.last": () => scrollBody((body) => body.scrollTo(Math.max(0, body.scrollHeight - body.viewport.height))),
  }, { when: interactive, priority: 10 })
  useKeyActions({
    "navigation.previousTab": () => {
      if (!props.onMovePage) return false
      props.onMovePage(-1)
    },
    "navigation.nextTab": () => {
      if (!props.onMovePage) return false
      props.onMovePage(1)
    },
  }, { when: () => interactive() && focus() === "files", priority: 10 })
  useKeyActions({
    "diff.panLeft": () => pan(-4),
    "diff.panRight": () => pan(4),
  }, { when: () => interactive() && focus() === "diff" && Boolean(scroll), priority: 10 })


  return (
    <box {...(props.onContextMenu ? contextMouse : {})} flexGrow={1} minHeight={0} minWidth={0} flexDirection="column" backgroundColor={colors.canvas}>
      <box height={1} flexShrink={0} flexDirection="row" backgroundColor={colors.header} overflow="hidden">
        <text flexShrink={0} fg={colors.blue}>{label()} </text>
        <text flexGrow={1} minWidth={0} height={1} wrapMode="none" truncate fg={colors.text}>
          {selected()?.previousPath ? `${selected()!.previousPath} → ${selected()!.path}` : selected()?.path ?? "Diff"}
        </text>
        <Show when={selected()}>
          <text flexShrink={0} fg={colors.green}> +{selected()?.additions ?? 0}</text>
          <text flexShrink={0} fg={colors.red}> −{selected()?.deletions ?? 0}</text>
        </Show>
        <Show when={hunkCount() > 0}>
          <text id="diff-position" flexShrink={0} fg={colors.muted}> hunk {hunk() + 1}/{hunkCount()} · col {wrap() ? 1 : offset() + 1}</text>
        </Show>
      </box>
      <Show when={props.resource.status === "loading"}>
        <text height={1} flexShrink={0} fg={colors.muted}>Loading diff…</text>
      </Show>
      <Show when={error()}>
        <text width="100%" flexShrink={0} fg={colors.red}>{[error(), keys.hints(["view.refresh", "retry"], ["navigation.activate", "file list"], ["item.open", "GitHub"])].filter(Boolean).join(" · ")}</text>
      </Show>
      <Show when={parsed().notice}>
        <text width="100%" flexShrink={0} fg={colors.muted}>{[parsed().notice, props.resource.value?.kind === "files" ? keys.hint("view.refresh", "retry full diff") : ""].filter(Boolean).join(" · ")}</text>
      </Show>
      <box flexGrow={1} minHeight={0} minWidth={0} flexDirection="row">
        <box
          id="diff-files-pane"
          visible={showFiles()}
          border={["left"]} borderColor={focus() === "files" ? colors.blue : colors.border}
          width={narrow() ? "100%" : 30}
          flexShrink={0} minHeight={0} minWidth={0} flexDirection="column"
          onMouseDown={(event) => {
            if (event.button === MouseButton.LEFT && interactive()) { event.preventDefault(); focusFiles() }
          }}
        >
          <text height={1} fg={colors.muted}>
            Files{props.resource.value !== undefined && !parsed().error ? ` (${parsed().files.length})` : ""}
          </text>
          <SelectableList
            items={parsed().files} itemKey={(file) => file.path} resetKey={targetKey()}
            active={interactive() && showFiles() && focus() === "files" && !error()}
            mouseActive={interactive() && showFiles() && !error()}
            onMouseFocus={() => { contextMouse.onMouseDrag(); focusFiles() }}
            showScrollbar={props.showScrollbar} rowHeight={1}
            empty={props.resource.status === "ready" && !error() ? "No changed files." : ""}
            onSelect={(file) => setPath(file.path)}
            onActivate={(file) => { setPath(file.path); setFocus("diff") }}
          >
            {(file) => <text height={1} flexGrow={1} minWidth={0} wrapMode="none" truncate fg={colors.text}>{file().path}</text>}
          </SelectableList>
        </box>
        <box id="diff-content-pane" visible={showBody()}
          {...bodyMouse}
          onMouseDown={(event) => {
            if (event.button !== MouseButton.LEFT) { bodyMouse.onMouseDrag(); return }
            bodyMouse.onMouseDown(event)
            focusBody(event)
          }}
          onMouseUp={(event) => { if (event.button === MouseButton.LEFT) bodyMouse.onMouseUp(event) }}
          border={["left"]} borderColor={focus() === "diff" ? colors.blue : colors.border}
          flexGrow={1} minHeight={0} minWidth={0} flexDirection="column">
          <scrollbox
            focusable={false}
            onMouseScroll={(event) => { contextMouse.onMouseScroll(); pending = undefined; if (interactive()) setFocus("diff"); event.stopPropagation() }}
            viewportOptions={{ onMouseScroll: bodyWheel }}
            scrollbarOptions={{ onMouseScroll: bodyWheel, trackOptions: { onMouse: (event) => {
              if (event.type === "down") focusBody(event)
            } } }}
            id="diff-body-scroll"
            ref={(value) => { scroll = value; bindScrollbar(value); value.viewport.on("resize", measure); measure() }}
            flexGrow={1} minHeight={0} minWidth={0} scrollY scrollX={false}
          >
            <Show when={message()}>
              <text width="100%" flexShrink={0} fg={colors.muted}>{message()}{keys.hints(["view.refresh", "retry"], ["item.open", "open GitHub"]) ? ` · ${keys.hints(["view.refresh", "retry"], ["item.open", "open GitHub"])}` : ""}</text>
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
