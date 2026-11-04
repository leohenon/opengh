# Opening repositories and pages

```sh
opengh                 # Repository picker
opengh .               # Current directory's GitHub repository
opengh owner/repo       # Explicit repository (restores its last tab)
```

## Issues, PRs, and commits

```sh
opengh https://github.com/owner/repo/issues/123
opengh https://github.com/owner/repo/pull/456
opengh https://github.com/owner/repo/commit/abc1234

opengh 123                    # Issue or PR in the current directory's repository
opengh abc1234                # Commit in the current directory's repository
opengh owner/repo 123
opengh owner/repo abc1234
opengh . '#123'               # Quote '#' so your shell doesn't treat it as a comment
```

Numbers resolve to issues or PRs automatically. Commit hashes accept 4–40 hex
characters; use `--commit` for digits-only hashes:

```sh
opengh --commit 1234567
opengh owner/repo --commit abc1234
opengh owner/repo --issue 123
opengh owner/repo --pr 456
```

## Repository pages and workflow runs

```sh
opengh https://github.com/owner/repo/issues
opengh https://github.com/owner/repo/pulls
opengh https://github.com/owner/repo/commits
opengh https://github.com/owner/repo/actions
opengh https://github.com/owner/repo/actions/runs/789
```

Only GitHub.com URLs are supported.

## Standalone mode

```sh
opengh '#234' --standalone
opengh owner/repo --pr 456 --standalone
opengh https://github.com/owner/repo/issues --standalone
```

Opens only the requested page. **Ctrl+O** opens the full app.

## Inline output

```sh
opengh '#12' --inline
opengh owner/repo --pr 456 --inline
opengh owner/repo '#12' --inline
```

Prints the complete page in the command line without launching the app.

## Development

```sh
bun run dev https://github.com/cli/cli/issues/14780
bun run dev cli/cli --pr 14784
bun run dev '#123'             # Number belongs to the current checkout's repository
```

Use `./bin/opengh` without the watcher. Run `opengh --help` for all options.
