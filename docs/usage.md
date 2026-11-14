# Usage

opengh is a terminal interface for GitHub.com repositories.

Run `opengh` to get started. See the [CLI reference](cli.md) for options.

## Basic Navigation

Use the keyboard or mouse. Arrow keys move between tabs and items; `enter` opens an item and `esc` goes back.

Press `?` for shortcuts or right-click for actions. See [Keybindings](keybindings.md) for
defaults and customization.

Press `,` to open settings. Change the icon style if your terminal does not use a Nerd Font. See [Configuration](configuration.md).

## Actions and comments

- Press `a` for actions such as assigning, labeling, closing, or reopening an issue or pull request.
- Press `c` to write a comment, then `ctrl+s` to post. `esc` saves the current draft, and `ctrl+d` clears it.
- Type `@` while commenting to mention users.

## Diffs

- Press `D` or use the right click menu to open a commit or PR diff. `esc` to come back.
- In a diff, use `,` / `.` to switch files, `[` / `]` to move between hunks, `t` to switch between split and unified layouts, and `w` to toggle line wrapping.
- Press `F` to filter files and `/` to search in the diffs.

## Reviews

- In a PR diff, click a line's `[+]` to comment on the line.
- On the PR page press `a` → **Review…**. Choose a review type and post review with a comment.

Inline comments post separately from the review.

## Search

Press `/` to search loaded content on any page. This does not search GitHub or the entire repository.
