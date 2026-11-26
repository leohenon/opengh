# Usage

opengh is a terminal interface for GitHub.com repositories.

Run `opengh` to get started. See the [CLI reference](cli.md) for options. opengh needs a
signed-in GitHub CLI; see [Installation](installation.md#authenticate).

## Navigation

Use the keyboard or mouse. Arrow keys move between tabs and items, and `1`–`5` jump to a tab; `enter` opens an item and `esc` goes back. Press `S` to switch repositories. Except for running Actions, pages don't update on their own. Press `r` to refresh, or to retry after an error.

Press `?` for shortcuts or right-click for actions. For anything opengh doesn't do yet, press `o` to open it on GitHub, or `y` to copy its link (a SHA for commits). See [Keybindings](keybindings.md) for defaults and customization. Press `,` to open [settings](configuration.md).

In tmux, add `set -g mouse on` for mouse support. If right-click does something else in your terminal, press `?` for shortcuts.

## Overview

The Overview tab shows the README and, when the repository has them, the same document tabs as GitHub: Code of conduct, Contributing, License, and Security. Press `tab` / `shift+tab` to switch documents. Links to other Markdown files in the repository open in place. Press `s` to show or hide the About sidebar.

## Issues and pull requests

Press `c` on a list to create an issue or pull request, or on an issue or pull request to comment, then `ctrl+s` to post. `esc` saves the draft and `ctrl+d` clears it. Type `@` to mention users.

Press `a` for actions: assign, close, reopen, or mark an issue as a duplicate. On a pull request, you can also review, merge, and mark it as a draft or ready for review.

To react, double-click a comment or right-click it and choose **React**. Click a reaction to add or remove yours.

## Diffs

Press `D` or use the right-click menu to open a commit or PR diff, and `esc` to come back. In a diff, `,` / `.` switch files, `[` / `]` move between hunks, `t` switches between split and unified layouts, and `w` toggles line wrapping. Press `F` to filter files and `/` to search.

## Reviews

In a PR diff, click a line's `[+]` to comment on it. To review, press `a` → **Review…** on the PR page, choose a review type, and post it with a comment. Inline comments post separately from the review. Press `R` to reply to a review thread.

## Commits and Actions

On Commits, press `tab` to choose a branch. Actions lists workflow runs; open one to see its jobs and steps, which update while the run is in progress. CI links on pull requests open the same view. Job logs aren't shown yet.

## Links

GitHub links open in opengh, including links to comments, branches, comparisons, and new issues or pull requests. Pages it doesn't support yet, such as discussions and releases, open in your browser.

You can also paste a GitHub link into the repository switcher (`S`).

## Search

Press `/` to search loaded content on any page.

Press `F` on an issues or pull requests list to search GitHub, e.g. `label:bug author:@me`, or `review-requested:@me -is:draft` for PRs. Results follow the Open/Closed tab, newest first, and the tabs show the number of matches. Press `esc` to clear.
