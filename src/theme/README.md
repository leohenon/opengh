# Theme assets

Except for the custom `opengh.json` and `terminal-minimal.json`, the JSON themes in `assets/` are vendored from
[anomalyco/opencode](https://github.com/anomalyco/opencode/tree/388406238bd5ca15564a762840a2362c3a45bd9c/packages/tui/src/theme/assets)
at commit `388406238bd5ca15564a762840a2362c3a45bd9c`.

OpenCode is distributed under the MIT License. Keep this source reference and
review upstream changes explicitly when refreshing the bundled themes.

## Custom bundled themes

- `opengh` builds on the GitHub palette in dark and light modes, with brighter
  secondary text in dark mode, layered neutral surfaces, blue-tinted selections,
  and clearer borders. Markdown uses neutral headings and body text to reduce
  visual noise, while links, inline code, and syntax retain semantic colors.
  Open, closed, and merged states use distinct green, red, and purple accents.
  This is the default theme, labeled `opengh (default)` in the theme picker.
  The original `github` theme remains available; saved theme choices are preserved.
- `github-light` always uses the GitHub light palette, regardless of terminal mode.
- `terminal-minimal` uses the terminal's detected foreground/background with neutral
  main tabs, surfaces, and borders. UI accents are limited to bright ANSI green
  for open/success and bright ANSI red for closed/error states, with purple kept
  for merged PRs. Markdown
  and code highlighting keep their colored ANSI palette. If detection is
  unavailable, it falls back to light gray on black with standard ANSI colors.
- `terminal-native` uses the same detected terminal foreground/background and
  neutral surfaces, but applies its full ANSI palette throughout the UI:
  blue primary accents, cyan secondary accents, purple merged PRs, and
  red/green/yellow status colors, plus colored Markdown and code highlighting.
