# Keybindings

## Change a shortcut

Set `keybindings` in [config.json](configuration.md):

```json
{
  "keybindings": {
    "global.help": ["f1"],
    "item.copy": []
  }
}
```

Press `ctrl+r` to reload, or the currently active reload shortcut if remapped.
Arrays replace defaults; omitted actions keep defaults; `[]` disables an action.
Conflicts within the same context reject the config. Reuse across contexts is allowed.

## Key syntax

Use characters (`j`, `G`, `?`), named keys (`enter`, `esc`), or modifiers (`ctrl+q`).
`G` means `shift+g`; write `?`, not `shift+/`. Key sequences are not supported.

`ctrl+shift` and `super` shortcuts may require enhanced terminal keyboard support.

## Contextual keys

- `q` quits while browsing or in Help; `ctrl+c` also works in dialogs and cancels running commands.
- `ctrl+o` opens the full app in standalone mode; in composers, it expands/restores the editor.
- `--inline` has no keybindings.

## Search the page

Press `/` to search the current page or focused diff pane. `enter` confirms;
`n`/`N` moves between matches. `esc` cancels edits or clears the search.

Search is literal, smart-case, and limited to loaded, visible content. It does not filter lists.

## Defaults

Source: [`src/keybindings.ts`](../src/keybindings.ts).

### Application

| Action | Keys |
| --- | --- |
| `global.quit` | `q` |
| `global.interrupt` | `ctrl+c` |
| `global.reloadConfig` | `ctrl+r` |
| `global.help` | `?` |
| `global.openFullApp` | `ctrl+o` |
| `global.settings` | `,` |
| `global.switchRepository` | `S` |

### Navigation and search

| Action | Keys |
| --- | --- |
| `navigation.up` | `up`, `k` |
| `navigation.down` | `down`, `j` |
| `navigation.halfPageUp` | `u` |
| `navigation.halfPageDown` | `d` |
| `navigation.pageUp` | `pageup`, `b`, `shift+space` |
| `navigation.pageDown` | `pagedown`, `f`, `space` |
| `navigation.first` | `g` |
| `navigation.last` | `G` |
| `navigation.previousTab` | `left`, `h` |
| `navigation.nextTab` | `right`, `l` |
| `navigation.tab1` | `1` |
| `navigation.tab2` | `2` |
| `navigation.tab3` | `3` |
| `navigation.tab4` | `4` |
| `navigation.tab5` | `5` |
| `navigation.activate` | `enter` |
| `navigation.back` | `esc` |
| `search.start` | `/` |
| `search.next` | `n` |
| `search.previous` | `N` |
| `item.open` | `o` |
| `item.copy` | `y` |
| `item.diff` | `D` |
| `view.refresh` | `r` |

### Repository pages

| Action | Keys |
| --- | --- |
| `overview.nextDocument` | `tab` |
| `overview.previousDocument` | `shift+tab` |
| `overview.toggleSidebar` | `s` |
| `commits.chooseBranch` | `tab`, `shift+tab` |
| `work.toggleState` | `tab`, `shift+tab` |
| `issue.comment` | `c` |
| `issue.actions` | `a` |
| `detail.references` | `p` |
| `detail.toggleTimeline` | `z` |

### Diffs

| Action | Keys |
| --- | --- |
| `diff.focus` | `tab`, `shift+tab` |
| `diff.toggleFiles` | `s` |
| `diff.filterFiles` | `F` |
| `diff.previousHunk` | `[` |
| `diff.nextHunk` | `]` |
| `diff.toggleLayout` | `t` |
| `diff.toggleWrap` | `w` |
| `diff.panLeft` | `left`, `h` |
| `diff.panRight` | `right`, `l` |

`F` shows the sidebar and opens a live, case-insensitive substring filter on full current and previous file paths (ignoring surrounding whitespace) in the status bar, like `/` search, with matches highlighted in the sidebar using the search colors. Enter or Tab accept the filter and return to navigation; the filter and highlights stay (the sidebar header shows `Files (matched/total)`), and `F` reopens it for editing. Escape clears the filter: while editing it also closes the prompt, and on a retained filter it clears before Escape means back. `s` toggles the sidebar, `f`/`b` page through the diff, and `S` switches repositories outside text input.

### Dialogs and pickers

| Action | Keys |
| --- | --- |
| `picker.up` | `up` |
| `picker.down` | `down` |
| `picker.accept` | `enter` |
| `dialog.close` | `esc` |
| `dialog.confirm` | `enter` |
| `dialog.submit` | `ctrl+s` |
| `dialog.discard` | `ctrl+d` |
| `dialog.toggleExpanded` | `ctrl+o` |
| `dialog.externalEditor` | `ctrl+g` |
| `dialog.togglePreview` | `ctrl+p` |
| `dialog.nextField` | `tab` |
| `dialog.previousField` | `shift+tab` |
| `references.switchTab` | `tab`, `shift+tab`, `left`, `right`, `h`, `l` |
| `settings.previousValue` | `left` |
| `settings.nextValue` | `right` |

### Commands

| Action | Keys |
| --- | --- |
| `command.clone` | `x` |
| `command.editPath` | `e` |
| `command.copyOutput` | `y` |

### Text editing

| Action | Keys |
| --- | --- |
| `input.submit` | `enter` |
| `editor.move-left` | `left`, `ctrl+b` |
| `editor.move-right` | `right`, `ctrl+f` |
| `editor.move-up` | `up` |
| `editor.move-down` | `down` |
| `editor.select-left` | `shift+left` |
| `editor.select-right` | `shift+right` |
| `editor.select-up` | `shift+up` |
| `editor.select-down` | `shift+down` |
| `editor.line-home` | `ctrl+a` |
| `editor.line-end` | `ctrl+e` |
| `editor.select-line-home` | `ctrl+shift+a` |
| `editor.select-line-end` | `ctrl+shift+e` |
| `editor.visual-line-home` | `alt+a`, `super+left` |
| `editor.visual-line-end` | `alt+e`, `super+right` |
| `editor.select-visual-line-home` | `alt+shift+a`, `super+shift+left` |
| `editor.select-visual-line-end` | `alt+shift+e`, `super+shift+right` |
| `editor.buffer-home` | `home`, `super+up` |
| `editor.buffer-end` | `end`, `super+down` |
| `editor.select-buffer-home` | `shift+home`, `super+shift+up` |
| `editor.select-buffer-end` | `shift+end`, `super+shift+down` |
| `editor.delete-line` | `ctrl+shift+d` |
| `editor.delete-to-line-end` | `ctrl+k` |
| `editor.delete-to-line-start` | `ctrl+u` |
| `editor.backspace` | `backspace`, `shift+backspace` |
| `editor.delete` | `delete`, `shift+delete`, `ctrl+d` |
| `editor.indent` | `tab` |
| `editor.outdent` | `shift+tab` |
| `editor.newline` | `enter` |
| `editor.undo` | `ctrl+z`, `super+z`, `ctrl+-`, `ctrl+_` |
| `editor.redo` | `ctrl+shift+z`, `super+shift+z`, `ctrl+.`, `ctrl+^` |
| `editor.word-forward` | `alt+f`, `alt+right`, `ctrl+right` |
| `editor.word-backward` | `alt+b`, `alt+left`, `ctrl+left` |
| `editor.select-word-forward` | `alt+shift+f`, `alt+shift+right` |
| `editor.select-word-backward` | `alt+shift+b`, `alt+shift+left` |
| `editor.delete-word-forward` | `alt+d`, `alt+delete`, `ctrl+delete` |
| `editor.delete-word-backward` | `ctrl+w`, `ctrl+backspace`, `alt+backspace` |
| `editor.select-all` | `super+a` |
| `editor.submit` | `alt+enter` |
