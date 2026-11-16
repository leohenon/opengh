import { TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, ErrorBoundary, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import type { DetailTarget, InitialNavigation, NavigationState, Page } from "./navigation"
import type { LaunchDetail } from "./launch-target"
import { resumeLocation, type ResumeLocation } from "./resume"
import { loadRepositoryTabs, saveRepositoryTabs, type RepositoryTabs } from "./repository-tabs"
import { defaultConfig, loadConfig, saveConfig, type Config } from "./config"
import { copyToHostClipboard } from "./clipboard"
import { resolveLocalRepository, runCommand, type LocalRepository } from "./command-actions"
import { loadRecentRepositories, rememberRepository, resolveRepository } from "./github/repository"
import { openGitHub } from "./github/browser"
import { openUrl } from "./open-url"
import { loadGitHubIssueKind } from "./github/client"
import { createInlineComments } from "./inline-comments"
import { createInlineDrafts, type InlineDrafts } from "./inline-drafts"
import { githubWrites, type GitHubWrites } from "./github/writes"
import { createPullReviewSession } from "./pull-review-session"
import type { PullReviewSession } from "./review-types"
import { createRepositorySession, type RepositoryScope, type RepositorySession } from "./repository-session"
import type { RepositoryState } from "./repository-state"
import { App } from "./ui/app"
import { ThemeProvider } from "./ui/theme"
import { MotionProvider } from "./ui/motion"
import { KeybindingsProvider, replaceEditorText, useKeyActions } from "./ui/keybindings"
import { MouseSurface } from "./ui/components/mouse-surface"
import { SelectionClipboard } from "./ui/components/selection-clipboard"
import { Toast } from "./ui/components/toast"
import { SwitchRepositoryScreen } from "./ui/pages/switch-repository"
import { LoadingScreen, RepositoryLoadError, RepositoryPicker } from "./ui/launcher"

type View = "resolving" | "picker" | "repository" | "switch" | "launch-error"
type LaunchRequest = { repository: string; detail?: LaunchDetail; page?: Page }
type ReadyState = Extract<RepositoryState, { status: "ready" }>
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
  createPullReviewSession(): PullReviewSession
  createInlineComments: typeof createInlineComments
  createInlineDrafts(): InlineDrafts
  githubWrites: GitHubWrites
  openGitHub(repository: string, target?: string | number, view?: "diff"): Promise<void>
  openUrl(url: string): Promise<void>
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
  createPullReviewSession,
  createInlineComments,
  createInlineDrafts: () => createInlineDrafts(),
  githubWrites,
  openGitHub,
  openUrl,
  copyToHostClipboard,
  resolveLocalRepository,
  runCommand,
}

export function Root(props: {
  repositoryArgument?: string
  initialPage?: Page
  initialDetail?: LaunchDetail
  focus?: boolean
  resumeLocation?: ResumeLocation
  onNavigationChange?: (location: ResumeLocation) => void
  cwd: string
  initialConfig?: Config
  initialConfigError?: string
  services?: Partial<RootServices>
  /** An error that escaped every handler. */
  unexpectedError?: () => string | undefined
  onDismissUnexpectedError?: () => void
  /** Saves the host must finish before exiting. */
  onShutdownWork?: (work: Promise<unknown>) => void
}) {
  const services = { ...defaultServices, ...props.services }
  const savedResume = props.resumeLocation
  const renderer = useRenderer()
  const [focus, setFocus] = createSignal(props.focus ?? false)
  const [view, setView] = createSignal<View>("resolving")
  const [recent, setRecent] = createSignal<string[]>([])
  const [pickerError, setPickerError] = createSignal("")
  const [launchError, setLaunchError] = createSignal<LaunchRequest & { message: string }>()
  const [config, setConfig] = createSignal(props.initialConfig ?? defaultConfig)
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
    pendingTabSave = Promise.resolve()
      .then(() => services.saveRepositoryTabs(updates))
      .then(() => {
        for (const [repository, entry] of Object.entries(snapshot)) {
          // A newer navigation, even back to the same tab, must still be saved.
          if (dirtyTabs[repository] === entry) delete dirtyTabs[repository]
        }
      })
      .catch(() => {
        // Keep failed updates dirty for the next navigation or exit flush.
      })
      .finally(() => {
        pendingTabSave = undefined
      })
    return pendingTabSave
  }
  const rememberTab = (repository: string, page: Page) => {
    const key = repository.toLowerCase()
    if (repositoryTabs()[key] === page) return
    setRepositoryTabs((current) => ({ ...current, [key]: page }))
    dirtyTabs[key] = { page }
    clearTimeout(tabSaveTimer)
    tabSaveTimer = setTimeout(() => {
      void flushRepositoryTabs()
    }, 250)
  }
  const [configSaving, setConfigSaving] = createSignal(false)
  const [configReloading, setConfigReloading] = createSignal(false)
  const [configReloaded, setConfigReloaded] = createSignal(false)
  const [configReloadFailed, setConfigReloadFailed] = createSignal(false)
  const configLoadWarning = (message: string) => `${message}. Fix or move the config file and reload configuration before saving settings.`
  const [configError, setConfigError] = createSignal(props.initialConfigError ? configLoadWarning(props.initialConfigError) : "")
  const [configWarningDismissed, setConfigWarningDismissed] = createSignal(false)
  const session = services.createRepositorySession()
  const [dismissedDraftError, setDismissedDraftError] = createSignal<string>()
  createEffect(() => {
    if (!session.draftSaveError?.()) setDismissedDraftError(undefined)
  })
  onCleanup(() => session.flushDrafts?.())
  const reviews = services.createPullReviewSession()
  const inlineComments = services.createInlineComments()
  // Owned here to survive repository switches, which remount App.
  const inlineDrafts = services.createInlineDrafts()
  // Also runs when a signal destroys the renderer without quit().
  onCleanup(() => {
    props.onShutdownWork?.(Promise.allSettled([flushRepositoryTabs(), reviews.flush(), inlineDrafts.flush()]))
  })
  const [dismissedInlineDraftError, setDismissedInlineDraftError] = createSignal<string>()
  createEffect(() => {
    if (!inlineDrafts.error()) setDismissedInlineDraftError(undefined)
  })
  const [quitSaveError, setQuitSaveError] = createSignal<{ title: string; message: string }>()
  const [quitDraftSaveError, setQuitDraftSaveError] = createSignal(false)
  const [localRepository, setLocalRepository] = createSignal<LocalRepository>()
  let commandCancel: (() => void) | undefined
  const refreshLocalRepository = async () => {
    setLocalRepository(await services.resolveLocalRepository(props.cwd))
  }
  let quitting = false

  const flushDraftsForQuit = () => {
    if (session.flushDrafts?.() !== false) return true
    quitting = false
    setQuitDraftSaveError(true)
    return false
  }
  const finishQuit = () => {
    // The app remains editable while review/tab saves are pending.
    if (renderer.isDestroyed) return
    setWaitingForWrites(false)
    if (flushDraftsForQuit()) renderer.destroy()
  }
  // Quitting waits for the whole operation, including confirming the result locally; quitting again stops it.
  const tracked =
    <A extends unknown[], R>(write: (...args: A) => Promise<R>) =>
    (...args: A) =>
      services.githubWrites.track(write(...args))
  const [waitingForWrites, setWaitingForWrites] = createSignal(false)
  const waitForWrites = async () => {
    if (!services.githubWrites.active()) return
    setWaitingForWrites(true)
    await services.githubWrites.settled()
  }
  const quit = () => {
    if (waitingForWrites()) {
      services.githubWrites.abandon()
      finishQuit()
      return
    }
    if (quitting) return
    quitting = true
    setQuitDraftSaveError(false)
    if (!flushDraftsForQuit()) return
    const tabs = flushRepositoryTabs()
    const flushReview = () =>
      reviews.flush().catch((error) => {
        throw {
          title: "Review draft not saved — quit cancelled",
          message: error instanceof Error ? error.message : "Could not save the review draft.",
        }
      })
    const flushInline = () =>
      inlineDrafts.flush().catch((error) => {
        throw {
          title: "Inline draft not saved — quit cancelled",
          message: `${error instanceof Error ? error.message : "Could not save an inline comment draft"}. The draft is kept in memory; fix local storage and quit again to retry.`,
        }
      })
    void Promise.all([tabs, flushReview(), flushInline()])
      .then(waitForWrites)
      .then(() => {
        // Tab saves can outlast the first drain, a review may first open while quitting,
        // and finished writes clear their drafts. Always drain again before the final flush.
        return Promise.all([flushReview(), flushInline()])
      })
      .then(finishQuit)
      .catch((error: { title: string; message: string }) => {
        quitting = false
        setWaitingForWrites(false)
        setQuitSaveError(error)
      })
  }

  const interrupt = (): false | void => {
    if (commandCancel) return commandCancel()
    const editor = renderer.currentFocusedRenderable
    if (editor instanceof TextareaRenderable && editor.plainText.length) replaceEditorText(editor, "")
    else return false
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
        setConfigError(
          `${error instanceof Error ? error.message : "Could not reload config"}. Previous settings remain active. Fix the file and reload configuration before saving settings.`,
        )
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
  const loadingMessage = createMemo(() => {
    if (view() === "resolving") return "Loading repository…"
    const current = session.state()
    return view() === "repository" && current.status === "loading" ? "Loading repository…" : undefined
  })
  createEffect(() => {
    const repository = accessibleRepository()
    if (repository)
      void services
        .rememberRepository(repository)
        .catch(() => {})
        .then(refreshRecent)
  })
  type RepositoryReturn = { repository: string; state: NavigationState; entry?: NavigationState }
  const [repositoryReturns, setRepositoryReturns] = createSignal<RepositoryReturn[]>([])
  let pendingState: RepositoryReturn | undefined
  let pendingNavigation: (InitialNavigation & { repository: string }) | undefined
  let loadScope: RepositoryScope = "full"
  const open = (repository: string, initial?: InitialNavigation, followingLink = false) => {
    if (!followingLink) {
      setRepositoryReturns([])
      pendingState = undefined
    }
    pendingNavigation = initial ? { ...initial, repository } : undefined
    setLaunchError(undefined)
    const restored = pendingState?.state
    loadScope = !focus()
      ? "full"
      : initial?.detail || initial?.diff || restored?.details?.[restored.page] || restored?.diffs?.[restored.page]
        ? "detail"
        : (initial?.page ?? restored?.page ?? repositoryTabs()[repository.toLowerCase()] ?? "overview")
    void session.load(repository, loadScope)
    setView("repository")
  }
  const followRepository = (repository: string, initial: InitialNavigation, origin: NavigationState, entry?: NavigationState) => {
    const current = session.state()
    if (current.status !== "ready") return
    setRepositoryReturns((items) => [...items, { repository: current.repository, state: origin, entry }])
    pendingState = undefined
    open(repository, initial, true)
  }
  const returnToRepository = () => {
    const items = repositoryReturns()
    const previous = items.at(-1)
    if (!previous) return false
    setRepositoryReturns(items.slice(0, -1))
    pendingState = previous
    open(previous.repository, undefined, true)
    return true
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
      detail =
        request.detail?.kind === "number"
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
      (savedResume ? Promise.resolve(savedResume.repository) : services.resolveRepository(props.repositoryArgument, props.cwd)).catch(
        (error) => {
          if (!renderer.isDestroyed) setPickerError(error instanceof Error ? error.message : "Could not resolve GitHub repository")
          return undefined
        },
      ),
      services.loadRecentRepositories().catch(() => []),
      services.loadRepositoryTabs().catch(() => ({})),
      props.initialConfig
        ? Promise.resolve(props.initialConfig)
        : services.loadConfig().catch((error) => {
            const message = error instanceof Error ? error.message : "Could not load config"
            setConfigError(configLoadWarning(message))
            return { ...defaultConfig }
          }),
    ]).then(([resolved, repositories, savedTabs, loadedConfig]) => {
      if (renderer.isDestroyed) return
      setRecent(repositories)
      setConfig(loadedConfig)
      setRepositoryTabs(savedTabs)
      if (savedResume) {
        pendingState = savedResume
        open(savedResume.repository, undefined, true)
        return
      }
      if (resolved) return resolveLaunch({ repository: resolved, detail: props.initialDetail, page: props.initialPage })
      if (!pickerError()) {
        if (props.repositoryArgument === ".")
          setPickerError(
            props.initialDetail
              ? "No GitHub repository found in the current directory. Pass owner/repo explicitly."
              : "No GitHub repository found",
          )
        else if (props.repositoryArgument) setPickerError(`Invalid repository: “${props.repositoryArgument}”`)
      }
      setView("picker")
    })
  })

  return (
    <KeybindingsProvider overrides={config().keybindings}>
      <RootShortcuts
        onInterrupt={interrupt}
        onQuit={quit}
        onReload={() => void reloadConfig()}
        onBack={() => (view() === "repository" && session.state().status !== "ready" ? returnToRepository() : false)}
      />
      <ThemeProvider name={config().theme} mode={config().colorMode}>
        <MotionProvider reduced={config().reducedMotion}>
          <MouseSurface>
            <SelectionClipboard onCopy={services.copyToHostClipboard} />
            <Show
              when={view() === "repository" && !loadingMessage()}
              fallback={
                <Switch>
                  {/* Stays mounted from repository discovery through session loading. */}
                  <Match when={loadingMessage()}>
                    <LoadingScreen
                      message={loadingMessage() ?? ""}
                      onSwitchRepository={view() === "repository" ? showSwitcher : undefined}
                    />
                  </Match>
                  <Match when={view() === "launch-error" && launchError()}>
                    {(current) => (
                      <RepositoryLoadError
                        title="Issue/PR unavailable"
                        repository={current().repository}
                        message={current().message}
                        onRetry={() => void resolveLaunch(current())}
                        onSwitchRepository={showSwitcher}
                        showStatusBarHints={config().showStatusBarHints}
                        onQuit={quit}
                      />
                    )}
                  </Match>
                  <Match when={view() === "switch"}>
                    <SwitchRepositoryScreen
                      recent={recent()}
                      showScrollbar={config().showScrollbars}
                      showStatusBarHints={config().showStatusBarHints}
                      onOpen={open}
                      onClose={() => setView(switchReturn)}
                    />
                  </Match>
                  <Match when={view() === "picker"}>
                    <RepositoryPicker recent={recent()} error={pickerError()} onOpen={open} onQuit={quit} />
                  </Match>
                </Switch>
              }
            >
              <Switch>
                <Match when={session.state().status === "error" ? (session.state() as ErrorState) : undefined}>
                  {(current) => (
                    <RepositoryLoadError
                      repository={current().repository}
                      message={current().message}
                      onRetry={() => void session.load(current().repository, loadScope)}
                      onSwitchRepository={showSwitcher}
                      showStatusBarHints={config().showStatusBarHints}
                      onQuit={quit}
                    />
                  )}
                </Match>
                <Match when={session.state().status === "ready" ? (session.state() as ReadyState) : undefined}>
                  {(current) => (
                    <Show when={current().repository} keyed>
                      {(repositoryName) => (
                        <ErrorBoundary
                          fallback={(error, reset) => (
                            <RepositoryLoadError
                              title="Something went wrong"
                              repository={repositoryName}
                              message={`${error instanceof Error ? error.message : String(error)}. Your drafts are saved; retry to reopen the repository.`}
                              onRetry={reset}
                              onSwitchRepository={showSwitcher}
                              showStatusBarHints={config().showStatusBarHints}
                              onQuit={quit}
                            />
                          )}
                        >
                          {(() => {
                            // Consume only when this repository actually mounts, preserving intent across metadata retries.
                            const initialNavigation =
                              pendingNavigation?.repository.toLowerCase() === repositoryName.toLowerCase() ? pendingNavigation : undefined
                            if (initialNavigation) pendingNavigation = undefined
                            const restored =
                              pendingState?.repository.toLowerCase() === repositoryName.toLowerCase() ? pendingState : undefined
                            if (restored) pendingState = undefined
                            return (
                              <App
                                data={() => current().data}
                                operations={() => current().operations}
                                initialPage={repositoryTabs()[repositoryName.toLowerCase()]}
                                initialNavigation={initialNavigation}
                                focus={focus()}
                                onOpenFullApp={() => setFocus(false)}
                                onEnsureResources={(scope) => {
                                  void session.ensure?.(scope)
                                }}
                                initialState={restored?.state}
                                resume={!!restored && restored === savedResume}
                                onNavigationChange={(state) => props.onNavigationChange?.(resumeLocation(repositoryName, state))}
                                repositoryEntry={restored?.entry}
                                onReturnToRepository={
                                  repositoryReturns().length
                                    ? () => {
                                        returnToRepository()
                                      }
                                    : undefined
                                }
                                onOpenLocation={followRepository}
                                onResolveIssueKind={services.loadIssueKind}
                                onOpenUrl={services.openUrl}
                                onPageChange={(page) => {
                                  if (!focus()) rememberTab(repositoryName, page)
                                }}
                                config={config()}
                                configSaving={configSaving() || configReloading()}
                                configError={configError()}
                                onConfigChange={updateConfig}
                                cwd={props.cwd}
                                localRepository={localRepository()}
                                onCommandCaptureCancel={(cancel) => {
                                  commandCancel = cancel
                                }}
                                onRunCommand={async (spec, output, signal) => {
                                  if (signal.aborted) throw new Error("Command cancelled before execution")
                                  return services.runCommand(spec, output)
                                }}
                                onQuit={quit}
                                onRefresh={() => void session.refresh()}
                                recentRepositories={recent()}
                                onRefreshRecentRepositories={refreshRecent}
                                onSwitchRepository={open}
                                onOpenReference={(repository, detail) => open(repository, { detail })}
                                onOpenDocument={(source) => session.openDocument(source)}
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
                                onAddReaction={tracked(session.addReaction)}
                                onRemoveReaction={tracked(session.removeReaction)}
                                issueDetail={session.issueDetail()}
                                onLoadIssue={session.loadIssue}
                                onLoadMoreIssueComments={session.loadMoreIssueComments}
                                onRetryIssueReferences={session.retryIssueReferences}
                                onCloseIssue={session.clearIssue}
                                assignableUsers={session.assignableUsers?.()}
                                onLoadAssignableUsers={session.loadAssignableUsers}
                                onReloadAssignableUsers={session.reloadAssignableUsers}
                                onSearchMentionUsers={session.searchMentionableUsers}
                                getCommentDraft={session.commentDraft}
                                getIssueAction={session.issueAction}
                                onPrepareIssueAction={session.prepareIssueAction}
                                onIssueDraftChange={session.updateIssueDraft}
                                onDiscardIssueDraft={session.discardIssueDraft}
                                onSubmitIssueAction={tracked(session.submitIssueAction)}
                                reviews={reviews}
                                inlineDrafts={inlineDrafts}
                                onPostInlineComment={tracked(inlineComments.post)}
                                onMergePull={tracked(session.mergePull)}
                                onUpdatePullDraft={tracked(session.updatePullDraft)}
                                onLoadPullMergeMessage={session.loadPullMergeMessage}
                                pullDetail={session.pullDetail()}
                                onLoadPull={session.loadPull}
                                onLoadMorePullComments={session.loadMorePullComments}
                                onRetryPullReferences={session.retryPullReferences}
                                onRetryPullCommits={session.retryPullCommits}
                                onRetryPullContext={session.retryPullContext}
                                onClosePull={session.clearPull}
                                onInvalidatePull={session.invalidatePull}
                                onOpenInBrowser={(target, repository, view) =>
                                  services.openGitHub(repository ?? repositoryName, target, view)
                                }
                                onCopyToClipboard={services.copyToHostClipboard}
                                onLoadMoreRuns={session.loadMoreRuns}
                                onWorkFindChange={
                                  session.setWorkFind ? (kind, query) => void session.setWorkFind?.(kind, query) : undefined
                                }
                                onLoadMoreIssues={session.loadMoreIssues}
                                onLoadMorePulls={session.loadMorePulls}
                              />
                            )
                          })()}
                        </ErrorBoundary>
                      )}
                    </Show>
                  )}
                </Match>
              </Switch>
            </Show>
            <Show when={!quitDraftSaveError() && session.draftSaveError?.() && session.draftSaveError?.() !== dismissedDraftError()}>
              <Toast
                title="Draft not saved locally"
                message={session.draftSaveError?.() ?? ""}
                zIndex={400}
                onDismiss={() => setDismissedDraftError(session.draftSaveError?.())}
              />
            </Show>
            <Show when={quitDraftSaveError()}>
              <Toast
                title="Draft not saved — quit cancelled"
                message="Your draft is retained in memory. Fix local storage and quit again to retry."
                zIndex={400}
                onDismiss={() => setQuitDraftSaveError(false)}
              />
            </Show>
            <Show
              when={
                !quitDraftSaveError() && !quitSaveError() && inlineDrafts.error() !== dismissedInlineDraftError() && inlineDrafts.error()
              }
            >
              {(message) => (
                <Toast
                  title="Inline comment drafts"
                  message={message()}
                  zIndex={400}
                  onDismiss={() => setDismissedInlineDraftError(inlineDrafts.error())}
                />
              )}
            </Show>
            <Show when={quitSaveError()}>
              {(error) => <Toast title={error().title} message={error().message} onDismiss={() => setQuitSaveError(undefined)} />}
            </Show>
            <Show when={waitingForWrites()}>
              <Toast
                title="Sending to GitHub"
                message="opengh will quit when it finishes. Quit again to stop it now."
                tone="info"
                zIndex={400}
                duration={60_000}
                onDismiss={() => {}}
              />
            </Show>
            <Show when={props.unexpectedError?.()}>
              {(message) => (
                <Toast
                  title="Something went wrong"
                  message={message()}
                  zIndex={400}
                  duration={10_000}
                  onDismiss={() => props.onDismissUnexpectedError?.()}
                />
              )}
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

function RootShortcuts(props: { onInterrupt(): false | void; onQuit(): void; onReload(): void; onBack(): boolean }) {
  const keys = useKeyActions(
    {
      "global.interrupt": (event) => {
        if (props.onInterrupt() === false && !keys.dispatch(event, "dialog.close")) props.onQuit()
      },
      "global.reloadConfig": () => props.onReload(),
    },
    { priority: 1000 },
  )
  useKeyActions({ "global.quit": () => props.onQuit(), "navigation.back": () => props.onBack() }, { priority: -100 })
  return null
}
