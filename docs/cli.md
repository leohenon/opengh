# CLI reference

## Open a repository

```sh
opengh                 # Repository picker
opengh .               # Current directory's repository
opengh owner/repo      # Explicit repository
```

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

```sh
opengh https://github.com/owner/repo/issues
opengh https://github.com/owner/repo/pulls
opengh https://github.com/owner/repo/commits
opengh https://github.com/owner/repo/actions
opengh https://github.com/owner/repo/actions/runs/789
```

Only GitHub.com URLs are supported.

## Resume the last page

```sh
opengh --resume
```

## Open only the requested page

```sh
opengh owner/repo --pr 456 --standalone
```

Press `ctrl+o` to open the full app.

## Print a page without launching the app

```sh
opengh owner/repo --pr 456 --inline
```

Run `opengh --help` for all options.
