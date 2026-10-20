import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSignal, Match, onMount, Show, Switch } from "solid-js"
import { defaultConfig, loadConfig, saveConfig, type Config } from "./config"
import { copyToHostClipboard } from "./clipboard"
import { resolveLocalRepository, runCommand, type LocalRepository } from "./command-actions"
import { loadRecentRepositories, rememberRepository, resolveRepository } from "./github/repository"
import { openGitHub } from "./github/browser"
import { createRepositorySession, type RepositorySession } from "./repository-session"
import type { RepositoryState } from "./repository-state"
import { App } from "./ui/app"
import { ThemeProvider } from "./ui/theme"
import { Toast } from "./ui/components/toast"
import { SwitchRepositoryScreen } from "./ui/pages/switch-repository"
import {
  LoadingRepository,
  RepositoryLoadError,
  RepositoryPicker,
  ResolvingRepository,
} from "./ui/launcher"

type View = "resolving" | "picker" | "repository" | "switch"
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
  openGitHub(repository: string, target?: string | number, view?: "diff"): Promise<void>
  copyToHostClipboard(value: string): Promise<boolean>
  resolveLocalRepository: typeof resolveLocalRepository
  runCommand: typeof runCommand
}

const defaultServices: RootServices = {
  resolveRepository,
  loadRecentRepositories,
  rememberRepository,
  loadConfig,
  saveConfig,
  createRepositorySession,
  openGitHub,
  copyToHostClipboard,
  resolveLocalRepository,
  runCommand,
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
  const [localRepository, setLocalRepository] = createSignal<LocalRepository>()
  let commandCancel: (() => void) | undefined
  const refreshLocalRepository = async () => { setLocalRepository(await services.resolveLocalRepository(props.cwd)) }
  let quitting = false

  const quit = () => {
    if (quitting) return
    quitting = true
    renderer.destroy()
  }

  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") {
      event.stopPropagation()
      if (commandCancel) commandCancel()
      else quit()
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

  let recentRequest = 0
  const refreshRecent = async () => {
    const request = ++recentRequest
    try {
      const repositories = await services.loadRecentRepositories()
      if (!renderer.isDestroyed && request === recentRequest) setRecent(repositories)
    } catch {
      // Recents are optional; keep the last usable list when persistence is unavailable.
    }
  }
  const open = (repository: string) => {
    setView("repository")
    void services.rememberRepository(repository).catch(() => {}).then(refreshRecent)
    void session.load(repository)
  }
  const showSwitcher = () => {
    setView("switch")
    void refreshRecent()
  }

  onMount(() => {
    void refreshLocalRepository().catch(() => setLocalRepository(undefined))
    void Promise.all([
      services.resolveRepository(props.repositoryArgument, props.cwd),
      services.loadRecentRepositories().catch(() => []),
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
        <Switch>
          <Match when={view() === "resolving"}><ResolvingRepository /></Match>
          <Match when={view() === "switch"}>
            <SwitchRepositoryScreen recent={recent()} showScrollbar={config().showScrollbars}
              showStatusBarHints={config().showStatusBarHints}
              onOpen={open} onClose={() => setView("repository")} />
          </Match>
          <Match when={view() === "picker"}>
            <RepositoryPicker recent={recent()} error={pickerError()} onOpen={open} onQuit={quit} />
          </Match>
        </Switch>
      }
    >
      <Switch>
        <Match when={session.state().status === "loading" ? session.state() as LoadingState : undefined}>
          {(current) => <LoadingRepository repository={current().repository} onSwitchRepository={showSwitcher} />}
        </Match>
        <Match when={session.state().status === "error" ? session.state() as ErrorState : undefined}>
          {(current) => (
            <RepositoryLoadError
              repository={current().repository}
              message={current().message}
              onRetry={() => void session.load(current().repository)}
              onSwitchRepository={showSwitcher}
              onQuit={quit}
            />
          )}
        </Match>
        <Match when={session.state().status === "ready" ? session.state() as ReadyState : undefined}>
          {(current) => (
            <Show when={current().repository} keyed>
              {(repositoryName) => <App
              data={() => current().data}
              operations={() => current().operations}
              config={config()}
              configSaving={configSaving()}
              configError={configError()}
              onConfigChange={updateConfig}
              cwd={props.cwd}
              localRepository={localRepository()}
              onCommandCaptureCancel={(cancel) => { commandCancel = cancel }}
              onRunCommand={async (spec, output, signal) => {
                if (signal.aborted) throw new Error("Command cancelled before execution")
                return services.runCommand(spec, output)
              }}
              onQuit={quit}
              onRefresh={() => void session.refresh()}
              recentRepositories={recent()}
              onRefreshRecentRepositories={refreshRecent}
              onSwitchRepository={open}
              onRetryResource={(resource) => void session.retryResource(resource)}
              canSwitchBranch={session.canSwitchBranch()}
              onBranchChange={(branch) => void session.switchBranch(branch)}
              onLoadMoreBranches={session.loadMoreBranches}
              onLoadMoreCommits={session.loadMoreCommits}
              diffs={session.diffs?.()}
              onLoadDiff={session.loadDiff}
              onCloseDiff={session.clearDiff}
              commitDetail={session.commitDetail()}
              onLoadCommit={session.loadCommit}
              onLoadMoreCommitFiles={session.loadMoreCommitFiles}
              onCloseCommit={session.clearCommit}
              issueDetail={session.issueDetail()}
              onLoadIssue={session.loadIssue}
              onLoadMoreIssueComments={session.loadMoreIssueComments}
              onRetryIssueReferences={session.retryIssueReferences}
              onCloseIssue={session.clearIssue}
              getIssueAction={session.issueAction}
              onPrepareIssueAction={session.prepareIssueAction}
              onIssueDraftChange={session.updateIssueDraft}
              onDiscardIssueDraft={session.discardIssueDraft}
              onSubmitIssueAction={session.submitIssueAction}
              pullDetail={session.pullDetail()}
              onLoadPull={session.loadPull}
              onLoadMorePullComments={session.loadMorePullComments}
              onRetryPullReferences={session.retryPullReferences}
              onRetryPullCommits={session.retryPullCommits}
              onRetryPullContext={session.retryPullContext}
              onClosePull={session.clearPull}
              onOpenInBrowser={(target, repository, view) => services.openGitHub(repository ?? repositoryName, target, view)}
              onCopyToClipboard={services.copyToHostClipboard}
              onLoadMoreRuns={session.loadMoreRuns}
              onLoadMoreIssues={session.loadMoreIssues}
              onLoadMorePulls={session.loadMorePulls}
            />}
            </Show>
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
