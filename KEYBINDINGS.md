# Keybindings

Customize opengh shortcuts in `~/.config/opengh/config.json` (or `$XDG_CONFIG_HOME/opengh/config.json`).

```json
{
  "keybindings": {
    "global.help": ["f1"],
    "global.quit": ["ctrl+q"],
    "navigation.down": ["m", "down"]
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

In `--standalone` mode, **Ctrl+O** (`global.openFullApp`) reveals the header
and enables global tab navigation without changing the current page.
`--inline` prints static output and has no keybindings.

## Defaults

```json
{
  "keybindings": {
    "global.quit": ["q"],
    "global.interrupt": ["ctrl+c"],
    "global.reloadConfig": ["ctrl+r"],
    "global.help": ["?"],
    "global.openFullApp": ["ctrl+o"],
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
    "search.start": ["/"],
    "search.next": ["n"],
    "search.previous": ["N"],
    "item.open": ["o"],
    "item.copy": ["y"],
    "item.diff": ["D"],
    "view.refresh": ["r"],

    "overview.nextDocument": ["tab"],
    "overview.previousDocument": ["shift+tab"],
    "overview.toggleSidebar": ["b"],
    "commits.chooseBranch": ["tab", "shift+tab"],
    "work.toggleState": ["tab", "shift+tab"],
    "issue.comment": ["c"],
    "issue.actions": ["a"],
    "detail.references": ["p"],
    "detail.toggleTimeline": ["z"],

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

## Terminal compatibility

Some terminals cannot distinguish combinations such as Ctrl+I and Tab, Ctrl+M and Enter,
or Ctrl+[ and Esc. Ctrl+Shift+letter and Super shortcuts may require Kitty/enhanced keyboard
support. Bind what your terminal reports, or use another shortcut if it intercepts or normalizes
one.

## Timeline

In issue and pull request details, press **z** to collapse or expand all timeline bodies.
Comments, reviews, review threads, and commit groups keep their headers; the description
and routine events stay unchanged. The toggle is shared across issues and pull requests
for the current app session.

## Page search

Press **/** (`search.start`) to search loaded content in the current page or focused diff pane,
without filtering lists. **Enter** accepts the query; **n** (`search.next`) and
**N** (`search.previous`) move between matches, wrapping at either end. On lists,
these continue from the selected row, including after manual navigation.
**Esc** in the prompt cancels edits; outside it, Esc clears an accepted search before going back.

Search is literal and uses smart case: lowercase queries ignore case; queries containing
uppercase letters match case exactly (including Unicode). Lists count matching loaded rows; details count
individual occurrences in rendered text, including Markdown tables. Hidden/collapsed
content and concealed link URLs are excluded. Searching never loads another page.
The prompt shows the current result and total (or `No matches`). Accepted queries are
remembered per view. In diffs, an accepted query keeps its visible pane scope when focus
moves; press **/** again to search the newly focused pane.

Search also works in Settings: it highlights and selects matching setting rows without
changing their values. The theme picker keeps its existing text filter. Other dialogs,
pickers and editors retain their own typing behavior.
Remap or disable these actions like any other binding; for example, disable `search.next`
before assigning `n` to another browsing action.

The renderer integration uses the version-pinned OpenTUI and Hunk patches in `patches/`:
install with Bun so rendered-chunk decoration, exact table geometry and diff source-cell
hooks are available. These adapters must be revalidated when upgrading either dependency.
