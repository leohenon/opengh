import { createGitHubClient } from "./github/client"
import { githubTransport } from "./github/transport"
import { resolveRepository } from "./github/repository"
import type { LaunchOptions } from "./launch-target"

const defaultClient = createGitHubClient(githubTransport)

export async function allPages<T>(load: (page: number) => Promise<{ items: T[]; hasMore: boolean }>): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; ; page++) {
    const result = await load(page)
    items.push(...result.items)
    if (!result.hasMore) return items
  }
}

// Preserve complete Markdown bodies when output is redirected.
// Strip terminal controls from remote content; never interpret it as terminal commands.
function safeOutput(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
}

export async function inlinePage(
  repository: string,
  launch: LaunchOptions,
  client = defaultClient,
): Promise<string> {
  let detail = launch.initialDetail
  if (detail?.kind === "number") detail = { kind: await client.issueKind(repository, detail.number), number: detail.number }
  const sections: string[] = []
  if (detail?.kind === "issue" || detail?.kind === "pull") {
    const number = detail.number
    const item = detail.kind === "pull" ? await client.pull(repository, number) : await client.issue(repository, number)
    const state = "merged" in item && item.merged ? "merged" : "draft" in item && item.draft ? "draft" : item.state
    sections.push(`# ${repository} #${item.number}: ${item.title}`, item.url,
      `${state} · @${item.author} · ${item.createdAt} · ${item.commentCount} comments`,
      ...(item.labels.length ? [`Labels: ${item.labels.join(", ")}`] : []),
      ...(item.assignees.length ? [`Assignees: ${item.assignees.join(", ")}`] : []),
      ...("baseBranch" in item ? [`${item.headBranch} → ${item.baseBranch} · +${item.additions} −${item.deletions} · ${item.changedFiles} files`] : []),
      item.body || "No description provided.")
    const comments = await allPages(page => client.issueComments(repository, number, page))
    for (const comment of comments) sections.push(`## @${comment.author} · ${comment.createdAt}`, comment.body)
    if (detail.kind === "pull") {
      const timeline = await client.issueTimeline(repository, number)
      for (const event of timeline.events) {
        if (event.kind === "review") sections.push(`## Review: ${event.state} · @${event.actor} · ${event.createdAt}`, event.body)
      }
      const context = await client.pullContext(repository, number)
      for (const thread of context.threads) {
        sections.push(`## ${thread.path}:${thread.line ?? thread.originalLine ?? ""}${thread.isResolved ? " (resolved)" : ""}`)
        for (const comment of thread.comments) sections.push(`### @${comment.author} · ${comment.createdAt}`, comment.body)
      }
      for (const warning of context.warnings) sections.push(`Warning: ${warning}`)
    }
  } else if (detail?.kind === "commit") {
    const sha = detail.sha
    const commit = await client.commit(repository, sha)
    sections.push(`# ${repository} · ${commit.sha}`, `https://github.com/${repository}/commit/${commit.sha}`,
      `${commit.author} · ${commit.date}`, commit.fullMessage)
    const files = [...commit.files.items]
    let current = commit
    while (current.files.hasMore) {
      current = await client.commit(repository, sha, current.files.page + 1)
      files.push(...current.files.items)
    }
    sections.push("## Files", files.map(file => `${file.status} ${file.path} (+${file.additions} −${file.deletions})`).join("\n"))
    if (current.filesTruncated) sections.push("GitHub truncated the file list; see the commit URL for more.")
  } else if (detail?.kind === "run") {
    const run = await client.run(repository, detail.id)
    sections.push(`# ${repository} · ${run.title}`, run.url,
      `${run.name} · ${run.conclusion || run.status} · ${run.branch} · ${run.sha}`)
    const jobs = await allPages(page => client.runJobs(repository, run.id, run.attempt, page))
    for (const job of jobs) sections.push(`## ${job.name} · ${job.conclusion || job.status}`,
      job.steps.map(step => `${step.number}. ${step.name} · ${step.conclusion || step.status}`).join("\n"))
  } else {
    const page = launch.initialPage ?? "overview"
    sections.push(`# ${repository} · ${page}`, `https://github.com/${repository}`)
    if (page === "overview") {
      const repo = await client.metadata(repository)
      sections.push(repo.description)
      const documents = await client.documents(repo, repo.defaultBranch)
      const document = documents.find(document => document.label === "README") ?? documents[0]
      if (document) sections.push(await client.document(document))
    } else if (page === "issues" || page === "pulls") {
      const items = await allPages(index => page === "issues" ? client.issues(repository, "open", index) : client.pulls(repository, "open", index))
      sections.push(items.map(item => `#${item.number} ${item.title} · @${item.author}`).join("\n") || "No open items.")
    } else if (page === "commits") {
      const commits = await allPages(index => client.commits(repository, "", index))
      sections.push(commits.map(commit => `${commit.sha} ${commit.message} · ${commit.author} · ${commit.date}`).join("\n") || "No commits.")
    } else {
      const runs = await allPages(index => client.runs(repository, index))
      sections.push(runs.map(run => `${run.id} ${run.title} · ${run.conclusion || run.status}`).join("\n") || "No workflow runs.")
    }
  }
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
