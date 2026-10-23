import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import type { DetailTarget, InitialNavigation, Page } from "./navigation"
import type { LaunchDetail } from "./launch-target"
import { loadRepositoryTabs, saveRepositoryTabs, type RepositoryTabs } from "./repository-tabs"
import { defaultConfig, loadConfig, saveConfig, type Config } from "./config"
import { copyToHostClipboard } from "./clipboard"
import { resolveLocalRepository, runCommand, type LocalRepository } from "./command-actions"
import { loadRecentRepositories, rememberRepository, resolveRepository } from "./github/repository"
import { openGitHub } from "./github/browser"
import { loadGitHubIssueKind } from "./github/client"
import { createRepositorySession, type RepositorySession } from "./repository-session"
import type { RepositoryState } from "./repository-state"
import { App } from "./ui/app"
import { ThemeProvider } from "./ui/theme"
import { MotionProvider } from "./ui/motion"
import { KeybindingsProvider, useKeyActions } from "./ui/keybindings"
import { MouseSurface } from "./ui/components/mouse-surface"
import { Toast } from "./ui/components/toast"
import { SwitchRepositoryScreen } from "./ui/pages/switch-repository"
import {
  LoadingRepository,
  RepositoryLoadError,
  RepositoryPicker,
  ResolvingRepository,
} from "./ui/launcher"

type View = "resolving" | "picker" | "repository" | "switch" | "launch-error"
type LaunchRequest = { repository: string; detail?: LaunchDetail; page?: Page }
type ReadyState = Extract<RepositoryState, { status: "ready" }>
type LoadingState = Extract<RepositoryState, { status: "loading" }>
type ErrorState = Extract<RepositoryState, { status: "error" }>

export type RootServices = {
  resolveRepository(argument: string | undefined, cwd: string): Promise<string | undefined>
  loadIssueKind(repository: string, number: number): Promise<"issue" | "pull">
  loadRecentRepositories(): Promise<string[]>
  rememberRepository(repository: string): Promise<void>
  loadRepositoryTabs(): Promise<RepositoryTabs>
  saveRepositoryTabs(tabs: RepositoryTabs): Promise<void>
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
  loadIssueKind: loadGitHubIssueKind,
  loadRecentRepositories,
  rememberRepository,
  loadRepositoryTabs,
  saveRepositoryTabs,
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
  initialPage?: Page
  initialDetail?: LaunchDetail
  cwd: string
  services?: Partial<RootServices>
}) {
  const services = { ...defaultServices, ...props.services }
  const renderer = useRenderer()
  const [view, setView] = createSignal<View>("resolving")
  const [recent, setRecent] = createSignal<string[]>([])
  const [pickerError, setPickerError] = createSignal("")
  const [launchError, setLaunchError] = createSignal<LaunchRequest & { message: string }>()
  const [config, setConfig] = createSignal(defaultConfig)
  const [repositoryTabs, setRepositoryTabs] = createSignal<RepositoryTabs>({})
  let tabSaveTimer: ReturnType<typeof setTimeout> | undefined
  const dirtyTabs: Record<string, { page: Page }> = {}
  let pendingTabSave: Promise<void> | undefined
  const flushRepositoryTabs = (): Promise<void> | undefined => {
    clearTimeout(tabSaveTimer)
    tabSaveTimer = undefined
    if (pendingTabSave) return pendingTabSave.then(() => flushRepositoryTabs())
    const snapshot = { ...dirtyTabs }
    if (!Object.keys(snapshot).length) return
    const updates = Object.fromEntries(Object.entries(snapshot).map(([repository, entry]) => [repository, entry.page]))
    pendingTabSave = Promise.resolve().then(() => services.saveRepositoryTabs(updates)).then(() => {
      for (const [repository, entry] of Object.entries(snapshot)) {
        // A newer navigation, even back to the same tab, must still be saved.
        if (dirtyTabs[repository] === entry) delete dirtyTabs[repository]
      }
    }).catch(() => {
      // Keep failed updates dirty for the next navigation or exit flush.
    }).finally(() => { pendingTabSave = undefined })
    return pendingTabSave
  }
  const rememberTab = (repository: string, page: Page) => {
    const key = repository.toLowerCase()
    if (repositoryTabs()[key] === page) return
    setRepositoryTabs((current) => ({ ...current, [key]: page }))
    dirtyTabs[key] = { page }
    clearTimeout(tabSaveTimer)
    tabSaveTimer = setTimeout(() => { void flushRepositoryTabs() }, 250)
  }
  onCleanup(() => { void flushRepositoryTabs() })
  const [configSaving, setConfigSaving] = createSignal(false)
  const [configReloading, setConfigReloading] = createSignal(false)
  const [configReloaded, setConfigReloaded] = createSignal(false)
  const [configReloadFailed, setConfigReloadFailed] = createSignal(false)
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
    const pending = flushRepositoryTabs()
    if (pending) void pending.finally(() => renderer.destroy())
    else renderer.destroy()
  }

  const reloadConfig = async () => {
    if (view() === "resolving" || configSaving() || configReloading()) return
    setConfigReloading(true)
    setConfigReloaded(false)
    try {
      const next = await services.loadConfig()
      if (renderer.isDestroyed) return
      setConfig(next)
      setConfigError("")
      setConfigReloadFailed(false)
      setConfigReloaded(true)
    } catch (error) {
      if (!renderer.isDestroyed) {
        setConfigReloadFailed(true)
        setConfigWarningDismissed(false)
        setConfigError(`${error instanceof Error ? error.message : "Could not reload config"}. Previous settings remain active. Fix the file and reload configuration before saving settings.`)
      }
    } finally {
      setConfigReloading(false)
    }
  }

  // Root owns committed preferences and the cross-dialog save lock; theme previews stay in the UI.
  const updateConfig = async (next: Config) => {
    if (configSaving()) throw new Error("A settings save is already in progress")
    if (configReloading()) throw new Error("A configuration reload is in progress")
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
  const accessibleRepository = createMemo(() => {
    const current = session.state()
    return current.status === "ready" ? current.repository : undefined
  })
  createEffect(() => {
    const repository = accessibleRepository()
    if (repository) void services.rememberRepository(repository).catch(() => {}).then(refreshRecent)
  })
  let pendingNavigation: (InitialNavigation & { repository: string }) | undefined
  const open = (repository: string, initial?: InitialNavigation) => {
    pendingNavigation = initial ? { ...initial, repository } : undefined
    setLaunchError(undefined)
    void session.load(repository)
    setView("repository")
  }
  let switchReturn: View = "repository"
  const showSwitcher = () => {
    switchReturn = view()
    setView("switch")
    void refreshRecent()
  }
  const resolveLaunch = async (request: LaunchRequest) => {
    setLaunchError(undefined)
    setView("resolving")
    let detail: DetailTarget | undefined
    try {
      detail = request.detail?.kind === "number"
        ? { kind: await services.loadIssueKind(request.repository, request.detail.number), number: request.detail.number }
        : request.detail
    } catch (error) {
      if (renderer.isDestroyed) return
      const target = request.detail?.kind === "number" ? `#${request.detail.number}` : ""
      const message = error instanceof Error ? error.message : "Could not resolve issue or PR"
      setLaunchError({ ...request, message: `Could not open ${request.repository}${target}: ${message}` })
      setView("launch-error")
      return
    }
    if (!renderer.isDestroyed) open(request.repository, detail || request.page ? { detail, page: request.page } : undefined)
  }

  onMount(() => {
    void refreshLocalRepository().catch(() => setLocalRepository(undefined))
    void Promise.all([
      services.resolveRepository(props.repositoryArgument, props.cwd).catch((error) => {
        if (!renderer.isDestroyed) setPickerError(error instanceof Error ? error.message : "Could not resolve GitHub repository")
        return undefined
      }),
      services.loadRecentRepositories().catch(() => []),
      services.loadRepositoryTabs().catch(() => ({})),
      services.loadConfig().catch((error) => {
        const message = error instanceof Error ? error.message : "Could not load config"
        setConfigError(`${message}. Fix or move the config file and reload configuration before saving settings.`)
        return { ...defaultConfig }
      }),
    ]).then(([resolved, repositories, savedTabs, loadedConfig]) => {
      if (renderer.isDestroyed) return
      setRecent(repositories)
      setConfig(loadedConfig)
      setRepositoryTabs(savedTabs)
      if (resolved) return resolveLaunch({ repository: resolved, detail: props.initialDetail, page: props.initialPage })
      if (!pickerError()) {
        if (props.repositoryArgument === ".") setPickerError(props.initialDetail
          ? "No GitHub repository found in the current directory. Pass owner/repo explicitly."
          : "No GitHub repository found")
        else if (props.repositoryArgument) setPickerError(`Invalid repository: “${props.repositoryArgument}”`)
      }
      setView("picker")
    })
  })

  return (
    <KeybindingsProvider overrides={config().keybindings}>
    <RootShortcuts onInterrupt={() => commandCancel ? commandCancel() : quit()} onQuit={quit} onReload={() => void reloadConfig()} />
    <ThemeProvider name={config().theme} mode={config().colorMode}>
      <MotionProvider reduced={config().reducedMotion}>
      <MouseSurface>
      <Show
        when={view() === "repository"}
      fallback={
        <Switch>
          <Match when={view() === "resolving"}><ResolvingRepository /></Match>
          <Match when={view() === "launch-error" && launchError()}>
            {(current) => <RepositoryLoadError
              title="Issue/PR unavailable"
              repository={current().repository}
              message={current().message}
              onRetry={() => void resolveLaunch(current())}
              onSwitchRepository={showSwitcher}
              showStatusBarHints={config().showStatusBarHints}
              onQuit={quit}
            />}
          </Match>
          <Match when={view() === "switch"}>
            <SwitchRepositoryScreen recent={recent()} showScrollbar={config().showScrollbars}
              showStatusBarHints={config().showStatusBarHints}
              onOpen={open} onClose={() => setView(switchReturn)} />
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
              showStatusBarHints={config().showStatusBarHints}
              onQuit={quit}
            />
          )}
        </Match>
        <Match when={session.state().status === "ready" ? session.state() as ReadyState : undefined}>
          {(current) => (
            <Show when={current().repository} keyed>
              {(repositoryName) => {
                // Consume only when this repository actually mounts, preserving intent across metadata retries.
                const initialNavigation = pendingNavigation?.repository.toLowerCase() === repositoryName.toLowerCase()
                  ? pendingNavigation : undefined
                if (initialNavigation) pendingNavigation = undefined
                return <App
              data={() => current().data}
              operations={() => current().operations}
              initialPage={repositoryTabs()[repositoryName.toLowerCase()]}
              initialNavigation={initialNavigation}
              onPageChange={(page) => rememberTab(repositoryName, page)}
              config={config()}
              configSaving={configSaving() || configReloading()}
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
              runDetail={session.runDetail()}
              onLoadRun={session.loadRun}
              onLoadMoreRunJobs={session.loadMoreRunJobs}
              onCloseRun={session.clearRun}
              commitDetail={session.commitDetail()}
              onLoadCommit={session.loadCommit}
              onLoadMoreCommitFiles={session.loadMoreCommitFiles}
              onCloseCommit={session.clearCommit}
              getReactionAction={session.reactionAction}
              onAddReaction={session.addReaction}
              issueDetail={session.issueDetail()}
              onLoadIssue={session.loadIssue}
              onLoadMoreIssueComments={session.loadMoreIssueComments}
              onRetryIssueReferences={session.retryIssueReferences}
              onCloseIssue={session.clearIssue}
              assignableUsers={session.assignableUsers?.()}
              onLoadAssignableUsers={session.loadAssignableUsers}
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
            />
              }}
            </Show>
          )}
        </Match>
        </Switch>
      </Show>
      <Show when={configReloaded()}>
        <Toast
          title="Config reloaded"
          message=""
          tone="success"
          duration={2000}
          zIndex={400}
          onDismiss={() => setConfigReloaded(false)}
        />
      </Show>
      <Show when={view() !== "resolving" && configError() && !configWarningDismissed()}>
        <Toast
          title={configReloadFailed() ? "Config reload failed" : "Using default settings"}
          message={configReloadFailed() ? "" : configError()}
          onDismiss={() => setConfigWarningDismissed(true)}
        />
      </Show>
      </MouseSurface>
      </MotionProvider>
    </ThemeProvider>
    </KeybindingsProvider>
  )
}

function RootShortcuts(props: { onInterrupt(): void; onQuit(): void; onReload(): void }) {
  useKeyActions({
    "global.interrupt": () => props.onInterrupt(),
    "global.reloadConfig": () => props.onReload(),
  }, { priority: 1000 })
  useKeyActions({ "global.quit": () => props.onQuit() }, { priority: -100 })
  return null
}
