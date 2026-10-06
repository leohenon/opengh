import { render } from "@opentui/solid"
import { createSignal, Match, onMount, Show, Switch } from "solid-js"
import { defaultConfig, loadConfig } from "./config"
import { loadRecentRepositories, rememberRepository, resolveRepository } from "./github/repository"
import { createRepositorySession } from "./repository-session"
import type { RepositoryState } from "./repository-state"
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

function Root() {
  const [view, setView] = createSignal<View>("resolving")
  const [recent, setRecent] = createSignal<string[]>([])
  const [pickerError, setPickerError] = createSignal("")
  const [config, setConfig] = createSignal(defaultConfig)
  const session = createRepositorySession()

  const open = (repository: string) => {
    setView("repository")
    void rememberRepository(repository)
    void session.load(repository)
  }

  onMount(() => {
    void Promise.all([
      resolveRepository(explicitRepository, process.cwd()),
      loadRecentRepositories(),
      loadConfig(),
    ]).then(([resolved, repositories, loadedConfig]) => {
      setRecent(repositories)
      setConfig(loadedConfig)
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
        <Match when={session.state().status === "loading" ? session.state() as LoadingState : undefined}>
          {(current) => <LoadingRepository repository={current().repository} />}
        </Match>
        <Match when={session.state().status === "error" ? session.state() as ErrorState : undefined}>
          {(current) => (
            <RepositoryLoadError
              repository={current().repository}
              message={current().message}
              onRetry={() => void session.load(current().repository)}
            />
          )}
        </Match>
        <Match when={session.state().status === "ready" ? session.state() as ReadyState : undefined}>
          {(current) => (
            <App
              data={() => current().data}
              operations={() => current().operations}
              config={config()}
              onRefresh={() => void session.refresh()}
              onRetryResource={(resource) => void session.retryResource(resource)}
              onBranchChange={(branch) => void session.switchBranch(branch)}
              onLoadMoreCommits={session.loadMoreCommits}
              onLoadMoreRuns={session.loadMoreRuns}
              onLoadMoreIssues={session.loadMoreIssues}
              onLoadMorePulls={session.loadMorePulls}
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
