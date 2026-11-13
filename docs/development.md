# Development

## Run locally

```sh
bun install --frozen-lockfile
gh auth login --hostname github.com
bun run dev .                   # Watch mode
bun start owner/repo            # Without watcher
```

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

## Sandbox

Use [leohenon/opengh-sandbox](https://github.com/leohenon/opengh-sandbox) for live manual testing.

```sh
bun run dev leohenon/opengh-sandbox
```

## References

[GitHub API integration](github-api.md) · [Dependency patches](../patches/README.md)
