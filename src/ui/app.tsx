import type { ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { defaultConfig, type Config } from "../config"
import type { HintEntry } from "../keybindings"
import { KeybindingsBoundary, useKeyActions, useKeybindings } from "./keybindings"
import { cloneCommand, cloneDestination, matchesLocalRepository, type LocalRepository, type CommandSpec, type CommandTask } from "../command-actions"
import { CommandDialog, type CommandAction } from "./components/command-dialog"
import type { CommitDetail, DiffContent, DiffTarget, IssueActionKind, IssueActionParent, IssueActionResult, Paginated, ListState, PullMergeDraft, PullMergeMessage, PullMergeMethod, PullRequestDetail, ReactionKind, ReactionState, ReactionTarget } from "../models"
import { back, navigate, openDetail, openDiff, type InitialNavigation, type NavigationState, type Page } from "../navigation"
import type {
  CommitDetailState,
  RunDetailState,
  DiffState,
  IssueDetailState,
  IssueActionState,
  ReactionActionState,
  PullDetailState,
  RepositoryData,
  RepositoryOperations,
  RepositoryResource,
  ResourceState,
} from "../repository-state"
import { reactionKey } from "../reactions"
import { ReactionPicker, type ReactionMessage } from "./components/reaction-picker"
import type { ReactionControls } from "./components/reactions"
import { BranchPicker } from "./components/branch-picker"
import { Header } from "./components/header"
import { ContextMenu, type ContextMenuItem } from "./components/context-menu"
import { mouseContextMenu, type MousePosition } from "./mouse"
import { IssueReferencesPicker } from "./components/issue-references-picker"
import { IssueActionDialog, IssueActionsMenu } from "./components/issue-actions"
import { IssueAssigneesPicker } from "./components/issue-assignees-picker"
import { PullMergeDialog } from "./components/pull-merge-dialog"
import { pullMergeBlocker } from "../pull-merge"
import { Help } from "./components/help"
import { Settings } from "./components/settings"
import { StatusBar, type StatusKind } from "./components/status-bar"
import { copyText } from "./clipboard"
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
import { MotionProvider } from "./motion"
import { MarkdownProvider } from "./markdown-preferences"

type Overlay = "context-menu" | "reactions" | "help" | "branch-picker" | "settings" | "issue-references" | "issue-actions" | "issue-action" | "pull-merge" | "command" | "switch-repo"
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
  initialPage?: Page
  initialNavigation?: InitialNavigation
  onPageChange?: (page: Page) => void
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
  getReactionAction?: (target: ReactionTarget) => ReactionActionState
  onAddReaction?: (target: ReactionTarget, kind: ReactionKind) => Promise<ReactionState>
  issueDetail?: IssueDetailState
  onLoadIssue?: (number: number) => Promise<void>
  onLoadMoreIssueComments?: () => Promise<void>
  onRetryIssueReferences?: () => Promise<void>
  onCloseIssue?: () => void
  getIssueAction?: (number: number, parent?: IssueActionParent) => IssueActionState
  assignableUsers?: ResourceState<Paginated<string>>
  onLoadAssignableUsers?: () => Promise<void>
  onPrepareIssueAction?: (number: number, kind: IssueActionKind, parent?: IssueActionParent) => void
  onIssueDraftChange?: (number: number, draft: Partial<Pick<IssueActionState, "body" | "reason" | "duplicateTarget" | "selectedAssignees">>, parent?: IssueActionParent) => void
  onDiscardIssueDraft?: (number: number, parent?: IssueActionParent) => void
  onSubmitIssueAction?: (number: number, kind: IssueActionKind, parent?: IssueActionParent) => Promise<IssueActionResult>
  onMergePull?: (number: number, method: PullMergeMethod, expectedHeadSha: string, message?: PullMergeMessage) => Promise<PullRequestDetail>
  onLoadPullMergeMessage?: (number: number, expectedHeadSha: string) => Promise<PullMergeDraft>
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
  return <KeybindingsBoundary overrides={props.config?.keybindings}><AppContent {...props} /></KeybindingsBoundary>
}

function AppContent(props: AppProps) {
  const renderer = useRenderer()
  const { colors } = useTheme()
  const dimensions = useTerminalDimensions()
  // Startup intent and preferences are sampled once; later writes must not navigate.
  const initialNavigation = props.initialNavigation
  const initialDetail = initialNavigation?.detail
  const initialPage = initialNavigation?.page ?? props.initialPage ?? "overview"
  const requestedActions = initialNavigation?.page === "actions" || initialDetail?.kind === "run"
  let initialPagePending = !initialNavigation && initialPage === "actions"
  const initialState: NavigationState = { page: initialPagePending ? "overview" : initialPage }
  const [navigation, setNavigation] = createSignal<NavigationState>(initialDetail ? openDetail(initialState, initialDetail) : initialState)
  onMount(() => {
    if (initialNavigation) props.onPageChange?.(navigation().page)
    if (initialDetail?.kind === "commit") void props.onLoadCommit?.(initialDetail.sha)
    if (initialDetail?.kind === "issue") void props.onLoadIssue?.(initialDetail.number)
    if (initialDetail?.kind === "pull") void props.onLoadPull?.(initialDetail.number)
    if (initialDetail?.kind === "run") void props.onLoadRun?.(initialDetail.id)
  })
  const [issueState, setIssueState] = createSignal<ListState>("open")
  const [issueRefresh, setIssueRefresh] = createSignal<{ number: number }>()
  const [pullState, setPullState] = createSignal<ListState>("open")
  const [pullRefresh, setPullRefresh] = createSignal<{ number: number }>()
  const [overviewDocument, setOverviewDocument] = createSignal<string>()
  const [diffFocus, setDiffFocus] = createSignal<Partial<Record<Page, DiffFocus>>>({})
  const [overlay, setOverlay] = createSignal<Overlay>()
  const [toast, setToast] = createSignal<ToastState>()
  const [commandAction, setCommandAction] = createSignal<CommandAction>()
  const [issueAction, setIssueAction] = createSignal<{ number: number; kind: IssueActionKind; parent?: IssueActionParent }>()
  const [pendingIssueActions, setPendingIssueActions] = createSignal<Array<NonNullable<ReturnType<typeof issueAction>> & { repository: string }>>([])
  const [mergeTarget, setMergeTarget] = createSignal<{ repository: string; number: number; headSha: string }>()
  const [pendingMerges, setPendingMerges] = createSignal<Array<{ repository: string; number: number }>>([])
  const [issueActionHint, setIssueActionHint] = createSignal<string>()
  const [commandHint, setCommandHint] = createSignal<string>()
  const [settingsHint, setSettingsHint] = createSignal<string>()
  const [revealActivity, setRevealActivity] = createSignal<{ number: number; id: number; parent?: IssueActionParent }>()
  const emptyIssueAction: IssueActionState = { body: "", reason: "completed", operation: { status: "idle" } }
  let revealId = 0
  const canClone = () => Boolean(props.onRunCommand && props.cwd && !matchesLocalRepository(props.localRepository, data().repo.nameWithOwner))
  const openCommand = (action: CommandAction) => { setCommandAction(action); setOverlay("command") }
  let toastId = 0
  let disposed = false
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
  const openCommit = (sha: string) => {
    setNavigation((state) => openDetail(state, { kind: "commit", sha }))
    void props.onLoadCommit?.(sha)
  }
  const openIssue = (number: number) => {
    setNavigation((state) => openDetail(state, { kind: "issue", number }))
    void props.onLoadIssue?.(number)
  }
  const openPull = (number: number) => {
    setNavigation((state) => openDetail(state, { kind: "pull", number }))
    void props.onLoadPull?.(number)
  }
  const openRun = (id: number) => {
    setNavigation((state) => openDetail(state, { kind: "run", id }));
    void props.onLoadRun?.(id);
  };
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
  const actionDetail = () => activePullNumber() ? pullDetail().resource.value : issueDetail().resource.value
  const canAct = (kind: IssueActionKind) => activePullNumber() ? canActOnPull(kind) : canActOnIssue(kind)
  const hasIssueActions = () => canAct(actionDetail()?.state === "closed" ? "reopen" : "close") || canAct("duplicate") || canAct("assignees") || canOfferMerge()
  const openIssueAction = (kind: IssueActionKind) => {
    const number = activePullNumber() ?? activeIssueNumber()
    const parent = activePullNumber() ? "pull" : undefined
    if (!number || !canAct(kind)) return
    props.onPrepareIssueAction?.(number, kind, parent)
    setIssueAction({ number, kind, parent })
    setOverlay("issue-action")
  }
  const submitIssueAction = async () => {
    const action = issueAction()
    if (!action || !props.onSubmitIssueAction) return
    if (action.parent === "pull" ? action.number !== activePullNumber() || !canActOnPull(action.kind)
      : action.number !== activeIssueNumber() || !canActOnIssue(action.kind)) return
    const repository = data().repo.nameWithOwner
    const retry = props.getIssueAction?.(action.number, action.parent).retry
    const pendingAction = { ...action, repository }
    setPendingIssueActions((current) => [...current, pendingAction])
    setOverlay()
    setIssueAction()
    try {
      const result = await props.onSubmitIssueAction(action.number, action.kind, action.parent)
      if (disposed || renderer.isDestroyed || data().repo.nameWithOwner !== repository) return
      if ((result.comment || retry) && (action.parent === "pull" ? activePullNumber() : activeIssueNumber()) === action.number)
        setRevealActivity({ number: action.number, id: ++revealId, parent: action.parent })
      setToast({ id: ++toastId, title: action.kind === "comment" ? "Comment posted"
        : action.kind === "assignees" ? `${action.parent === "pull" ? "PR" : "Issue"} assignees updated`
        : action.kind === "duplicate" ? "Issue marked as duplicate" : `${action.parent === "pull" ? "PR" : "Issue"} ${action.kind === "close" ? "closed" : "reopened"}`,
        message: result.duplicateOf ? `#${action.number} → #${result.duplicateOf}` : `#${action.number}`, duration: 2000, tone: "success" })
    } catch (error) {
      if (!disposed && !renderer.isDestroyed && data().repo.nameWithOwner === repository) {
        const operation = props.getIssueAction?.(action.number, action.parent).operation
        setToast({ id: ++toastId, title: action.parent === "pull" ? "PR action failed" : "Issue action failed",
          message: operation?.status === "error" ? operation.message : error instanceof Error ? error.message : "Unknown error" })
      }
    } finally {
      setPendingIssueActions((current) => current.filter((pending) => pending !== pendingAction))
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
  const canActOnPull = (kind: IssueActionKind) => {
    const number = activePullNumber()
    const pull = pullDetail().resource.value
    if (kind === "duplicate" || ((kind === "close" || kind === "reopen") && pull?.merged)) return false
    return Boolean(number && props.onSubmitIssueAction && pull?.permissions?.[kind]
      && pullDetail().resource.status !== "loading"
      && props.getIssueAction?.(number, "pull").operation.status !== "loading")
  }
  const canOfferMerge = () => {
    const pull = pullDetail().resource.value
    return !!(activePullNumber() && props.onMergePull && pull?.permissions?.merge && pull.state === "open" && pull.draft === false && !pull.merged)
  }
  const checkingMerge = () => pullDetail().resource.status === "loading" || pullDetail().context.status === "loading"
  const mergeBlocker = () => {
    if (!canOfferMerge()) return "Merge permission unavailable or this PR is no longer eligible."
    if (checkingMerge()) return "Checking mergeability…"
    if (pullDetail().resource.status !== "ready" || pullDetail().context.status !== "ready")
      return "Merge readiness unavailable; refresh the PR or check GitHub."
    if (props.getIssueAction?.(activePullNumber()!, "pull").operation.status === "loading") return "Another PR action is in progress."
    return pullMergeBlocker(pullDetail().resource.value!, pullDetail().context.status === "ready" ? pullDetail().context.value : undefined)
  }
  const mergeDialogBlocker = () => {
    const target = mergeTarget()
    if (!target || target.repository !== data().repo.nameWithOwner || target.number !== activePullNumber()) return "The PR changed; reopen the merge dialog."
    if (target.headSha !== pullDetail().resource.value?.headSha) return "New commits detected; reopen the merge dialog to review them."
    return mergeBlocker()
  }
  const openMerge = () => {
    const pull = pullDetail().resource.value
    if (mergeBlocker() || !pull?.headSha) return
    setMergeTarget({ repository: data().repo.nameWithOwner, number: pull.number, headSha: pull.headSha })
    setOverlay("pull-merge")
  }
  const closeMerge = () => { setOverlay(); setMergeTarget() }
  const submitMerge = async (method: PullMergeMethod, headSha: string, message?: PullMergeMessage) => {
    const target = mergeTarget()
    if (!target || !props.onMergePull || mergeDialogBlocker() || headSha !== target.headSha) return
    setPendingMerges((current) => [...current, target])
    closeMerge()
    try {
      await props.onMergePull(target.number, method, headSha, message)
      if (disposed || renderer.isDestroyed || data().repo.nameWithOwner !== target.repository) return
      setToast({ id: ++toastId, title: "PR merged", message: `#${target.number}`, duration: 2000, tone: "success" })
    } catch (error) {
      if (!disposed && !renderer.isDestroyed && data().repo.nameWithOwner === target.repository)
        setToast({ id: ++toastId, title: "Merge failed", message: error instanceof Error ? error.message : "Check the PR on GitHub before retrying." })
    } finally {
      setPendingMerges((current) => current.filter((pending) => pending !== target))
    }
  }
  createEffect(() => { if (overlay() === "issue-actions" && !hasIssueActions()) setOverlay() })
  const canCommentOnPull = () => canActOnPull("comment")
  const canComment = () => canActOnIssue("comment") || canCommentOnPull()
  const openComment = () => {
    if (!activePullNumber()) return openIssueAction("comment")
    if (!canCommentOnPull()) return
    const number = activePullNumber()!
    props.onPrepareIssueAction?.(number, "comment", "pull")
    setIssueAction({ number, kind: "comment", parent: "pull" })
    setOverlay("issue-action")
  }
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
  const reactionMessages = createMemo<ReactionMessage[]>(() => {
    if (diffTarget() || !props.onAddReaction || !props.getReactionAction) return []
    const parent = activeIssueNumber() ? "issue" : "pull"
    const detail = activeIssueNumber() ? issueDetail() : activePullNumber() ? pullDetail() : undefined
    const body = detail?.resource.value
    if (!detail || !body) return []
    const number = detail.number
    const messages: ReactionMessage[] = [{ target: { kind: parent, number, nodeId: body.nodeId }, state: body }]
    for (const comment of detail.comments.value?.items ?? []) messages.push({
      target: { kind: "comment", parent, number, id: comment.id, nodeId: comment.nodeId }, state: comment,
    })
    if (parent === "pull") for (const thread of pullDetail().context.value?.threads ?? []) for (const comment of thread.comments) messages.push({
      target: { kind: "review-comment", number, id: comment.id, nodeId: comment.id }, state: comment,
    })
    return messages
  })
  const [reactionPicker, setReactionPicker] = createSignal<{ origin: NavigationState; repository: string; target: ReactionTarget }>()
  const sameReactionTarget = (left: ReactionTarget, right: ReactionTarget) => reactionKey(left) === reactionKey(right) && left.nodeId === right.nodeId
  const selectedReactionMessage = () => {
    const target = reactionPicker()?.target
    return target && reactionMessages().find((message) => sameReactionTarget(message.target, target))
  }
  const openReactions = (target: ReactionTarget) => {
    const message = reactionMessages().find((message) => sameReactionTarget(message.target, target))
    if (overlay() || !message || message.state.canReact === false || props.getReactionAction?.(target).operation.status === "loading") return
    setReactionPicker({ origin: navigation(), repository: data().repo.nameWithOwner, target })
    setOverlay("reactions")
  }
  const closeReactions = () => { setOverlay(); setReactionPicker() }
  createEffect(() => {
    const picker = reactionPicker()
    if (overlay() !== "reactions" || !picker) return
    if (navigation() !== picker.origin || data().repo.nameWithOwner !== picker.repository
      || !reactionMessages().length || picker.target && !selectedReactionMessage()) closeReactions()
  })
  const addReaction = (target: ReactionTarget, kind: ReactionKind, fromPicker = false) => {
    if (fromPicker ? overlay() !== "reactions" || !selectedReactionMessage()
      || !sameReactionTarget(selectedReactionMessage()!.target, target) : overlay() !== undefined) return
    const message = reactionMessages().find((message) => sameReactionTarget(message.target, target))
    if (!message || message.state.canReact === false || message.state.viewerReactions?.includes(kind)
      || props.getReactionAction?.(target).operation.status === "loading") return
    // Session owns confirmation/error publication. No async popup, toast or focus effects can outlive this view.
    void props.onAddReaction?.(target, kind).catch(() => {})
  }
  const reactionControls = (): ReactionControls | undefined => props.onAddReaction && props.getReactionAction ? {
    action: props.getReactionAction, add: (target, kind) => addReaction(target, kind), open: openReactions,
    context: openMessageContext,
  } : undefined
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
  const baseTabs = requestedActions ? tabs : tabs.filter((tab) => tab.page !== "actions")
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
      if (tab.page === "actions") return requestedActions || sectionAvailable(current.runs)
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
    if (pendingMerges().some((pending) => pending.repository === data().repo.nameWithOwner)) return "merging-pull"
    const pendingAction = pendingIssueActions().find((action) => action.repository === data().repo.nameWithOwner)
    if (pendingAction)
      return pendingAction.kind === "assignees" ? "updating-issue"
        : pendingAction.kind === "duplicate" ? "marking-duplicate" : pendingAction.kind === "comment" ? "posting-comment"
        : pendingAction.kind === "close" ? pendingAction.parent === "pull" ? "closing-pull" : "closing-issue"
          : pendingAction.parent === "pull" ? "reopening-pull" : "reopening-issue"
    if (overlay() === "issue-action") {
      const action = issueAction()
      if (action && props.getIssueAction?.(action.number, action.parent).operation.status === "loading")
        return action.kind === "assignees" ? "updating-issue"
          : action.kind === "duplicate" ? "marking-duplicate" : action.kind === "comment" ? "posting-comment"
          : action.kind === "close" ? action.parent === "pull" ? "closing-pull" : "closing-issue"
            : action.parent === "pull" ? "reopening-pull" : "reopening-issue"
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
    if (!initialPagePending || !navigationTabs().resolved) return
    initialPagePending = false
    if (visibleTabs().some((tab) => tab.page === initialPage))
      setNavigation((state) => navigate(state, initialPage))
  })

  createEffect(on(page, (current) => props.onPageChange?.(current), { defer: true }))

  createEffect(() => {
    if (visibleTabs().some((tab) => tab.page === page())) return
    setNavigation((state) => navigate(back(state), "overview"))
    if (overlay() === "issue-references" || overlay() === "issue-actions" || overlay() === "issue-action" || overlay() === "pull-merge") { setOverlay(); setIssueAction(); setMergeTarget() }
  })

  createEffect(() => {
    if (!overviewDocuments().some((document) => document.id === overviewDocument())) {
      setOverviewDocument(overviewDocuments()[0]?.id)
      overviewScroll?.scrollTo(0)
    }
  })

  onCleanup(() => { disposed = true; props.onCloseDiff?.(); props.onCloseRun?.(); props.onCloseCommit?.(); props.onCloseIssue?.(); props.onClosePull?.() })

  const closeDetail = () => {
    const detail = navigation().details?.[page()]
    setNavigation(back)
    if (detail?.kind === "run") props.onCloseRun?.()
    if (detail?.kind === "commit") props.onCloseCommit?.()
    if (detail?.kind === "issue") { props.onCloseIssue?.(); setRevealActivity() }
    if (detail?.kind === "pull") { props.onClosePull?.(); setRevealActivity() }
  }
  const selectPage = (next: Page) => {
    initialPagePending = false
    setNavigation((state) => navigate(state, next))
  }
  const canGoBack = () => Boolean(diffTarget() || navigation().details?.[page()]);
  const goBack = () => {
    if (diffTarget()) closeDiff();
    else if (navigation().details?.[page()]) closeDetail();
  };
  const selectHeaderPage = (next: Page) => {
    initialPagePending = false
    if (next !== page()) return selectPage(next);
    goBack();
  };
  const movePage = (delta: number) => {
    const available = visibleTabs()
    const current = Math.max(0, available.findIndex((tab) => tab.page === page()))
    selectPage(available[(current + delta + available.length) % available.length]!.page)
  }
  const selectOverviewDocument = (id: string) => {
    if (id === overviewDocument() || !overviewDocuments().some((document) => document.id === id)) return
    setOverviewDocument(id)
    overviewScroll?.scrollTo(0)
  }
  const moveOverviewDocument = (delta: number) => {
    const available = overviewDocuments()
    if (!available.length) return
    const current = Math.max(0, available.findIndex((document) => document.id === overviewDocument()))
    selectOverviewDocument(available[(current + delta + available.length) % available.length]!.id)
  }
  const openRepositoryPicker = () => {
    if (overlay() !== undefined || !props.onSwitchRepository) return
    setOverlay("switch-repo")
    void props.onRefreshRecentRepositories?.().catch(() => {})
  }
  const openBranchPicker = () => {
    if (overlay() !== undefined || page() !== "commits" || activeCommitSha() || diffTarget() || props.canSwitchBranch === false) return
    const branches = data().branches
    if (branches.status === "error" && branches.phase === "load") props.onRetryResource?.({ kind: "branches" })
    if (branches.value) setOverlay("branch-picker")
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
  const copyToClipboard = async (value: string, label: "SHA" | "URL" | "Text") => {
    if (copying) return
    copying = true
    const origin = navigation()
    try {
      const notice = await copyText(renderer, props.onCopyToClipboard, value, label)
      if (notice && navigation() === origin) setToast({ id: ++toastId, ...notice })
    } finally {
      copying = false
    }
  }
  const keys = useKeybindings()
  const clearRunFailures = (id = activeRunId()) => {
    if (id) for (const key of [`resource:run:${id}:resource`, `resource:run:${id}:jobs`, `pagination:run:${id}`]) shownFailures.delete(key)
  }
  const refreshCallback = createMemo<(() => void | Promise<void>) | undefined>(() => {
    const diff = diffTarget()
    if (diff) return diffResource().status !== "loading" && props.onLoadDiff ? () => props.onLoadDiff!(diff) : undefined
    const run = activeRunId()
    if (run) {
      const jobs = runDetail().jobs
      return runDetail().resource.status === "ready" && jobs.status === "error" && jobs.phase === "pagination"
        ? props.onLoadMoreRunJobs : props.onLoadRun ? () => props.onLoadRun!(run) : undefined
    }
    const sha = activeCommitSha()
    if (sha) {
      const resource = commitResource()
      return resource.status === "loading" ? undefined
        : resource.status === "error" && resource.phase === "pagination" ? props.onLoadMoreCommitFiles
        : props.onLoadCommit ? () => props.onLoadCommit!(sha) : undefined
    }
    const issue = activeIssueNumber()
    if (issue) return props.onLoadIssue || props.onLoadMoreIssueComments || props.onRetryIssueReferences ? () => refreshIssue(issue) : undefined
    const pull = activePullNumber()
    if (pull) return props.onLoadPull || props.onRetryPullCommits || props.onRetryPullContext || props.onLoadMorePullComments || props.onRetryPullReferences
      ? () => refreshPull(pull) : undefined
    const target = retryTarget()
    if (activeResource()?.status === "error" && target) return props.onRetryResource ? () => props.onRetryResource!(target) : undefined
    return props.onRefresh
  })
  const refreshCurrent = () => { clearRunFailures(); void refreshCallback()?.() }
  const loadMoreCurrent = () => {
    clearRunFailures()
    if (activeRunId()) void props.onLoadMoreRunJobs?.()
    else if (activeCommitSha()) void props.onLoadMoreCommitFiles?.()
    else if (activeIssueNumber()) void props.onLoadMoreIssueComments?.()
    else if (activePullNumber()) void props.onLoadMorePullComments?.()
  }
  const cloneRepository = () => {
    if (!canClone()) return
    const repository = data().repo.nameWithOwner
    openCommand({ title: `Clone ${repository}`, destination: cloneDestination(repository.split("/")[1]!, props.cwd!), command: (destination) => cloneCommand(repository, destination, props.cwd!) })
  }
  const [contextMenu, setContextMenu] = createSignal<{
    origin: NavigationState; repository: string; position: MousePosition; items: ContextMenuItem[]; valid: () => boolean
  }>()
  const closeContextMenu = () => { setOverlay(); setContextMenu() }
  const ownsContextMenu = (menu: NonNullable<ReturnType<typeof contextMenu>>) => navigation() === menu.origin
    && data().repo.nameWithOwner === menu.repository && menu.valid()
  const openContextMenu = (position: MousePosition, items: ContextMenuItem[], valid: () => boolean) => {
    if (overlay() || !valid()) return
    setContextMenu({ origin: navigation(), repository: data().repo.nameWithOwner, position, items, valid })
    setOverlay("context-menu")
  }
  createEffect(() => {
    const menu = contextMenu()
    if (overlay() === "context-menu" && menu && !ownsContextMenu(menu)) closeContextMenu()
  })
  const backContextItems = (): ContextMenuItem[] =>
    canGoBack() ? [{ label: "Back", run: goBack }] : [];
  const commentContextItems = (): ContextMenuItem[] =>
    canComment() ? [{
      label: "Add comment",
      run: openComment,
      get disabled() { return !canComment(); },
    }] : [];
  const issueActionsContextItems = (): ContextMenuItem[] =>
    (activeIssueNumber() || activePullNumber()) && !diffTarget() && hasIssueActions() ? [{
      label: "Actions…",
      run: () => { if (hasIssueActions()) setOverlay("issue-actions"); },
      get disabled() { return !hasIssueActions(); },
    }] : [];
  const openMessageContext = (target: ReactionTarget, body: string, position: MousePosition) => {
    const message = () => reactionMessages().find((message) => sameReactionTarget(message.target, target))
    const current = message()
    if (!current) return
    openContextMenu(position, [
      { label: "React", run: () => openReactions(target), get disabled() { return message()?.state.canReact === false || props.getReactionAction?.(target).operation.status === "loading" } },
      { label: "Copy text", run: () => void copyToClipboard(body, "Text"), disabled: !body },
      ...commentContextItems(),
      ...issueActionsContextItems(),
      ...backContextItems(),
    ], () => !!message())
  }
  const openRowContext = (kind: "commit" | "issue" | "pull" | "run", id: string | number, position: MousePosition) => {
    const valid = () => {
      if (kind === "commit") return page() === "commits" && !activeCommitSha() && !!data().commits.value?.items.some((commit) => commit.sha === id);
      if (kind === "issue") return page() === "issues" && !activeIssueNumber() && !!issues().value?.items.some((issue) => issue.number === id);
      if (kind === "pull") return page() === "pulls" && !activePullNumber() && !!pulls().value?.items.some((pull) => pull.number === id);
      return page() === "actions" && !activeRunId() && !!data().runs.value?.items.some((run) => run.id === id);
    };
    const open = () => {
      if (kind === "commit") openCommit(String(id));
      else if (kind === "issue") openIssue(Number(id));
      else if (kind === "pull") openPull(Number(id));
      else openRun(Number(id));
    };
    const items: ContextMenuItem[] = [{ label: "Open", run: open }];
    if (kind === "commit" || kind === "pull") items.push({
      label: "View diff", disabled: !props.onLoadDiff,
      run: () => viewDiff(kind === "commit" ? { kind, sha: String(id) } : { kind, number: Number(id) }),
    });
    const copy = kind === "commit" ? String(id) : kind === "issue" ? issueUrl(Number(id)) : kind === "pull" ? pullUrl(Number(id)) : runUrl(Number(id));
    items.push(
      { label: "Copy " + (kind === "commit" ? "SHA" : "URL"), run: () => void copyToClipboard(copy, kind === "commit" ? "SHA" : "URL") },
      { label: "Open on GitHub", run: () => void openInBrowser(kind === "run" ? `actions/runs/${id}` : id), disabled: !props.onOpenInBrowser },
    );
    openContextMenu(position, items, valid);
  };
  const openPageContext = (position: MousePosition) => {
    if (diffTarget()) {
      openContextMenu(position, backContextItems(), canGoBack);
      return;
    }
    const sha = activeCommitSha();
    const issue = activeIssueNumber();
    const pull = activePullNumber();
    const run = activeRunId();
    const items: ContextMenuItem[] = [];
    if (sha) {
      items.push(
        { label: "View diff", run: () => viewDiff({ kind: "commit", sha }), disabled: !props.onLoadDiff },
        { label: "Open on GitHub", run: () => void openInBrowser(sha), disabled: !props.onOpenInBrowser },
        { label: "Copy SHA", run: () => void copyToClipboard(sha, "SHA") },
      );
    } else if (issue || pull) {
      const number = (issue ?? pull)!;
      if (pull) items.push({ label: "View diff", run: () => viewDiff({ kind: "pull", number }), disabled: !props.onLoadDiff });
      items.push(
        { label: "Open on GitHub", run: () => void openInBrowser(number), disabled: !props.onOpenInBrowser },
        { label: "Copy URL", run: () => void copyToClipboard(issue ? issueUrl(number) : pullUrl(number), "URL") },
      );
    } else if (run) {
      items.push(
        { label: "Open on GitHub", run: () => void openInBrowser(`actions/runs/${run}`), disabled: !props.onOpenInBrowser },
        { label: "Copy URL", run: () => void copyToClipboard(runUrl(run), "URL") },
      );
    } else if (page() === "overview") {
      items.push(
        { label: "Open on GitHub", run: () => void openInBrowser(), disabled: !props.onOpenInBrowser },
        { label: "Copy repository URL", run: () => void copyToClipboard(data().repo.url, "URL") },
      );
      if (canClone()) items.push({
        label: "Clone repository", run: cloneRepository,
        get disabled() { return !canClone(); },
      });
    }
    items.push(...commentContextItems(), ...issueActionsContextItems(), ...backContextItems());
    if (items.length) openContextMenu(position, items, () => true);
  };
  const pageMouse = mouseContextMenu(openPageContext, () => overlay() === undefined, navigation)
  createEffect(() => { navigation(); overlay(); pageMouse.onMouseDrag() })
  const shortcutHint = () => {
    if (!config().showStatusBarHints) return undefined
    const hint = (...entries: HintEntry[]) => keys.hints(...entries)
    const select: HintEntry = [["navigation.up", "navigation.down"], "select"]
    const open: HintEntry = ["navigation.activate", "open"]
    const back: HintEntry = ["navigation.back", "back"]
    const github: HintEntry = ["item.open", "GitHub"]
    const copy: HintEntry = ["item.copy", activeCommitSha() || page() === "commits" ? "copy SHA" : "copy URL"]
    const diff: HintEntry = ["item.diff", "diff"]
    const help: HintEntry = ["global.help", "help"]
    const close: HintEntry = ["dialog.close", "close"]
    const picker: HintEntry[] = [[["picker.up", "picker.down"], "select"], ["picker.accept", "open"], close]
    if (overlay() === "context-menu") return undefined
    if (overlay() === "reactions") return hint(select, ["navigation.activate", "add"], close)
    if (overlay() === "issue-action" || overlay() === "pull-merge") return issueActionHint()
    if (overlay() === "issue-actions") return hint(select, open, close)
    if (overlay() === "help") return hint(close)
    if (overlay() === "settings") return settingsHint()
    if (overlay() === "command") return commandHint()
    if (overlay() === "branch-picker" || overlay() === "switch-repo") return hint(...picker)
    if (overlay() === "issue-references") return hint(select, open, ["references.switchTab", "switch tabs"], copy, close)
    const common: HintEntry[] = [...(props.onSwitchRepository ? [["global.switchRepository", "switch repo"] as const] : []), help]
    const resource = activeResource()
    if (resource?.status === "loading" && resource.value === undefined) {
      const detail = diffTarget() || activeRunId() || activeCommitSha() || activeIssueNumber() || activePullNumber()
      const tabs: HintEntry = [["navigation.previousTab", "navigation.nextTab"], "tabs"]
      return hint(...(detail ? [back] : []), ...(!diffTarget() ? [tabs] : []), ...common)
    }
    if (diffTarget()) {
      const files = diffFocus()[page()] === "files"
      const horizontal: HintEntry = [files ? ["navigation.previousTab", "navigation.nextTab"] : ["diff.panLeft", "diff.panRight"], files ? "tabs" : "pan"]
      const focus: HintEntry = ["diff.focus", `focus ${files ? "diff" : "files"}`]
      if (dimensions().width < 80) return hint(back, horizontal, focus, help)
      return hint(back, horizontal, [["navigation.up", "navigation.down"], files ? "files" : "scroll"], focus,
        ["diff.toggleFiles", "toggle files"], [["diff.previousHunk", "diff.nextHunk"], "hunks"],
        ...(diffResource().status === "error" ? [["navigation.activate", "file list"] as const]
          : [["diff.toggleLayout", "layout"], ["diff.toggleWrap", "wrap"]] as const), help)
    }
    if (activeRunId()) {
      const load: HintEntry = resource?.status === "error" ? ["view.refresh", "retry"]
        : runDetail().jobs.value?.hasMore ? ["navigation.activate", "load more"] : ["view.refresh", "refresh"]
      return hint(back, github, copy, ...(resource?.status === "loading" ? [] : [load]), ...common)
    }
    if (activeCommitSha()) {
      const retry = commitResource().status === "error"
      const more = commitResource().status !== "loading" && commitResource().value?.files.hasMore
      const load: HintEntry[] = retry ? [["view.refresh", "retry"]] : more ? [["navigation.activate", "load more"]] : []
      return hint(back, diff, ...(dimensions().width < 60 && (retry || more) ? [] : [github, copy]), ...load, ...common)
    }
    if (activeIssueNumber()) {
      const retry = activeResource()?.status === "error"
      const more = issueDetail().comments.status !== "loading" && issueDetail().comments.value?.hasMore
      const references = issueMenuItems().length
      const actions: HintEntry[] = [...(canActOnIssue("comment") ? [["issue.comment", "comment"] as const] : []),
        ...(hasIssueActions() ? [["issue.actions", "actions"] as const] : [])]
      const hintWidth = dimensions().width - hint(...actions).length
      if (dimensions().width < 64) return hint(back, ...actions,
        ...(!actions.length ? [retry ? ["view.refresh", "retry"] : more ? ["navigation.activate", "load more"]
          : references ? ["detail.references", "references"] : github] as HintEntry[] : []), ...common)
      return hint(back, ...actions, ...(retry ? [["view.refresh", "retry"] as const] : more ? [["navigation.activate", "load more"] as const] : []),
        ...(references && hintWidth >= 64 ? [["detail.references", "references"] as const] : []),
        ...(hintWidth >= 100 || !retry && !more && hintWidth >= 64 ? [github, copy] : []), ...common)
    }
    if (activePullNumber()) {
      const retry = activeResource()?.status === "error"
      const more = pullDetail().comments.status !== "loading" && pullDetail().comments.value?.hasMore
      const references = pullMenuItems().length
      const commentHints: HintEntry[] = [...(canCommentOnPull() ? [["issue.comment", "comment"] as const] : []),
        ...(hasIssueActions() ? [["issue.actions", "actions"] as const] : [])]
      if (dimensions().width < 64) return hint(back, diff, ...commentHints,
        retry ? ["view.refresh", "retry"] : more ? ["navigation.activate", "load more"]
          : references ? ["detail.references", "references"] : github, ...common)
      return hint(back, diff, ...commentHints, ...(retry ? [["view.refresh", "retry"] as const] : more ? [["navigation.activate", "load more"] as const] : []),
        ...(references ? [["detail.references", "references"] as const] : []),
        ...(dimensions().width >= 100 || !retry && !more ? [github, copy] : []), ...common)
    }
    if (page() === "actions") return hint(select, open, github, copy, ...common)
    if (page() === "pulls" || page() === "issues") return hint(select, open, ...(page() === "pulls" ? [diff] : []), github, copy,
      ...(dimensions().width >= 60 ? [["work.toggleState", "open/closed"] as const] : []), ...common)
    if (page() === "commits") return hint(select, open, diff, github, copy,
      ...(dimensions().width >= 60 ? [["commits.chooseBranch", "branch"] as const] : []), ...common)
    if (page() === "overview") return hint(github, copy, ...(canClone() ? [["command.clone", "clone"] as const] : []), ...common)
    return hint(...common)
  }

  useKeyActions({
    "dialog.close": () => setOverlay(),
    "global.help": () => setOverlay(),
    "global.quit": quit,
  }, { when: () => overlay() === "help", priority: 100, modal: true })
  // References use an ordinary list (priority 0). Block ambient keys below it,
  // including Root's quit fallback, without intercepting selection or copy/open.
  useKeyActions({ "dialog.close": () => setOverlay() }, {
    when: () => overlay() === "issue-references", priority: -1, modal: true,
  })

  const selectTab = (index: number) => {
    const tab = visibleTabs()[index]
    if (!tab) return false
    selectPage(tab.page)
  }
  // Page/list handlers run before this ambient layer. Every matched key is consumed once.
  useKeyActions({
    "global.quit": quit,
    "global.help": () => setOverlay("help"),
    "global.settings": () => setOverlay("settings"),
    "global.switchRepository": () => {
      if (!props.onSwitchRepository) return false
      setOverlay("switch-repo")
      void props.onRefreshRecentRepositories?.().catch(() => {})
    },
    "navigation.back": () => {
      if (diffTarget()) closeDiff()
      else if (navigation().details?.[page()]) closeDetail()
      else return false
    },
    "navigation.tab1": () => selectTab(0),
    "navigation.tab2": () => selectTab(1),
    "navigation.tab3": () => selectTab(2),
    "navigation.tab4": () => selectTab(3),
    "navigation.tab5": () => selectTab(4),
    "navigation.previousTab": () => { if (diffTarget()) return false; movePage(-1) },
    "navigation.nextTab": () => { if (diffTarget()) return false; movePage(1) },
    "item.open": () => {
      const diff = diffTarget()
      if (diff) void openInBrowser(diff.kind === "pull" ? diff.number : diff.sha, undefined, "diff")
      else if (activeRunId()) void openInBrowser(`actions/runs/${activeRunId()}`)
      else if (activeCommitSha()) void openInBrowser(activeCommitSha())
      else if (activeIssueNumber() || activePullNumber()) void openInBrowser(activeIssueNumber() ?? activePullNumber())
      else if (page() === "overview") void openInBrowser()
      else return false
    },
    "item.copy": () => {
      if (diffTarget()) return false
      if (activeRunId()) void copyToClipboard(runUrl(activeRunId()!), "URL")
      else if (activeCommitSha()) void copyToClipboard(commitResource().value?.sha ?? activeCommitSha()!, "SHA")
      else if (activeIssueNumber()) void copyToClipboard(issueUrl(activeIssueNumber()!), "URL")
      else if (activePullNumber()) void copyToClipboard(pullUrl(activePullNumber()!), "URL")
      else if (page() === "overview") void copyToClipboard(data().repo.url, "URL")
      else return false
    },
    "item.diff": () => {
      if (diffTarget()) return false
      if (activeCommitSha()) viewDiff({ kind: "commit", sha: activeCommitSha()! })
      else if (activePullNumber()) viewDiff({ kind: "pull", number: activePullNumber()! })
      else return false
    },
    "navigation.activate": () => {
      const diff = diffTarget()
      if (diff) {
        if (diffResource().status !== "error") return false
        void props.onLoadDiff?.(diff, true)
      } else if (activeRunId()) { clearRunFailures(activeRunId()!); void props.onLoadMoreRunJobs?.() }
      else if (activeCommitSha()) void props.onLoadMoreCommitFiles?.()
      else if (activeIssueNumber()) void props.onLoadMoreIssueComments?.()
      else if (activePullNumber()) void props.onLoadMorePullComments?.()
      else return false
    },
    "view.refresh": () => {
      const diff = diffTarget()
      if (diff) { if (diffResource().status !== "loading") void props.onLoadDiff?.(diff); return }
      const run = activeRunId()
      if (run) {
        clearRunFailures(run)
        const jobs = runDetail().jobs
        if (runDetail().resource.status === "ready" && jobs.status === "error" && jobs.phase === "pagination") void props.onLoadMoreRunJobs?.()
        else void props.onLoadRun?.(run)
      } else if (activeCommitSha()) {
        const resource = commitResource()
        if (resource.status === "loading") return
        if (resource.status === "error" && resource.phase === "pagination") void props.onLoadMoreCommitFiles?.()
        else void props.onLoadCommit?.(activeCommitSha()!)
      } else if (activeIssueNumber()) void refreshIssue(activeIssueNumber()!)
      else if (activePullNumber()) void refreshPull(activePullNumber()!)
      else {
        const resource = activeResource()
        const target = retryTarget()
        if (resource?.status === "error" && target) props.onRetryResource?.(target)
        else props.onRefresh?.()
      }
    },
    "issue.comment": () => { if (diffTarget() || !canComment()) return false; openComment() },
    "issue.actions": () => { if (!(activeIssueNumber() || activePullNumber()) || diffTarget() || !hasIssueActions()) return false; setOverlay("issue-actions") },
    "detail.references": () => { if (diffTarget() || !(activeIssueNumber() || activePullNumber()) || !activeMenuItems().length) return false; setOverlay("issue-references") },
    "command.clone": () => {
      if (page() !== "overview" || !canClone()) return false
      const repository = data().repo.nameWithOwner
      openCommand({ title: `Clone ${repository}`, destination: cloneDestination(repository.split("/")[1]!, props.cwd!), command: (destination) => cloneCommand(repository, destination, props.cwd!) })
    },
    "commits.chooseBranch": () => {
      if (page() !== "commits" || activeCommitSha() || diffTarget()) return false
      const branches = data().branches
      if (branches.status === "error" && branches.phase === "load") props.onRetryResource?.({ kind: "branches" })
      if (branches.value) setOverlay("branch-picker")
    },
    "work.toggleState": () => {
      if (diffTarget() || activeIssueNumber() || activePullNumber()) return false
      if (page() === "issues") setIssueState((value) => value === "open" ? "closed" : "open")
      else if (page() === "pulls") setPullState((value) => value === "open" ? "closed" : "open")
      else return false
    },
    "overview.nextDocument": () => { if (page() !== "overview") return false; moveOverviewDocument(1) },
    "overview.previousDocument": () => { if (page() !== "overview") return false; moveOverviewDocument(-1) },
  }, { when: () => overlay() === undefined, priority: -10 })

  useKeyActions({
    "navigation.up": () => overviewScroll?.scrollBy(-1),
    "navigation.down": () => overviewScroll?.scrollBy(1),
    "navigation.halfPageUp": () => overviewScroll?.scrollBy(-Math.max(1, Math.floor((overviewScroll.viewport.height ?? 1) / 2))),
    "navigation.halfPageDown": () => overviewScroll?.scrollBy(Math.max(1, Math.floor((overviewScroll.viewport.height ?? 1) / 2))),
    "navigation.pageUp": () => overviewScroll?.scrollBy(-(overviewScroll.viewport.height ?? 1)),
    "navigation.pageDown": () => overviewScroll?.scrollBy(overviewScroll.viewport.height ?? 1),
    "navigation.first": () => overviewScroll?.scrollTo(0),
    "navigation.last": () => overviewScroll?.scrollTo(Math.max(0, overviewScroll.scrollHeight - overviewScroll.viewport.height)),
  }, { when: () => page() === "overview" && overlay() === undefined })

  return (
    <IconProvider style={config().iconStyle}>
    <MotionProvider reduced={config().reducedMotion}>
    <MarkdownProvider style={config().markdownStyle}>
    <box width={dimensions().width} height={dimensions().height} flexDirection="column" backgroundColor={colors.canvas}>
      <Header repo={data().repo} page={page()} tabs={visibleTabs()} workCounts={data().workCounts} compact={config().compactHeader} showTabCounts={config().showTabCounts}
        interactive={overlay() === undefined} onSelect={selectHeaderPage}
        onOpenRepository={props.onSwitchRepository ? openRepositoryPicker : undefined} />
      <box {...pageMouse} flexGrow={1} minHeight={0} flexDirection="column">
      <box visible={!diffTarget()} flexGrow={1} minHeight={0} flexDirection="column">
      <box visible={page() === "overview"} flexGrow={1} minHeight={0}>
          <OverviewScreen
            repo={data().repo}
            documents={data().documents}
            currentDocument={overviewDocument()}
            interactive={page() === "overview" && !diffTarget() && overlay() === undefined}
            onSelectDocument={selectOverviewDocument}
            onMoveDocument={moveOverviewDocument}
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
            canOpenBranches={props.canSwitchBranch !== false && (data().branches.value !== undefined || data().branches.status === "error")}
            onOpenBranches={openBranchPicker}
            active={page() === "commits" && !commitSha()}
            interactive={!diffTarget() && overlay() === undefined}
            showScrollbar={config().showScrollbars}
            onContextMenu={(commit, position) => openRowContext("commit", commit.sha, position)}
            onOpenCommit={(commit) => openCommit(commit.sha)}
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
            onStateChange={setIssueState}
            counts={issueCounts()}
            resource={issues()}
            active={page() === "issues" && !issueNumber()}
            interactive={!diffTarget() && overlay() === undefined}
            showScrollbar={config().showScrollbars}
            onContextMenu={(issue, position) => openRowContext("issue", issue.number, position)}
            onOpen={(issue) => openIssue(issue.number)}
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
            onStateChange={setPullState}
            counts={pullCounts()}
            resource={pulls()}
            active={page() === "pulls" && !pullNumber()}
            interactive={!diffTarget() && overlay() === undefined}
            showScrollbar={config().showScrollbars}
            onContextMenu={(pull, position) => openRowContext("pull", pull.number, position)}
            onOpen={(pull) => openPull(pull.number)}
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
              onOpenRun={(run) => openRun(run.id)}
              onContextMenu={(run, position) => openRowContext("run", run.id, position)}
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
              reactionControls={reactionControls()}
              revealActivity={revealActivity()?.parent !== "pull" && revealActivity()?.number === number ? revealActivity()?.id : undefined}
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
              revealActivity={revealActivity()?.parent === "pull" && revealActivity()?.number === number ? revealActivity()?.id : undefined}
              reactionControls={reactionControls()}
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
              onContextMenu={(position, items) =>
                openContextMenu(
                  position,
                  [...items, ...backContextItems()],
                  () => page() === owner && navigation().diffs?.[owner] === target,
                )
              }
              onFocusChange={(focus) => setDiffFocus((current) => ({ ...current, [owner]: focus }))}
              showScrollbar={config().showScrollbars} onLoadFiles={() => void props.onLoadDiff?.(target, true)} />
          </box>}
        </Show>}
      </For>
      </box>
      <StatusBar kind={status()} detail={statusDetail()} hint={shortcutHint()}
        zIndex={overlay() && (config().showStatusBarHints || status()) ? 350 : 0} />
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
      <Show when={overlay() === "context-menu" ? contextMenu() : undefined} keyed>
        {(menu) => <ContextMenu position={menu.position} items={menu.items} onClose={closeContextMenu}
          onSelect={(item) => { if (ownsContextMenu(menu)) { closeContextMenu(); item.run() } }} />}
      </Show>
      <Show when={overlay() === "reactions" ? selectedReactionMessage() : undefined}>
        {(message) => <ReactionPicker message={message()}
          action={props.getReactionAction!} onClose={closeReactions} showScrollbar={config().showScrollbars}
          onAdd={(target, kind) => addReaction(target, kind, true)} />}
      </Show>
      <Show when={overlay() === "switch-repo"}>
        <SwitchRepositoryScreen
          current={data().repo.nameWithOwner}
          renderStatusBar={false}
          recent={props.recentRepositories ?? []}
          showStatusBarHints={config().showStatusBarHints}
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
          onRun={props.onRunCommand!}
          onCaptureCancel={props.onCommandCaptureCancel}
          onCopy={props.onCopyToClipboard}
          onClose={() => { setOverlay(); setCommandAction() }}
        />}
      </Show>
      <Show when={overlay() === "help"}>
        <Help
          onClose={() => setOverlay()}
          view={diffTarget() ? "diff" : activeRunId() ? "run" : activeCommitSha() ? "commit" : activeIssueNumber() ? "issue" : activePullNumber() ? "pull" : page()}
          tabCount={visibleTabs().length}
          hasDocumentTabs={overviewDocuments().length > 1}
          hasMoreFiles={commitResource().value?.files.hasMore}
          hasMoreComments={activePullNumber() ? pullDetail().comments.value?.hasMore : issueDetail().comments.value?.hasMore}
          hasReferences={activeMenuItems().length > 0}
          canComment={canComment()}
          hasIssueActions={hasIssueActions()}
          command={page() === "overview" && canClone() ? "clone repository" : undefined}
        />
      </Show>
      <Show when={overlay() === "issue-actions" && (activeIssueNumber() || activePullNumber()) && hasIssueActions()}>
        <IssueActionsMenu
          number={(activePullNumber() ?? activeIssueNumber())!}
          parent={activePullNumber() ? "pull" : "issue"}
          state={actionDetail()?.state ?? "open"}
          permissions={{ close: canAct("close"), reopen: canAct("reopen"), duplicate: canAct("duplicate"), assignees: canAct("assignees") }}
          merge={canOfferMerge() ? { reason: mergeBlocker(), checking: checkingMerge() } : undefined}
          onMerge={openMerge}
          onOpenGitHub={props.onOpenInBrowser ? () => { setOverlay(); void openInBrowser(activePullNumber()) } : undefined}
          onSelect={openIssueAction}
          onClose={() => setOverlay()}
        />
      </Show>
      <Show when={overlay() === "pull-merge" ? mergeTarget() : undefined} keyed>
        {(target) => <PullMergeDialog number={target.number} headSha={target.headSha}
          methods={pullDetail().resource.value?.merge?.methods ?? []}
          reason={mergeDialogBlocker()} checking={checkingMerge()}
          onLoadMessage={async () => {
            if (!props.onLoadPullMergeMessage) throw new Error("Loading GitHub's commit message is unavailable.")
            return props.onLoadPullMergeMessage(target.number, target.headSha)
          }}
          onSubmit={(method, headSha, message) => void submitMerge(method, headSha, message)}
          onHintChange={setIssueActionHint} onClose={closeMerge} />}
      </Show>
      <Show when={overlay() === "issue-action" ? issueAction() : undefined} keyed>
        {(action) => <Show when={action.kind === "assignees"}
          fallback={<IssueActionDialog
            number={action.number}
            kind={action.kind}
            parent={action.parent}
            state={props.getIssueAction?.(action.number, action.parent) ?? emptyIssueAction}
            showScrollbar={config().showScrollbars}
            locked={action.parent === "pull" ? pullDetail().resource.value?.locked : issueDetail().resource.value?.locked}
            repositoryUrl={data().repo.url}
            defaultBranch={data().repo.defaultBranch}
            onBodyChange={(body) => props.onIssueDraftChange?.(action.number, { body }, action.parent)}
            onReasonChange={(reason) => props.onIssueDraftChange?.(action.number, { reason }, action.parent)}
            onDuplicateTargetChange={(duplicateTarget) => props.onIssueDraftChange?.(action.number, { duplicateTarget }, action.parent)}
            onSubmit={() => void submitIssueAction()}
            onDiscard={() => props.onDiscardIssueDraft?.(action.number, action.parent)}
            onHintChange={setIssueActionHint}
            onClose={() => { setOverlay(); setIssueAction() }}
          />}>
          <IssueAssigneesPicker
            number={action.number}
            state={props.getIssueAction?.(action.number, action.parent) ?? emptyIssueAction}
            users={props.assignableUsers}
            showScrollbar={config().showScrollbars}
            onLoadMore={() => void props.onLoadAssignableUsers?.()}
            onChange={(selectedAssignees) => props.onIssueDraftChange?.(action.number, { selectedAssignees }, action.parent)}
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
          onClose={() => setOverlay()}
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
            if (props.canSwitchBranch === false) return
            setOverlay()
            if (branch === data().currentBranch) return
            props.onBranchChange?.(branch)
            overviewScroll?.scrollTo(0)
          }}
        />
      </Show>
    </box>
    </MarkdownProvider>
    </MotionProvider>
    </IconProvider>
  )
}
