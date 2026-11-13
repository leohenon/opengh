# Dependency patches

`bun install` applies these patches via `patchedDependencies`.
Bun only applies patches in the root project, so releases ship compiled executables.

- **opentui-core@0.6.6:** text and table geometry for in-page search.
- **hunkdiff@0.24.0:** diff search, inline comment buttons, highlight worker
  configuration, and the `shell-quote` fix for GHSA-pqg4-j6r4-53mv
  (covered by `test/dependency-security.test.ts`).

After upgrading, reapply patches, regenerate the Hunk worker using its header command,
and verify tests and diff highlighting.
