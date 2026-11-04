# GitHub API integration

opengh uses both GitHub REST and GraphQL through the authenticated GitHub CLI (`gh api`). This document maps the integration; upstream documentation remains the source of truth for endpoint fields, schema, permissions, and limits.

## Code map

| Layer | Files | Responsibility |
| --- | --- | --- |
| Transport | `src/github/transport.ts`, `process.ts`, `errors.ts` | CLI execution, authentication checks, endpoint validation, cancellation, timeouts, and error guidance |
| Main client | `src/github/client.ts` | Repository metadata, branches, commits, issues, PRs, timelines, Actions, and domain-model mapping |
| Specialized clients | `src/github/documents.ts`, `diff.ts`, `pull-context.ts`, `reactions.ts`, `reviews.ts` | Repository documents, bounded diff loading, review threads/checks, reactions, and review submission |
| Repository discovery | `src/github/repository.ts` | Repository resolution and recent history |
| Session | `src/repository-session.ts` | Async resource state, caching, refresh, pagination, and user actions |
| Models and UI | `src/models.ts`, `src/ui/` | Domain types and presentation; do not issue API requests directly from UI components |

Client factories accept a `GitHubTransport` so responses and failures can be exercised without a live GitHub account. Agent guidance is in [the GitHub API skill](../.agents/skills/github-api/SKILL.md).

## API choices

- **REST:** repository metadata, contents, branches, commits, issue/PR lists and details, conversation comments, issue edits, review submission, and Actions runs/jobs.
- **GraphQL:** connected PR review/check context, reactions, counts and timeline enrichment, capability data, merge messages, merging, and draft-state changes.
- **Representation-specific reads:** documents and diffs use explicit `Accept` headers through `transport.text()`.

Keep response parsing in the clients. `json<T>` and `graphql<T>` parse JSON but do not perform runtime schema validation. GraphQL callers must inspect `errors` and required fields even when a response contains `data`.

## Authentication and safety

- Users authenticate with `gh auth login --hostname github.com`. `GH_TOKEN` or `GITHUB_TOKEN` can override saved CLI credentials; error guidance accounts for this.
- The transport remembers the initial viewer and checks viewer identity again before REST mutations and GraphQL requests. The latter check currently applies to queries as well as mutations.
- REST endpoints must be relative and pass transport validation. Preserve this restriction: `gh api --hostname` does not prevent an absolute endpoint URL from targeting another host.
- A failed mutation may have reached GitHub. Preserve reconciliation and draft handling rather than retrying automatically. `GitHubRequestNotSentError` is reserved for proven pre-dispatch failures.
- Read access does not imply mutation permission. Check operation-specific capabilities and repository state; report permission or SSO failures explicitly.

## Pagination and resource semantics

REST list clients generally expose `{ items, hasMore }` with explicit page sizes; some operations accumulate pages internally. GraphQL connections use cursor pagination, including nested review/comment connections. Follow each caller's contract rather than assuming one request returns a complete collection.

GitHub's REST issues listing includes PRs. PR conversation comments are issue comments, not inline review comments. Review submissions and review threads have separate lifecycles. Numeric REST IDs, issue/PR numbers, and GraphQL node IDs are not interchangeable.

## Current boundaries

- The transport targets **GitHub.com**, not arbitrary GitHub Enterprise hosts.
- Requests have a 20-second process timeout; selected text requests support cancellation and byte limits. Diff viewing is capped at 4 MiB.
- GraphQL variables currently use `Record<string, string>` and `gh api -f`; supporting other variable types requires explicit transport design rather than assuming coercion.
- Error handling provides rate-limit guidance; the transport does not provide automatic retries or general rate-limit scheduling.
- `transport.page()` is a separate anonymous HTML fetch restricted to `https://github.com`, with redirects rejected. It is not an authenticated API fallback.

## Official references

Consult the specific operation before changing a request; do not vendor the full API documentation.

### Transport and reliability

- [GitHub CLI: `gh api`](https://cli.github.com/manual/gh_api) — fields, request methods, headers, pagination, and GraphQL examples.
- [GitHub CLI environment](https://cli.github.com/manual/gh_help_environment) — token and host configuration.
- [REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [REST pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
- [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [REST troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)

### Endpoint and schema references

- [REST repositories](https://docs.github.com/en/rest/repos), [commits](https://docs.github.com/en/rest/commits), and [Actions](https://docs.github.com/en/rest/actions)
- [REST issues](https://docs.github.com/en/rest/issues) — also covers conversation comments used on PRs.
- [REST pull requests](https://docs.github.com/en/rest/pulls) — includes reviews and inline review comments.
- [GraphQL reference](https://docs.github.com/en/graphql/reference) — objects, unions, enums, inputs, and mutations.
- [GraphQL pagination](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api)
- [GraphQL limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits)
