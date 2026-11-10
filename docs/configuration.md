# Configuration

## Change settings

Press `,` to change appearance and layout. Changes save immediately; theme previews
require `enter` to save.

## Edit the config file

Set preferences in `~/.config/opengh/config.json`:

```json
{
  "theme": "github",
  "colorMode": "dark"
}
```

Press `ctrl+r` to reload. Omitted options use defaults.
With an absolute `XDG_CONFIG_HOME`, the path is `$XDG_CONFIG_HOME/opengh/config.json`.

## Options

| Key | Default | Values / notes |
| --- | --- | --- |
| `theme` | `"opengh"` | Bundled themes; browse in settings. |
| `colorMode` | `"system"` | `system`, `dark`, `light`. Detection falls back to dark. |
| `markdownStyle` | `"rich"` | `rich`, `minimal`. |
| `compactHeader` | `false` | Single-row header. |
| `showTabCounts` | `true` | Open issue/PR counts. |
| `hideDocumentsTab` | `false` | Hide Overview document tabs; `tab` still cycles documents. |
| `detailLayout` | `"centered"` | `centered`, `wide`. |
| `detailsPlacement` | `"auto"` | `auto`: sidebar on wide terminals, inline otherwise. `inline`: always inline. |
| `iconStyle` | `"nerd"` | `nerd` requires a Nerd Font; `unicode` does not; `none` hides icons. |
| `showStatusBarHints` | `false` | Shortcut hints. |
| `showScrollbars` | `false` | Scrollbars for overflowing content. |
| `reducedMotion` | `false` | Static loading indicators. |
| `diffViewerCommand` | `hunk patch {patch}` when `hunk` is on `PATH` | [External diff viewer](#external-diff-viewer). |
| `keybindings` | No overrides | [Customize shortcuts](keybindings.md). |

## External diff viewer

In a diff, `v` (or the right-click menu) opens the loaded patch in an external
viewer. No local checkout is needed: the viewer receives the entire loaded patch
as a temporary file, and opengh never fetches, clones, or changes working files.
Files-only views must load the full diff first.

`diffViewerCommand` is a JSON argument array, not a command string, and must
include `{patch}`:

```json
{ "diffViewerCommand": ["hunk", "patch", "{patch}"] }
```

`{patch}` expands to a private temporary UTF-8 file that is deleted after the
viewer exits, so use foreground/wait flags. Commands run in the temporary
directory; use absolute paths for scripts that are not on `PATH`. Placeholders
are replaced per argument with no shell involved, so spaces and quotes in the
path stay literal. For shell redirection, pass `{patch}` as a positional argument
rather than inside the script:

```json
{ "diffViewerCommand": ["sh", "-c", "exec hunk patch - < \"$1\"", "opengh-hunk", "{patch}"] }
```

Non-array commands, empty executables, and `{patch}` inside `sh -c` source are
rejected. The viewer takes over the terminal; opengh resumes when it exits and
reports launch failures and nonzero exits. Without `hunk` or a configured
command, `v` explains how to set one up.

## Resume state

Interactive navigation is saved separately from settings in
`~/.config/opengh/resume.json`, or `$XDG_CONFIG_HOME/opengh/resume.json` when
`XDG_CONFIG_HOME` is absolute. [`opengh --resume`](cli.md#resume-the-last-page) uses
this file to reopen the last repository and active page. Delete it to clear resume
history without changing settings or drafts.

## Environment

| Variable | Effect |
| --- | --- |
| `VISUAL`, `EDITOR` | External editor (`ctrl+g` in composers). `VISUAL` takes precedence; defaults to `vi`. |
| `GH_TOKEN`, `GITHUB_TOKEN` | Override saved `gh` credentials. |
