import type { PullCheck, PullContext, PullReviewThread, ReviewThreadComment } from "../models"
import { parseReactionGroups, parseReactionState, reactionFields } from "./reactions"
import type { GitHubTransport } from "./transport"

type ObjectValue = Record<string, unknown>

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid PR details response")
  return value as ObjectValue
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid PR details text")
  return value
}

function optionalText(value: unknown): string | undefined {
  return value == null ? undefined : text(value)
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid PR details boolean")
  return value
}

function optionalNumber(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Invalid PR details number")
  return value
}

function login(value: unknown): string {
  return value == null ? "ghost" : optionalText(object(value).login) || "ghost"
}

class HeadChangedError extends Error {
  constructor() { super("The PR head changed while loading details. Reload to try again.") }
}

const pageInfo = "pageInfo { hasNextPage endCursor }"
const commentFields = `id author { login } authorAssociation body createdAt updatedAt url
  pullRequestReview { databaseId } replyTo { id }
  ${reactionFields}`

function comment(value: unknown): ReviewThreadComment {
  const node = object(value)
  return {
    id: text(node.id), author: login(node.author), authorAssociation: text(node.authorAssociation),
    body: text(node.body), createdAt: text(node.createdAt), updatedAt: text(node.updatedAt), url: text(node.url),
    reviewId: node.pullRequestReview == null ? undefined : optionalNumber(object(node.pullRequestReview).databaseId),
    replyToId: node.replyTo == null ? undefined : text(object(node.replyTo).id),
    reactions: parseReactionGroups(node.reactionGroups),
    ...parseReactionState(node),
  }
}

function check(value: unknown): PullCheck {
  const node = object(value)
  let state: PullCheck["state"] = "unknown"
  let name: string
  let url: string | undefined
  if (node.__typename === "CheckRun") {
    name = text(node.name)
    url = optionalText(node.detailsUrl)
    const status = text(node.status)
    if (["QUEUED", "WAITING", "IN_PROGRESS", "REQUESTED", "PENDING"].includes(status)) state = "pending"
    else if (status === "COMPLETED") {
      switch (node.conclusion) {
        case "SUCCESS": state = "success"; break
        case "NEUTRAL": state = "neutral"; break
        case "SKIPPED": state = "skipped"; break
        case "CANCELLED": state = "cancelled"; break
        case "FAILURE": case "TIMED_OUT": case "ACTION_REQUIRED": case "STARTUP_FAILURE": case "STALE":
          state = "failure"; break
      }
    }
  } else if (node.__typename === "StatusContext") {
    name = text(node.context)
    url = optionalText(node.targetUrl)
    switch (node.state) {
      case "SUCCESS": state = "success"; break
      case "FAILURE": case "ERROR": state = "failure"; break
      case "PENDING": state = "pending"; break
    }
  } else throw new Error("Unknown PR check type")
  return { id: text(node.id), name, state, url, required: node.isRequired == null ? undefined : boolean(node.isRequired) }
}

// Refuse missing or non-advancing page metadata instead of returning a truncated collection.
function page(value: unknown, cursors: Set<string>) {
  const connection = object(value)
  if (!Array.isArray(connection.nodes)) throw new Error("Missing PR details connection nodes")
  const info = object(connection.pageInfo)
  const more = boolean(info.hasNextPage)
  const end = optionalText(info.endCursor)
  if (more && (!end || cursors.has(end))) throw new Error("Invalid PR details pagination cursor")
  if (more) cursors.add(end!)
  return { nodes: connection.nodes, next: more ? end : undefined }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createGitHubPullContext(transport: GitHubTransport) {
  return {
    async pullContext(repository: string, number: number): Promise<PullContext> {
      if (!transport.graphql) throw new Error("PR details require GraphQL")
      if (!Number.isSafeInteger(number) || number <= 0) throw new Error("Invalid pull request number")
      const [owner, name, ...extra] = repository.split("/")
      if (!owner || !name || extra.length) throw new Error("Invalid pull request repository")
      const variables = { owner, name }
      const graphql = transport.graphql.bind(transport)
      async function request(query: string, args: Record<string, string>) {
        const response = object(await graphql<unknown>(query, args))
        if (response.errors != null) {
          if (!Array.isArray(response.errors)) throw new Error("Invalid GraphQL errors response")
          if (response.errors.length) {
            throw new Error(response.errors.map(error => optionalText(object(error).message) || "GraphQL error").join("; "))
          }
        }
        return object(response.data)
      }
      async function pull(operation: string, fields: string, cursor?: string) {
        const paginated = operation !== "PullContext"
        const data = await request(`query ${operation}($owner: String!, $name: String!${paginated ? ", $cursor: String" : ""}) {
          repository(owner: $owner, name: $name) { pullRequest(number: ${number}) { ${fields} } }
        }`, cursor === undefined ? variables : { ...variables, cursor })
        return object(object(data.repository).pullRequest)
      }
      const core = await pull("PullContext", `headRefOid isDraft mergeable mergeStateStatus reviewDecision milestone { title url dueOn }`)
      const headSha = text(core.headRefOid)
      if (!headSha) throw new Error("Missing PR head SHA")
      const mergeable = text(core.mergeable)
      if (!["MERGEABLE", "CONFLICTING", "UNKNOWN"].includes(mergeable)) throw new Error("Invalid PR mergeability")
      const reviewDecision = core.reviewDecision === null ? null : optionalText(core.reviewDecision)
      if (reviewDecision && !["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(reviewDecision)) {
        throw new Error("Invalid PR review decision")
      }
      const readiness: PullContext["readiness"] = {
        headSha, isDraft: boolean(core.isDraft), mergeable: mergeable as PullContext["readiness"]["mergeable"],
        mergeStateStatus: text(core.mergeStateStatus),
        reviewDecision: reviewDecision as PullContext["readiness"]["reviewDecision"],
        checks: [], checksComplete: false,
      }
      const milestone = core.milestone == null ? undefined : object(core.milestone)
      function sameHead(node: ObjectValue) {
        if (node.headRefOid != null && text(node.headRefOid) !== headSha) throw new HeadChangedError()
      }
      async function collection<T>(operation: string, fields: string, select: (node: ObjectValue) => unknown,
        parse: (node: unknown) => T, id: (node: T) => string, verifyHead = false): Promise<T[]> {
        const result = new Map<string, T>()
        const cursors = new Set<string>()
        let cursor: string | undefined
        do {
          const node = await pull(operation, fields, cursor)
          if (verifyHead) sameHead(node)
          const current = page(select(node), cursors)
          for (const value of current.nodes) {
            const item = parse(value)
            result.set(id(item), item)
          }
          cursor = current.next
        } while (cursor !== undefined)
        return [...result.values()]
      }
      async function threads(): Promise<PullReviewThread[]> {
        const nodes = await collection("PullThreads", `headRefOid reviewThreads(first: 100, after: $cursor) {
          nodes { id path line originalLine isResolved isOutdated resolvedBy { login }
            comments(first: 100) { nodes { ${commentFields} } ${pageInfo} }
          } ${pageInfo}
        }`, node => node.reviewThreads, object, node => text(node.id), true)
        const result = new Array<PullReviewThread>(nodes.length)
        let index = 0
        // Each worker finishes a thread's exact-node pagination before taking another thread.
        await Promise.all(Array.from({ length: Math.min(4, nodes.length) }, async () => {
          while (index < nodes.length) {
            const position = index++
            const node = nodes[position]!
            const id = text(node.id)
            const comments = new Map<string, ReviewThreadComment>()
            const cursors = new Set<string>()
            let current = page(node.comments, cursors)
            while (true) {
              for (const value of current.nodes) {
                const item = comment(value)
                comments.set(item.id, item)
              }
              if (current.next === undefined) break
              const data = await request(`query PullThreadComments($id: ID!, $cursor: String) {
                node(id: $id) { ... on PullRequestReviewThread { id
                  pullRequest { headRefOid }
                  comments(first: 100, after: $cursor) { nodes { ${commentFields} } ${pageInfo} }
                } }
              }`, { id, cursor: current.next })
              const thread = object(data.node)
              if (thread.id !== id) throw new Error("Unexpected review thread in PR details")
              if (thread.pullRequest != null) sameHead(object(thread.pullRequest))
              sameHead(thread)
              current = page(thread.comments, cursors)
            }
            const items = [...comments.values()]
            result[position] = {
              kind: "review-thread", id, path: text(node.path), line: optionalNumber(node.line),
              originalLine: optionalNumber(node.originalLine), isResolved: boolean(node.isResolved),
              isOutdated: boolean(node.isOutdated),
              resolvedBy: node.resolvedBy == null ? undefined : login(node.resolvedBy),
              createdAt: items[0]?.createdAt, comments: items,
            }
          }
        }))
        return result
      }
      async function checks() {
        const items = await collection("PullChecks", `headRefOid commits(last: 1) { nodes { commit {
          statusCheckRollup { contexts(first: 100, after: $cursor) {
            nodes { __typename
              ... on CheckRun { id name status conclusion detailsUrl isRequired(pullRequestNumber: ${number}) }
              ... on StatusContext { id context state targetUrl isRequired(pullRequestNumber: ${number}) }
            } ${pageInfo}
          } }
        } } }`, node => {
          const commits = object(node.commits).nodes
          if (!Array.isArray(commits) || commits.length !== 1) throw new Error("Missing PR head commit checks")
          const rollup = object(object(commits[0]).commit).statusCheckRollup
          if (rollup == null) return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
          return object(rollup).contexts
        }, check, item => item.id, true)
        return { checks: items, checksComplete: true }
      }
      // Optional API surfaces fail independently; neither can erase threads or readiness.
      const [threadItems, checkResult, projectsResult, issuesResult] = await Promise.all([
        threads(),
        checks().then(value => ({ value, warning: undefined })).catch((error: unknown) => {
          if (error instanceof HeadChangedError) throw error
          return { value: undefined, warning: `Could not load PR checks; readiness is incomplete: ${message(error)}` }
        }),
        collection("PullProjects", `projectItems(first: 100, after: $cursor) {
          nodes { id project { title url } } ${pageInfo}
        }`, node => node.projectItems, value => {
          const node = object(value)
          const project = object(node.project)
          return { id: text(node.id), title: text(project.title), url: text(project.url) }
        }, item => item.id).then(value => ({ value, warning: undefined })).catch((error: unknown) => ({
          value: undefined, warning: `Could not load PR projects (access may be restricted): ${message(error)}`,
        })),
        collection("PullClosingIssues", `closingIssuesReferences(first: 100, after: $cursor) {
          nodes { number title state url repository { nameWithOwner } } ${pageInfo}
        }`, node => node.closingIssuesReferences, value => {
          const node = object(value)
          const issueNumber = optionalNumber(node.number)
          if (issueNumber === undefined || issueNumber <= 0 || !["OPEN", "CLOSED"].includes(text(node.state))) {
            throw new Error("Invalid closing issue")
          }
          return { number: issueNumber, title: text(node.title), url: text(node.url),
            repository: text(object(node.repository).nameWithOwner), state: node.state === "OPEN" ? "open" as const : "closed" as const }
        }, item => `${item.repository}#${item.number}`).then(value => ({ value, warning: undefined })).catch((error: unknown) => ({
          value: undefined, warning: `Could not load closing issues (access may be restricted): ${message(error)}`,
        })),
      ])
      return {
        threads: threadItems,
        milestone: milestone ? { title: text(milestone.title), url: text(milestone.url), dueAt: optionalText(milestone.dueOn) } : undefined,
        projects: projectsResult.value, closingIssues: issuesResult.value,
        readiness: { ...readiness, ...checkResult.value },
        warnings: [checkResult.warning, projectsResult.warning, issuesResult.warning].filter((value): value is string => value !== undefined),
      }
    },
  }
}
