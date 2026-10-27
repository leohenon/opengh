import { BoxRenderable, MouseButton, type MouseEvent, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import { insert, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useKeyActions } from "../keybindings"
import { HUNK_DIFF_THEME_NAMES, type HunkDiffBodyProps, type HunkDiffThemeName } from "hunkdiff/opentui"
import { createEffect, createMemo, createRoot, createSignal, For, getOwner, on, onCleanup, onMount, Show } from "solid-js"
import type { DiffContent, DiffTarget, PullReviewThread } from "../../models"
import { createDiffCommentCards, isCommentCard, isSourceRowY } from "../diff-comment-cards"
import type { ResourceState } from "../../repository-state"
import { SelectableList } from "../components/selectable-list"
import { mouseClick, mouseContextMenu, mouseHover, type MousePosition } from "../mouse"
import type { ContextMenuItem } from "../components/context-menu"
import { parseDiff, type DiffFile } from "../diff-model"
import { mountHunk } from "../hunk-host"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { useTheme } from "../theme"
import { useIcons } from "../icon-style"
import { GitHubMarkdown } from "../components/github-markdown"
import { createReactiveMarkdownStyle } from "../markdown-style"
import type { DraftReviewComment, ReviewAnchor } from "../../review-types"
import { extendReviewRange, reviewHit, reviewRows, reviewSplitBoundary, type ReviewLocation } from "../review-lines"

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
  threads?: readonly PullReviewThread[]
  repositoryUrl?: string
  review?: {
    headSha: string
    comments: readonly DraftReviewComment[]
    onComment(anchor: ReviewAnchor): void
    onOpenReview(): void
    jump?: ReviewAnchor & { id: number }
  }
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const active = () => props.active !== false
  const interactive = () => active() && props.interactive
  const { colors, theme: markdownTheme, selected: selectedTheme, mode } = useTheme()
  const icons = useIcons()
  const markdownStyle = createReactiveMarkdownStyle(colors, markdownTheme)
  const owner = getOwner()
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
  const rows = createMemo(() => { const file = renderFile(); return file ? reviewRows(file, currentLayout()) : [] })
  const rowMap = createMemo(() => new Map(rows().map((row) => [row.id, row])))
  const [location, setLocation] = createSignal<ReviewLocation>()
  const [markers, setMarkers] = createSignal<{ id: string; x: number; y: number }[]>([])
  createEffect(on(() => [props.review?.headSha, selected()] as const, () => setLocation(undefined)))
  const pendingMouse = mouseClick(() => props.review?.onOpenReview(), () => interactive() && !!props.review)
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
  let pending: { file: DiffFile | undefined; index: number | null; scrollTop?: number; anchor?: ReviewAnchor } | undefined
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
        const row = navigation.anchor && rows().find((row) => {
          const value = navigation.anchor!.side === "LEFT" ? row.left : row.right
          return value?.line === navigation.anchor!.line
        })
        const anchor = host()?.findDescendantById(row?.id ?? `diff-hunk:${body?.id}:${navigation.index}`)
        if (anchor) scroll.scrollTo(anchor.y - scroll.content.y)
      }
    }).catch(() => { waiting = false })
  }
  const measure = () => { if (active() && showBody()) setWidth(Math.max(1, scroll?.viewport.width ?? 1)) }
  let markerGeneration = 0
  const refreshMarkers = () => {
    const generation = ++markerGeneration
    const comments = props.review?.comments ?? []
    const currentRows = rows()
    void renderer.idle().then(() => {
      if (disposed || generation !== markerGeneration || !wrapper) return
      setMarkers(comments.flatMap((comment) => {
        if (comment.path !== selected()?.path) return []
        const row = currentRows.find((row) => (comment.side === "LEFT" ? row.left : row.right)?.line === comment.line)
        const node = row && host()?.findDescendantById(row.id)
        return node ? [{ id: comment.id, x: currentLayout() === "split" && comment.side === "RIGHT" ? reviewSplitBoundary(node.width) : 0, y: node.y - wrapper!.y }] : []
      }))
    }).catch(() => {})
  }
  createEffect(refreshMarkers)
  const commentMarkdownContext = (sourceUrl: string) => {
    const value = content()
    return props.repositoryUrl ? { repositoryUrl: props.repositoryUrl,
      ref: value?.kind === "patch" ? value.headSha : undefined, sourceUrl } : undefined
  }
  const cards = createDiffCommentCards(renderer, (container, comment) => createRoot(dispose => {
    insert(container, () => <GitHubMarkdown content={comment.body || "(empty comment)"}
      syntaxStyle={markdownStyle()} backgroundColor={colors.panel} preserveImages codePanels wide
      context={commentMarkdownContext(comment.url)} />)
    return dispose
  }, owner))
  const refreshCards = () => {
    const container = host()
    if (!disposed && container) cards.render(container, rows(), selected()?.path, props.threads ?? [], colors, currentLayout(), width(), icons().comment)
  }
  const committed = () => { refreshCards(); revealPending(); refreshMarkers() }

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
    // Posted threads are readable even when this diff has no writable review actions.
    void props.threads
    void [colors.text, colors.muted, colors.blue, colors.border, colors.panel, icons().comment]
    if (!container) return
    cards.clear()
    if (!bodyProps.file) { pane?.dispose(); pane = undefined; refreshCards(); return }
    if (pane) pane.update(bodyProps)
    else pane = mountHunk(renderer, container, bodyProps, committed)
  })

  createEffect(on(() => props.review?.jump, (anchor) => {
    if (!anchor || !props.review) return
    const file = parsed().files.find((file) => file.path === anchor.path)
    if (!file?.body || file.message) return
    const row = reviewRows(file.body, currentLayout()).find((row) => (anchor.side === "LEFT" ? row.left : row.right)?.line === anchor.line)
    if (!row) return
    setPath(file.path)
    setFocus("diff")
    // Let the selected-file reset run before restoring the requested line.
    queueMicrotask(() => {
      if (disposed || props.review?.jump !== anchor || selected() !== file) return
      setLocation({ anchor, hunk: row.hunk })
      pending = { file, index: row.hunk, anchor }
      setHunk(row.hunk)
      revealPending()
    })
  }))

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
    // Release our additions before React releases its portal and Solid removes the host.
    cards.clear()
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
  let contextLocation: ReviewLocation | undefined
  const contextMouse = mouseContextMenu((position) => props.onContextMenu?.(position, [
    ...(props.review && contextLocation ? [{ label: "Add review comment…", run: () => {
      if (props.review && contextLocation) props.review.onComment(contextLocation.anchor)
    } }] : []),
    { label: "Change layout", run: toggleLayout, get disabled() { return !renderFile() } },
    { label: "Toggle files", run: toggleSidebar },
  ]), interactive, targetKey)
  const pan = (delta: number) => {
    if (wrap() || !renderFile()) return
    pending = undefined
    setFocus("diff")
    setOffset((value) => Math.max(0, Math.min(maxOffset(), value + delta)))
  }
  const clickedHunk = (target: Renderable | null, y: number) => {
    const body = renderFile()
    if (!body) return
    const header = `diff-hunk:${body.id}:`
    const row = `review-row:diff-row:${body.id}:`
    for (let node = target; node && node !== host(); node = node.parent) {
      if (isCommentCard(node)) return
      if (node.id.startsWith(row) && !isSourceRowY(node, y)) return
      // Hunk 0.24.0 anchors headers and tags flat split/unified rows with their hunk index.
      const raw = node.id.startsWith(header) ? node.id.slice(header.length)
        : node.id.startsWith(row) ? /^(?:split|unified):(\d+):/.exec(node.id.slice(row.length))?.[1] : undefined
      const index = raw === undefined ? NaN : Number(raw)
      if (Number.isInteger(index) && index >= 0 && index < hunkCount()) return index
    }
  }
  const clickedLocation = (event: MouseEvent) => {
    if (!props.review || !interactive()) return
    for (let node = event.target; node && node !== host(); node = node.parent) {
      if (isCommentCard(node)) return
      const row = rowMap().get(node.id)
      if (row) return isSourceRowY(node, event.y)
        ? reviewHit(row, currentLayout(), node.width, event.x - node.x, event.y - node.y) : undefined
    }
  }
  const bodyHover = mouseHover(interactive, selected)
  let press: { x: number; y: number; file: DiffFile | undefined } | undefined
  // Observe clicks without preventing native text selection or claiming drags.
  const bodyMouse = {
    ...bodyHover.handlers,
    onMouseDown(event: MouseEvent) {
      press = interactive() && event.button === MouseButton.LEFT ? { x: event.x, y: event.y, file: selected() } : undefined
    },
    onMouseUp(event: MouseEvent) {
      const start = press
      press = undefined
      if (!interactive() || !start || start.file !== selected() || start.x !== event.x || start.y !== event.y) return
      const index = clickedHunk(event.target, event.y)
      if (index !== undefined) setHunk(index)
      const hit = clickedLocation(event)
      setLocation(hit && (event.modifiers.shift ? extendReviewRange(location(), hit) : hit))
    },
    onMouseDrag() { press = undefined; bodyHover.handlers.onMouseDrag() },
    onMouseScroll() { press = undefined; bodyHover.handlers.onMouseScroll() },
  }
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
    "review.open": () => { if (!props.review) return false; props.review.onOpenReview() },
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
    <box {...(props.onContextMenu ? contextMouse : {})}
      onMouseDown={(event) => {
        if (!props.onContextMenu) return
        if (event.button === MouseButton.RIGHT) {
          const hit = clickedLocation(event)
          const selectedRange = location()
          contextLocation = hit && selectedRange && selectedRange.hunk === hit.hunk
            && selectedRange.anchor.path === hit.anchor.path && selectedRange.anchor.side === hit.anchor.side
            && hit.anchor.line >= (selectedRange.anchor.startLine ?? selectedRange.anchor.line) && hit.anchor.line <= selectedRange.anchor.line
            ? selectedRange : hit
          setLocation(contextLocation)
          if (contextLocation) setHunk(contextLocation.hunk)
        }
        contextMouse.onMouseDown(event)
      }} flexGrow={1} minHeight={0} minWidth={0} flexDirection="column" backgroundColor={colors.canvas}>
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
            if (event.button !== MouseButton.LEFT) {
              bodyMouse.onMouseDrag()
              return
            }
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
              <text width="100%" flexShrink={0} fg={colors.muted}>{message()}</text>
            </Show>
            <Show when={!selected() && props.resource.status === "ready" && !error()}>
              <text fg={colors.muted}>No changed files.</text>
            </Show>
            <box ref={(value) => { wrapper = value }} width="100%" minWidth={0} flexShrink={0} flexDirection="column">
              <For each={markers()}>{(marker) =>
                <text position="absolute" top={marker.y} left={marker.x} width={1} height={1} zIndex={1}
                  selectable={false} fg={colors.blue} {...pendingMouse}>*</text>
              }</For>
            </box>
          </scrollbox>
        </box>
      </box>
    </box>
  )
}
