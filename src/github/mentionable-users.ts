import { repositorySelector, type RepositoryReference } from "./repository-target"
import { githubTransport, type GitHubTransport, type RequestOptions } from "./transport"

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function createMentionableUserLoader(transport: GitHubTransport) {
  return async (repository: RepositoryReference, query: string, options?: RequestOptions): Promise<string[]> => {
    if (typeof query !== "string" || !/^[a-z\d-]{0,39}$/i.test(query)) throw new Error("Invalid mentionable user query.")
    const selector = repositorySelector(repository)
    if (!transport.graphql) throw new Error("GitHub transport does not support GraphQL.")
    // Suggestions only: intentionally fetch a single bounded page, not a complete user list.
    const response = await transport.graphql<unknown>(`query MentionableUsers(${selector.declarations}, $query: String!) {
      ${selector.select("mentionableUsers(first: 30, query: $query) { nodes { login } }")}
    }`, { ...selector.variables, query }, options)
    if (!record(response) || (response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length > 0))) {
      throw new Error("GitHub mentionable users query failed.")
    }
    const result = record(response.data) ? response.data.repository : undefined
    if (!record(result)) throw new Error("GitHub mentionable users repository is missing or malformed.")
    if (typeof repository !== "string" && result.id !== repository.nodeId) throw new Error("GitHub repository identity does not match.")
    const connection = result.mentionableUsers
    if (!record(connection) || !Array.isArray(connection.nodes) || connection.nodes.length > 30) {
      throw new Error("GitHub mentionable users connection is missing or malformed.")
    }
    const logins: string[] = []
    const seen = new Set<string>()
    for (const node of connection.nodes) {
      if (node === null) continue
      if (!record(node) || typeof node.login !== "string" || !/^[a-z\d][a-z\d-]{0,38}(?:\[bot\])?$/i.test(node.login)) {
        throw new Error("GitHub mentionable user login is malformed.")
      }
      const key = node.login.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      logins.push(node.login)
    }
    options?.budget?.consumeItems(logins.length)
    return logins
  }
}

export const loadGitHubMentionableUsers = createMentionableUserLoader(githubTransport)
