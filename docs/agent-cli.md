# Agent CLI

Unlike gh pr view, opengh `--inline` includes inline review threads alongside the
description, comments, and reviews, so agents don’t miss line-level feedback.
The skill teaches agents to fetch the full discussion in one read-only command, with `--diff` to include the patch.

The skill is a short set of instructions, not a service.

## Install

```sh
npx skills add . --skill opengh --global
```

## Use

Ask for GitHub context as part of a task:

- Summarize the review feedback on owner/repo PR #123.
- Read owner/repo issue #42, then find the relevant code in this checkout.

The agent then runs commands like `opengh owner/repo --pr 123 --inline`.

The [skill source](../skills/opengh/SKILL.md) is what the agent reads.
