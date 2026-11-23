# Usage

opengh is a terminal interface for GitHub.com repositories.

Run `opengh` to get started. See the [CLI reference](cli.md) for options. opengh needs a
signed-in GitHub CLI; see [Installation](installation.md#authenticate).

## Navigation

Use the keyboard or mouse. Arrow keys move between tabs and items; `enter` opens an item and `esc` goes back. Press `S` to switch repositories.

Press `?` for shortcuts or right-click for actions. See [Keybindings](keybindings.md) for
defaults and customization. Press `,` to open settings.

## Issues and pull requests

Press `c` on a list to create an issue or pull request, or on an issue or pull request to comment, then `ctrl+s` to post. `esc` saves the draft and `ctrl+d` clears it. Type `@` to mention users, and press `a` for actions such as assigning or closing.

## Diffs

Press `D` or use the right-click menu to open a commit or PR diff, and `esc` to come back. In a diff, `,` / `.` switch files, `[` / `]` move between hunks, `t` switches between split and unified layouts, and `w` toggles line wrapping. Press `F` to filter files and `/` to search.

## Reviews

In a PR diff, click a line's `[+]` to comment on it. To review, press `a` → **Review…** on the PR page, choose a review type, and post it with a comment. Inline comments post separately from the review. Press `R` to reply to a review thread.

## Search

Press `/` to search loaded content on any page.

Press `F` on an issues or pull requests list to search GitHub, e.g. `label:bug author:@me`, or `review-requested:@me -is:draft` for PRs. Results follow the Open/Closed tab, newest first, and the tabs show the number of matches. Press `esc` to clear.
