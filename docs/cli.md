# Opening repositories and pages

```sh
opengh                 # Repository picker
opengh .               # Current directory's GitHub repository
opengh owner/repo       # Explicit repository (restores its last tab)
```

Launch directly into an issue, pull request, or commit:

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

GitHub shares issue and PR numbering. Plain numbers (and `/issues/123` URLs)
are resolved using GitHub, so PR numbers open the PR screen automatically.
Commits accept abbreviated or full hashes (4–40 hexadecimal characters).
Digits-only input is interpreted as an issue/PR number; force a commit with
`--commit` when its hash contains only digits:

```sh
opengh --commit 1234567
opengh owner/repo --commit abc1234
opengh owner/repo --issue 123
opengh owner/repo --pr 456
```

Identifiers without a repository require a GitHub.com repository in the current
working directory. They do not use the most recent repository from the picker.
Use `owner/repo` explicitly when outside a checkout. Authentication and repository
access use the same `gh` credentials as normal launches.

Repository pages and workflow runs can also be opened:

```sh
opengh https://github.com/owner/repo/issues
opengh https://github.com/owner/repo/pulls
opengh https://github.com/owner/repo/commits
opengh https://github.com/owner/repo/actions
opengh https://github.com/owner/repo/actions/runs/789
```

Explicit pages/details override the remembered starting tab. Details load directly
by identifier, including closed issues, merged PRs, and commits not in the loaded
list. Back returns to the corresponding list. Switching repositories or reopening
the application without a target does not replay the launch target.

Only GitHub.com URLs are supported. Query strings and anchors are ignored; they do
not select a comment, file, or line. Quote URLs containing shell metacharacters.
Unsupported paths (such as PR `/files` subpages) and invalid arguments produce an
error instead of silently opening a different page. URLs containing control
characters, backslashes, or dot path segments are rejected before normalization.
Missing/inaccessible details use the existing error screens. Number-resolution
failures retain the target: press `r` to retry, or `s` to choose another repository.

The POSIX launcher runs Bun from the trusted installation, while preserving your
original directory for repository discovery and commands. It ignores the caller's
Bun/TypeScript configuration, preload packages, and `.env` files; export credentials
in your shell or authenticate with `gh auth login` instead.

## Development

From the application's checkout, pass the same arguments to `bun run dev`:

```sh
bun run dev https://github.com/cli/cli/issues/14780
bun run dev cli/cli --pr 14784
bun run dev '#123'             # Number belongs to the current checkout's repository
```

For a direct launch without the development watcher, use `./bin/opengh`.
Run `opengh --help` for the command summary.
