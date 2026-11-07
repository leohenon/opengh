import type { Repo } from "../models"

export type RepositoryTarget = Pick<Repo, "id" | "nodeId" | "nameWithOwner">
export type RepositoryReference = string | RepositoryTarget

export function repositoryName(repository: RepositoryReference): string {
  return typeof repository === "string" ? repository : repository.nameWithOwner
}

export function repositoryPath(repository: RepositoryReference): string {
  if (typeof repository !== "string") {
    if (!Number.isSafeInteger(repository.id) || repository.id <= 0) throw new Error("Repository ID must be a positive safe integer.")
    return `repositories/${repository.id}`
  }
  if (!/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository)
    || repository.split("/").some(part => part === "." || part === "..")) throw new Error("Invalid repository name.")
  return `repos/${repository}`
}

export function repositorySelector(repository: RepositoryReference): {
  declarations: string
  variables: Record<string, string>
  select(fields: string): string
} {
  repositoryPath(repository)
  if (typeof repository !== "string") {
    if (typeof repository.nodeId !== "string" || !repository.nodeId.trim()) throw new Error("Repository node ID must not be blank.")
    return {
      declarations: "$repositoryId: ID!",
      variables: { repositoryId: repository.nodeId },
      select: fields => `repository: node(id: $repositoryId) { ... on Repository { id ${fields} } }`,
    }
  }
  const [owner, name] = repository.split("/") as [string, string]
  return {
    declarations: "$owner: String!, $name: String!",
    variables: { owner, name },
    select: fields => `repository(owner: $owner, name: $name) { ${fields} }`,
  }
}
