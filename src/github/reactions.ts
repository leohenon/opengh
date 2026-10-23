import { reactionKinds, type ReactionCounts, type ReactionKind, type ReactionState, type ReactionTarget } from "../models"
import { reactionKey, validateReactionKind } from "../reactions"
import { normalizeRepository } from "../repository-name"
import type { GitHubTransport } from "./transport"

const contents: Record<string, ReactionKind> = {
  THUMBS_UP: "+1", THUMBS_DOWN: "-1", LAUGH: "laugh", HOORAY: "hooray",
  CONFUSED: "confused", HEART: "heart", ROCKET: "rocket", EYES: "eyes",
}

export const reactionFields = "viewerCanReact reactionGroups { content viewerHasReacted users: reactors { totalCount } }"

export function parseReactions(value: unknown): ReactionCounts | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const source = value as Record<string, unknown>
  const result: ReactionCounts = {}
  for (const kind of reactionKinds) {
    const count = source[kind]
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) result[kind] = count
  }
  return result
}

export function parseReactionGroups(value: unknown): ReactionCounts | undefined {
  if (!Array.isArray(value)) return
  const result: ReactionCounts = {}
  for (const group of value) {
    const kind = typeof group?.content === "string" && Object.hasOwn(contents, group.content) ? contents[group.content] : undefined
    const count = group?.users?.totalCount
    if (kind && typeof count === "number" && Number.isSafeInteger(count) && count >= 0) result[kind] = count
  }
  return result
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reaction response from GitHub.")
  return value as Record<string, unknown>
}

export function parseReactionState(value: unknown): ReactionState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const source = value as Record<string, unknown>
  if (typeof source.viewerCanReact !== "boolean" || !Array.isArray(source.reactionGroups)) return
  const reactions: ReactionCounts = {}
  const viewerReactions: ReactionKind[] = []
  for (const group of source.reactionGroups) {
    const kind = typeof group?.content === "string" && Object.hasOwn(contents, group.content) ? contents[group.content] : undefined
    if (!kind) continue
    const count = group?.users?.totalCount
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0
      || typeof group.viewerHasReacted !== "boolean" || reactions[kind] !== undefined
      || group.viewerHasReacted && count === 0) return
    reactions[kind] = count
    if (group.viewerHasReacted) viewerReactions.push(kind)
  }
  return { reactions, viewerReactions, canReact: source.viewerCanReact }
}

export function createGitHubReactions(transport: GitHubTransport) {
  const request = async (query: string, variables: Record<string, string> = {}) => {
    if (!transport.graphql) throw new Error("Reactions require GitHub GraphQL access.")
    const response = object(await transport.graphql<unknown>(query, variables))
    if (response.errors != null) {
      if (!Array.isArray(response.errors)) throw new Error("Invalid reaction errors response from GitHub.")
      if (response.errors.length) throw new Error(response.errors.map((error) =>
        typeof error?.message === "string" ? error.message : "GitHub reaction request failed.").join(" · "))
    }
    return object(response.data)
  }
  const validRepository = (repository: string) => {
    if (!normalizeRepository(repository) || repository.trim() !== repository || repository.split("/").length !== 2
      || repository.split("/").some((part) => part === "." || part === ".."))
      throw new Error("Invalid reaction repository.")
  }
  const addReaction = async (repository: string, requested: ReactionTarget, kind: ReactionKind): Promise<ReactionState> => {
    const target = { ...requested }
    reactionKey(target)
    validateReactionKind(kind)
    validRepository(repository)
    if (!transport.graphql) throw new Error("Reactions require GitHub GraphQL access.")
    let id: string
    if (target.kind === "review-comment") {
      const data = await request(`query ReactionSubject($id: ID!) { node(id: $id) {
        __typename ... on PullRequestReviewComment { id pullRequest { number repository { nameWithOwner } } }
      } }`, { id: target.id })
      const node = object(data.node)
      const pull = object(node.pullRequest)
      if (node.__typename !== "PullRequestReviewComment" || node.id !== target.id || pull.number !== target.number
        || String(object(pull.repository).nameWithOwner).toLowerCase() !== repository.toLowerCase())
        throw new Error("Review comment does not belong to this pull request and repository.")
      id = target.id
    } else {
      const path = target.kind === "comment" ? `issues/comments/${target.id}` : `issues/${target.number}`
      const node = object(await transport.json<unknown>(`repos/${repository}/${path}`))
      if (target.kind === "comment") {
        const parent = typeof node.issue_url === "string" ? /\/issues\/([1-9]\d*)$/.exec(node.issue_url)?.[1] : undefined
        if (node.id !== target.id || Number(parent) !== target.number) throw new Error("Comment does not belong to this issue or pull request.")
      } else if (node.number !== target.number || (node.pull_request != null) !== (target.kind === "pull")) {
        throw new Error("Reaction description does not match the requested issue or pull request.")
      }
      if (typeof node.node_id !== "string" || !node.node_id.trim()) throw new Error("Missing reaction subject ID from GitHub.")
      id = node.node_id
    }
    if (target.nodeId !== undefined && target.nodeId !== id) throw new Error("The reaction subject changed. Refresh the message before retrying.")
    const content = Object.keys(contents).find((content) => contents[content] === kind)!
    const data = await request(`mutation AddReaction($id: ID!, $content: ReactionContent!) {
      addReaction(input: { subjectId: $id, content: $content }) { subject { id ${reactionFields} } }
    }`, { id, content })
    const subject = object(object(data.addReaction).subject)
    const value = parseReactionState(subject)
    if (subject.id !== id || !value || !value.viewerReactions.includes(kind))
      throw new Error("GitHub did not confirm the requested reaction. Refresh the message before retrying.")
    return value
  }
  const bodyReactions = async (repository: string, number: number, kind: "issue" | "pull"): Promise<ReactionState | undefined> => {
    if (!transport.graphql || !Number.isSafeInteger(number) || number <= 0) return
    try {
      validRepository(repository)
      const [owner, name] = repository.split("/")
      const field = kind === "issue" ? "issue" : "pullRequest"
      const data = await request(`query BodyReactions($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) { ${field}(number: ${number}) { ${reactionFields} } }
      }`, { owner: owner!, name: name! })
      return parseReactionState(object(data.repository)[field])
    } catch { return undefined } // Optional viewer information must not prevent read-only browsing.
  }
  const commentReactions = async (items: readonly { node_id?: string }[]) => {
    const states = new Map<string, ReactionState>()
    const ids = [...new Set(items.map((item) => item.node_id).filter((id): id is string => typeof id === "string" && Boolean(id.trim())))].slice(0, 100)
    if (!transport.graphql || !ids.length) return states
    try {
      const data = await request(`query CommentReactions { nodes(ids: ${JSON.stringify(ids)}) { ... on Reactable { id ${reactionFields} } } }`)
      if (Array.isArray(data.nodes)) for (const node of data.nodes) {
        const value = parseReactionState(node)
        if (value && typeof node.id === "string" && ids.includes(node.id)) states.set(node.id, value)
      }
    } catch { /* REST counts remain usable when optional viewer information is unavailable. */ }
    return states
  }
  return { addReaction, bodyReactions, commentReactions }
}
