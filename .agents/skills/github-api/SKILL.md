---
name: github-api
description: Implement or review GitHub REST and GraphQL integrations in opengh, including gh CLI transport, pagination, permissions, comments, reviews, reactions, and safe mutations. Use when changing src/github/ or GitHub-backed session behavior.
---

# GitHub API integrations

Read [the project integration guide](../../../docs/github-api.md) before changing API behavior. Consult the linked official endpoint or GraphQL schema documentation for the operation being changed; do not guess field names, permissions, or mutation semantics.

## Project boundaries

- Use `GitHubTransport` from `src/github/transport.ts`. Keep authentication and process execution there; do not add a separate token store, SDK client, or direct authenticated fetch path.
- Keep API response validation and domain mapping in `src/github/`. Keep async state, caching, refresh, and pagination coordination in the session layer, not UI components.
- Preserve transport injection in client factories so API behavior remains verifiable without live GitHub access.
- Use REST for existing endpoint-shaped operations and GraphQL for connected data or capabilities unavailable through the chosen REST endpoint. Follow nearby code rather than rewriting working integrations to another API.

## Requests and responses

- Use relative REST endpoints, encode dynamic path/query values, and preserve host/path validation. `--hostname` alone does not constrain an absolute `gh api` URL.
- Use GraphQL variables for values instead of interpolating user input. The current transport accepts string variables and uses `gh api -f`; explicitly account for types if an operation requires a different variable representation.
- Validate nullable, missing, and union fields at the API boundary. A TypeScript generic on `json<T>` does not validate the response.
- Inspect GraphQL `errors` as well as `data`; partial data is not proof of success. Optional enrichment may degrade explicitly, but required data and mutations must not silently succeed.
- Follow the endpoint's pagination contract. Preserve page sizes and `hasMore` behavior for REST; follow `pageInfo.hasNextPage` and `endCursor` for GraphQL, including nested connections.
- Distinguish REST numeric IDs, issue/PR numbers, and GraphQL node IDs. Do not substitute one for another.

## GitHub-specific semantics

- The REST issues listing also contains pull requests; preserve filtering where the UI expects only issues.
- PR conversation comments use issue-comment endpoints. Review submissions, inline review comments, and GraphQL review threads are separate resources with different identifiers and permissions.
- Anchor inline comments to the correct commit, file, side, and line. Preserve head-change and eligibility checks before submitting reviews or merging.
- Do not infer write permission from read access or hide unknown capabilities behind optimistic defaults. Account access, token permissions, organization SSO, and repository state can all restrict operations.

## Failure and mutation safety

- Preserve the transport's session viewer identity checks before writes. Do not bypass them with a new request path.
- Use `GitHubRequestNotSentError` only when it is provable that no mutation request was dispatched. Timeouts, process failures, or GraphQL errors can leave the remote outcome uncertain.
- Never blindly retry a mutation. Reconcile remote state first using the existing operation-specific flow; retain drafts and show an explicit uncertain outcome when success cannot be confirmed.
- Surface authentication, permission, network, and rate-limit failures through existing error handling. Do not introduce tight retries; respect GitHub's retry guidance and headers when implementing backoff.
- Do not perform live writes to GitHub to validate a code change without explicit user authorization. Prefer focused inspection and existing injected transports/fixtures; add tests only when necessary for a meaningful behavioral regression.
