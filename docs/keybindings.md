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

Press `ctrl+r` to reload.
Arrays replace defaults; `[]` disables an action.

## Key syntax

Use characters (`j`, `G`, `?`), named keys (`enter`, `esc`), or modifiers (`ctrl+q`).
`G` means `shift+g`; write `?`, not `shift+/`. Key sequences are not supported.

`ctrl+shift` and `super` shortcuts may require enhanced terminal keyboard support.

## Search the page

Press `/` to search the current page or diff body. `enter` confirms;
`n`/`N` moves between matches.

Search is literal, smart-case, and limited to loaded, visible content. It does not filter lists.

## Defaults

Source: [`src/keybindings.ts`](../src/keybindings.ts).

### Application

| Action                    | Keys     |
| ------------------------- | -------- |
| `global.quit`             | `q`      |
| `global.interrupt`        | `ctrl+c` |
| `global.reloadConfig`     | `ctrl+r` |
| `global.help`             | `?`      |
| `global.openFullApp`      | `ctrl+o` |
| `global.settings`         | `,`      |
| `global.switchRepository` | `S`      |

### Navigation and search

| Action                    | Keys                         |
| ------------------------- | ---------------------------- |
| `navigation.up`           | `up`, `k`                    |
| `navigation.down`         | `down`, `j`                  |
| `navigation.halfPageUp`   | `u`                          |
| `navigation.halfPageDown` | `d`                          |
| `navigation.pageUp`       | `pageup`, `b`, `shift+space` |
| `navigation.pageDown`     | `pagedown`, `f`, `space`     |
| `navigation.first`        | `g`                          |
| `navigation.last`         | `G`                          |
| `navigation.previousTab`  | `left`, `h`                  |
| `navigation.nextTab`      | `right`, `l`                 |
| `navigation.tab1`         | `1`                          |
| `navigation.tab2`         | `2`                          |
| `navigation.tab3`         | `3`                          |
| `navigation.tab4`         | `4`                          |
| `navigation.tab5`         | `5`                          |
| `navigation.activate`     | `enter`                      |
| `navigation.back`         | `esc`                        |
| `search.start`            | `/`                          |
| `search.next`             | `n`                          |
| `search.previous`         | `N`                          |
| `item.open`               | `o`                          |
| `item.copy`               | `y`                          |
| `item.diff`               | `D`                          |
| `view.refresh`            | `r`                          |

### Repository pages

| Action                      | Keys               |
| --------------------------- | ------------------ |
| `overview.nextDocument`     | `tab`              |
| `overview.previousDocument` | `shift+tab`        |
| `overview.toggleSidebar`    | `s`                |
| `commits.chooseBranch`      | `tab`, `shift+tab` |
| `work.toggleState`          | `tab`, `shift+tab` |
| `issue.comment`             | `c`                |
| `issue.actions`             | `a`                |
| `detail.references`         | `p`                |
| `detail.toggleTimeline`     | `z`                |

### Diffs

| Action                | Keys               |
| --------------------- | ------------------ |
| `diff.openViewer`     | `v`                |
| `diff.previousFile`   | `,`                |
| `diff.nextFile`       | `.`                |
| `diff.toggleFiles`    | `s`                |
| `diff.filterFiles`    | `F`                |
| `diff.previousHunk`   | `[`                |
| `diff.nextHunk`       | `]`                |
| `diff.toggleLayout`   | `t`                |
| `diff.toggleWrap`     | `w`                |
| `diff.toggleComments` | `z`                |
| `diff.panLeft`        | `left`, `h`        |
| `diff.panRight`       | `right`, `l`       |

In diffs, `,`/`.` move through files (including a filtered list); `j`/`k`, arrows, `u`/`d`, `f`/`b`, Space and `g`/`G` scroll the diff regardless of sidebar clicks. `h`/`l` and horizontal arrows pan the diff. The file sidebar is mouse-selectable; `s` toggles it and `F` filters paths. On narrow terminals the sidebar starts hidden and, when shown, shares the screen with the diff. Use a file or body right-click menu for Settings; outside diffs `,` opens Settings.

### Username suggestions

Type `@` in a comment editor. `esc` dismisses suggestions without closing the comment.

| Action | Keys |
| --- | --- |
| `mention.up` | `up` |
| `mention.down` | `down` |
| `mention.accept` | `enter`, `tab` |

### Dialogs and pickers

| Action                   | Keys                                          |
| ------------------------ | --------------------------------------------- |
| `dialog.close`           | `esc`                                         |
| `dialog.confirm`         | `enter`                                       |
| `dialog.submit`          | `ctrl+s`                                      |
| `dialog.discard`         | `ctrl+d`                                      |
| `dialog.toggleExpanded`  | `ctrl+o`                                      |
| `dialog.externalEditor`  | `ctrl+g`                                      |
| `dialog.togglePreview`   | `ctrl+p`                                      |
| `dialog.nextField`       | `tab`                                         |
| `dialog.previousField`   | `shift+tab`                                   |
| `references.switchTab`   | `tab`, `shift+tab`, `left`, `right`, `h`, `l` |
| `settings.previousValue` | `left`                                        |
| `settings.nextValue`     | `right`                                       |

### Commands

| Action               | Keys |
| -------------------- | ---- |
| `command.clone`      | `x`  |
| `command.editPath`   | `e`  |
| `command.copyOutput` | `y`  |

### Text editing

| Action           | Keys                                                |
| ---------------- | --------------------------------------------------- |
| `editor.indent`  | `tab`                                               |
| `editor.outdent` | `shift+tab`                                         |
| `editor.undo`    | `ctrl+z`, `super+z`, `ctrl+-`, `ctrl+_`             |
| `editor.redo`    | `ctrl+shift+z`, `super+shift+z`, `ctrl+.`, `ctrl+^` |
| `editor.submit`  | `alt+enter`                                         |
