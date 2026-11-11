import { createGitHubClient } from "./github/client"
import { githubTransport } from "./github/transport"
import { createRequestBudget, isRequestInterrupted, RequestBudgetLimitError } from "./github/request-budget"
import { resolveRepository } from "./github/repository"
import type { LaunchOptions } from "./launch-target"

const defaultClient = createGitHubClient(githubTransport)

export const INLINE_MAX_PAGES = 5
export const INLINE_MAX_ITEMS = 500
export const INLINE_MAX_BYTES = 256 * 1024
export const INLINE_INCOMPLETE = "Output is incomplete (inline resource limit). Open this item on GitHub for the full view."

// One budget covers the entire inline operation, including nested client reads.
export function createInlineOperation() {
  const budget = createRequestBudget()
  let remainingItems = INLINE_MAX_ITEMS
  let remainingBytes = INLINE_MAX_BYTES
  let incomplete = false
  return {
    options: { budget, signal: budget.signal },
    get incomplete() { return incomplete },
    markIncomplete() { incomplete = true },
    accept(value: unknown) {
      const bytes = Buffer.byteLength(JSON.stringify(value) ?? "")
      if (remainingItems <= 0 || bytes > remainingBytes) { incomplete = true; return false }
      remainingItems--
      remainingBytes -= bytes
      return true
    },
    async optional<T>(load: () => Promise<T>, fallback: T): Promise<T> {
      try { return await load() } catch (error) {
        if (!isRequestInterrupted(error, { budget })) throw error
        incomplete = true
        return fallback
      }
    },
    dispose() { budget.dispose() },
  }
}
export type InlineOperation = ReturnType<typeof createInlineOperation>

export async function allPages<T>(load: (page: number) => Promise<{ items: T[]; hasMore: boolean }>, operation?: InlineOperation): Promise<T[]> {
  const owned = operation ? undefined : createInlineOperation()
  const current = operation ?? owned!
  const items: T[] = []
  try {
    for (let page = 1; page <= INLINE_MAX_PAGES; page++) {
      const result = await current.optional(() => load(page), { items: [] as T[], hasMore: false })
      for (const item of result.items) {
        if (!current.accept(item)) return items
        items.push(item)
      }
      if (!result.hasMore) return items
    }
    current.markIncomplete()
    return items
  } finally {
    owned?.dispose()
    // Standalone callers cannot accidentally mistake a bounded result for a complete one.
    if (owned?.incomplete) throw new RequestBudgetLimitError("Inline pagination exceeded its limit")
  }
}

// Preserve Markdown bodies verbatim within the inline output budget.
// Strip terminal controls from remote content; never interpret it as terminal commands.
export function safeOutput(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
}

export async function inlinePage(
  repository: string,
  launch: LaunchOptions,
  client = defaultClient,
): Promise<string> {
  const operation = createInlineOperation()
  const options = operation.options
  const sections: string[] = []
  let bytes = 0
  const append = (...values: string[]) => {
    for (const value of values) {
      if (!value) continue
      const safe = safeOutput(value)
      const available = Math.max(0, INLINE_MAX_BYTES - bytes - 2)
      const buffer = Buffer.from(safe)
      const text = buffer.length <= available ? safe : buffer.subarray(0, available).toString("utf8").replace(/\ufffd$/, "")
      if (text) { sections.push(text); bytes += Buffer.byteLength(text) + 2 }
      if (buffer.length > available) {
        operation.markIncomplete()
        throw new RequestBudgetLimitError("Inline output exceeded the 256 KiB limit")
      }
    }
  }
  try {
  let detail = launch.initialDetail
  if (detail?.kind === "number") detail = { kind: await client.issueKind(repository, detail.number, options), number: detail.number }
  if (detail?.kind === "issue" || detail?.kind === "pull") {
    const number = detail.number
    const item = detail.kind === "pull" ? await client.pull(repository, number, options) : await client.issue(repository, number, options)
    const state = "merged" in item && item.merged ? "merged" : "draft" in item && item.draft ? "draft" : item.state
    append(`# ${repository} #${item.number}: ${item.title}`, item.url,
      `${state} · @${item.author} · ${item.createdAt} · ${item.commentCount} comments`,
      ...(item.labels.length ? [`Labels: ${item.labels.join(", ")}`] : []),
      ...(item.assignees.length ? [`Assignees: ${item.assignees.join(", ")}`] : []),
      ...("baseBranch" in item ? [`${item.headBranch} → ${item.baseBranch} · +${item.additions} −${item.deletions} · ${item.changedFiles} files`] : []),
      item.body || "No description provided.")
    const comments = await allPages(page => client.issueComments(repository, number, page, options), operation)
    for (const comment of comments) append(`## @${comment.author} · ${comment.createdAt}`, comment.body)
    if (detail.kind === "pull") {
      const timeline = await client.issueTimeline(repository, number, options)
      for (const event of timeline.events) {
        if (event.kind === "review") append(`## Review: ${event.state} · @${event.actor} · ${event.createdAt}`, event.body)
      }
      const context = await client.pullContext(repository, number, options)
      for (const thread of context.threads) {
        append(`## ${thread.path}:${thread.line ?? thread.originalLine ?? ""}${thread.isResolved ? " (resolved)" : ""}`)
        for (const comment of thread.comments) append(`### @${comment.author} · ${comment.createdAt}`, comment.body)
      }
      for (const warning of context.warnings) append(`Warning: ${warning}`)
    }
  } else if (detail?.kind === "commit") {
    const sha = detail.sha
    const commit = await client.commit(repository, sha, 1, options)
    append(`# ${repository} · ${commit.sha}`, `https://github.com/${repository}/commit/${commit.sha}`,
      `${commit.author} · ${commit.date}`, commit.fullMessage)
    let current = commit
    const files = await allPages(async page => {
      if (page > 1) current = await client.commit(repository, sha, page, options)
      return current.files
    }, operation)
    append("## Files", files.map(file => `${file.status} ${file.path} (+${file.additions} −${file.deletions})`).join("\n"))
    if (current.filesTruncated) append("GitHub truncated the file list; see the commit URL for more.")
  } else if (detail?.kind === "run") {
    const run = await client.run(repository, detail.id, options)
    append(`# ${repository} · ${run.title}`, run.url,
      `${run.name} · ${run.conclusion || run.status} · ${run.branch} · ${run.sha}`)
    const jobs = await allPages(page => client.runJobs(repository, run.id, run.attempt, page, options), operation)
    for (const job of jobs) append(`## ${job.name} · ${job.conclusion || job.status}`,
      job.steps.map(step => `${step.number}. ${step.name} · ${step.conclusion || step.status}`).join("\n"))
  } else {
    const page = launch.initialPage ?? "overview"
    append(`# ${repository} · ${page}`, `https://github.com/${repository}`)
    if (page === "overview") {
      const repo = await client.metadata(repository, options)
      append(repo.description)
      const documents = await client.documents(repo, repo.defaultBranch, options)
      const document = documents.find(document => document.label === "README") ?? documents[0]
      if (document) append(await client.document(document, options))
    } else if (page === "issues" || page === "pulls") {
      const items = await allPages(index => page === "issues" ? client.issues(repository, "open", index, options) : client.pulls(repository, "open", index, options), operation)
      append(items.map(item => `#${item.number} ${item.title} · @${item.author}`).join("\n") || (operation.incomplete ? "" : "No open items."))
    } else if (page === "commits") {
      const commits = await allPages(index => client.commits(repository, "", index, options), operation)
      append(commits.map(commit => `${commit.sha} ${commit.message} · ${commit.author} · ${commit.date}`).join("\n") || (operation.incomplete ? "" : "No commits."))
    } else {
      const runs = await allPages(index => client.runs(repository, index, options), operation)
      append(runs.map(run => `${run.id} ${run.title} · ${run.conclusion || run.status}`).join("\n") || (operation.incomplete ? "" : "No workflow runs."))
    }
  }
  } catch (error) {
    if (!isRequestInterrupted(error, options)) throw error
    operation.markIncomplete()
  } finally { operation.dispose() }
  if (operation.incomplete) sections.push(`${INLINE_INCOMPLETE}\nhttps://github.com/${repository}`)
  return safeOutput(sections.filter(Boolean).join("\n\n")) + "\n"
}

export async function printInline(launch: LaunchOptions, cwd: string) {
  const repository = await resolveRepository(launch.repositoryArgument ?? ".", cwd)
  if (!repository) throw new Error("No GitHub repository found. Specify owner/repo explicitly.")
  let output: string
  if (process.stdout.isTTY) {
    const { renderInlineScreen } = await import("./inline-screen")
    output = await renderInlineScreen(repository, launch, defaultClient, process.stdout.columns || 80,
      !(process.env.NO_COLOR || process.env.TERM === "dumb"))
  } else output = await inlinePage(repository, launch)
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(output, error => error ? reject(error) : resolve())
  })
}
