import type { CliRenderer, KeyEvent, TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, type InputProps, type TextareaProps } from "@opentui/solid"
import { createContext, createMemo, onCleanup, splitProps, useContext, type JSX } from "solid-js"
import {
  formatBinding, formatHints, keyActions, matchesKey, resolveKeybindings,
  type HintEntry, type KeyAction, type KeybindingOverrides,
} from "../keybindings"

export type KeyHandlers = Partial<Record<KeyAction, (event: KeyEvent) => unknown>>
export type KeyHandlerOptions = { when?: () => boolean; priority?: number; modal?: boolean }
type Registration = { handlers: KeyHandlers; options: KeyHandlerOptions; order: number }

function createKeybindings(overrides: () => KeybindingOverrides | undefined) {
  const bindings = createMemo(() => resolveKeybindings(overrides()))
  const registrations = new Set<Registration>()
  let order = 0
  const matches = (event: KeyEvent, action: KeyAction) => bindings()[action].some((key) => matchesKey(event, key))
  return {
    bindings,
    matches,
    key: (action: KeyAction, all = false) => formatBinding(bindings(), action, all),
    hint: (action: KeyAction, label: string) => formatHints(bindings(), [[action, label]]),
    hints: (...entries: HintEntry[]) => formatHints(bindings(), entries),
    register(handlers: KeyHandlers, options: KeyHandlerOptions) {
      const registration = { handlers, options, order: ++order }
      registrations.add(registration)
      return () => { registrations.delete(registration) }
    },
    dispatch(event: KeyEvent) {
      if (event.defaultPrevented || event.propagationStopped || event.eventType === "release") return
      // Snapshot before invoking callbacks: opening a dialog must not handle this same key again.
      const active = [...registrations].filter(({ options }) => options.when?.() !== false)
        .sort((a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0) || b.order - a.order)
      for (const { handlers, options } of active) {
        for (const action of Object.keys(handlers) as KeyAction[]) {
          if (!matches(event, action)) continue
          if (handlers[action]?.(event) === false) continue
          event.preventDefault()
          event.stopPropagation()
          return
        }
        // Block lower application layers, but leave unclaimed text to the focused editor.
        if (options.modal) return
      }
    },
  }
}

type Keybindings = ReturnType<typeof createKeybindings>
const KeybindingsContext = createContext<Keybindings>()

export function KeybindingsProvider(props: { overrides?: KeybindingOverrides; children: JSX.Element }) {
  const keys = createKeybindings(() => props.overrides)
  useKeyboard(keys.dispatch)
  return <KeybindingsContext.Provider value={keys}>{props.children}</KeybindingsContext.Provider>
}

// App is also an embeddable component; don't install a second dispatcher under Root.
export function KeybindingsBoundary(props: { overrides?: KeybindingOverrides; children: JSX.Element }) {
  const parent = useContext(KeybindingsContext)
  return parent ? <>{props.children}</> : <KeybindingsProvider overrides={props.overrides}>{props.children}</KeybindingsProvider>
}

const standalone = new WeakMap<CliRenderer, Keybindings>()
function standaloneKeybindings() {
  const renderer = useRenderer()
  let keys = standalone.get(renderer)
  if (!keys) {
    keys = createKeybindings(() => undefined)
    standalone.set(renderer, keys)
    renderer.keyInput.on("keypress", keys.dispatch)
    const dispatch = keys.dispatch
    renderer.once("destroy", () => { renderer.keyInput.off("keypress", dispatch); standalone.delete(renderer) })
  }
  return keys
}

export function useKeybindings() {
  return useContext(KeybindingsContext) ?? standaloneKeybindings()
}

export function useKeyActions(handlers: KeyHandlers, options: KeyHandlerOptions = {}) {
  const keys = useKeybindings()
  onCleanup(keys.register(handlers, options))
  return keys
}

// OpenTUI merges custom bindings with its defaults. Suspending only native shortcuts
// is essential: [] must really disable an editing action, while typing/paste stay native.
const editorActions = keyActions.filter((action) => action.startsWith("editor."))
function edit(event: KeyEvent, editor: TextareaRenderable, keys: Keybindings, multiline: boolean) {
  const action = [...editorActions.filter((id) => multiline || id !== "editor.newline"), ...(!multiline ? ["input.submit" as const] : [])]
    .find((id) => keys.matches(event, id))
  if (!action) return
  event.preventDefault()
  const select = { select: true }
  const actions: Record<string, () => unknown> = {
    "move-left": () => editor.moveCursorLeft(), "move-right": () => editor.moveCursorRight(),
    "move-up": () => editor.moveCursorUp(), "move-down": () => editor.moveCursorDown(),
    "select-left": () => editor.moveCursorLeft(select), "select-right": () => editor.moveCursorRight(select),
    "select-up": () => editor.moveCursorUp(select), "select-down": () => editor.moveCursorDown(select),
    "line-home": () => editor.gotoLineHome(), "line-end": () => editor.gotoLineEnd(),
    "select-line-home": () => editor.gotoLineHome(select), "select-line-end": () => editor.gotoLineEnd(select),
    "visual-line-home": () => editor.gotoVisualLineHome(), "visual-line-end": () => editor.gotoVisualLineEnd(),
    "select-visual-line-home": () => editor.gotoVisualLineHome(select), "select-visual-line-end": () => editor.gotoVisualLineEnd(select),
    "buffer-home": () => editor.gotoBufferHome(), "buffer-end": () => editor.gotoBufferEnd(),
    "select-buffer-home": () => editor.gotoBufferHome(select), "select-buffer-end": () => editor.gotoBufferEnd(select),
    "delete-line": () => editor.deleteLine(), "delete-to-line-end": () => editor.deleteToLineEnd(),
    "delete-to-line-start": () => editor.deleteToLineStart(), "backspace": () => editor.deleteCharBackward(),
    "delete": () => editor.deleteChar(), "newline": () => editor.newLine(),
    "undo": () => editor.undo(), "redo": () => editor.redo(),
    "word-forward": () => editor.moveWordForward(), "word-backward": () => editor.moveWordBackward(),
    "select-word-forward": () => editor.moveWordForward(select), "select-word-backward": () => editor.moveWordBackward(select),
    "delete-word-forward": () => editor.deleteWordForward(), "delete-word-backward": () => editor.deleteWordBackward(),
    "select-all": () => editor.selectAll(), "submit": () => editor.submit(),
  }
  actions[action.slice(action.indexOf(".") + 1)]?.()
}

export function KeyInput(props: InputProps) {
  const keys = useKeybindings()
  const [local, rest] = splitProps(props, ["ref", "onKeyDown"])
  let input: TextareaRenderable
  return <input {...rest} ref={(value) => {
    input = value
    value.traits = { suspend: true }
    if (typeof local.ref === "function") local.ref(value)
  }} onKeyDown={(event) => {
    local.onKeyDown?.(event)
    if (!event.defaultPrevented) edit(event, input, keys, false)
  }} />
}

export function KeyTextarea(props: TextareaProps) {
  const keys = useKeybindings()
  const [local, rest] = splitProps(props, ["ref", "onKeyDown"])
  let textarea: TextareaRenderable
  return <textarea {...rest} ref={(value) => {
    textarea = value
    value.traits = { suspend: true }
    if (typeof local.ref === "function") local.ref(value)
  }} onKeyDown={(event) => {
    local.onKeyDown?.(event)
    if (!event.defaultPrevented) edit(event, textarea, keys, true)
  }} />
}
