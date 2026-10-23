import { expect, test } from "bun:test"
import { createGitHubClient } from "../src/github/client"
import { createGitHubReactions } from "../src/github/reactions"
import type { ReactionKind, ReactionTarget } from "../src/models"

const group = (content = "HEART", count = 9, viewer = true) => ({ content, users: { totalCount: count }, viewerHasReacted: viewer })
const subject = (id: string, content = "HEART") => ({ id, viewerCanReact: true, reactionGroups: [group(content)] })

test("reaction additions resolve each subject type and use authoritative, idempotent GitHub snapshots", async () => {
  const cases: { target: ReactionTarget; id: string; kind: ReactionKind; content: string }[] = [
    { target: { kind: "issue", number: 42 }, id: "I42", kind: "heart", content: "HEART" },
    { target: { kind: "pull", number: 43 }, id: "PR43", kind: "+1", content: "THUMBS_UP" },
    { target: { kind: "comment", parent: "pull", number: 43, id: 99 }, id: "C99", kind: "eyes", content: "EYES" },
    { target: { kind: "review-comment", number: 43, id: "RC1" }, id: "RC1", kind: "rocket", content: "ROCKET" },
  ]
  let current = cases[0]!
  const paths: string[] = []
  const client = createGitHubReactions({
    async json<T>(path: string) {
      paths.push(path)
      const target = current.target
      return (target.kind === "comment" ? { id: target.id, node_id: current.id, issue_url: `https://api.github.com/repos/owner/repo/issues/${target.number}` }
        : { number: target.number, node_id: current.id, ...(target.kind === "pull" ? { pull_request: {} } : {}) }) as T
    },
    async text() { return "" },
    async graphql<T>(query: string, variables: Record<string, string>) {
      if (query.includes("query ReactionSubject")) return { data: { node: { id: "RC1", __typename: "PullRequestReviewComment",
        pullRequest: { number: 43, repository: { nameWithOwner: "owner/repo" } } } } } as T
      expect(query).toContain("mutation AddReaction")
      expect(query).toContain("users: reactors")
      expect(variables).toEqual({ id: current.id, content: current.content })
      return { data: { addReaction: { subject: subject(current.id, current.content) } } } as T
    },
  })
  for (current of cases) {
    const result = await client.addReaction("owner/repo", current.target, current.kind)
    expect(result).toEqual({ reactions: { [current.kind]: 9 }, viewerReactions: [current.kind], canReact: true })
  }
  expect(paths).toEqual(["repos/owner/repo/issues/42", "repos/owner/repo/issues/43", "repos/owner/repo/issues/comments/99"])
  current = cases[0]!
  for (const [kind, content] of Object.entries({ "+1": "THUMBS_UP", "-1": "THUMBS_DOWN", laugh: "LAUGH", hooray: "HOORAY",
    confused: "CONFUSED", heart: "HEART", rocket: "ROCKET", eyes: "EYES" })) {
    current = { ...cases[0]!, kind: kind as ReactionKind, content }
    expect((await client.addReaction("owner/repo", current.target, current.kind)).reactions[current.kind]).toBe(9)
  }
  expect((await client.addReaction("owner/repo", current.target, current.kind)).reactions[current.kind]).toBe(9)
})

test("reaction writes reject wrong subjects, GraphQL errors and unconfirmed results rather than guessing counts", async () => {
  let writes = 0
  let wrongParent = true
  let reply: unknown = { data: { addReaction: { subject: subject("I42") } }, errors: [{ message: "Permission denied" }] }
  const client = createGitHubReactions({
    async json<T>() { return { number: 42, node_id: "I42" } as T },
    async text() { return "" },
    async graphql<T>(query: string) {
      if (query.includes("query ReactionSubject")) return { data: { node: { id: "RC1", __typename: "PullRequestReviewComment",
        pullRequest: { number: wrongParent ? 44 : 43, repository: { nameWithOwner: "owner/repo" } } } } } as T
      writes++
      return reply as T
    },
  })
  await expect(client.addReaction("owner/repo", { kind: "review-comment", number: 43, id: "RC1" }, "heart")).rejects.toThrow("does not belong")
  await expect(client.addReaction("owner/repo", { kind: "pull", number: 42 }, "heart")).rejects.toThrow("does not match")
  await expect(client.addReaction("owner/repo", { kind: "issue", number: 0 }, "heart")).rejects.toThrow("parent number")
  await expect(client.addReaction("owner/repo", { kind: "issue", number: 42 }, "invalid" as ReactionKind)).rejects.toThrow("Unsupported")
  await expect(client.addReaction("owner/repo", { kind: "issue", number: 42, nodeId: "OLD-SUBJECT" }, "heart")).rejects.toThrow("subject changed")
  expect(writes).toBe(0)
  await expect(client.addReaction("owner/repo", { kind: "issue", number: 42 }, "heart")).rejects.toThrow("Permission denied")
  for (const bad of [
    { ...subject("I42"), reactionGroups: [group("HEART", -1)] },
    { ...subject("I42"), reactionGroups: [group("HEART", 9, false)] }, subject("OTHER"),
  ]) {
    reply = { data: { addReaction: { subject: bad } } }
    await expect(client.addReaction("owner/repo", { kind: "issue", number: 42 }, "heart")).rejects.toThrow("did not confirm")
  }
  wrongParent = false
  reply = { data: { addReaction: { subject: subject("RC1") } } }
  expect((await client.addReaction("owner/repo", { kind: "review-comment", number: 43, id: "RC1" }, "heart")).reactions.heart).toBe(9)
})

test("description and comment reads retain REST fallback and enrich viewer state without breaking permissions", async () => {
  const date = "2026-01-01T00:00:00Z"
  const issue = { node_id: "I42", number: 42, state: "open", title: "Issue", user: { login: "author" }, created_at: date, updated_at: date,
    html_url: "https://github.com/owner/repo/issues/42", body: "Body", locked: false, closed_at: null, state_reason: null,
    labels: [], assignees: [], milestone: null, comments: 1, reactions: { heart: 2 } }
  let failed = false
  const client = createGitHubClient({
    async json<T>(path: string) {
      if (path.includes("/comments?")) return [{ id: 99, node_id: "C99", user: null, body: "Comment", created_at: date, updated_at: date, reactions: { heart: 2 } }] as T
      if (path.includes("/pulls/")) return { ...issue, node_id: "PR43", number: 43, html_url: "https://github.com/owner/repo/pull/43", merged_at: null, draft: false, base: { ref: "main" }, head: { ref: "next", repo: null },
        additions: 1, deletions: 0, changed_files: 1, commits: 0, review_comments: 0, requested_reviewers: [], requested_teams: [], mergeable: true, mergeable_state: "clean" } as T
      return issue as T
    },
    async text() { return "" },
    async graphql<T>(query: string) {
      if (failed) throw new Error("GraphQL unavailable")
      expect(query).toContain("viewerHasReacted")
      if (query.includes("CommentReactions")) return { data: { nodes: [subject("C99")] } } as T
      return { data: { repository: { isArchived: false, viewerPermission: "WRITE",
        issue: { ...subject("I42"), viewerCanClose: true, viewerCanReopen: false, viewerCanAssign: true }, pullRequest: subject("PR43") } } } as T
    },
  })
  expect(await client.issue("owner/repo", 42)).toMatchObject({ nodeId: "I42", reactions: { heart: 9 }, viewerReactions: ["heart"], canReact: true, permissions: { comment: true } })
  expect(await client.pull("owner/repo", 43)).toMatchObject({ reactions: { heart: 9 }, viewerReactions: ["heart"], canReact: true })
  expect((await client.issueComments("owner/repo", 42)).items[0]).toMatchObject({ id: 99, nodeId: "C99", reactions: { heart: 9 }, viewerReactions: ["heart"] })
  failed = true
  expect((await client.issue("owner/repo", 42)).reactions).toEqual({ heart: 2 })
  expect((await client.pull("owner/repo", 43)).reactions).toEqual({ heart: 2 })
  const comment = (await client.issueComments("owner/repo", 42)).items[0]!
  expect(comment.reactions).toEqual({ heart: 2 })
  expect(comment.viewerReactions).toBeUndefined()
})
