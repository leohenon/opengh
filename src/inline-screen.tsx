import { Match, Switch } from "solid-js"
import { loadConfig, type Config } from "./config"
import type { LaunchOptions } from "./launch-target"
import type { CommitDetail, CommitSummary, IssueSummary, PullRequestSummary, Repo, WorkflowRunSummary } from "./models"
import type { IssueDetailState, PullDetailState, RepositoryDocumentState, RunDetailState } from "./repository-state"
import type { createGitHubClient } from "./github/client"
import { allPages } from "./inline"
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
export type InlineScreenData =
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

export async function loadInlineScreen(repository: string, launch: LaunchOptions, client: Client): Promise<InlineScreenData> {
  let detail = launch.initialDetail
  if (detail?.kind === "number") detail = { kind: await client.issueKind(repository, detail.number), number: detail.number }
  if (detail?.kind === "issue" || detail?.kind === "pull") {
    const number = detail.number
    const comments = allPages(index => client.issueComments(repository, number, index))
    const timeline = client.issueTimeline(repository, number)
    const metadata = client.metadata(repository)
    if (detail.kind === "issue") {
      const [issue, discussion, activity, repo] = await Promise.all([client.issue(repository, number), comments, timeline, metadata])
      return { kind: "issue", defaultBranch: repo.defaultBranch, detail: { number, resource: ready(issue), comments: page(discussion),
        references: ready(activity.references), events: activity.events } }
    }
    const [pull, discussion, activity, context, commits, repo] = await Promise.all([
      client.pull(repository, number), comments, timeline, client.pullContext(repository, number), client.pullCommits(repository, number), metadata,
    ])
    return { kind: "pull", defaultBranch: repo.defaultBranch, detail: { number, resource: ready(pull), comments: page(discussion),
      references: ready(activity.references), events: activity.events, context: ready(context), commits: ready(commits) } }
  }
  if (detail?.kind === "commit") {
    const sha = detail.sha
    const commit = await client.commit(repository, sha)
    const files = [...commit.files.items]
    let current = commit
    while (current.files.hasMore) {
      current = await client.commit(repository, sha, current.files.page + 1)
      files.push(...current.files.items)
    }
    return { kind: "commit", commit: { ...commit, files: { ...current.files, items: files, hasMore: false }, filesTruncated: current.filesTruncated } }
  }
  if (detail?.kind === "run") {
    const run = await client.run(repository, detail.id)
    const jobs = await allPages(index => client.runJobs(repository, run.id, run.attempt, index))
    return { kind: "run", detail: { id: run.id, resource: ready(run), jobs: page(jobs) } }
  }
  const kind = launch.initialPage ?? "overview"
  if (kind === "issues" || kind === "pulls") {
    const items = await allPages(index => kind === "issues" ? client.issues(repository, "open", index) : client.pulls(repository, "open", index))
    // Closed counts are not part of this open-items snapshot.
    return { kind, items, closedCount: "—" }
  }
  if (kind === "commits") {
    const repo = await client.metadata(repository)
    return { kind, branch: repo.defaultBranch, items: await allPages(index => client.commits(repository, repo.defaultBranch, index)) }
  }
  if (kind === "actions") return { kind, items: await allPages(index => client.runs(repository, index)) }
  const repo = await client.metadata(repository)
  const documents = await client.documents(repo, repo.defaultBranch)
  const document = documents.find(document => document.label === "README") ?? documents[0]
  return { kind: "overview", repo, documents: document ? [{ ...document, resource: ready(await client.document(document)) }] : [] }
}

export function InlineScreen(props: { data: InlineScreenData; config: Config }) {
  return <Switch>
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
  const [data, config] = await Promise.all([loadInlineScreen(repository, launch, client), loadConfig()])
  const inlineConfig: Config = { ...config, detailLayout: "wide" }
  return renderStaticPage(() => <InlineScreen data={data} config={inlineConfig} />, { width, config: inlineConfig, color })
}
