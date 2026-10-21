import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { defaultConfig, type Config } from "../config"
import { cloneCommand, cloneDestination, matchesLocalRepository, type LocalRepository, type CommandSpec, type CommandTask } from "../command-actions"
import { CommandDialog, type CommandAction } from "./components/command-dialog"
import type { CommitDetail, DiffContent, DiffTarget, IssueActionKind, IssueActionResult, Paginated, ListState } from "../models"
import { back, navigate, openDetail, openDiff, type NavigationState, type Page } from "../navigation"
import type {
  CommitDetailState,
  RunDetailState,
  DiffState,
  IssueDetailState,
  IssueActionState,
  PullDetailState,
  RepositoryData,
  RepositoryOperations,
  RepositoryResource,
  ResourceState,
} from "../repository-state"
import { BranchPicker } from "./components/branch-picker"
import { Header } from "./components/header"
import { IssueReferencesPicker } from "./components/issue-references-picker"
import { IssueActionDialog, IssueActionsMenu } from "./components/issue-actions"
import { IssueAssigneesPicker } from "./components/issue-assignees-picker"
import { Help } from "./components/help"
import { Settings } from "./components/settings"
import { StatusBar, type StatusKind } from "./components/status-bar"
import { Toast } from "./components/toast"
import { ActionsScreen } from "./pages/actions"
import { CommitsScreen } from "./pages/commits"
import { IssueScreen } from "./pages/issue"
import { PullScreen } from "./pages/pull"
import { RunScreen } from "./pages/run"
import { CommitScreen } from "./pages/commit"
import { DiffScreen, type DiffFocus } from "./pages/diff"
import { OverviewScreen } from "./pages/overview"
import { WorkScreen } from "./pages/work"
import { SwitchRepositoryScreen } from "./pages/switch-repository"
import { tabs } from "./tabs"
import { referencedItems } from "./issue-references"
import { useTheme } from "./theme"
import { IconProvider } from "./icon-style"

type Overlay = "help" | "branch-picker" | "settings" | "issue-references" | "issue-actions" | "issue-action" | "command" | "switch-repo"
type ToastState = { id: number; title: string; message: string; duration?: number; tone?: "error" | "success" | "info" }

export type AppProps = {
  data: RepositoryData | (() => RepositoryData)
  operations: RepositoryOperations | (() => RepositoryOperations)
  config?: Config
  configSaving?: boolean
  configError?: string
  onConfigChange?: (config: Config) => Promise<void>
  cwd?: string
  localRepository?: LocalRepository
  onRunCommand?: (spec: CommandSpec, output: (chunk: string) => void, signal: AbortSignal) => Promise<CommandTask>
  onCommandCaptureCancel?: (cancel: (() => void) | undefined) => void
  onQuit?: () => void
  onRefresh?: () => void
  recentRepositories?: readonly string[]
  onRefreshRecentRepositories?: () => Promise<void>
  onSwitchRepository?: (repository: string) => void
  onRetryResource?: (resource: RepositoryResource) => void
  canSwitchBranch?: boolean
  onBranchChange?: (branch: string) => void
  onLoadMoreBranches?: () => Promise<void>
  onLoadMoreCommits?: () => Promise<void>
  diffs?: Partial<Record<DiffTarget["kind"], DiffState>>
  onLoadDiff?: (target: DiffTarget, filesOnly?: boolean) => Promise<void>
  onCloseDiff?: (target?: DiffTarget) => void
  runDetail?: RunDetailState
  onLoadRun?: (id: number) => Promise<void>
  onLoadMoreRunJobs?: () => Promise<void>
  onCloseRun?: () => void
  commitDetail?: CommitDetailState
  onLoadCommit?: (sha: string) => Promise<void>
  onLoadMoreCommitFiles?: () => Promise<void>
  onCloseCommit?: () => void
  issueDetail?: IssueDetailState
  onLoadIssue?: (number: number) => Promise<void>
  onLoadMoreIssueComments?: () => Promise<void>
  onRetryIssueReferences?: () => Promise<void>
  onCloseIssue?: () => void
  getIssueAction?: (number: number) => IssueActionState
  assignableUsers?: ResourceState<Paginated<string>>
  onLoadAssignableUsers?: () => Promise<void>
  onPrepareIssueAction?: (number: number, kind: IssueActionKind) => void
  onIssueDraftChange?: (number: number, draft: Partial<Pick<IssueActionState, "body" | "reason" | "duplicateTarget" | "selectedAssignees">>) => void
  onDiscardIssueDraft?: (number: number) => void
  onSubmitIssueAction?: (number: number, kind: IssueActionKind) => Promise<IssueActionResult>
  pullDetail?: PullDetailState
  onLoadPull?: (number: number) => Promise<void>
  onLoadMorePullComments?: () => Promise<void>
  onRetryPullReferences?: () => Promise<void>
  onRetryPullCommits?: () => Promise<void>
  onRetryPullContext?: () => Promise<void>
  onClosePull?: () => void
  onOpenInBrowser?: (target?: string | number, repository?: string, view?: "diff") => Promise<void>
  onCopyToClipboard?: (value: string) => Promise<boolean>
  onLoadMoreRuns?: () => Promise<void>
  onLoadMoreIssues?: (state: ListState) => Promise<void>
  onLoadMorePulls?: (state: ListState) => Promise<void>
}

export function App(props: AppProps) {
  const renderer = useRenderer()
  const { colors } = useTheme()
  const dimensions = useTerminalDimensions()
  const [navigation, setNavigation] = createSignal<NavigationState>({ page: "overview" })
  const [issueState, setIssueState] = createSignal<ListState>("open")
  const [issueRefresh, setIssueRefresh] = createSignal<{ number: number }>()
  const [pullState, setPullState] = createSignal<ListState>("open")
  const [pullRefresh, setPullRefresh] = createSignal<{ number: number }>()
  const [overviewDocument, setOverviewDocument] = createSignal<string>()
  const [diffFocus, setDiffFocus] = createSignal<Partial<Record<Page, DiffFocus>>>({})
  const [overlay, setOverlay] = createSignal<Overlay>()
  const [toast, setToast] = createSignal<ToastState>()
  const [commandAction, setCommandAction] = createSignal<CommandAction>()
  const [issueAction, setIssueAction] = createSignal<{ number: number; kind: IssueActionKind }>()
  const [issueActionHint, setIssueActionHint] = createSignal<string>()
  const [commandHint, setCommandHint] = createSignal<string>()
  const [confirmationPopup, setConfirmationPopup] = createSignal(false)
  const [settingsHint, setSettingsHint] = createSignal<string>()
  const [revealActivity, setRevealActivity] = createSignal<{ number: number; id: number }>()
  const emptyIssueAction: IssueActionState = { body: "", reason: "completed", operation: { status: "idle" } }
  let revealId = 0
  const canClone = () => Boolean(props.onRunCommand && props.cwd && !matchesLocalRepository(props.localRepository, data().repo.nameWithOwner))
  const openCommand = (action: CommandAction) => { setCommandAction(action); setOverlay("command") }
  let toastId = 0
  let overviewScroll: ScrollBoxRenderable | undefined
  let defaultStateRepository: string | undefined
  let issueDefaultResolved = false
  let pullDefaultResolved = false

  const config = () => props.config ?? defaultConfig
  const data = () => typeof props.data === "function" ? props.data() : props.data
  const operations = () => typeof props.operations === "function" ? props.operations() : props.operations
  const page = () => navigation().page
  const diffTarget = () => navigation().diffs?.[page()]
  const resourceForDiff = (target?: DiffTarget): ResourceState<DiffContent> => {
    const loaded = target && props.diffs?.[target.kind]
    const matches = target?.kind === "commit" ? loaded?.target.kind === "commit" && loaded.target.sha === target.sha
      : target?.kind === "pull" && loaded?.target.kind === "pull" && loaded.target.number === target.number
    return matches && loaded ? loaded.resource : { status: "loading", phase: "load" }
  }
  const diffResource = createMemo(() => resourceForDiff(diffTarget()))
  const viewDiff = (target: DiffTarget) => {
    setNavigation((state) => openDiff(state, target))
    void props.onLoadDiff?.(target)
  }
  const closeDiff = () => {
    const target = diffTarget()
    setNavigation(back)
    if (target) props.onCloseDiff?.(target)
  }
  const runId = createMemo(() => {
    const detail = navigation().details?.actions
    return detail?.kind === "run" ? detail.id : undefined
  })
  const activeRunId = () => page() === "actions" ? runId() : undefined
  const runDetail = createMemo<RunDetailState>(() => props.runDetail?.id === runId() && props.runDetail
    ? props.runDetail
    : { id: runId() ?? 0, resource: { status: "loading", phase: "load" }, jobs: { status: "loading", phase: "load" } })
  const runDetailPart = () => runDetail().resource.status !== "ready" ? "resource" : "jobs"
  const runUrl = (id: number) => `${data().repo.url}/actions/runs/${id}`
  const commitSha = createMemo(() => {
    const detail = navigation().details?.commits
    return detail?.kind === "commit" ? detail.sha : undefined
  })
  const activeCommitSha = () => page() === "commits" ? commitSha() : undefined
  const commitResource = createMemo<ResourceState<CommitDetail>>(() => props.commitDetail && props.commitDetail.sha === commitSha()
    ? props.commitDetail.resource
    : { status: "loading", phase: "load" })
  const issueNumber = createMemo(() => {
    const detail = navigation().details?.issues
    return detail?.kind === "issue" ? detail.number : undefined
  })
  const activeIssueNumber = () => page() === "issues" ? issueNumber() : undefined
  const issueDetail = createMemo<IssueDetailState>(() => props.issueDetail && props.issueDetail.number === issueNumber()
    ? props.issueDetail
    : { number: issueNumber() ?? 0, resource: { status: "loading", phase: "load" }, comments: { status: "loading", phase: "load" }, references: { status: "loading", phase: "load" } })
  const issueMenuItems = createMemo(() => referencedItems(issueDetail().references.value ?? [], {
    repository: data().repo.nameWithOwner, number: issueNumber() ?? 0,
  }))
  const issueDetailPart = () => {
    const detail = issueDetail()
    if (detail.resource.status !== "ready") return "issue"
    if (detail.comments.status !== "ready") return "comments"
    if (detail.references.status !== "ready") return "references"
    return "issue"
  }
  const issueUrl = (number: number) => props.issueDetail?.number === number && props.issueDetail.resource.value
    ? props.issueDetail.resource.value.url : `${data().repo.url}/issues/${number}`
  const canActOnIssue = (kind: IssueActionKind) => {
    const number = activeIssueNumber()
    return Boolean(number && props.onSubmitIssueAction && issueDetail().resource.value?.permissions?.[kind]
      && issueDetail().resource.status !== "loading"
      && props.getIssueAction?.(number).operation.status !== "loading")
  }
  const hasIssueActions = () => canActOnIssue(issueDetail().resource.value?.state === "closed" ? "reopen" : "close") || canActOnIssue("duplicate")
    || canActOnIssue("assignees")
  const openIssueAction = (kind: IssueActionKind) => {
    const number = activeIssueNumber()
    if (!number || !canActOnIssue(kind) || props.getIssueAction?.(number).operation.status === "loading") return
    props.onPrepareIssueAction?.(number, kind)
    setIssueAction({ number, kind })
    setOverlay("issue-action")
  }
  const submitIssueAction = async () => {
    const action = issueAction()
    if (!action || !props.onSubmitIssueAction || action.number !== activeIssueNumber() || !canActOnIssue(action.kind)) return
    const repository = data().repo.nameWithOwner
    const retry = props.getIssueAction?.(action.number).retry
    try {
      const result = await props.onSubmitIssueAction(action.number, action.kind)
      if (renderer.isDestroyed || data().repo.nameWithOwner !== repository || issueAction() !== action) return
      if (result.comment || retry) setRevealActivity({ number: action.number, id: ++revealId })
      setOverlay()
      setIssueAction()
      setToast({ id: ++toastId, title: action.kind === "comment" ? "Comment posted"
        : action.kind === "assignees" ? "Issue assignees updated"
        : action.kind === "duplicate" ? "Issue marked as duplicate" : action.kind === "close" ? "Issue closed" : "Issue reopened",
        message: result.duplicateOf ? `#${action.number} → #${result.duplicateOf}` : `#${action.number}`, duration: 2000, tone: "success" })
    } catch (error) {
      if (!renderer.isDestroyed && issueAction() === action && props.getIssueAction?.(action.number).operation.status !== "error")
        setToast({ id: ++toastId, title: "Issue action failed", message: error instanceof Error ? error.message : "Unknown error" })
    }
  }
  const refreshIssue = async (number: number) => {
    const detail = issueDetail()
    if (issueRefresh()?.number === number
      || [detail.resource, detail.comments, detail.references].some((resource) => resource.status === "loading")) return
    const request = { number }
    setIssueRefresh(request)
    try {
      if (detail.resource.status === "ready" && detail.comments.status === "error")
        await props.onLoadMoreIssueComments?.()
      else if (detail.resource.status === "ready" && detail.references.status === "error")
        await props.onRetryIssueReferences?.()
      else await props.onLoadIssue?.(number)
    } finally {
      setIssueRefresh((current) => current === request ? undefined : current)
    }
  }
  const pullNumber = createMemo(() => {
    const detail = navigation().details?.pulls
    return detail?.kind === "pull" ? detail.number : undefined
  })
  const activePullNumber = () => page() === "pulls" ? pullNumber() : undefined
  const pullDetail = createMemo<PullDetailState>(() => props.pullDetail && props.pullDetail.number === pullNumber()
    ? props.pullDetail
    : { number: pullNumber() ?? 0, resource: { status: "loading", phase: "load" }, commits: { status: "loading", phase: "load" }, context: { status: "loading", phase: "load" }, comments: { status: "loading", phase: "load" }, references: { status: "loading", phase: "load" } })
  const pullResource = () => pullDetail().resource
  const pullDetailPart = () => {
    const detail = pullDetail()
    if (detail.resource.status !== "ready") return "pull"
    if (detail.commits.status !== "ready") return "commits"
    if (detail.context.status !== "ready") return "context"
    if (detail.comments.status !== "ready") return "comments"
    if (detail.references.status !== "ready") return "references"
    return "pull"
  }
  const pullMenuItems = createMemo(() => referencedItems(pullDetail().references.value ?? [], {
    repository: data().repo.nameWithOwner, number: pullNumber() ?? 0,
  }))
  const activeMenuItems = () => activePullNumber() ? pullMenuItems() : issueMenuItems()
  const refreshPull = async (number: number) => {
    const detail = pullDetail()
    if (pullRefresh()?.number === number
      || [detail.resource, detail.commits, detail.context, detail.comments, detail.references].some((resource) => resource.status === "loading")) return
    const request = { number }
    setPullRefresh(request)
    try {
      if (detail.resource.status === "ready" && detail.commits.status === "error")
        await props.onRetryPullCommits?.()
      else if (detail.resource.status === "ready" && detail.context.status === "error")
        await props.onRetryPullContext?.()
      else if (detail.resource.status === "ready" && detail.comments.status === "error")
        await props.onLoadMorePullComments?.()
      else if (detail.resource.status === "ready" && detail.references.status === "error")
        await props.onRetryPullReferences?.()
      else await props.onLoadPull?.(number)
    } finally {
      setPullRefresh((current) => current === request ? undefined : current)
    }
  }
  const pullUrl = (number: number) => props.pullDetail?.number === number && props.pullDetail.resource.value
    ? props.pullDetail.resource.value.url : `${data().repo.url}/pull/${number}`
  const issues = () => data().issues[issueState()]
  const pulls = () => data().pulls[pullState()]
  const issueCounts = () => ({
    open: data().issues.open.value?.items.length ?? 0,
    closed: data().issues.closed.value?.items.length ?? 0,
  })
  const pullCounts = () => ({
    open: data().pulls.open.value?.items.length ?? 0,
    closed: data().pulls.closed.value?.items.length ?? 0,
  })
  const baseTabs = tabs.filter((tab) => tab.page !== "actions")
  const sectionAvailable = (...resources: ResourceState<{ items: readonly unknown[]; hasMore: boolean }>[]) => resources.some((resource) =>
    resource.status === "error" || Boolean(resource.value && (resource.value.items.length > 0 || resource.value.hasMore)),
  )
  const navigationTabs = createMemo<{ repository: string; tabs: typeof tabs; resolved: boolean }>((previous) => {
    const current = data()
    const repository = current.repo.nameWithOwner
    const conditional = [current.issues.open, current.issues.closed, current.pulls.open, current.pulls.closed, current.runs]
    const pending = operations().refresh.status === "loading" || conditional.some((resource) => resource.status === "loading")
    // Freeze availability across partial refresh responses; unknown initial tabs stay hidden until availability is known.
    if (pending && previous.repository === repository && previous.resolved) return previous
    if (pending && conditional.some((resource) => resource.value === undefined)) return { repository, tabs: baseTabs, resolved: false }
    const available = tabs.filter((tab) => {
      if (tab.page === "actions") return sectionAvailable(current.runs)
      return true
    })
    if (previous.repository === repository && previous.resolved && available.length === previous.tabs.length
      && available.every((tab, index) => tab.page === previous.tabs[index]?.page)) return previous
    return { repository, tabs: available, resolved: true }
  }, { repository: "", tabs: baseTabs, resolved: false })
  const visibleTabs = () => navigationTabs().tabs
  const overviewDocuments = () => data().documents.value ?? []
  const currentOverviewDocument = createMemo(() => overviewDocuments().find((document) => document.id === overviewDocument())
    ?? overviewDocuments()[0])
  const activeResource = (): ResourceState<unknown> | undefined => {
    if (diffTarget()) return diffResource()
    if (activeRunId()) return runDetail()[runDetailPart()]
    if (activeCommitSha()) return commitResource()
    if (activePullNumber()) {
      const part = pullDetailPart()
      return part === "pull" ? pullResource() : pullDetail()[part]
    }
    if (activeIssueNumber()) {
      const part = issueDetailPart()
      return part === "issue" ? issueDetail().resource : issueDetail()[part]
    }
    if (page() === "overview") return data().documents.status !== "ready"
      ? data().documents : currentOverviewDocument()?.resource ?? data().documents
    if (page() === "commits") return data().commits
    if (page() === "issues") return issues()
    if (page() === "pulls") return pulls()
    if (page() === "actions") return data().runs
    return undefined
  }
  const retryTarget = (): RepositoryResource | undefined => {
    if (page() === "overview") {
      const document = currentOverviewDocument()
      return data().documents.status === "ready" && document
        ? { kind: "document", id: document.id } : { kind: "documents" }
    }
    if (page() === "commits") return { kind: "commits" }
    if (page() === "issues") return { kind: "issues", state: issueState() }
    if (page() === "pulls") return { kind: "pulls", state: pullState() }
    if (page() === "actions") return { kind: "runs" }
    return undefined
  }
  const statusKind = (): StatusKind | undefined => {
    if (overlay() === "issue-action") {
      const action = issueAction()
      if (action && props.getIssueAction?.(action.number).operation.status === "loading")
        return action.kind === "assignees" ? "updating-issue"
          : action.kind === "duplicate" ? "marking-duplicate" : action.kind === "comment" ? "posting-comment"
          : action.kind === "close" ? "closing-issue" : "reopening-issue"
      return undefined
    }
    if (overlay() === "issue-actions") return undefined
    const current = operations()
    if (current.refresh.status === "loading") return "refreshing"
    if (current.branch.status === "loading") return "switching-branch"
    const resource = activeResource()
    if (resource?.status === "loading") {
      if (resource.phase === "pagination") return "loading-more"
      if (activeRunId() && resource.value !== undefined) return "refreshing"
      if (activeCommitSha() && resource.value !== undefined) return "refreshing"
      if (activePullNumber() && pullResource().value) {
        if (pullRefresh()?.number === activePullNumber() || resource.value !== undefined) return "refreshing"
        return "loading-resource"
      }
      if (activeIssueNumber() && issueDetail().resource.value) {
        if (issueRefresh()?.number === activeIssueNumber() || resource.value !== undefined) return "refreshing"
        return "loading-resource"
      }
      return resource.value === undefined ? undefined : "loading-resource"
    }
    return undefined
  }
  const statusDetail = () => {
    if (diffTarget()) return "diff"
    if (activeRunId()) return "workflow run"
    if (activeCommitSha()) return "commit"
    if (activePullNumber()) return pullDetailPart() === "pull" ? "pull request" : pullDetailPart() === "context" ? "PR details" : pullDetailPart()
    if (activeIssueNumber()) return issueDetailPart()
    if (page() === "overview")
      return data().documents.status === "ready" ? currentOverviewDocument()?.label ?? "documentation" : "documentation"
    if (page() === "commits") return "commits"
    if (page() === "issues") return `${issueState()} issues`
    if (page() === "pulls") return `${pullState()} pull requests`
    if (page() === "actions") return "workflow runs"
    return undefined
  }
  const status = createMemo(statusKind)
  const paginationSource = () => {
    if (activeRunId()) return `pagination:run:${runId()}`
    if (activeCommitSha()) return `pagination:commit:${commitSha()}`
    if (activeIssueNumber()) return `pagination:issue:${issueNumber()}`
    if (activePullNumber()) return `pagination:pull:${pullNumber()}`
    if (page() === "commits") return "pagination:commits"
    if (page() === "issues") return `pagination:issues:${issueState()}`
    if (page() === "pulls") return `pagination:pulls:${pullState()}`
    if (page() === "actions") return "pagination:runs"
    return undefined
  }
  const activeResourceSource = () => {
    if (diffTarget()) return `resource:diff:${JSON.stringify(diffTarget())}`
    if (activeRunId()) return `resource:run:${runId()}:${runDetailPart()}`
    if (activeCommitSha()) return `resource:commit:${commitSha()}`
    if (activePullNumber()) return `resource:pull:${pullNumber()}:${pullDetailPart()}`
    if (activeIssueNumber()) return `resource:issue:${issueNumber()}:${issueDetailPart()}`
    if (page() === "overview") return `resource:overview:${data().documents.status === "ready" ? currentOverviewDocument()?.id : "documents"}`
    if (page() === "commits") return "resource:commits"
    if (page() === "issues") return `resource:issues:${issueState()}`
    if (page() === "pulls") return `resource:pulls:${pullState()}`
    if (page() === "actions") return "resource:runs"
    return undefined
  }
  const shownFailures = new Map<string, string>()

  createEffect(() => {
    const current = data()
    const currentOperations = operations()
    const failures = new Map<string, string>()
    if (currentOperations.refresh.status === "error") failures.set("refresh", currentOperations.refresh.message)
    if (currentOperations.branch.status === "error") failures.set("branch", currentOperations.branch.message)

    const paginationResources: Array<[string, ResourceState<unknown>]> = [
      ["pagination:commits", current.commits],
      ["pagination:runs", current.runs],
      ["pagination:issues:open", current.issues.open],
      ["pagination:issues:closed", current.issues.closed],
      ["pagination:pulls:open", current.pulls.open],
      ["pagination:pulls:closed", current.pulls.closed],
    ]
    if (runId()) paginationResources.push([`pagination:run:${runId()}`, runDetail().jobs])
    if (commitSha()) paginationResources.push([`pagination:commit:${commitSha()}`, commitResource()])
    if (issueNumber()) paginationResources.push([`pagination:issue:${issueNumber()}`, issueDetail().comments])
    if (pullNumber()) paginationResources.push([`pagination:pull:${pullNumber()}`, pullDetail().comments])
    for (const [source, resource] of paginationResources) {
      if (resource.status === "error" && resource.phase === "pagination") failures.set(source, resource.message)
    }
    const active = activeResource()
    const resourceSource = activeResourceSource()
    if (resourceSource && active?.status === "error" && active.phase === "load" && active.value !== undefined)
      failures.set(resourceSource, active.message)
    for (const [source, message] of shownFailures) {
      const pendingRunResource = source === `resource:run:${runId()}:resource` ? runDetail().resource
        : source === `resource:run:${runId()}:jobs` || source === `pagination:run:${runId()}` ? runDetail().jobs : undefined
      // Automatic retries should not re-notify the same failure every five seconds.
      if (pendingRunResource?.status === "loading") continue
      if (failures.get(source) !== message) shownFailures.delete(source)
    }

    let source: string | undefined
    let title: string | undefined
    if (failures.has("refresh")) {
      source = "refresh"
      title = "Refresh failed"
    } else if (failures.has("branch")) {
      source = "branch"
      title = "Branch switch failed"
    } else {
      source = activeResourceSource()
      if (source && failures.has(source)) title = `Refresh failed — ${statusDetail()}`
      else {
        source = paginationSource()
        if (source && failures.has(source)) title = `Load more failed — ${statusDetail()}`
      }
    }

    if (!source || !title || shownFailures.has(source)) return
    const message = failures.get(source) ?? "Unknown error"
    shownFailures.set(source, message)
    setToast({ id: ++toastId, title, message })
  })

  createEffect(() => {
    const current = data()
    const repository = current.repo.nameWithOwner
    if (defaultStateRepository !== repository) {
      defaultStateRepository = repository
      issueDefaultResolved = false
      pullDefaultResolved = false
      setIssueState("open")
      setPullState("open")
    }

    if (navigationTabs().resolved) {
      if (!visibleTabs().some((tab) => tab.page === "issues")) issueDefaultResolved = false
      if (!visibleTabs().some((tab) => tab.page === "pulls")) pullDefaultResolved = false
    }

    if (!issueDefaultResolved && current.issues.open.status === "ready" && current.issues.closed.status === "ready"
      && (current.issues.open.value.items.length > 0 || current.issues.closed.value.items.length > 0)
      && (current.issues.open.value.items.length > 0 || !current.issues.open.value.hasMore)) {
      issueDefaultResolved = true
      if (current.issues.open.value.items.length === 0 && current.issues.closed.value.items.length > 0)
        setIssueState("closed")
    }

    if (!pullDefaultResolved && current.pulls.open.status === "ready" && current.pulls.closed.status === "ready"
      && (current.pulls.open.value.items.length > 0 || current.pulls.closed.value.items.length > 0)) {
      pullDefaultResolved = true
      if (current.pulls.open.value.items.length === 0 && current.pulls.closed.value.items.length > 0)
        setPullState("closed")
    }
  })

  createEffect(() => {
    if (visibleTabs().some((tab) => tab.page === page())) return
    const detail = navigation().details?.[page()]
    setNavigation((state) => navigate(back(state), "overview"))
    if (detail?.kind === "issue") props.onCloseIssue?.()
    if (detail?.kind === "pull") props.onClosePull?.()
    if (detail?.kind === "issue") setRevealActivity()
    if (overlay() === "issue-references" || overlay() === "issue-actions" || overlay() === "issue-action") { setOverlay(); setIssueAction() }
  })

  createEffect(() => {
    if (!overviewDocuments().some((document) => document.id === overviewDocument())) {
      setOverviewDocument(overviewDocuments()[0]?.id)
      overviewScroll?.scrollTo(0)
    }
  })

  onCleanup(() => { props.onCloseDiff?.(); props.onCloseRun?.(); props.onCloseCommit?.(); props.onCloseIssue?.(); props.onClosePull?.() })

  const closeDetail = () => {
    const detail = navigation().details?.[page()]
    setNavigation(back)
    if (detail?.kind === "run") props.onCloseRun?.()
    if (detail?.kind === "commit") props.onCloseCommit?.()
    if (detail?.kind === "issue") { props.onCloseIssue?.(); setRevealActivity() }
    if (detail?.kind === "pull") props.onClosePull?.()
  }
  const selectPage = (next: Page) => setNavigation((state) => navigate(state, next))
  const movePage = (delta: number) => {
    const available = visibleTabs()
    const current = Math.max(0, available.findIndex((tab) => tab.page === page()))
    selectPage(available[(current + delta + available.length) % available.length]!.page)
  }
  const moveOverviewDocument = (delta: number) => {
    const available = overviewDocuments()
    if (!available.length) return
    const current = Math.max(0, available.findIndex((document) => document.id === overviewDocument()))
    setOverviewDocument(available[(current + delta + available.length) % available.length]!.id)
    overviewScroll?.scrollTo(0)
  }
  const quit = () => props.onQuit ? props.onQuit() : renderer.destroy()
  let openingBrowser = false
  const openInBrowser = async (target?: string | number, repository?: string, view?: "diff") => {
    if (openingBrowser || !props.onOpenInBrowser) return
    openingBrowser = true
    const origin = navigation()
    const label = typeof target === "number" ? `${repository ? repository + "#" : "#"}${target}` : target?.slice(0, 7) ?? data().repo.nameWithOwner
    try {
      await props.onOpenInBrowser(target, repository, view)
      if (!renderer.isDestroyed && navigation() === origin)
        setToast({ id: ++toastId, title: "Opened on GitHub", message: label, duration: 2000, tone: "success" })
    } catch (error) {
      if (!renderer.isDestroyed && navigation() === origin)
        setToast({ id: ++toastId, title: "Could not open GitHub", message: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      openingBrowser = false
    }
  }
  let copying = false
  const copyToClipboard = async (value: string, label: "SHA" | "URL") => {
    if (copying) return
    copying = true
    const origin = navigation()
    try {
      const copied = await props.onCopyToClipboard?.(value) ?? false
      if (renderer.isDestroyed) return
      if (!copied && !renderer.copyToClipboardOSC52(value))
        throw new Error(`Clipboard unavailable. Enable OSC 52 or copy the ${label} manually.`)
      if (navigation() === origin) setToast(copied
        ? { id: ++toastId, title: `${label} copied to clipboard`, message: value, duration: 2000, tone: "success" }
        : { id: ++toastId, title: `${label} sent to terminal`, message: "Copy could not be confirmed. Your terminal/tmux must allow OSC 52 clipboard requests.", duration: 4000, tone: "info" })
    } catch (error) {
      if (!renderer.isDestroyed && navigation() === origin)
        setToast({ id: ++toastId, title: `Could not copy ${label}`, message: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      copying = false
    }
  }
  const shortcutHint = () => {
    if (!config().showStatusBarHints) return undefined
    if (overlay() === "issue-action") return issueActionHint()
    if (overlay() === "issue-actions") return "↑/↓ select · enter open · esc close"
    if (overlay() === "help") return "esc close"
    if (overlay() === "settings") return settingsHint()
    if (overlay() === "command") return commandHint()
    if (overlay() === "branch-picker") return "↑/↓ select · enter open · esc close"
    if (overlay() === "issue-references") return "↑/↓ select · enter open · tab switch tabs · y copy URL · esc close"
    if (overlay() === "switch-repo") return "↑/↓ select · enter open · esc close"
    const common = (props.onSwitchRepository ? " · s switch repo" : "") + " · ? help"
    if (diffTarget()) {
      const files = diffFocus()[page()] === "files"
      const horizontal = files ? "←/→ tabs" : "←/→ pan"
      const next = files ? "diff" : "files"
      if (dimensions().width < 80) return `esc back · ${horizontal} · tab focus ${next} · ? help`
      return `esc back · ${horizontal} · ↑/↓ ${files ? "files" : "scroll"} · tab focus ${next} · b toggle files · [ ] hunks`
        + (diffResource().status === "error" ? " · enter file list" : " · t layout · w wrap") + " · ? help"
    }
    if (activeRunId()) return "esc back · o GitHub · y copy URL"
      + (activeResource()?.status === "error" ? " · r retry" : runDetail().jobs.value?.hasMore ? " · enter load more" : " · r refresh") + common
    if (activeCommitSha()) {
      const retry = commitResource().status === "error"
      const more = commitResource().value?.files.hasMore
      if (dimensions().width < 60 && (retry || more)) return "esc back · D diff"
        + (retry ? " · r retry" : " · enter load more") + common
      return "esc back · D diff · o GitHub · y copy SHA"
        + (retry ? " · r retry" : more ? " · enter load more" : "")
        + common
    }
    if (activeIssueNumber()) {
      const retry = activeResource()?.status === "error"
      const more = issueDetail().comments.value?.hasMore
      const references = issueMenuItems().length
      const actions = (canActOnIssue("comment") ? " · c comment" : "") + (hasIssueActions() ? " · a actions" : "")
      const hintWidth = dimensions().width - actions.length
      if (dimensions().width < 64) return "esc back" + actions
        + (!actions ? retry ? " · r retry" : more ? " · enter load more" : references ? " · p references" : " · o GitHub" : "")
        + common
      return "esc back" + actions
        + (retry ? " · r retry" : more ? " · enter load more" : "")
        + (references && hintWidth >= 64 ? " · p references" : "")
        + (hintWidth >= 100 || !retry && !more && hintWidth >= 64 ? " · o GitHub · y copy URL" : "")
        + common
    }
    if (activePullNumber()) {
      const retry = activeResource()?.status === "error"
      const more = pullDetail().comments.value?.hasMore
      const references = pullMenuItems().length
      if (dimensions().width < 64) return "esc back · D diff"
        + (retry ? " · r retry" : more ? " · enter load more" : references ? " · p references" : " · o GitHub") + common
      return "esc back · D diff"
        + (retry ? " · r retry" : more ? " · enter load more" : "")
        + (references ? " · p references" : "")
        + (dimensions().width >= 100 || !retry && !more ? " · o GitHub · y copy URL" : "") + common
    }
    if (page() === "actions") return "↑/↓ select · enter open · o GitHub · y copy URL" + common
    if (page() === "pulls") return "↑/↓ select · enter open · D diff · o GitHub · y copy URL"
      + (dimensions().width >= 60 ? " · tab open/closed" : "") + common
    if (page() === "issues") return "↑/↓ select · enter open · o GitHub · y copy URL"
      + (dimensions().width >= 60 ? " · tab open/closed" : "") + common
    if (page() === "commits") return "↑/↓ select · enter open · D diff · o GitHub · y copy SHA"
      + (dimensions().width >= 60 ? " · tab branch" : "")
      + common
    if (page() === "overview") return "o GitHub · y copy URL" + (canClone() ? " · x clone" : "")
      + common
    return props.onSwitchRepository ? "s switch repo · ? help" : "? help"
  }

  // Global handlers run before focused inputs; overlay checks must precede page shortcuts.
  // Hidden tabs remain mounted, so their lists must also gate interaction explicitly.
  useKeyboard((event) => {
    const escape = event.name === "escape" || event.name === "esc" || event.raw === "\u001b" || event.sequence === "\u001b"
    if (overlay() === "branch-picker" || overlay() === "issue-references") {
      if (escape) setOverlay()
      return
    }
    if (overlay() === "settings" || overlay() === "command" || overlay() === "switch-repo"
      || overlay() === "issue-actions" || overlay() === "issue-action") return
    if (event.name === "q") return quit()
    if (overlay() === "help") {
      if (event.name === "?" || escape) setOverlay()
      return
    }
    if (event.name === "s" && !event.ctrl && !event.meta && !event.shift && !event.super && !event.hyper && !event.option && props.onSwitchRepository) {
      event.preventDefault()
      event.stopPropagation()
      setOverlay("switch-repo")
      void props.onRefreshRecentRepositories?.().catch(() => {})
      return
    }
    if (event.name === "?") return setOverlay("help")
    if (event.name === "," || event.sequence === ",") return setOverlay("settings")
    const diff = diffTarget()
    if (diff) {
      if (escape) { event.stopPropagation(); closeDiff(); return }
      if (event.ctrl || event.meta) return
      if (event.name === "o") void openInBrowser(diff.kind === "pull" ? diff.number : diff.sha, undefined, "diff")
      else if (event.name === "r" && diffResource().status !== "loading") void props.onLoadDiff?.(diff)
      else if ((event.name === "return" || event.name === "enter") && diffResource().status === "error")
        void props.onLoadDiff?.(diff, true)
      else if (event.name >= "1" && event.name <= "5") {
        const tab = visibleTabs()[Number(event.name) - 1]
        if (tab) { event.stopPropagation(); selectPage(tab.page) }
      }
      return
    }
    if (escape && navigation().details?.[page()]) {
      event.stopPropagation()
      return closeDetail()
    }
    if (event.name >= "1" && event.name <= "5") {
      const target = visibleTabs()[Number(event.name) - 1]
      if (target) { event.stopPropagation(); selectPage(target.page) }
      return
    }
    if (event.name === "left" || event.name === "h") {
      event.stopPropagation()
      return movePage(-1)
    }
    if (event.name === "right" || event.name === "l") {
      event.stopPropagation()
      return movePage(1)
    }
    const run = activeRunId()
    if (run) {
      if (event.ctrl || event.meta) return
      if (event.name === "r" || event.name === "return" || event.name === "enter") {
        shownFailures.delete(`resource:run:${run}:resource`)
        shownFailures.delete(`resource:run:${run}:jobs`)
        shownFailures.delete(`pagination:run:${run}`)
      }
      if (event.name === "o") void openInBrowser(`actions/runs/${run}`)
      else if (event.name === "y") void copyToClipboard(runUrl(run), "URL")
      else if (event.name === "return" || event.name === "enter") void props.onLoadMoreRunJobs?.()
      else if (event.name === "r") {
        const jobs = runDetail().jobs
        if (runDetail().resource.status === "ready" && jobs.status === "error" && jobs.phase === "pagination") void props.onLoadMoreRunJobs?.()
        else void props.onLoadRun?.(run)
      }
      return
    }
    const sha = activeCommitSha()
    if (sha) {
      if (event.ctrl || event.meta) return
      if ((event.name === "D" || (event.name === "d" && event.shift))) viewDiff({ kind: "commit", sha })
      else if (event.name === "o") void openInBrowser(sha)
      else if (event.name === "y") void copyToClipboard(sha, "SHA")
      else if (event.name === "return" || event.name === "enter") void props.onLoadMoreCommitFiles?.()
      else if (event.name === "r") {
        const resource = commitResource()
        if (resource.status === "loading") return
        if (resource.status === "error" && resource.phase === "pagination") void props.onLoadMoreCommitFiles?.()
        else void props.onLoadCommit?.(sha)
      }
      return
    }
    const number = activeIssueNumber()
    if (number) {
      if (event.ctrl || event.meta) return
      if (event.name === "o") void openInBrowser(number)
      else if (event.name === "y") void copyToClipboard(issueUrl(number), "URL")
      else if (event.name === "c" && canActOnIssue("comment")) { event.stopPropagation(); openIssueAction("comment") }
      else if (event.name === "a" && hasIssueActions()) { event.stopPropagation(); setOverlay("issue-actions") }
      else if (event.name === "p" && issueMenuItems().length) setOverlay("issue-references")
      else if (event.name === "return" || event.name === "enter") void props.onLoadMoreIssueComments?.()
      else if (event.name === "r") void refreshIssue(number)
      return
    }
    const pull = activePullNumber()
    if (pull) {
      if (event.ctrl || event.meta) return
      if ((event.name === "D" || (event.name === "d" && event.shift))) viewDiff({ kind: "pull", number: pull })
      else if (event.name === "o") void openInBrowser(pull)
      else if (event.name === "y") void copyToClipboard(pullUrl(pull), "URL")
      else if (event.name === "p" && pullMenuItems().length) setOverlay("issue-references")
      else if (event.name === "return" || event.name === "enter") void props.onLoadMorePullComments?.()
      else if (event.name === "r") void refreshPull(pull)
      return
    }
    if (page() === "overview" && !event.ctrl && !event.meta) {
      if (event.name === "x" && canClone()) {
        const repository = data().repo.nameWithOwner
        return openCommand({ title: `Clone ${repository}`, destination: cloneDestination(repository.split("/")[1]!, props.cwd!), command: (destination) => cloneCommand(repository, destination, props.cwd!) })
      }
      if (event.name === "o") return void openInBrowser()
      if (event.name === "y") return void copyToClipboard(data().repo.url, "URL")
    }
    if (event.name === "tab") {
      if (page() === "overview") {
        moveOverviewDocument(event.shift ? -1 : 1)
      } else if (page() === "commits") {
        const branches = data().branches
        if (branches.status === "error" && branches.phase === "load") props.onRetryResource?.({ kind: "branches" })
        if (branches.value) setOverlay("branch-picker")
      } else if (page() === "issues") {
        setIssueState((value) => value === "open" ? "closed" : "open")
      } else if (page() === "pulls") {
        setPullState((value) => value === "open" ? "closed" : "open")
      }
      return
    }
    if (page() === "overview" && (event.name === "G" || (event.name === "g" && event.shift))) {
      if (overviewScroll) overviewScroll.scrollTo(Math.max(0, overviewScroll.scrollHeight - overviewScroll.viewport.height))
      return
    }
    if (page() === "overview" && event.name === "g") return overviewScroll?.scrollTo(0)
    if (page() === "overview" && event.name === "u")
      return overviewScroll?.scrollBy(-Math.max(1, Math.floor((overviewScroll.viewport.height ?? 1) / 2)))
    if (page() === "overview" && event.name === "d")
      return overviewScroll?.scrollBy(Math.max(1, Math.floor((overviewScroll.viewport.height ?? 1) / 2)))
    if ((event.name === "up" || event.name === "k") && page() === "overview")
      return overviewScroll?.scrollBy(-1)
    if ((event.name === "down" || event.name === "j") && page() === "overview")
      return overviewScroll?.scrollBy(1)
    if (event.name === "r") {
      const resource = activeResource()
      const target = retryTarget()
      if (resource?.status === "error" && target) return props.onRetryResource?.(target)
      return props.onRefresh?.()
    }
  })

  return (
    <IconProvider style={config().iconStyle}>
    <box width={dimensions().width} height={dimensions().height} flexDirection="column" backgroundColor={colors.canvas}>
      <Header repo={data().repo} page={page()} tabs={visibleTabs()} workCounts={data().workCounts} compact={config().compactHeader} showTabCounts={config().showTabCounts} />
      <box visible={!diffTarget()} flexGrow={1} minHeight={0} flexDirection="column">
      <box visible={page() === "overview"} flexGrow={1} minHeight={0}>
          <OverviewScreen
            repo={data().repo}
            documents={data().documents}
            currentDocument={overviewDocument()}
            compactHeader={config().compactHeader}
            hideDocumentsTab={config().hideDocumentsTab}
            showScrollbar={config().showScrollbars}
            aboutSidebar={config().aboutSidebar}
            detailLayout={config().detailLayout}
            scrollRef={(value) => (overviewScroll = value)}
          />
        </box>
        <box visible={page() === "commits" && !commitSha()} flexGrow={1} minHeight={0}>
          <CommitsScreen
            commits={data().commits}
            commitCount={data().commitCount}
            currentBranch={data().currentBranch}
            active={page() === "commits" && !commitSha()}
            interactive={!diffTarget() && overlay() === undefined}
            showScrollbar={config().showScrollbars}
            onOpenCommit={(commit) => {
              setNavigation((state) => openDetail(state, { kind: "commit", sha: commit.sha }))
              void props.onLoadCommit?.(commit.sha)
            }}
            onOpenCommitInBrowser={(commit) => void openInBrowser(commit.sha)}
            onCopyCommitSha={(commit) => void copyToClipboard(commit.sha, "SHA")}
            onDiff={(commit) => viewDiff({ kind: "commit", sha: commit.sha })}
            onEndReached={() => {
              const commits = data().commits
              if (commits.status === "ready" && commits.value.hasMore) void props.onLoadMoreCommits?.()
            }}
          />
        </box>
        <box visible={page() === "issues" && !issueNumber()} flexGrow={1} minHeight={0}>
          <WorkScreen
            kind="issue"
            state={issueState()}
            counts={issueCounts()}
            resource={issues()}
            active={page() === "issues" && !issueNumber()}
            interactive={!diffTarget() && overlay() === undefined}
            showScrollbar={config().showScrollbars}
            onOpen={(issue) => {
              setNavigation((state) => openDetail(state, { kind: "issue", number: issue.number }))
              void props.onLoadIssue?.(issue.number)
            }}
            onOpenInBrowser={(issue) => void openInBrowser(issue.number)}
            onCopy={(issue) => void copyToClipboard(issueUrl(issue.number), "URL")}
            onEndReached={() => {
              const resource = issues()
              if (resource.status === "ready" && resource.value.hasMore) void props.onLoadMoreIssues?.(issueState())
            }}
          />
        </box>
        <box visible={page() === "pulls" && !pullNumber()} flexGrow={1} minHeight={0}>
          <WorkScreen
            kind="pull"
            state={pullState()}
            counts={pullCounts()}
            resource={pulls()}
            active={page() === "pulls" && !pullNumber()}
            interactive={!diffTarget() && overlay() === undefined}
            showScrollbar={config().showScrollbars}
            onOpen={(pull) => {
              setNavigation((state) => openDetail(state, { kind: "pull", number: pull.number }))
              void props.onLoadPull?.(pull.number)
            }}
            onOpenInBrowser={(pull) => void openInBrowser(pull.number)}
            onCopy={(pull) => void copyToClipboard(pullUrl(pull.number), "URL")}
            onDiff={(pull) => viewDiff({ kind: "pull", number: pull.number })}
            onEndReached={() => {
              const resource = pulls()
              if (resource.status === "ready" && resource.value.hasMore) void props.onLoadMorePulls?.(pullState())
            }}
          />
        </box>
        <Show when={visibleTabs().some((tab) => tab.page === "actions")}>
          <box visible={page() === "actions" && !runId()} flexGrow={1} minHeight={0}>
            <ActionsScreen
              runs={data().runs}
              onOpenRun={(run) => {
                setNavigation((state) => openDetail(state, { kind: "run", id: run.id }))
                void props.onLoadRun?.(run.id)
              }}
              onOpenRunInBrowser={(run) => void openInBrowser(`actions/runs/${run.id}`)}
              onCopyRunUrl={(run) => void copyToClipboard(runUrl(run.id), "URL")}
              active={page() === "actions" && !runId()}
              interactive={!diffTarget() && overlay() === undefined}
              showScrollbar={config().showScrollbars}
              onEndReached={() => {
                const runs = data().runs
                if (runs.status === "ready" && runs.value.hasMore) void props.onLoadMoreRuns?.()
              }}
            />
          </box>
        </Show>
      <Show when={runId()} keyed>
        {(id) => (
          <box visible={page() === "actions"} flexGrow={1} minHeight={0}>
            <RunScreen
              id={id}
              detail={runDetail()}
              active={page() === "actions"}
              onRefresh={props.onLoadRun ? () => props.onLoadRun!(id) : undefined}
              interactive={page() === "actions" && overlay() === undefined}
              showScrollbar={config().showScrollbars}
              detailLayout={config().detailLayout}
            />
          </box>
        )}
      </Show>
      <Show when={commitSha()} keyed>
        {(sha) => (
          <box visible={page() === "commits"} flexGrow={1} minHeight={0}>
            <CommitScreen
              sha={sha}
              resource={commitResource()}
              interactive={!diffTarget() && page() === "commits" && overlay() === undefined}
              showScrollbar={config().showScrollbars}
              detailLayout={config().detailLayout}
            />
          </box>
        )}
      </Show>
      <Show when={issueNumber()} keyed>
        {(number) => (
          <box visible={page() === "issues"} flexGrow={1} minHeight={0}>
            <IssueScreen
              number={number}
              detail={issueDetail()}
              revealActivity={revealActivity()?.number === number ? revealActivity()?.id : undefined}
              defaultBranch={data().repo.defaultBranch}
              interactive={!diffTarget() && page() === "issues" && overlay() === undefined}
              showScrollbar={config().showScrollbars}
              detailLayout={config().detailLayout}
            />
          </box>
        )}
      </Show>
      <Show when={pullNumber()} keyed>
        {(number) => (
          <box visible={page() === "pulls"} flexGrow={1} minHeight={0}>
            <PullScreen
              number={number}
              detail={pullDetail()}
              defaultBranch={data().repo.defaultBranch}
              interactive={!diffTarget() && page() === "pulls" && overlay() === undefined}
              showScrollbar={config().showScrollbars}
              detailLayout={config().detailLayout}
            />
          </box>
        )}
      </Show>
      </box>
      <For each={["commits", "pulls"] as const}>
        {(owner) => <Show when={navigation().diffs?.[owner]} keyed>
          {(target) => <box id={`diff-view-${owner}`} visible={page() === owner} flexGrow={1} minHeight={0} flexDirection="column">
            <DiffScreen target={target} resource={resourceForDiff(target)} active={page() === owner}
              interactive={page() === owner && overlay() === undefined}
              onMovePage={movePage}
              onFocusChange={(focus) => setDiffFocus((current) => ({ ...current, [owner]: focus }))}
              showScrollbar={config().showScrollbars} onLoadFiles={() => void props.onLoadDiff?.(target, true)} />
          </box>}
        </Show>}
      </For>
      <Show when={!confirmationPopup()}>
        <StatusBar kind={status()} detail={statusDetail()} hint={shortcutHint()}
          zIndex={overlay() && (config().showStatusBarHints || status()) ? 350 : 0} />
      </Show>
      <Show when={toast()} keyed>
        {(current) => (
          <Toast
            title={current.title}
            message={current.message}
            duration={current.duration}
            tone={current.tone}
            onDismiss={() => setToast((value) => value?.id === current.id ? undefined : value)}
          />
        )}
      </Show>
      <Show when={overlay() === "switch-repo"}>
        <SwitchRepositoryScreen
          renderStatusBar={false}
          recent={props.recentRepositories ?? []}
          showStatusBarHints={config().showStatusBarHints}
          current={data().repo.nameWithOwner}
          showScrollbar={config().showScrollbars}
          onClose={() => setOverlay()}
          onOpen={(repository) => {
            setOverlay()
            if (repository.toLowerCase() !== data().repo.nameWithOwner.toLowerCase()) props.onSwitchRepository?.(repository)
          }}
        />
      </Show>
      <Show when={overlay() === "command" && commandAction()} keyed>
        {(action) => <CommandDialog
          action={action}
          onHintChange={setCommandHint}
          onConfirmationChange={setConfirmationPopup}
          onRun={props.onRunCommand!}
          onCaptureCancel={props.onCommandCaptureCancel}
          onCopy={props.onCopyToClipboard}
          onClose={() => { setOverlay(); setCommandAction() }}
        />}
      </Show>
      <Show when={overlay() === "help"}>
        <Help
          view={diffTarget() ? "diff" : activeRunId() ? "run" : activeCommitSha() ? "commit" : activeIssueNumber() ? "issue" : activePullNumber() ? "pull" : page()}
          tabCount={visibleTabs().length}
          hasDocumentTabs={overviewDocuments().length > 1}
          hasMoreFiles={commitResource().value?.files.hasMore}
          hasMoreComments={activePullNumber() ? pullDetail().comments.value?.hasMore : issueDetail().comments.value?.hasMore}
          hasReferences={activeMenuItems().length > 0}
          canComment={canActOnIssue("comment")}
          hasIssueActions={hasIssueActions()}
          command={page() === "overview" && canClone() ? "clone repository" : undefined}
        />
      </Show>
      <Show when={overlay() === "issue-actions" && activeIssueNumber() && hasIssueActions()}>
        <IssueActionsMenu
          number={activeIssueNumber()!}
          state={issueDetail().resource.value?.state ?? "open"}
          permissions={issueDetail().resource.value?.permissions}
          onSelect={openIssueAction}
          onClose={() => setOverlay()}
        />
      </Show>
      <Show when={overlay() === "issue-action" ? issueAction() : undefined} keyed>
        {(action) => <Show when={action.kind === "assignees"}
          fallback={<IssueActionDialog
            number={action.number}
            kind={action.kind}
            state={props.getIssueAction?.(action.number) ?? emptyIssueAction}
            showScrollbar={config().showScrollbars}
            locked={issueDetail().resource.value?.locked}
            repositoryUrl={data().repo.url}
            defaultBranch={data().repo.defaultBranch}
            onBodyChange={(body) => props.onIssueDraftChange?.(action.number, { body })}
            onReasonChange={(reason) => props.onIssueDraftChange?.(action.number, { reason })}
            onDuplicateTargetChange={(duplicateTarget) => props.onIssueDraftChange?.(action.number, { duplicateTarget })}
            onSubmit={() => void submitIssueAction()}
            onDiscard={() => props.onDiscardIssueDraft?.(action.number)}
            onHintChange={setIssueActionHint}
            onConfirmationChange={setConfirmationPopup}
            onClose={() => { setOverlay(); setIssueAction() }}
          />}>
          <IssueAssigneesPicker
            number={action.number}
            state={props.getIssueAction?.(action.number) ?? emptyIssueAction}
            users={props.assignableUsers}
            showScrollbar={config().showScrollbars}
            onLoadMore={() => void props.onLoadAssignableUsers?.()}
            onChange={(selectedAssignees) => props.onIssueDraftChange?.(action.number, { selectedAssignees })}
            onSubmit={() => void submitIssueAction()}
            onHintChange={setIssueActionHint}
            onClose={() => { setOverlay(); setIssueAction() }}
          />
        </Show>}
      </Show>
      <Show when={overlay() === "issue-references" && (activeIssueNumber() || activePullNumber())}>
        <IssueReferencesPicker
          references={(activePullNumber() ? pullDetail() : issueDetail()).references.value ?? []}
          currentIssue={{ repository: data().repo.nameWithOwner, number: (activeIssueNumber() ?? activePullNumber())! }}
          showScrollbar={config().showScrollbars}
          onOpen={(reference) => { setOverlay(); void openInBrowser(reference.number, reference.repository) }}
          onCopy={(reference) => { setOverlay(); void copyToClipboard(reference.url, "URL") }}
        />
      </Show>
      <Show when={overlay() === "settings"}>
        <Settings
          onHintChange={setSettingsHint}
          config={config()}
          saving={props.configSaving}
          loadError={props.configError}
          onChange={(config) => props.onConfigChange?.(config) ?? Promise.resolve()}
          onClose={() => setOverlay()}
        />
      </Show>
      <Show when={overlay() === "branch-picker" && data().branches.value}>
        <BranchPicker
          branches={data().branches}
          current={data().currentBranch}
          canSwitch={props.canSwitchBranch}
          showScrollbar={config().showScrollbars}
          onLoadMore={props.onLoadMoreBranches ?? (() => Promise.resolve())}
          onRetry={() => props.onRetryResource?.({ kind: "branches" })}
          onClose={() => setOverlay()}
          onSelect={(branch) => {
            props.onBranchChange?.(branch)
            overviewScroll?.scrollTo(0)
            setOverlay()
          }}
        />
      </Show>
    </box>
    </IconProvider>
  )
}
