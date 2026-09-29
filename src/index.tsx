import { render } from "@opentui/solid"
import { createSignal, Match, onMount, Show, Switch } from "solid-js"
import { loadGitHubCommits, loadGitHubData, loadGitHubIssues, loadGitHubPulls, loadGitHubReadme, loadGitHubRuns } from "./github/client"
import { loadRecentRepositories, rememberRepository, resolveRepository } from "./github/repository"
import type { Issue, ListState, PullRequest, RepositoryState } from "./models"
import { App } from "./ui/app"
import {
  LoadingRepository,
  RepositoryLoadError,
  RepositoryPicker,
  ResolvingRepository,
} from "./ui/launcher"

const explicitRepository = process.argv[2] && !process.argv[2].startsWith("-")
  ? process.argv[2]
  : undefined

type View = "resolving" | "picker" | "repository"
type ReadyState = Extract<RepositoryState, { status: "ready" }>
type LoadingState = Extract<RepositoryState, { status: "loading" }>
type ErrorState = Extract<RepositoryState, { status: "error" }>

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "An unknown error occurred"
}

function Root() {
  const [view, setView] = createSignal<View>("resolving")
  const [recent, setRecent] = createSignal<string[]>([])
  const [pickerError, setPickerError] = createSignal("")
  const [state, setState] = createSignal<RepositoryState>({ status: "loading", repository: "" })
  let requestId = 0
  let branchRequestId = 0

  const load = async (nameWithOwner: string) => {
    const id = ++requestId
    setState({ status: "loading", repository: nameWithOwner })
    try {
      const data = await loadGitHubData(nameWithOwner)
      if (id === requestId) setState({ status: "ready", data, refreshing: false })
    } catch (error) {
      if (id === requestId) setState({ status: "error", repository: nameWithOwner, message: messageFrom(error) })
    }
  }

  const open = (nameWithOwner: string) => {
    setView("repository")
    void rememberRepository(nameWithOwner)
    void load(nameWithOwner)
  }

  const switchBranch = async (branch: string) => {
    const current = state()
    if (current.status !== "ready" || current.data.currentBranch === branch) return

    const id = ++branchRequestId
    setState({ ...current, refreshing: true, refreshError: undefined })
    try {
      const [commitPage, readme] = await Promise.all([
        loadGitHubCommits(current.data.repo.nameWithOwner, branch),
        loadGitHubReadme(current.data.repo.nameWithOwner, branch),
      ])
      const latest = state()
      if (id === branchRequestId && latest.status === "ready") {
        setState({
          status: "ready",
          data: {
            ...latest.data,
            readme,
            commits: commitPage.items,
            commitsPage: { page: 1, hasMore: commitPage.hasMore },
            currentBranch: branch,
          },
          refreshing: false,
        })
      }
    } catch (error) {
      const latest = state()
      if (id === branchRequestId && latest.status === "ready") {
        setState({
          ...latest,
          refreshing: false,
          refreshError: messageFrom(error),
        })
      }
    }
  }

  const loadMoreCommits = async () => {
    const current = state()
    if (current.status !== "ready" || !current.data.commitsPage.hasMore) return

    const branch = current.data.currentBranch
    const page = current.data.commitsPage.page + 1
    const result = await loadGitHubCommits(current.data.repo.nameWithOwner, branch, page)
    const latest = state()
    if (latest.status !== "ready" || latest.data.currentBranch !== branch
      || latest.data.commitsPage.page !== page - 1) return

    const existing = new Set(latest.data.commits.map((commit) => commit.sha))
    const commits = [...latest.data.commits, ...result.items.filter((commit) => !existing.has(commit.sha))]
    setState({
      ...latest,
      data: { ...latest.data, commits, commitsPage: { page, hasMore: result.hasMore } },
    })
  }

  const loadMoreRuns = async () => {
    const current = state()
    if (current.status !== "ready" || !current.data.runsPage.hasMore) return

    const page = current.data.runsPage.page + 1
    const result = await loadGitHubRuns(current.data.repo.nameWithOwner, page)
    const latest = state()
    if (latest.status !== "ready" || latest.data.runsPage.page !== page - 1) return

    const existing = new Set(latest.data.runs.map((run) => run.id))
    const runs = [...latest.data.runs, ...result.items.filter((run) => !existing.has(run.id))]
    setState({
      ...latest,
      data: { ...latest.data, runs, runsPage: { page, hasMore: result.hasMore } },
    })
  }

  const loadMoreIssues = async (listState: ListState) => {
    const current = state()
    if (current.status !== "ready" || !current.data.issuesPage[listState].hasMore) return
    const page = current.data.issuesPage[listState].page + 1
    const result = await loadGitHubIssues(current.data.repo.nameWithOwner, listState, page)
    const latest = state()
    if (latest.status !== "ready" || latest.data.issuesPage[listState].page !== page - 1) return
    const existing = new Set(latest.data.issues.filter((item: Issue) => item.state === listState).map((item: Issue) => item.number))
    const issues = [...latest.data.issues, ...result.items.filter((item: Issue) => !existing.has(item.number))]
    setState({
      ...latest,
      data: {
        ...latest.data,
        issues,
        issuesPage: { ...latest.data.issuesPage, [listState]: { page, hasMore: result.hasMore } },
      },
    })
  }

  const loadMorePulls = async (listState: ListState) => {
    const current = state()
    if (current.status !== "ready" || !current.data.pullsPage[listState].hasMore) return
    const page = current.data.pullsPage[listState].page + 1
    const result = await loadGitHubPulls(current.data.repo.nameWithOwner, listState, page)
    const latest = state()
    if (latest.status !== "ready" || latest.data.pullsPage[listState].page !== page - 1) return
    const existing = new Set(latest.data.pulls.filter((item: PullRequest) => item.state === listState).map((item: PullRequest) => item.number))
    const pulls = [...latest.data.pulls, ...result.items.filter((item: PullRequest) => !existing.has(item.number))]
    setState({
      ...latest,
      data: {
        ...latest.data,
        pulls,
        pullsPage: { ...latest.data.pullsPage, [listState]: { page, hasMore: result.hasMore } },
      },
    })
  }

  const refresh = async () => {
    const current = state()
    if (current.status !== "ready" || current.refreshing) return

    const id = ++requestId
    setState({ ...current, refreshing: true, refreshError: undefined })
    try {
      let data = await loadGitHubData(current.data.repo.nameWithOwner)
      if (current.data.currentBranch !== data.currentBranch) {
        const [commitPage, readme] = await Promise.all([
          loadGitHubCommits(current.data.repo.nameWithOwner, current.data.currentBranch),
          loadGitHubReadme(current.data.repo.nameWithOwner, current.data.currentBranch),
        ])
        data = {
          ...data,
          readme,
          commits: commitPage.items,
          commitsPage: { page: 1, hasMore: commitPage.hasMore },
          currentBranch: current.data.currentBranch,
        }
      }
      if (id === requestId) setState({ status: "ready", data, refreshing: false })
    } catch (error) {
      if (id === requestId) {
        setState({
          status: "ready",
          data: current.data,
          refreshing: false,
          refreshError: messageFrom(error),
        })
      }
    }
  }

  onMount(() => {
    void Promise.all([
      resolveRepository(explicitRepository, process.cwd()),
      loadRecentRepositories(),
    ]).then(([resolved, repositories]) => {
      setRecent(repositories)
      if (resolved) return open(resolved)
      if (explicitRepository) setPickerError(`Could not parse “${explicitRepository}” as owner/repository`)
      setView("picker")
    })
  })

  return (
    <Show
      when={view() === "repository"}
      fallback={
        <Show when={view() === "resolving"} fallback={<RepositoryPicker recent={recent()} error={pickerError()} onOpen={open} />}>
          <ResolvingRepository />
        </Show>
      }
    >
      <Switch>
        <Match when={state().status === "loading" ? state() as LoadingState : undefined}>
          {(current) => <LoadingRepository repository={current().repository} />}
        </Match>
        <Match when={state().status === "error" ? state() as ErrorState : undefined}>
          {(current) => (
            <RepositoryLoadError
              repository={current().repository}
              message={current().message}
              onRetry={() => void load(current().repository)}
            />
          )}
        </Match>
        <Match when={state().status === "ready" ? state() as ReadyState : undefined}>
          {(current) => (
            <App
              data={() => current().data}
              refreshing={current().refreshing}
              refreshError={current().refreshError}
              onRefresh={() => void refresh()}
              onBranchChange={(branch) => void switchBranch(branch)}
              onLoadMoreCommits={loadMoreCommits}
              onLoadMoreRuns={loadMoreRuns}
              onLoadMoreIssues={loadMoreIssues}
              onLoadMorePulls={loadMorePulls}
            />
          )}
        </Match>
      </Switch>
    </Show>
  )
}

await render(() => <Root />, {
  targetFps: 30,
  exitOnCtrlC: false,
  useMouse: false,
})
