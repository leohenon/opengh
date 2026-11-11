import { ScrollBoxRenderable, TextAttributes, type TextareaRenderable, type BoxRenderable } from "@opentui/core"
import { Portal, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack, type Accessor } from "solid-js"
import { detectMention, mentionCursorIndex, mergeMentionUsers, type MentionToken } from "./mention-completion"
import { useMentions } from "./mentions"
import { replaceEditorRange, useKeyActions, useKeybindings } from "./keybindings"
import { mouseClick, mouseHover } from "./mouse"
import { useTheme } from "./theme"

type Capture = MentionToken & { text: string; cursor: number; offset: number; identity: string }
type Position = { x: number; y: number; width: number; height: number; rows: number }

export function createMentionAutocomplete(options: { editor: Accessor<TextareaRenderable | undefined>; enabled(): boolean }) {
  const source = useMentions()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const keys = useKeybindings()
  const { colors } = useTheme()
  const [capture, setCapture] = createSignal<Capture>()
  const [remote, setRemote] = createSignal<readonly string[]>([])
  const [loading, setLoading] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [selected, setSelected] = createSignal(0)
  const [position, setPosition] = createSignal<Position | undefined>(undefined, {
    equals: (a, b) => a?.x === b?.x && a?.y === b?.y && a?.width === b?.width && a?.height === b?.height && a?.rows === b?.rows,
  })
  let disposed = false, queued = false, suppressNext = false
  let dismissedText: string | undefined
  let previous: { text: string; cursor: number; identity: string } | undefined
  const current = (): Capture | undefined => {
    const editor = options.editor()
    if (disposed || !source || !editor || editor.isDestroyed || !options.enabled() || !editor.focused || !editor.visible || editor.getSelection()) return
    const text = editor.plainText
    const point = editor.logicalCursor
    const cursor = mentionCursorIndex(text, point.row, point.col, value => editor.editBuffer.measureText(value))
    if (cursor === undefined) return
    const token = detectMention(text, cursor)
    return token && { ...token, text, cursor, offset: editor.cursorOffset, identity: source.identity() }
  }
  const dismiss = () => {
    const editor = options.editor()
    if (editor && !editor.isDestroyed) dismissedText = editor.plainText
    setCapture(undefined)
    setPosition(undefined)
  }
  const refresh = () => {
    if (disposed) return
    const value = current()
    const suppressed = suppressNext
    suppressNext = false
    if (!value) {
      if (suppressed) {
        const editor = options.editor()
        if (editor && !editor.isDestroyed) dismissedText = editor.plainText
      }
      setCapture(undefined); setPosition(undefined); return
    }
    if (previous?.identity !== value.identity) dismissedText = undefined
    if (suppressed || previous?.text === value.text && previous.cursor !== value.cursor) dismissedText = value.text
    previous = value
    if (dismissedText === value.text) { setCapture(undefined); setPosition(undefined); return }
    setCapture(value)
  }
  const queueRefresh = () => {
    if (disposed || queued) return
    queued = true
    queueMicrotask(() => { queued = false; refresh() })
  }
  const suppress = () => { suppressNext = true; dismiss(); queueRefresh() }
  const query = createMemo(() => { const value = capture(); return value ? JSON.stringify([value.identity, value.query]) : undefined })
  createEffect(on(query, (identity) => {
    setRemote([]); setFailed(false); setSelected(0)
    const search = source?.search()
    const value = capture()
    setLoading(!!identity && !!search)
    if (!identity || !value || !search) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const users = await search(value.query, controller.signal)
        if (!disposed && !controller.signal.aborted && query() === identity) setRemote(users)
      } catch {
        if (!disposed && !controller.signal.aborted && query() === identity) setFailed(true)
      } finally {
        if (!disposed && !controller.signal.aborted && query() === identity) setLoading(false)
      }
    }, 180)
    onCleanup(() => { clearTimeout(timer); controller.abort() })
  }))
  const users = createMemo(() => mergeMentionUsers(source?.users() ?? [], remote(), capture()?.query ?? ""))
  const index = () => Math.max(0, Math.min(selected(), users().length - 1))
  const measure = () => {
    const editor = options.editor()
    if (disposed || !capture() || !editor || editor.isDestroyed || !options.enabled() || !editor.focused || !editor.visible) { setPosition(undefined); return }
    if (editor.getSelection()) { dismiss(); return }
    const cursor = editor.visualCursor
    const x = editor.x + cursor.visualCol, y = editor.y + cursor.visualRow
    const size = dimensions()
    if (x < 0 || x >= size.width || y < 0 || y >= size.height) { setPosition(undefined); return }
    for (let node = editor.parent; node; node = node.parent) {
      if (!node.visible || node instanceof ScrollBoxRenderable && (y < node.viewport.y || y >= node.viewport.y + node.viewport.height)) {
        setPosition(undefined); return
      }
    }
    const space = Math.max(y, size.height - y - 1)
    const rows = Math.min(6, Math.max(1, users().length), space - 2)
    if (rows < 1 || size.width < 5) { setPosition(undefined); return }
    const height = rows + 2, width = Math.min(34, size.width)
    setPosition({ x: Math.max(0, Math.min(x, size.width - width)), y: size.height - y - 1 >= height ? y + 1 : y - height, width, height, rows })
  }
  createEffect(() => {
    const identity = source?.identity(), enabled = options.enabled()
    untrack(() => {
      if (!enabled || capture()?.identity !== identity) { setCapture(undefined); setPosition(undefined) }
      queueRefresh()
    })
  })
  createEffect(on(options.editor, (editor) => {
    if (!editor) return
    editor.on("focused", queueRefresh)
    editor.on("blurred", dismiss)
    onCleanup(() => { editor.off("focused", queueRefresh); editor.off("blurred", dismiss) })
    queueRefresh()
  }))
  createEffect(() => { capture(); users(); dimensions(); untrack(measure); renderer.requestRender() })
  renderer.on("frame", measure)
  onCleanup(() => { disposed = true; renderer.off("frame", measure) })
  const accept = (login = users()[index()]) => {
    const saved = capture(), editor = options.editor(), value = current()
    if (!login || !saved || !value || !editor || saved.identity !== value.identity || saved.text !== value.text || saved.cursor !== value.cursor) { dismiss(); return }
    suppressNext = true
    setCapture(undefined); setPosition(undefined)
    const suffix = value.end === value.text.length ? " " : ""
    replaceEditorRange(editor, value.offset - (value.cursor - value.start), value.offset + (value.end - value.cursor), `@${login}${suffix}`)
    queueRefresh()
  }
  const move = (delta: number) => {
    if (!users().length) { dismiss(); return false }
    setSelected(Math.max(0, Math.min(users().length - 1, index() + delta)))
  }
  useKeyActions({
    "mention.up": () => move(-1),
    "mention.down": () => move(1),
    "mention.accept": () => { if (!users().length) { dismiss(); return false }; accept() },
    "dialog.close": dismiss,
  }, { when: () => !!capture() && !!position() && options.enabled() && !!options.editor()?.focused && !options.editor()?.getSelection(), priority: 190 })
  const visibleUsers = () => {
    const rows = position()?.rows ?? 6
    const first = Math.max(0, index() - rows + 1)
    return users().slice(first, first + rows)
  }
  const overlay = <Show when={source && position()}>
    {point => <Portal mount={renderer.root} ref={node => {
      const container = node as BoxRenderable
      container.position = "absolute"; container.left = 0; container.top = 0
      container.width = 0; container.height = 0; container.zIndex = 500
    }}>
      <box id="mention-completions" position="absolute" left={point().x} top={point().y} width={point().width} height={point().height}
        zIndex={500} border borderStyle="rounded" borderColor={colors.border} backgroundColor={colors.panel} flexDirection="column"
        onMouse={event => event.stopPropagation()} onMouseScroll={event => {
          setSelected(Math.max(0, Math.min(users().length - 1, index() + (event.scroll?.direction === "up" ? -1 : 1))))
        }}>
        <For each={visibleUsers()} fallback={<text height={1} fg={colors.muted}>{loading() ? "Loading users…" : failed() ? "Could not load users" : "No matching users"}</text>}>
          {login => {
            const enabled = () => !!capture() && !!position() && options.enabled() && !!options.editor()?.focused && !options.editor()?.getSelection()
            const hover = mouseHover(enabled, () => login)
            return <box id={`mention-option:${login}`} width="100%" height={1} flexShrink={0} paddingX={1}
              backgroundColor={users()[index()] === login || hover.hovered() ? colors.panelHover : colors.panel}
              {...mouseClick(() => accept(login), enabled, () => login, hover)}>
              <text height={1} selectable={false} truncate wrapMode="none" fg={colors.blue}
                attributes={users()[index()] === login ? TextAttributes.BOLD : TextAttributes.NONE}>@{login}</text>
            </box>
          }}
        </For>
      </box>
    </Portal>}
  </Show>
  return { overlay, refresh: queueRefresh, dismiss, suppress,
    onKeyDown(event: Parameters<typeof keys.matches>[0]) {
      if (keys.matches(event, "editor.undo") || keys.matches(event, "editor.redo")) suppress()
    },
  }
}
