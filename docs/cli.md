# CLI reference

## Open a repository

```sh
opengh
opengh owner/repo
opengh .
opengh /path/to/repo
opengh ../
```

Local directories need a GitHub.com remote. Local paths must start with `./`, `../`, `/`, or `~/`
(or be `.` or `..`); anything else is read as a GitHub name or link.

## Open an issue, PR, or commit

```sh
opengh 123
opengh abc1234
opengh owner/repo 123
opengh https://github.com/owner/repo/pull/456
```

Without `owner/repo`, uses the current directory's repository. Numbers resolve to
issues or PRs; commit hashes accept 4–40 hex characters.

Use flags to specify the type (required for digits-only commit hashes):

```sh
opengh owner/repo --issue 123
opengh owner/repo --pr 456
opengh owner/repo --commit 1234567
```

## Open a page or workflow run

Uses the current repository unless `--repo` is specified:

```sh
opengh issues
opengh pulls
opengh actions
opengh issues --repo owner/repo
opengh issues --repo ../
```

Or use a GitHub URL:

```sh
opengh https://github.com/owner/repo/issues
opengh https://github.com/owner/repo/pulls
opengh https://github.com/owner/repo/commits
opengh https://github.com/owner/repo/actions
opengh https://github.com/owner/repo/actions/runs/789
```

Only GitHub.com URLs are supported.`https://github.com/` can be omitted; `opengh owner/repo/actions/runs/789` works the same.

Links to files and folders, releases, discussions, the wiki, projects, packages, deployments, labels, milestones, security advisories, insights, settings, forks, stargazers, and watchers don't open in opengh yet. Pages outside a repository, such as profiles, aren't supported.

## Open a diff

```sh
opengh https://github.com/owner/repo/pull/456/changes
opengh https://github.com/owner/repo/compare/v1.0...v1.1
```

PR `/changes` and `/files` URLs open the diff. If the URL ends with a `#diff-…` anchor, as file
links copied from a PR or commit do, opengh opens that file; line numbers are ignored. Quote
URLs that contain `#`.

Links to specific commits in a PR include a range, such as `/changes/BASE..<sha>` (from the
PR's base to that commit) or `/changes/<sha>..<sha>`. opengh shows only those changes.

Compare URLs open the comparison on the Commits page. Ranges and compare URLs don't work
with `--inline`.

## Choose a page interactively

```sh
opengh -i
opengh --interactive --repo owner/repo
```

Press 1–5 to open a page immediately.

## Resume the last page

```sh
opengh --resume
```

## Focus

`--focus` / `-f` hides global navigation and loads only the requested page:

```sh
opengh issues --focus
opengh owner/repo --pr 456 -f
opengh -if                      # Page menu + focus
```

Press `ctrl+o` to open the full app.

## Print a page without launching the app

Output is rendered in terminals and plain Markdown when piped. `--diff` always
prints plain Markdown.

```sh
opengh owner/repo --pr 456 --inline
```

Add `--diff` to include a validated PR or commit patch; optionally use `--file PATH`
to keep one file's patch and review threads (use the new path for renames).
`--diff` fails rather than returning incomplete output.

See [Agent CLI](agent-cli.md) for agent skill setup and `--inline` usage.

Run `opengh --help` for all options.
