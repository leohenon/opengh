import { Match, Switch } from "solid-js"
import { loadConfig, type Config } from "./config"
import type { LaunchOptions } from "./launch-target"
import type { CommitDetail, CommitSummary, IssueSummary, PullRequestSummary, Repo, WorkflowRunSummary } from "./models"
import type { IssueDetailState, PullDetailState, RepositoryDocumentState, RunDetailState } from "./repository-state"
import type { createGitHubClient } from "./github/client"
import { allPages, createInlineOperation, INLINE_INCOMPLETE, INLINE_MAX_BYTES, safeOutput, type InlineOperation } from "./inline"
import { isRequestInterrupted } from "./github/request-budget"
import { renderStaticPage } from "./ui/static-page"
import { IssueScreen } from "./ui/pages/issue"
import { PullScreen } from "./ui/pages/pull"
import { CommitScreen } from "./ui/pages/commit"
import { RunScreen } from "./ui/pages/run"
import { OverviewScreen } from "./ui/pages/overview"
import { WorkScreen } from "./ui/pages/work"
import { CommitsScreen } from "./ui/pages/commits"
import { ActionsScreen } from "./ui/pages/actions"

type Client = ReturnType<typeof createGitHubClient>
export type InlineScreenData = InlineScreenContent & { incomplete?: boolean }
type InlineScreenContent =
  | { kind: "incomplete"; repository: string }
  | { kind: "issue"; detail: IssueDetailState; defaultBranch?: string }
  | { kind: "pull"; detail: PullDetailState; defaultBranch?: string }
  | { kind: "commit"; commit: CommitDetail }
  | { kind: "run"; detail: RunDetailState }
  | { kind: "overview"; repo: Repo; documents: RepositoryDocumentState[] }
  | { kind: "issues" | "pulls"; items: (IssueSummary | PullRequestSummary)[]; closedCount: string }
  | { kind: "commits"; items: CommitSummary[]; branch: string }
  | { kind: "actions"; items: WorkflowRunSummary[] }

const ready = <T,>(value: T) => ({ status: "ready" as const, value })
const page = <T,>(items: T[]) => ready({ items, page: 1, hasMore: false })

export async function loadInlineScreen(repository: string, launch: LaunchOptions, client: Client, operation?: InlineOperation): Promise<InlineScreenData> {
  const owned = operation ? undefined : createInlineOperation()
  const current = operation ?? owned!
  try {
    const data = await loadScreen(repository, launch, client, current)
    return current.incomplete ? { ...data, incomplete: true } : data
  } catch (error) {
    if (!isRequestInterrupted(error, current.options)) throw error
    current.markIncomplete()
    return { kind: "incomplete", repository }
  } finally { owned?.dispose() }
}

async function loadScreen(repository: string, launch: LaunchOptions, client: Client, operation: InlineOperation): Promise<InlineScreenData> {
  const options = operation.options
  let detail = launch.initialDetail
  if (detail?.kind === "number") detail = { kind: await client.issueKind(repository, detail.number, options), number: detail.number }
  if (detail?.kind === "issue" || detail?.kind === "pull") {
    const number = detail.number
    const comments = allPages(index => client.issueComments(repository, number, index, options), operation)
    const timeline = operation.optional(() => client.issueTimeline(repository, number, options), { references: [], events: [] })
    const metadata = operation.optional(() => client.metadata(repository, options), undefined)
    if (detail.kind === "issue") {
      const [issue, discussion, activity, repo] = await Promise.all([client.issue(repository, number, options), comments, timeline, metadata])
      return { kind: "issue", defaultBranch: repo?.defaultBranch, detail: { number, resource: ready(issue), comments: page(discussion),
        references: ready(activity.references), events: activity.events } }
    }
    const [pull, discussion, activity, context, commits, repo] = await Promise.all([
      client.pull(repository, number, options), comments, timeline, operation.optional(() => client.pullContext(repository, number, options), undefined), operation.optional(() => client.pullCommits(repository, number, options), []), metadata,
    ])
    return { kind: "pull", defaultBranch: repo?.defaultBranch, detail: { number, resource: ready(pull), comments: page(discussion),
      references: ready(activity.references), events: activity.events, context: context ? ready(context) : { status: "error", phase: "load", message: INLINE_INCOMPLETE }, commits: ready(commits) } }
  }
  if (detail?.kind === "commit") {
    const sha = detail.sha
    const commit = await client.commit(repository, sha, 1, options)
    let current = commit
    const files = await allPages(async page => {
      if (page > 1) current = await client.commit(repository, sha, page, options)
      return current.files
    }, operation)
    return { kind: "commit", commit: { ...commit, files: { ...current.files, items: files, hasMore: false }, filesTruncated: current.filesTruncated || operation.incomplete } }
  }
  if (detail?.kind === "run") {
    const run = await client.run(repository, detail.id, options)
    const jobs = await allPages(index => client.runJobs(repository, run.id, run.attempt, index, options), operation)
    return { kind: "run", detail: { id: run.id, resource: ready(run), jobs: page(jobs) } }
  }
  const kind = launch.initialPage ?? "overview"
  if (kind === "issues" || kind === "pulls") {
    const items = await allPages(index => kind === "issues" ? client.issues(repository, "open", index, options) : client.pulls(repository, "open", index, options), operation)
    // Closed counts are not part of this open-items snapshot.
    return { kind, items, closedCount: "—" }
  }
  if (kind === "commits") {
    const repo = await client.metadata(repository, options)
    return { kind, branch: repo.defaultBranch, items: await allPages(index => client.commits(repository, repo.defaultBranch, index, options), operation) }
  }
  if (kind === "actions") return { kind, items: await allPages(index => client.runs(repository, index, options), operation) }
  const repo = await client.metadata(repository, options)
  const documents = await client.documents(repo, repo.defaultBranch, options)
  const document = documents.find(document => document.label === "README") ?? documents[0]
  return { kind: "overview", repo, documents: document ? [{ ...document, resource: ready(await client.document(document, options)) }] : [] }
}

export function InlineScreen(props: { data: InlineScreenData; config: Config }) {
  return <Switch>
    <Match when={props.data.kind === "incomplete" && props.data}>
      {data => <text>{safeOutput(data().repository)}{"\n"}{INLINE_INCOMPLETE}</text>}
    </Match>
    <Match when={props.data.kind === "issue" && props.data}>
      {data => <IssueScreen inlineMetadata number={data().detail.number} detail={data().detail} defaultBranch={data().defaultBranch} interactive={false} showScrollbar={false} detailLayout={props.config.detailLayout} />}
    </Match>
    <Match when={props.data.kind === "pull" && props.data}>
      {data => <PullScreen inlineMetadata number={data().detail.number} detail={data().detail} defaultBranch={data().defaultBranch} interactive={false} showScrollbar={false} detailLayout={props.config.detailLayout} />}
    </Match>
    <Match when={props.data.kind === "commit" && props.data}>
      {data => <CommitScreen sha={data().commit.sha} resource={ready(data().commit)} interactive={false} showScrollbar={false} detailLayout={props.config.detailLayout} />}
    </Match>
    <Match when={props.data.kind === "run" && props.data}>
      {data => <RunScreen id={data().detail.id} detail={data().detail} active={false} interactive={false} showScrollbar={false} detailLayout={props.config.detailLayout} />}
    </Match>
    <Match when={props.data.kind === "overview" && props.data}>
      {data => <OverviewScreen inlineAbout repo={data().repo} documents={ready(data().documents)} scrollRef={() => {}}
        hideDocumentsTab={props.config.hideDocumentsTab} compactHeader={props.config.compactHeader}
        interactive={false} showScrollbar={false} aboutSidebar="auto" detailLayout={props.config.detailLayout} />}
    </Match>
    <Match when={(props.data.kind === "issues" || props.data.kind === "pulls") && props.data}>
      {data => <WorkScreen kind={data().kind === "issues" ? "issue" : "pull"} state="open"
        counts={{ open: String(data().items.length), closed: data().closedCount }} resource={page(data().items)}
        active={false} interactive={false} showScrollbar={false} />}
    </Match>
    <Match when={props.data.kind === "commits" && props.data}>
      {data => <CommitsScreen commits={page(data().items)} commitCount={ready(data().items.length)} currentBranch={data().branch}
        active={false} interactive={false} showScrollbar={false} />}
    </Match>
    <Match when={props.data.kind === "actions" && props.data}>
      {data => <ActionsScreen runs={page(data().items)} active={false} interactive={false} showScrollbar={false} />}
    </Match>
  </Switch>
}

export async function renderInlineScreen(repository: string, launch: LaunchOptions, client: Client, width: number, color: boolean) {
  const operation = createInlineOperation()
  try {
    const [data, config] = await Promise.all([loadInlineScreen(repository, launch, client, operation), loadConfig()])
    const inlineConfig: Config = { ...config, detailLayout: "wide" }
    // Bound the tree before OpenTUI/Markdown can allocate renderables for it.
    const serialized = JSON.stringify(data)
    if (Buffer.byteLength(serialized) > INLINE_MAX_BYTES) {
      // Keep the primary description without building a giant terminal tree.
      const resource = data.kind === "issue" || data.kind === "pull" ? data.detail.resource.value : undefined
      const preview = resource ? `${resource.title}\n\n${resource.body}`
        : data.kind === "commit" ? data.commit.fullMessage
        : data.kind === "overview" ? `${data.repo.description}\n\n${data.documents[0]?.resource.value ?? ""}` : ""
      const bounded = Buffer.from(safeOutput(preview)).subarray(0, INLINE_MAX_BYTES).toString("utf8").replace(/\ufffd$/, "")
      return `${safeOutput(repository)}\n\n${bounded}\n\n${INLINE_INCOMPLETE}\nhttps://github.com/${repository}\n`
    }
    const sanitized: InlineScreenData = JSON.parse(serialized, (_key, value) => typeof value === "string" ? safeOutput(value) : value)
    const output = await renderStaticPage(() => <InlineScreen data={sanitized} config={inlineConfig} />, { width, config: inlineConfig, color })
    const warning = operation.incomplete && !output.includes(INLINE_INCOMPLETE) ? `${INLINE_INCOMPLETE}\n` : ""
    return output + warning + (operation.incomplete || output.includes(INLINE_INCOMPLETE) ? `https://github.com/${safeOutput(repository)}\n` : "")
  } finally { operation.dispose() }
}
