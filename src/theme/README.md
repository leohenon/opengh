# Theme assets

Except for the custom `opengh.json` and `terminal-minimal.json`, the JSON themes in `assets/` are vendored from
[anomalyco/opencode](https://github.com/anomalyco/opencode/tree/388406238bd5ca15564a762840a2362c3a45bd9c/packages/tui/src/theme/assets)
at commit `388406238bd5ca15564a762840a2362c3a45bd9c`.

OpenCode is distributed under the MIT License. Keep this source reference and
review upstream changes explicitly when refreshing the bundled themes.

## Color mode

All bundled themes use the Color mode setting: `system` (default), `dark`, or
`light`. System follows the terminal's detected appearance, falls back to dark
when unavailable, and responds to terminal appearance changes. Theme previews use
the same mode. Saved `github-light` choices migrate to `github` with light mode.

## Custom bundled themes

- `opengh` builds on the GitHub palette in dark and light modes, with brighter
  secondary text in dark mode, layered neutral surfaces, blue-tinted selections,
  and clearer borders. Markdown uses neutral headings and body text to reduce
  visual noise, while links, inline code, and syntax retain semantic colors.
  Open, closed, and merged states use distinct green, red, and purple accents.
  This is the default theme, labeled `opengh (default)` in the theme picker.
  The original `github` theme remains available; saved theme choices are preserved.
- `terminal-minimal` uses the terminal's detected foreground/background with neutral
  main tabs, surfaces, and borders. UI accents are limited to bright ANSI green
  for open/success and bright ANSI red for closed/error states, with purple kept
  for merged PRs. Markdown
  and code highlighting keep their colored ANSI palette. If detection is
  unavailable, it falls back to light gray on black in dark mode, or dark text
  on white in light mode, with standard ANSI colors. Status colors use the darker
  ANSI red/green entries in light mode for readability.
- `terminal-native` uses the same detected terminal foreground/background and
  neutral surfaces, but applies its full ANSI palette throughout the UI:
  blue primary accents, cyan secondary accents, purple merged PRs, and
  red/green/yellow status colors, plus colored Markdown and code highlighting.

Both terminal themes preserve detected foreground/background colors when they
match the selected mode. Forcing the opposite mode reverses those foreground and
background colors and rebuilds neutral surfaces; the detected ANSI palette stays
in use. If either default color is unavailable, both surfaces use the selected
mode's fallback pair to preserve contrast. `github` and `opengh` have their own
bundled dark and light palettes.
