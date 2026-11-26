# Agent CLI

Unlike `gh pr view`, opengh `--inline` includes inline review threads, with resolved and outdated ones marked, alongside the
description, comments, and reviews, so agents don’t miss line-level feedback.
The skill teaches agents to fetch the full discussion in one read-only command, with `--diff` to include the patch.

The skill is a short set of instructions, not a service.

## Install

```sh
npx skills add leohenon/opengh --skill opengh --global
```

The agent's environment needs `opengh` on `PATH` and a signed-in GitHub CLI. See
[Installation](installation.md#authenticate).

## Use

Ask for GitHub context as part of a task, such as "Summarize the review feedback on owner/repo PR #123"
or "Read owner/repo issue #42, then find the relevant code in this checkout." The agent then runs
commands like `opengh owner/repo --pr 123 --inline`.

The [skill source](../skills/opengh/SKILL.md) is what the agent reads.
