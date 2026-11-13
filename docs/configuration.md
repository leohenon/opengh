# Configuration

## Change settings

Press `,` for settings. Changes save immediately.

No [Nerd Font](https://www.nerdfonts.com/)? Set **Icon style** to **Unicode** or **None**.

## Edit the config file

Edit `~/.config/opengh/config.json`, then press `ctrl+r` to reload:

```json
{
  "theme": "github",
  "colorMode": "dark"
}
```

Omitted options use defaults. An absolute `XDG_CONFIG_HOME` changes the path to
`$XDG_CONFIG_HOME/opengh/config.json`.

## Options

| Key                  | Default                                       | Values / notes                                                                 |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| `theme`              | `"opengh"`                                    | Bundled themes; browse in settings.                                            |
| `colorMode`          | `"system"`                                    | `system`, `dark`, `light`. Detection falls back to dark.                       |
| `markdownStyle`      | `"rich"`                                      | `rich`, `minimal`.                                                             |
| `compactHeader`      | `false`                                       | Single-row header.                                                             |
| `showTabShortcuts`   | `true`                                        | Show tab shortcut labels.                                                      |
| `showTabCounts`      | `true`                                        | Open issue/PR counts.                                                          |
| `hideDocumentsTab`   | `false`                                       | Hide Overview document tabs; `tab` still cycles documents.                     |
| `detailLayout`       | `"centered"`                                  | `centered`, `wide`.                                                            |
| `detailsPlacement`   | `"auto"`                                      | `auto`: sidebar on wide terminals, inline otherwise. `inline`: always inline.  |
| `diffLayout`         | `"auto"`                                      | `auto`: split on wide terminals, unified below 80 columns. `split`, `unified`. |
| `diffWrap`           | `false`                                       | Wrap long diff lines instead of panning.                                       |
| `diffFullscreen`     | `true`                                        | Hide app tabs during diff review.                                              |
| `iconStyle`          | `"nerd"`                                      | `nerd` requires a Nerd Font; `unicode` does not; `none` hides icons.           |
| `showStatusBarHints` | `false`                                       | Shortcut hints.                                                                |
| `showScrollbars`     | `false`                                       | Scrollbars for overflowing content.                                            |
| `reducedMotion`      | `false`                                       | Static loading indicators.                                                     |
| `diffViewerCommand`  | `hunk patch {patch}` when `hunk` is on `PATH` | External diff viewer.                                                          |
| `keybindings`        | No overrides                                  | Customize shortcuts.                                                           |

## External diff viewer

Press `v` to open a loaded diff in the configured viewer:

```json
{ "diffViewerCommand": ["hunk", "patch", "{patch}"] }
```

Use an array of command arguments. `{patch}` is the patch file’s path, deleted when the viewer exits.

## Environment

| Variable           | Effect                                                                                |
| ------------------ | ------------------------------------------------------------------------------------- |
| `VISUAL`, `EDITOR` | External editor (`ctrl+g` in composers). `VISUAL` takes precedence; defaults to `vi`. |
