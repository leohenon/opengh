import type { TextareaRenderable } from "@opentui/core"

type Snapshot = { text: string; cursor: number; selection: { start: number; end: number } | null }
type Edit = { before: Snapshot; after: Snapshot }
type EditGroup = "typing" | "backspace" | "delete" | undefined

// OpenTUI exposes individual native undo steps, but no grouping API. Keep bounded,
// field-local snapshots so typing and selection replacement are logical edits.
export function createEditorHistory(editor: TextareaRenderable, onRestore: () => void = () => {}) {
  const undo: Edit[] = []
  const redo: Edit[] = []
  let expected = editor.plainText
  let groupUntil = 0
  let lastGroup: EditGroup
  const snapshot = (): Snapshot => ({ text: editor.plainText, cursor: editor.cursorOffset, selection: editor.getSelection() })
  const boundary = () => { groupUntil = 0; lastGroup = undefined }
  const sync = () => {
    // An external value change starts a new editing session.
    if (editor.plainText !== expected) {
      undo.length = redo.length = 0
      boundary()
      expected = editor.plainText
    }
  }
  const restore = (state: Snapshot) => {
    expected = state.text
    editor.runMutation(() => {
      editor.clearSelection()
      editor.setText(state.text)
      editor.cursorOffset = state.cursor
      if (state.selection) editor.setSelection(state.selection.start, state.selection.end)
      onRestore()
    })
  }
  const reset = () => {
    undo.length = redo.length = 0
    expected = editor.plainText
    boundary()
  }
  return {
    boundary,
    reset,
    record(group: EditGroup, operation: () => void) {
      sync()
      const before = snapshot()
      const now = Date.now()
      operation()
      if (editor.isDestroyed) return
      const after = snapshot()
      if (before.text === after.text) { boundary(); return }
      const previous = undo.at(-1)
      const canGroup = group !== undefined && !before.selection && !after.selection
      if (canGroup && group === lastGroup && now < groupUntil && previous?.after.cursor === before.cursor) {
        previous.after = after
      } else {
        undo.push({ before, after })
        if (undo.length > 100) undo.shift()
      }
      redo.length = 0
      expected = after.text
      groupUntil = canGroup ? now + 750 : 0
      lastGroup = canGroup ? group : undefined
      // Native history isn't used: replacements may contain multiple native steps.
      editor.editBuffer.clearHistory()
    },
    undo() {
      sync()
      boundary()
      const edit = undo.pop()
      if (!edit) return
      redo.push(edit)
      restore(edit.before)
    },
    redo() {
      sync()
      boundary()
      const edit = redo.pop()
      if (!edit) return
      undo.push(edit)
      restore(edit.after)
    },
  }
}
