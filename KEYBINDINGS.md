# Keybindings

Customize opengh shortcuts in `~/.config/opengh/config.json` (or `$XDG_CONFIG_HOME/opengh/config.json`).

```json
{
  "keybindings": {
    "global.help": ["f1"],
    "global.quit": ["ctrl+q"],
    "navigation.down": ["n", "down"]
  }
}
```

Save the file and press **Ctrl+R** to apply changes. If you remap `global.reloadConfig`, use its new shortcut.

## Override a binding

Each action accepts an array of shortcuts. Your array replaces its defaults; omitted actions
remain unchanged.

```json
{
  "keybindings": {
    "item.open": ["o", "ctrl+o"]
  }
}
```

## Disable a binding

Use an empty array:

```json
{
  "keybindings": {
    "item.copy": []
  }
}
```

## Key syntax

Use characters (`j`, `G`, `?`), named keys (`enter`, `esc`, `up`), or modifier combinations (`ctrl+q`, `alt+enter`, `shift+tab`).

`G` means `shift+g`. Write punctuation directly: `?`, not `shift+/`. Leader keys and multi-stroke shortcuts are not supported.

## Quit and interrupt

`global.quit` closes the app outside dialogs and in Help. `global.interrupt` also works inside dialogs, cancelling a running command or quitting otherwise.

## Defaults

```json
{
  "keybindings": {
    "global.quit": ["q"],
    "global.interrupt": ["ctrl+c"],
    "global.reloadConfig": ["ctrl+r"],
    "global.help": ["?"],
    "global.settings": [","],
    "global.switchRepository": ["s"],
    "navigation.up": ["up", "k"],
    "navigation.down": ["down", "j"],
    "navigation.halfPageUp": ["u"],
    "navigation.halfPageDown": ["d"],
    "navigation.pageUp": ["pageup"],
    "navigation.pageDown": ["pagedown"],
    "navigation.first": ["g"],
    "navigation.last": ["G"],
    "navigation.previousTab": ["left", "h"],
    "navigation.nextTab": ["right", "l"],
    "navigation.tab1": ["1"],
    "navigation.tab2": ["2"],
    "navigation.tab3": ["3"],
    "navigation.tab4": ["4"],
    "navigation.tab5": ["5"],
    "navigation.activate": ["enter"],
    "navigation.back": ["esc"],
    "item.open": ["o"],
    "item.copy": ["y"],
    "item.diff": ["D"],
    "view.refresh": ["r"],

    "overview.nextDocument": ["tab"],
    "overview.previousDocument": ["shift+tab"],
    "commits.chooseBranch": ["tab", "shift+tab"],
    "work.toggleState": ["tab", "shift+tab"],
    "issue.comment": ["c"],
    "issue.actions": ["a"],
    "detail.references": ["p"],

    "diff.focus": ["tab", "shift+tab"],
    "diff.toggleFiles": ["b"],
    "diff.previousHunk": ["["],
    "diff.nextHunk": ["]"],
    "diff.toggleLayout": ["t"],
    "diff.toggleWrap": ["w"],
    "diff.panLeft": ["left", "h"],
    "diff.panRight": ["right", "l"],

    "picker.up": ["up"],
    "picker.down": ["down"],
    "picker.accept": ["enter"],
    "dialog.close": ["esc"],
    "dialog.confirm": ["enter"],
    "dialog.submit": ["ctrl+s"],
    "dialog.discard": ["ctrl+d"],
    "dialog.toggleExpanded": ["ctrl+o"],
    "dialog.externalEditor": ["ctrl+g"],
    "dialog.togglePreview": ["ctrl+p"],
    "dialog.changeReason": ["alt+r"],
    "references.switchTab": ["tab", "shift+tab", "left", "right"],
    "settings.previousValue": ["left"],
    "settings.nextValue": ["right"],
    "command.clone": ["x"],
    "command.editPath": ["e"],
    "command.copyOutput": ["y"],

    "input.submit": ["enter"],
    "editor.move-left": ["left", "ctrl+b"],
    "editor.move-right": ["right", "ctrl+f"],
    "editor.move-up": ["up"],
    "editor.move-down": ["down"],
    "editor.select-left": ["shift+left"],
    "editor.select-right": ["shift+right"],
    "editor.select-up": ["shift+up"],
    "editor.select-down": ["shift+down"],
    "editor.line-home": ["ctrl+a"],
    "editor.line-end": ["ctrl+e"],
    "editor.select-line-home": ["ctrl+shift+a"],
    "editor.select-line-end": ["ctrl+shift+e"],
    "editor.visual-line-home": ["alt+a", "super+left"],
    "editor.visual-line-end": ["alt+e", "super+right"],
    "editor.select-visual-line-home": ["alt+shift+a", "super+shift+left"],
    "editor.select-visual-line-end": ["alt+shift+e", "super+shift+right"],
    "editor.buffer-home": ["home", "super+up"],
    "editor.buffer-end": ["end", "super+down"],
    "editor.select-buffer-home": ["shift+home", "super+shift+up"],
    "editor.select-buffer-end": ["shift+end", "super+shift+down"],
    "editor.delete-line": ["ctrl+shift+d"],
    "editor.delete-to-line-end": ["ctrl+k"],
    "editor.delete-to-line-start": ["ctrl+u"],
    "editor.backspace": ["backspace", "shift+backspace"],
    "editor.delete": ["delete", "shift+delete", "ctrl+d"],
    "editor.indent": ["tab"],
    "editor.outdent": ["shift+tab"],
    "editor.newline": ["enter"],
    "editor.undo": ["ctrl+z", "super+z", "ctrl+-", "ctrl+_"],
    "editor.redo": ["ctrl+shift+z", "super+shift+z", "ctrl+.", "ctrl+^"],
    "editor.word-forward": ["alt+f", "alt+right", "ctrl+right"],
    "editor.word-backward": ["alt+b", "alt+left", "ctrl+left"],
    "editor.select-word-forward": ["alt+shift+f", "alt+shift+right"],
    "editor.select-word-backward": ["alt+shift+b", "alt+shift+left"],
    "editor.delete-word-forward": ["alt+d", "alt+delete", "ctrl+delete"],
    "editor.delete-word-backward": [
      "ctrl+w",
      "ctrl+backspace",
      "alt+backspace"
    ],
    "editor.select-all": ["super+a"],
    "editor.submit": ["alt+enter"]
  }
}
```

## Text editing

While a text field is focused, **Ctrl+Z** (or **Cmd+Z**) undoes edits and
**Ctrl+Shift+Z** (or **Cmd+Shift+Z**) redoes them.

- Continuous typing or repeated Backspace/Delete is one undo step. A 750 ms pause, navigation, mouse click, focus change, or switch between typing/backward/forward deletion starts another.
- Paste, selection replacement, and word/line deletion are separate steps.
- Undo/redo restores the cursor and selection. A new edit clears redo history.
- Each field retains up to 100 steps through field switching and Write/Preview or merge review.
- Discarding or starting a new draft clears history; submitted changes cannot be undone.

These shortcuts are not app-wide actions.

## Markdown composer

- **Ctrl+O** expands/restores the composer without replacing the editing buffer.
- **Ctrl+G** edits the draft with `$VISUAL`, then `$EDITOR`, falling back to `vi`. Configure GUI editors to wait (for example `code --wait`). Returning imports the text as one undoable edit; cancelling/failure preserves the draft.
- **Ctrl+D** clears the draft; **Esc** closes the composer while keeping the draft. Reopening remembers whether it was expanded.
- **Tab / Shift+Tab** indents/outdents text or selected lines by two spaces.
- **Alt+R** changes the close reason, leaving Tab available for indentation.
- In the comment composer, **Ctrl+P** toggles the Markdown preview. The shortcut is shown in the status bar; there is no preview button.
- **Ctrl+S** reviews the submission before posting; it does not send on the first press.

Markdown source is highlighted using the active theme, with punctuation kept visible. Expanding, previewing, and returning from an external editor preserve the editing session.

Drafts are saved locally in `~/.config/opengh/drafts/` (or `$XDG_CONFIG_HOME/opengh/drafts/`) per repository, issue/PR, and action, and restored after restart. Failed submissions keep the draft. A successful comment clears the posted text; if a close/reopen step fails afterward, only that state change is retried. Local-save failures display a warning and retain the draft in memory.

## Terminal compatibility

Some terminals cannot distinguish combinations such as Ctrl+I and Tab, Ctrl+M and Enter,
or Ctrl+[ and Esc. Ctrl+Shift+letter and Super shortcuts may require Kitty/enhanced keyboard
support. Bind what your terminal reports, or use another shortcut if it intercepts or normalizes
one.
