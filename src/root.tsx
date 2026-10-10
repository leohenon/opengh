import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSignal, Match, onMount, Show, Switch } from "solid-js"
import { defaultConfig, loadConfig, saveConfig, type Config } from "./config"
import { loadRecentRepositories, rememberRepository, resolveRepository } from "./github/repository"
import { createRepositorySession, type RepositorySession } from "./repository-session"
import type { RepositoryState } from "./repository-state"
import { App } from "./ui/app"
import { ThemeProvider } from "./ui/theme"
import { Toast } from "./ui/components/toast"
import {
  LoadingRepository,
  RepositoryLoadError,
  RepositoryPicker,
  ResolvingRepository,
} from "./ui/launcher"

type View = "resolving" | "picker" | "repository"
type ReadyState = Extract<RepositoryState, { status: "ready" }>
type LoadingState = Extract<RepositoryState, { status: "loading" }>
type ErrorState = Extract<RepositoryState, { status: "error" }>

export type RootServices = {
  resolveRepository(argument: string | undefined, cwd: string): Promise<string | undefined>
  loadRecentRepositories(): Promise<string[]>
  rememberRepository(repository: string): Promise<void>
  loadConfig(): Promise<Config>
  saveConfig(config: Config): Promise<void>
  createRepositorySession(): RepositorySession
}

const defaultServices: RootServices = {
  resolveRepository,
  loadRecentRepositories,
  rememberRepository,
  loadConfig,
  saveConfig,
  createRepositorySession,
}

export function Root(props: {
  repositoryArgument?: string
  cwd: string
  services?: Partial<RootServices>
}) {
  const services = { ...defaultServices, ...props.services }
  const renderer = useRenderer()
  const [view, setView] = createSignal<View>("resolving")
  const [recent, setRecent] = createSignal<string[]>([])
  const [pickerError, setPickerError] = createSignal("")
  const [config, setConfig] = createSignal(defaultConfig)
  const [configSaving, setConfigSaving] = createSignal(false)
  const [configError, setConfigError] = createSignal("")
  const [configWarningDismissed, setConfigWarningDismissed] = createSignal(false)
  const session = services.createRepositorySession()
  let quitting = false

  const quit = () => {
    if (quitting) return
    quitting = true
    renderer.destroy()
  }

  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") {
      event.stopPropagation()
      quit()
    }
  })

  // Root owns committed preferences and the cross-dialog save lock; theme previews stay in the UI.
  const updateConfig = async (next: Config) => {
    if (configSaving()) throw new Error("A settings save is already in progress")
    if (configError()) throw new Error(configError())
    setConfigSaving(true)
    try {
      await services.saveConfig(next)
      setConfig(next)
    } finally {
      setConfigSaving(false)
    }
  }

  const open = (repository: string) => {
    setView("repository")
    void services.rememberRepository(repository)
    void session.load(repository)
  }

  onMount(() => {
    void Promise.all([
      services.resolveRepository(props.repositoryArgument, props.cwd),
      services.loadRecentRepositories(),
      services.loadConfig().catch((error) => {
        const message = error instanceof Error ? error.message : "Could not load config"
        setConfigError(`${message}. Fix or move the config file and restart before saving settings.`)
        return { ...defaultConfig }
      }),
    ]).then(([resolved, repositories, loadedConfig]) => {
      if (renderer.isDestroyed) return
      setRecent(repositories)
      setConfig(loadedConfig)
      if (resolved) return open(resolved)
      if (props.repositoryArgument === ".") setPickerError("No GitHub repository found")
      else if (props.repositoryArgument) setPickerError(`Invalid repository: “${props.repositoryArgument}”`)
      setView("picker")
    })
  })

  return (
    <ThemeProvider name={config().theme}>
      <Show
        when={view() === "repository"}
      fallback={
        <Show when={view() === "resolving"} fallback={<RepositoryPicker recent={recent()} error={pickerError()} onOpen={open} onQuit={quit} />}>
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
              onQuit={quit}
            />
          )}
        </Match>
        <Match when={session.state().status === "ready" ? session.state() as ReadyState : undefined}>
          {(current) => (
            <App
              data={() => current().data}
              operations={() => current().operations}
              config={config()}
              configSaving={configSaving()}
              configError={configError()}
              onConfigChange={updateConfig}
              onQuit={quit}
              onRefresh={() => void session.refresh()}
              onRetryResource={(resource) => void session.retryResource(resource)}
              canSwitchBranch={session.canSwitchBranch()}
              onBranchChange={(branch) => void session.switchBranch(branch)}
              onLoadMoreBranches={session.loadMoreBranches}
              onLoadMoreCommits={session.loadMoreCommits}
              onLoadMoreRuns={session.loadMoreRuns}
              onLoadMoreIssues={session.loadMoreIssues}
              onLoadMorePulls={session.loadMorePulls}
            />
          )}
        </Match>
        </Switch>
      </Show>
      <Show when={view() !== "resolving" && configError() && !configWarningDismissed()}>
        <Toast
          title="Using default settings"
          message={configError()}
          onDismiss={() => setConfigWarningDismissed(true)}
        />
      </Show>
    </ThemeProvider>
  )
}
