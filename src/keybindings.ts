// Application actions, defaults, and display labels share one source of truth.
const binding = (keys: string[], description: string) => ({ keys, description })

export const keybindingDefinitions = {
  "global.quit": binding(["q"], "Quit"),
  "global.interrupt": binding(["ctrl+c"], "Quit / cancel running command"),
  "global.reloadConfig": binding(["ctrl+r"], "Reload configuration"),
  "global.help": binding(["?"], "Help"),
  "global.openFullApp": binding(["ctrl+o"], "Open full app from standalone mode"),
  "global.settings": binding([","], "Settings"),
  "global.switchRepository": binding(["s"], "Switch repository"),
  "navigation.up": binding(["up", "k"], "Move / scroll up"),
  "navigation.down": binding(["down", "j"], "Move / scroll down"),
  "navigation.halfPageUp": binding(["u"], "Half-page up"),
  "navigation.halfPageDown": binding(["d"], "Half-page down"),
  "navigation.pageUp": binding(["pageup"], "Page up"),
  "navigation.pageDown": binding(["pagedown"], "Page down"),
  "navigation.first": binding(["g"], "First item / top"),
  "navigation.last": binding(["G"], "Last item / bottom"),
  "navigation.previousTab": binding(["left", "h"], "Previous tab"),
  "navigation.nextTab": binding(["right", "l"], "Next tab"),
  "navigation.tab1": binding(["1"], "First visible tab"),
  "navigation.tab2": binding(["2"], "Second visible tab"),
  "navigation.tab3": binding(["3"], "Third visible tab"),
  "navigation.tab4": binding(["4"], "Fourth visible tab"),
  "navigation.tab5": binding(["5"], "Fifth visible tab"),
  "navigation.activate": binding(["enter"], "Open / load more"),
  "navigation.back": binding(["esc"], "Back"),
  "item.open": binding(["o"], "Open on GitHub"),
  "item.copy": binding(["y"], "Copy URL / SHA"),
  "item.diff": binding(["D"], "View diff"),
  "view.refresh": binding(["r"], "Refresh / retry"),
  "overview.nextDocument": binding(["tab"], "Next document"),
  "overview.previousDocument": binding(["shift+tab"], "Previous document"),
  "overview.toggleSidebar": binding(["b"], "Show / hide About sidebar"),
  "commits.chooseBranch": binding(["tab", "shift+tab"], "Choose branch"),
  "work.toggleState": binding(["tab", "shift+tab"], "Toggle open / closed"),
  "issue.comment": binding(["c"], "Add comment"),
  "issue.actions": binding(["a"], "Issue actions"),
  "detail.references": binding(["p"], "Open references"),
  "detail.toggleTimeline": binding(["z"], "Collapse / expand timeline"),
  "diff.focus": binding(["tab", "shift+tab"], "Focus files / diff"),
  "diff.toggleFiles": binding(["b"], "Toggle file sidebar"),
  "diff.previousHunk": binding(["["], "Previous hunk"),
  "diff.nextHunk": binding(["]"], "Next hunk"),
  "diff.toggleLayout": binding(["t"], "Toggle split / unified"),
  "diff.toggleWrap": binding(["w"], "Toggle line wrapping"),
  "diff.panLeft": binding(["left", "h"], "Pan diff left"),
  "diff.panRight": binding(["right", "l"], "Pan diff right"),
  "picker.up": binding(["up"], "Previous search result"),
  "picker.down": binding(["down"], "Next search result"),
  "picker.accept": binding(["enter"], "Select search result / toggle assignee"),
  "dialog.close": binding(["esc"], "Close / cancel dialog"),
  "dialog.confirm": binding(["enter"], "Confirm"),
  "dialog.submit": binding(["ctrl+s"], "Submit / save / review"),
  "dialog.discard": binding(["ctrl+d"], "Clear draft"),
  "dialog.toggleExpanded": binding(["ctrl+o"], "Expand / restore editor"),
  "dialog.externalEditor": binding(["ctrl+g"], "Open draft in external editor"),
  "dialog.togglePreview": binding(["ctrl+p"], "Toggle write / preview"),
  "dialog.nextField": binding(["tab"], "Next field"),
  "dialog.previousField": binding(["shift+tab"], "Previous field"),
  "references.switchTab": binding(["tab", "shift+tab", "left", "right", "h", "l"], "Switch reference tabs"),
  "settings.previousValue": binding(["left"], "Previous setting value"),
  "settings.nextValue": binding(["right"], "Next setting value"),
  "command.clone": binding(["x"], "Clone repository"),
  "command.editPath": binding(["e"], "Edit destination"),
  "command.copyOutput": binding(["y"], "Copy command output"),
  "input.submit": binding(["enter"], "Submit single-line input"),
  "editor.move-left": binding(["left", "ctrl+b"], "Cursor left"),
  "editor.move-right": binding(["right", "ctrl+f"], "Cursor right"),
  "editor.move-up": binding(["up"], "Cursor up"),
  "editor.move-down": binding(["down"], "Cursor down"),
  "editor.select-left": binding(["shift+left"], "Select left"),
  "editor.select-right": binding(["shift+right"], "Select right"),
  "editor.select-up": binding(["shift+up"], "Select up"),
  "editor.select-down": binding(["shift+down"], "Select down"),
  "editor.line-home": binding(["ctrl+a"], "Line start"),
  "editor.line-end": binding(["ctrl+e"], "Line end"),
  "editor.select-line-home": binding(["ctrl+shift+a"], "Select to line start"),
  "editor.select-line-end": binding(["ctrl+shift+e"], "Select to line end"),
  "editor.visual-line-home": binding(["alt+a", "super+left"], "Visual line start"),
  "editor.visual-line-end": binding(["alt+e", "super+right"], "Visual line end"),
  "editor.select-visual-line-home": binding(["alt+shift+a", "super+shift+left"], "Select to visual line start"),
  "editor.select-visual-line-end": binding(["alt+shift+e", "super+shift+right"], "Select to visual line end"),
  "editor.buffer-home": binding(["home", "super+up"], "Buffer start"),
  "editor.buffer-end": binding(["end", "super+down"], "Buffer end"),
  "editor.select-buffer-home": binding(["shift+home", "super+shift+up"], "Select to buffer start"),
  "editor.select-buffer-end": binding(["shift+end", "super+shift+down"], "Select to buffer end"),
  "editor.delete-line": binding(["ctrl+shift+d"], "Delete line"),
  "editor.delete-to-line-end": binding(["ctrl+k"], "Delete to line end"),
  "editor.delete-to-line-start": binding(["ctrl+u"], "Delete to line start"),
  "editor.backspace": binding(["backspace", "shift+backspace"], "Delete previous character"),
  "editor.delete": binding(["delete", "shift+delete", "ctrl+d"], "Delete next character"),
  "editor.indent": binding(["tab"], "Indent text / selected lines"),
  "editor.outdent": binding(["shift+tab"], "Outdent current / selected lines"),
  "editor.newline": binding(["enter"], "Insert newline (multiline)"),
  "editor.undo": binding(["ctrl+z", "super+z", "ctrl+-", "ctrl+_"], "Undo"),
  "editor.redo": binding(["ctrl+shift+z", "super+shift+z", "ctrl+.", "ctrl+^"], "Redo"),
  "editor.word-forward": binding(["alt+f", "alt+right", "ctrl+right"], "Next word"),
  "editor.word-backward": binding(["alt+b", "alt+left", "ctrl+left"], "Previous word"),
  "editor.select-word-forward": binding(["alt+shift+f", "alt+shift+right"], "Select next word"),
  "editor.select-word-backward": binding(["alt+shift+b", "alt+shift+left"], "Select previous word"),
  "editor.delete-word-forward": binding(["alt+d", "alt+delete", "ctrl+delete"], "Delete next word"),
  "editor.delete-word-backward": binding(["ctrl+w", "ctrl+backspace", "alt+backspace"], "Delete previous word"),
  "editor.select-all": binding(["super+a"], "Select all"),
  "editor.submit": binding(["alt+enter"], "Submit multiline input"),
}

export type KeyAction = keyof typeof keybindingDefinitions
export type KeybindingOverrides = Partial<Record<KeyAction, string[]>>
export type ResolvedKeybindings = Record<KeyAction, string[]>
export const keyActions = Object.keys(keybindingDefinitions) as KeyAction[]

const aliases: Record<string, string> = {
  return: "enter", kpenter: "enter", linefeed: "enter", esc: "escape", spacebar: "space",
  pgup: "pageup", pgdn: "pagedown", del: "delete", plus: "+",
  arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right",
}
const namedKeys = new Set(["enter", "escape", "space", "tab", "backspace", "delete", "insert", "home", "end", "pageup", "pagedown", "up", "down", "left", "right"])
const modifiers = ["ctrl", "alt", "super", "hyper", "shift"] as const
const modifierAliases: Record<string, string> = { control: "ctrl", meta: "alt", option: "alt", cmd: "super", command: "super" }
export type KeyStroke = { name: string; ctrl: boolean; alt: boolean; super: boolean; hyper: boolean; shift: boolean }

export function parseKey(key: string): KeyStroke {
  if (!key || key !== key.trim()) throw new TypeError(`Invalid key ${JSON.stringify(key)}; use named keys such as space`)
  // A trailing '+' denotes the literal plus key, including e.g. ctrl++.
  const parts = key === "+" ? ["+"] : key.endsWith("++") ? [...key.slice(0, -2).split("+"), "+"] : key.split("+")
  const rawName = parts.pop()!
  let name = aliases[rawName.toLowerCase()] ?? rawName
  const result: KeyStroke = { name: "", ctrl: false, alt: false, super: false, hyper: false, shift: false }
  for (const raw of parts) {
    const modifier = modifierAliases[raw.toLowerCase()] ?? raw.toLowerCase()
    if (!modifiers.includes(modifier as typeof modifiers[number]) || result[modifier as typeof modifiers[number]])
      throw new TypeError(`Invalid modifier in key ${JSON.stringify(key)}`)
    result[modifier as typeof modifiers[number]] = true
  }
  if (Array.from(name).length === 1) {
    if (/[\p{C}\p{Z}]/u.test(name)) throw new TypeError(`Invalid character in key ${JSON.stringify(key)}`)
    if (/^[A-Z]$/.test(name)) { result.shift = true; name = name.toLowerCase() }
    // Printable punctuation is bound by its resulting character, not a keyboard layout.
    if (result.shift && !/^[a-z]$/.test(name)) throw new TypeError(`Use the resulting character (e.g. ?), not Shift+punctuation, in ${JSON.stringify(key)}`)
  } else {
    name = name.toLowerCase()
    if (!namedKeys.has(name) && !/^f([1-9]|1[0-9]|2[0-4])$/.test(name)) throw new TypeError(`Unknown key ${JSON.stringify(rawName)}`)
  }
  result.name = name
  return result
}

export function canonicalKey(key: string): string {
  const parsed = parseKey(key)
  return [...modifiers.filter((modifier) => parsed[modifier]), parsed.name].join("+")
}

export type KeyInput = {
  name: string; sequence?: string; ctrl?: boolean; meta?: boolean; option?: boolean;
  shift?: boolean; super?: boolean; hyper?: boolean; eventType?: string
}

export function matchesKey(event: KeyInput, key: string): boolean {
  if (event.eventType === "release") return false
  const wanted = parseKey(key)
  let name = aliases[event.name.toLowerCase()] ?? event.name
  // Legacy and Kitty terminals disagree about shift on punctuation and uppercase names.
  if (event.sequence && Array.from(event.sequence).length === 1 && !/[\x00-\x20\x7f]/.test(event.sequence)) name = event.sequence
  const printable = Array.from(name).length === 1
  const shift = printable && !/^[a-zA-Z]$/.test(name) ? false : Boolean(event.shift || /^[A-Z]$/.test(name))
  const identity = !printable || /^[a-zA-Z]$/.test(name) ? name.toLowerCase() : name
  return wanted.name === identity && wanted.ctrl === Boolean(event.ctrl)
    && wanted.alt === Boolean(event.meta || event.option) && wanted.super === Boolean(event.super)
    && wanted.hyper === Boolean(event.hyper) && wanted.shift === shift
}

export function normalizeKeybindings(value: unknown): KeybindingOverrides {
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("keybindings must be an object of action IDs and key arrays")
  const result: KeybindingOverrides = {}
  for (const [action, keys] of Object.entries(value)) {
    if (!Object.hasOwn(keybindingDefinitions, action)) throw new TypeError(`Unknown keybinding action: ${action}`)
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) throw new TypeError(`keybindings.${action} must be an array of keys; use [] to disable`)
    try { result[action as KeyAction] = [...new Set(keys.map(canonicalKey))] }
    catch (error) { throw new TypeError(`keybindings.${action}: ${error instanceof Error ? error.message : error}`) }
  }
  validateKeybindingConflicts(resolveKeybindings(result))
  return result
}

export function resolveKeybindings(overrides?: KeybindingOverrides): ResolvedKeybindings {
  return Object.fromEntries(keyActions.map((action) => [action, overrides?.[action] ?? keybindingDefinitions[action].keys])) as ResolvedKeybindings
}

// Contexts describe simultaneously active application shortcuts. Dialog shortcuts deliberately
// shadow editor keys (e.g. Ctrl+D discards a draft instead of deleting a character).
const globalActions: KeyAction[] = ["global.quit", "global.interrupt", "global.reloadConfig", "global.help", "global.settings", "global.switchRepository"]
const navigationActions: KeyAction[] = ["navigation.up", "navigation.down", "navigation.halfPageUp", "navigation.halfPageDown", "navigation.pageUp", "navigation.pageDown", "navigation.first", "navigation.last"]
const tabs: KeyAction[] = ["navigation.previousTab", "navigation.nextTab", "navigation.tab1", "navigation.tab2", "navigation.tab3", "navigation.tab4", "navigation.tab5"]
const items: KeyAction[] = ["navigation.activate", "item.open", "item.copy", "view.refresh"]
const browse: KeyAction[] = [...globalActions, ...navigationActions, ...tabs, ...items]
const dialogs: KeyAction[] = ["global.interrupt", "global.reloadConfig", "dialog.close"]
const picker: KeyAction[] = [...dialogs, "picker.up", "picker.down", "picker.accept"]
const multilineActions: KeyAction[] = ["editor.newline", "editor.indent", "editor.outdent"]
const editor = keyActions.filter((action) => action.startsWith("editor.") && !multilineActions.includes(action))
export const keybindingContexts: Record<string, KeyAction[]> = {
  overview: [...browse.filter((action) => action !== "navigation.activate"), "overview.nextDocument", "overview.previousDocument", "overview.toggleSidebar", "command.clone"],
  commits: [...browse, "item.diff", "commits.chooseBranch"],
  work: [...browse, "item.diff", "work.toggleState"],
  actions: browse,
  commit: [...browse, "navigation.back", "item.diff", "detail.references"],
  issue: [...browse, "navigation.back", "issue.comment", "issue.actions", "detail.references", "detail.toggleTimeline"],
  pull: [...browse, "navigation.back", "item.diff", "issue.comment", "issue.actions", "detail.references", "detail.toggleTimeline"],
  run: [...browse, "navigation.back"],
  diffFiles: [...browse.filter((action) => action !== "item.copy"), "navigation.back", "diff.focus", "diff.toggleFiles", "diff.previousHunk", "diff.nextHunk", "diff.toggleLayout", "diff.toggleWrap"],
  diffBody: [...browse.filter((action) => !["navigation.previousTab", "navigation.nextTab", "item.copy"].includes(action)), "navigation.back", "diff.focus", "diff.toggleFiles", "diff.previousHunk", "diff.nextHunk", "diff.toggleLayout", "diff.toggleWrap", "diff.panLeft", "diff.panRight"],
  picker,
  assignees: [...picker, "dialog.submit"],
  settings: [...dialogs, "navigation.up", "navigation.down", "navigation.activate", "settings.previousValue", "settings.nextValue"],
  references: [...dialogs, ...navigationActions, "navigation.activate", "item.open", "item.copy", "references.switchTab"],
  issueMenu: [...dialogs, "navigation.up", "navigation.down", "navigation.activate"],
  mergeMethods: [...dialogs, "navigation.up", "navigation.down", "navigation.activate", "dialog.submit"],
  mergeMessage: [...dialogs, "dialog.submit", "dialog.nextField", "dialog.previousField"],
  mergeConfirmation: [...dialogs, "dialog.confirm", "navigation.up", "navigation.down", "navigation.pageUp", "navigation.pageDown"],
  reviewMenu: [...dialogs, "navigation.up", "navigation.down", "navigation.activate"],
  reviewWriter: [...dialogs, "dialog.submit", "dialog.discard", "dialog.togglePreview", "dialog.toggleExpanded", "dialog.externalEditor", "editor.indent", "editor.outdent"],
  writer: [...dialogs, "dialog.submit", "dialog.discard", "dialog.togglePreview", "dialog.toggleExpanded", "dialog.externalEditor", "editor.indent", "editor.outdent"],
  closeReason: [...dialogs, "navigation.up", "navigation.down", "navigation.activate"],
  closeIssue: [...dialogs, "dialog.submit", "dialog.discard", "dialog.togglePreview", "editor.indent", "editor.outdent", "dialog.toggleExpanded", "dialog.externalEditor"],
  duplicate: [...dialogs, "dialog.submit", "dialog.discard", "dialog.confirm"],
  preview: [...dialogs, ...navigationActions, "dialog.submit", "dialog.discard", "dialog.togglePreview", "dialog.toggleExpanded", "dialog.externalEditor"],
  confirmation: [...dialogs, "dialog.confirm"],
  help: [...dialogs, ...navigationActions, "global.quit", "global.help"],
  commandPreview: [...dialogs, "dialog.confirm", "command.editPath"],
  commandOutput: [...dialogs, ...navigationActions, "command.copyOutput"],
  singleLineEditor: ["global.interrupt", "global.reloadConfig", ...editor, "input.submit"],
  multilineEditor: ["global.interrupt", "global.reloadConfig", ...editor, ...multilineActions],
}

export function validateKeybindingConflicts(bindings: ResolvedKeybindings) {
  for (const [context, actions] of Object.entries(keybindingContexts)) {
    const seen = new Map<string, KeyAction>()
    for (const action of actions) for (const key of bindings[action]) {
      const canonical = canonicalKey(key)
      const previous = seen.get(canonical)
      if (previous && previous !== action) throw new TypeError(`Key ${formatKey(key)} is assigned to both ${previous} and ${action} in ${context}; remap or disable one`)
      seen.set(canonical, action)
    }
  }
}

const keyLabels: Record<string, string> = { escape: "esc", up: "↑", down: "↓", left: "←", right: "→", pageup: "PgUp", pagedown: "PgDn", backspace: "Backspace", delete: "Del", insert: "Ins", home: "Home", end: "End" }
export function formatKey(key: string) {
  const parsed = parseKey(key)
  if (parsed.shift && /^[a-z]$/.test(parsed.name) && !parsed.ctrl && !parsed.alt && !parsed.super && !parsed.hyper) return parsed.name.toUpperCase()
  return [...modifiers.filter((modifier) => parsed[modifier]), keyLabels[parsed.name] ?? parsed.name].join("+")
}

export function formatBinding(bindings: ResolvedKeybindings, action: KeyAction, all = false) {
  const keys = bindings[action]
  return (all ? keys : keys.slice(0, 1)).map(formatKey).join("/")
}

export type HintEntry = readonly [KeyAction | readonly KeyAction[], string]
export function formatHints(bindings: ResolvedKeybindings, entries: readonly HintEntry[]) {
  return entries.flatMap(([action, label]) => {
    const actions = typeof action === "string" ? [action] : action
    const keys = [...new Set(actions.map((id) => formatBinding(bindings, id)).filter(Boolean))].join("/")
    return keys ? [`${keys} ${label}`] : []
  }).join(" · ")
}
