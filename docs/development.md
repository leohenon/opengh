# Development

## Run locally

Use the Bun version pinned in `package.json`.

```sh
bun install --frozen-lockfile
gh auth login --hostname github.com
bun run dev .                   # Watch mode
bun start owner/repo            # Without watcher
OPENGH_DEBUG=1 bun start .      # Open OpenTUI's console on unexpected errors
```

Without `OPENGH_DEBUG`, unexpected errors show as a notice, and a crashed repository view offers a retry.

## Check changes

```sh
bun test ./test/config.test.ts  # Targeted tests
bun run typecheck
bun test                        # Full suite
```

TUI tests use `testRender` from `@opentui/solid`.

## Build

```sh
bun run build                   # dist/opengh-<os>-<arch>/opengh
bun run smoke                   # Runs it outside the checkout, offline
bun run build --all             # Every target; first: bun install --frozen-lockfile --os='*' --cpu='*'
```

After build or dependency changes, manually check diff syntax highlighting;
the smoke test cannot open the app.

## References

[GitHub API integration](github-api.md) · [Dependency patches](../patches/README.md)
