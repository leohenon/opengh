import type { TextareaRenderable } from "@opentui/core"

const indentation = "  "

export function indentEditor(editor: TextareaRenderable, outdent = false) {
  const selection = editor.getSelection()
  if (!selection && !outdent) {
    editor.insertText(indentation)
    return
  }
  const buffer = editor.editBuffer
  const cursor = editor.cursorOffset
  const start = buffer.offsetToPosition(selection?.start ?? cursor)
  const end = buffer.offsetToPosition(selection?.end ?? cursor)
  if (!start || !end) return
  // A selection ending at the next line's start does not include that line.
  const lastRow = selection && end.col === 0 && end.row > start.row ? end.row - 1 : end.row
  const lines = editor.plainText.split("\n")
  const edits: Array<{ row: number; offset: number; removed: number; added: number }> = []
  for (let row = start.row; row <= lastRow; row++) {
    const prefix = outdent ? lines[row]?.match(/^(?:\t| {1,2})/)?.[0] ?? "" : ""
    const removed = buffer.measureText(prefix)
    if (outdent && !removed) continue
    edits.push({ row, offset: buffer.getLineStartOffset(row), removed, added: outdent ? 0 : indentation.length })
  }
  if (!edits.length) return
  const adjusted = (offset: number) => offset + edits.reduce((delta, edit) => {
    if (offset < edit.offset) return delta
    return delta + edit.added - Math.min(edit.removed, offset - edit.offset)
  }, 0)
  editor.runMutation(() => {
    editor.clearSelection()
    // Edit bottom-up so the original line offsets and row indexes stay valid.
    for (const edit of edits.toReversed()) {
      if (edit.removed) buffer.deleteRange(edit.row, 0, edit.row, edit.removed)
      if (edit.added) {
        buffer.setCursor(edit.row, 0)
        buffer.insertText(indentation)
      }
    }
    editor.cursorOffset = adjusted(cursor)
    if (selection) editor.setSelection(adjusted(selection.start), adjusted(selection.end))
  })
}
