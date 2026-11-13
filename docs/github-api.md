# GitHub API integration

Use `GitHubTransport` for authenticated requests through `gh api`. Keep response
validation in `src/github/` and async state in the session layer, not UI components.

## Choose an API

| API | Use for |
| --- | --- |
| REST | Repository data, documents, commits, issues, PRs, comments, reviews, Actions. |
| GraphQL | Connected PR review/check context, reactions, counts, capabilities, merge messages, merging, draft state. |
| `transport.text()` | Documents and diffs with explicit `Accept` headers. |

Inject the transport into client factories so tests can use fixtures.

## Validate responses

- `json<T>` and `graphql<T>` parse JSON; they do not validate response shapes.
  A malformed list must fail, not become an empty page.
- Check GraphQL `errors` and required fields, even when `data` exists.
- Keep REST IDs, issue/PR numbers, and GraphQL node IDs distinct.
- REST issue listings include PRs. PR conversation comments use issue-comment
  endpoints; inline review comments and review threads are separate resources.

## Paginate results

Follow each client's contract: REST lists generally return `{ items, hasMore }`;
some accumulate pages internally. GraphQL uses cursors, including nested connections.

## Preserve mutation safety

- Authenticate with `gh auth login --hostname github.com`; `GH_TOKEN` and
  `GITHUB_TOKEN` override saved credentials.
- Verify the session viewer before writes.
- Use validated, relative REST endpoints. `--hostname` does not constrain absolute URLs.
- Check operation-specific permissions and repository state; read access is not write access.
  Require a successfully loaded resource before a write, not a retained value from a failed reload.
- Bind stored drafts to the repository's numeric ID. An `owner/name` can be reused by a
  different repository; review drafts and inline-comment attempts refuse to submit on a mismatch.
- Reconcile uncertain writes before retrying. Keep drafts and recovery records.
  Use `GitHubRequestNotSentError` only for proven pre-dispatch failures.

## Limits

| Area | Boundary |
| --- | --- |
| Host | GitHub.com only. |
| Processes | 20-second timeout; JSON, GraphQL, and text requests support cancellation and byte limits. |
| Responses | 8 MiB default API cap; documents: 1 MiB; diffs: 4 MiB. |
| Pagination | 20-page automatic limit. |
| Detail loading | Shared budgets: 60 seconds, 100 requests, 10,000 items, 16 MiB. |
| GraphQL variables | `Record<string, string>`, sent in a JSON request body through stdin. Other types need explicit transport support. |
| Scheduling | Four concurrent requests with shared rate-limit cooldowns. No automatic retries. |
| `transport.page()` | Anonymous GitHub.com HTML fetch; rejects redirects. Not an authenticated API fallback. |

## Code map

| Path | Responsibility |
| --- | --- |
| `src/github/transport.ts`, `process.ts`, `errors.ts` | Transport, authentication, validation, cancellation, errors. |
| `src/github/client.ts` | Main API operations and domain mapping. |
| `src/github/documents.ts`, `diff.ts`, `pull-context.ts`, `reactions.ts`, `reviews.ts` | Documents, diffs, PR context, reactions, review submission. |
| `src/github/repository.ts` | Discovery and recent history. |
| `src/github/releases.ts` | Latest stable release validation for `opengh update`; the bundled installer downloads public archives. |
| `src/repository-session.ts` | Resource state, caching, refresh, pagination, actions. |
| `src/models.ts`, `src/ui/` | Domain types and presentation. |

## References

Consult the operation's upstream docs before changing requests:

- [GitHub API skill](../.agents/skills/github-api/SKILL.md)
- GitHub CLI: [`gh api`](https://cli.github.com/manual/gh_api), [environment](https://cli.github.com/manual/gh_help_environment)
- REST: [best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api), [pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api), [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)
- Endpoints: [repositories](https://docs.github.com/en/rest/repos), [commits](https://docs.github.com/en/rest/commits), [issues](https://docs.github.com/en/rest/issues), [PRs](https://docs.github.com/en/rest/pulls), [Actions](https://docs.github.com/en/rest/actions), [latest release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
- GraphQL: [schema](https://docs.github.com/en/graphql/reference), [pagination](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api), [limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits)
