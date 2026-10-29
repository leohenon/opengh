import type { ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { defaultConfig, type Config } from "../config"
import type { HintEntry } from "../keybindings"
import { KeybindingsBoundary, useKeyActions, useKeybindings } from "./keybindings"
import { cloneCommand, cloneDestination, matchesLocalRepository, type LocalRepository, type CommandSpec, type CommandTask } from "../command-actions"
import { CommandDialog, type CommandAction } from "./components/command-dialog"
import type { IssueReference, CommitDetail, DiffContent, DiffTarget, IssueActionKind, IssueActionParent, IssueActionResult, Paginated, ListState, PullMergeDraft, PullMergeMessage, PullMergeMethod, PullRequestDetail, PullReviewThread, ReactionKind, ReactionState, ReactionTarget } from "../models"
import { back, navigate, openDetail, openDiff, type DetailTarget, type InitialNavigation, type NavigationState, type Page } from "../navigation"
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
import type { InlineCommentInput, PostedInlineComment, PullReviewSession, ReviewAnchor } from "../review-types"
import { InlineCommentUncertainError } from "../inline-comments"
import { InlineCommentRetryDialog } from "./components/inline-comment-retry"
import { PullReviewDialog, ReviewCommentDialog } from "./components/pull-review-dialog"
import { IssueActionDialog, IssueActionsMenu } from "./components/issue-actions"
import { IssueAssigneesPicker } from "./components/issue-assignees-picker"
import { PullMergeDialog } from "./components/pull-merge-dialog"
import { PullDraftDialog } from "./components/pull-draft-dialog"
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

type Overlay = "context-menu" | "reactions" | "help" | "branch-picker" | "settings" | "issue-references" | "issue-actions" | "issue-action" | "pull-merge" | "pull-draft" | "pull-review" | "review-comment" | "inline-retry" | "command" | "switch-repo"
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
  onOpenReference?: (repository: string, detail: DetailTarget) => void
  onRetryResource?: (resource: RepositoryResource) => void
  canSwitchBranch?: boolean
  onBranchChange?: (branch: string) => void
  onLoadMoreBranches?: () => Promise<void>
  onLoadMoreCommits?: () => Promise<void>
  diffs?: Partial<Record<DiffTarget["kind"], DiffState>>
  onLoadDiff?: (target: DiffTarget, filesOnly?: boolean, options?: { force?: boolean }) => Promise<void>
  onCloseDiff?: (target?: DiffTarget) => void
  runDetail?: RunDetailState
  onLoadRun?: (id: number, options?: { force?: boolean }) => Promise<void>
  onLoadMoreRunJobs?: () => Promise<void>
  onCloseRun?: () => void
  commitDetail?: CommitDetailState
  onLoadCommit?: (sha: string, options?: { force?: boolean }) => Promise<void>
  onLoadMoreCommitFiles?: () => Promise<void>
  onCloseCommit?: () => void
  getReactionAction?: (target: ReactionTarget) => ReactionActionState
  onAddReaction?: (target: ReactionTarget, kind: ReactionKind) => Promise<ReactionState>
  issueDetail?: IssueDetailState
  onLoadIssue?: (number: number, options?: { force?: boolean }) => Promise<void>
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
  reviews?: PullReviewSession
  onPostInlineComment?: (input: InlineCommentInput, options?: { retryUnconfirmed?: boolean }) => Promise<PostedInlineComment>
  onMergePull?: (number: number, method: PullMergeMethod, expectedHeadSha: string, message?: PullMergeMessage) => Promise<PullRequestDetail>
  onLoadPullMergeMessage?: (number: number, expectedHeadSha: string) => Promise<PullMergeDraft>
  onUpdatePullDraft?: (number: number, draft: boolean) => Promise<PullRequestDetail>
  pullDetail?: PullDetailState
  onLoadPull?: (number: number, options?: { force?: boolean }) => Promise<void>
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
  // OpenTUI installs a renderer selection listener for every scrollbox. Retained
  // tabs, detail panes and popup lists can legitimately exceed Node's default 10.
  const listenerLimit = renderer.getMaxListeners()
  const appListenerLimit = Math.max(listenerLimit, 32)
  if (listenerLimit > 0) renderer.setMaxListeners(appListenerLimit)
  onCleanup(() => {
    if (listenerLimit > 0 && renderer.getMaxListeners() === appListenerLimit) renderer.setMaxListeners(listenerLimit)
  })
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
  const [timelineCollapsed, setTimelineCollapsed] = createSignal(false)
  const [overviewDocument, setOverviewDocument] = createSignal<string>()
  const [diffFocus, setDiffFocus] = createSignal<Partial<Record<Page, DiffFocus>>>({})
  const [overlay, setOverlay] = createSignal<Overlay>()
  const [toast, setToast] = createSignal<ToastState>()
  const [commandAction, setCommandAction] = createSignal<CommandAction>()
  const [issueAction, setIssueAction] = createSignal<{ number: number; kind: IssueActionKind; parent?: IssueActionParent }>()
  const [pendingIssueActions, setPendingIssueActions] = createSignal<Array<NonNullable<ReturnType<typeof issueAction>> & { repository: string }>>([])
  const [reviewTarget, setReviewTarget] = createSignal<{ repository: string; number: number }>()
  const [reviewAnchor, setReviewAnchor] = createSignal<ReviewAnchor>()
  const [inlineContext, setInlineContext] = createSignal<Omit<InlineCommentInput, "body">>()
  const [inlineBody, setInlineBody] = createSignal("")
  const [postingInline, setPostingInline] = createSignal<InlineCommentInput>()
  const [inlineRetry, setInlineRetry] = createSignal<InlineCommentInput>()
  const [postedInlineThreads, setPostedInlineThreads] = createSignal<Array<{ repository: string; number: number; headSha: string; thread: PullReviewThread }>>([])
  const [reviewJump, setReviewJump] = createSignal<ReviewAnchor & { id: number }>()
  const [reviewSubmitting, setReviewSubmitting] = createSignal<{ repository: string; number: number }>()
  let reviewJumpId = 0
  const [mergeTarget, setMergeTarget] = createSignal<{ repository: string; number: number; headSha: string }>()
  const [pendingMerges, setPendingMerges] = createSignal<Array<{ repository: string; number: number }>>([])
  const [draftTarget, setDraftTarget] = createSignal<{ repository: string; number: number; draft: boolean }>()
  const [pendingDraftUpdates, setPendingDraftUpdates] = createSignal<Array<NonNullable<ReturnType<typeof draftTarget>>>>([])
  const [issueActionHint, setIssueActionHint] = createSignal<string>()
  const [issueEditorExpanded, setIssueEditorExpanded] = createSignal(false)
  const [reviewEditorActive, setReviewEditorActive] = createSignal(false)
  const [issueEditorActive, setIssueEditorActive] = createSignal(false)
  const fullscreenEditorOpen = () => issueEditorExpanded() && (
    overlay() === "pull-review" && reviewEditorActive() || overlay() === "review-comment"
    || overlay() === "issue-action" && issueEditorActive())
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
    if (target.kind === "pull" && (props.pullDetail?.number !== target.number || props.pullDetail.context.status === "error"))
      void props.onLoadPull?.(target.number)
    if (target.kind === "pull" && props.reviews && props.reviews.state().status !== "submitting")
      void props.reviews.open(data().repo.nameWithOwner, target.number).catch((error) => {
        if (!disposed && !renderer.isDestroyed) setToast({ id: ++toastId, title: "Review unavailable", message: String(error) })
      })
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
  const openReference = (reference: IssueReference) => {
    setOverlay()
    const detail: DetailTarget = reference.kind === "commit" ? { kind: "commit", sha: reference.sha }
      : { kind: reference.kind, number: reference.number }
    if (reference.repository.toLowerCase() !== data().repo.nameWithOwner.toLowerCase()) {
      props.onOpenReference?.(reference.repository, detail)
      return
    }
    if (detail.kind === "commit") openCommit(detail.sha)
    else if (detail.kind === "pull") openPull(detail.number)
    else if (detail.kind === "issue") openIssue(detail.number)
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
  const issueMenuItems = createMemo(() => referencedItems([
    ...(issueDetail().references.value ?? []), ...(issueDetail().resource.value?.references ?? []),
  ], {
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
  const hasIssueActions = () => canAct(actionDetail()?.state === "closed" ? "reopen" : "close") || canAct("duplicate") || canAct("assignees") || canOfferMerge() || canChangeDraft(true) || canChangeDraft(false) || canOfferReview()
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
      else await props.onLoadIssue?.(number, { force: true })
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
  const canChangeDraft = (draft: boolean) => {
    const number = activePullNumber()
    const pull = pullDetail().resource.value
    return !!(number && props.onUpdatePullDraft && pull?.state === "open" && !pull.merged && pull.draft === !draft
      && pull.permissions?.[draft ? "markDraft" : "markReady"] && pullDetail().resource.status === "ready"
      && props.getIssueAction?.(number, "pull").operation.status !== "loading")
  }
  const draftChangeAvailable = () => {
    const target = draftTarget()
    return !!(target && target.repository === data().repo.nameWithOwner && target.number === activePullNumber() && canChangeDraft(target.draft))
  }
  const openDraftChange = (draft: boolean) => {
    if (!canChangeDraft(draft)) return
    setDraftTarget({ repository: data().repo.nameWithOwner, number: activePullNumber()!, draft })
    setOverlay("pull-draft")
  }
  const closeDraftChange = () => { setOverlay(); setDraftTarget() }
  const submitDraftChange = async () => {
    const target = draftTarget()
    if (!target || !props.onUpdatePullDraft || !draftChangeAvailable()) return
    setPendingDraftUpdates((current) => [...current, target])
    closeDraftChange()
    try {
      await props.onUpdatePullDraft(target.number, target.draft)
      if (disposed || renderer.isDestroyed || data().repo.nameWithOwner !== target.repository) return
      setToast({ id: ++toastId, title: target.draft ? "PR marked as draft" : "PR ready for review", message: `#${target.number}`, duration: 2000, tone: "success" })
    } catch (error) {
      if (!disposed && !renderer.isDestroyed && data().repo.nameWithOwner === target.repository)
        setToast({ id: ++toastId, title: "PR stage change failed", message: error instanceof Error ? error.message : "Check the PR on GitHub before retrying." })
    } finally {
      setPendingDraftUpdates((current) => current.filter((pending) => pending !== target))
    }
  }
  createEffect(on(() => [data().repo.nameWithOwner, activePullNumber(), props.reviews] as const, ([repository, number, reviews]) => {
    if (!number || !reviews) return
    void reviews.open(repository, number).catch((error) => {
      if (!disposed && !renderer.isDestroyed && data().repo.nameWithOwner === repository && activePullNumber() === number)
        setToast({ id: ++toastId, title: "Review unavailable", message: String(error) })
    })
  }))
  const canOfferReview = () => {
    const pull = pullDetail().resource.value
    return !!(props.reviews && activePullNumber() && pull?.permissions?.comment && pull.state === "open" && pull.draft === false && !pull.merged)
  }
  const openReview = async (number = activePullNumber()) => {
    if (!number || !props.reviews || reviewSubmitting()) return
    const target = { repository: data().repo.nameWithOwner, number }
    setReviewTarget(target)
    setOverlay("pull-review")
    try { await props.reviews.open(target.repository, number) }
    catch (error) {
      if (!disposed && reviewTarget() === target) setToast({ id: ++toastId, title: "Review unavailable", message: String(error) })
    }
  }
  const threadsForDiff = (target: DiffTarget): PullReviewThread[] => {
    if (target.kind !== "pull") return []
    const value = resourceForDiff(target).value
    if (value?.kind !== "patch" || !value.headSha) return []
    const context = props.pullDetail?.number === target.number ? props.pullDetail.context.value : undefined
    const remote = context?.readiness.headSha === value.headSha ? context.threads : []
    const urls = new Set(remote.flatMap(thread => thread.comments.map(comment => comment.url)))
    const posted = postedInlineThreads().filter(item => item.repository === data().repo.nameWithOwner && item.number === target.number
      && item.headSha === value.headSha && !item.thread.comments.some(comment => urls.has(comment.url))).map(item => item.thread)
    return [...remote, ...posted]
  }
  const reviewForDiff = (target: DiffTarget) => {
    if (target.kind !== "pull" || !props.reviews || !props.onPostInlineComment) return undefined
    const state = props.reviews.state()
    const eligible = state.eligibility
    const resource = resourceForDiff(target)
    const value = resource.value
    if (!eligible || !(eligible.canInlineComment ?? eligible.canComment) || state.status === "loading" || state.status === "submitting" || postingInline()
      || eligible.repository.toLowerCase() !== data().repo.nameWithOwner.toLowerCase() || eligible.number !== target.number
      || resource.status !== "ready" || value?.kind !== "patch" || !value.headSha
      || value.headSha !== eligible.headSha || !value.baseSha || value.baseSha !== eligible.baseSha) return undefined
    return {
      headSha: value.headSha, comments: [], jump: reviewJump(),
      onComment: (anchor: ReviewAnchor) => {
        const context = { accountId: eligible.accountId, repository: data().repo.nameWithOwner, number: target.number,
          headSha: value.headSha!, baseSha: value.baseSha!, anchor: { path: anchor.path, line: anchor.line, side: anchor.side,
            ...(anchor.startLine === undefined ? {} : { startLine: anchor.startLine, startSide: anchor.startSide }) } }
        if (JSON.stringify(context) !== JSON.stringify(inlineContext())) setInlineBody("")
        setInlineContext(context)
        setReviewAnchor(anchor)
        setOverlay("review-comment")
      },
      onOpenReview: () => { void openReview(target.number) },
    }
  }
  const submitInlineComment = async (body: string, retryUnconfirmed = false) => {
    const context = inlineContext()
    if (!context || !props.onPostInlineComment || postingInline()) return
    const input = { ...context, body }
    const viewer = props.reviews?.state().eligibility
    const author = viewer?.accountId === context.accountId ? viewer.login : "You"
    setInlineBody(body)
    setPostingInline(input)
    setOverlay()
    try {
      const posted = await props.onPostInlineComment(input, retryUnconfirmed ? { retryUnconfirmed: true } : undefined)
      if (inlineContext() === context) setInlineBody("")
      if (disposed || renderer.isDestroyed || data().repo.nameWithOwner !== context.repository) return
      const now = new Date().toISOString()
      const thread: PullReviewThread = { kind: "review-thread", id: `posted-${posted.id}`, path: posted.path,
        line: posted.line, originalLine: posted.line, diffSide: posted.side, startLine: posted.startLine,
        isResolved: false, isOutdated: false, createdAt: now,
        comments: [{ id: `posted-${posted.id}`, author, authorAssociation: "", body: posted.body,
          createdAt: now, updatedAt: now, url: posted.url }] }
      setPostedInlineThreads(current => [...current.filter(item => item.thread.id !== thread.id || item.repository !== context.repository),
        { repository: context.repository, number: context.number, headSha: context.headSha, thread }])
      setToast({ id: ++toastId, title: "Inline comment posted", message: `${context.anchor.path}:${context.anchor.line}`, duration: 2000, tone: "success" })
      const target = diffTarget()
      if (activePullNumber() === context.number || target?.kind === "pull" && target.number === context.number) void props.onLoadPull?.(context.number)
    } catch (error) {
      if (!disposed && !renderer.isDestroyed && data().repo.nameWithOwner === context.repository) {
        setToast({ id: ++toastId, title: "Inline comment not confirmed", message: error instanceof Error ? error.message : String(error) })
        const target = diffTarget()
        if (error instanceof InlineCommentUncertainError && error.retryAllowed && !overlay()
          && inlineContext() === context && target?.kind === "pull" && target.number === context.number) {
          setInlineRetry(input)
          setOverlay("inline-retry")
        }
      }
    } finally { setPostingInline(undefined) }
  }
  const jumpReview = (anchor: ReviewAnchor) => {
    const target = reviewTarget()
    if (!target || target.repository !== data().repo.nameWithOwner) return
    setOverlay()
    setReviewJump({ ...anchor, id: ++reviewJumpId })
    const diff = diffTarget()
    if (diff?.kind !== "pull" || diff.number !== target.number) viewDiff({ kind: "pull", number: target.number })
  }
  const submitReview = async () => {
    const target = reviewTarget()
    if (!target || !props.reviews || reviewSubmitting()) return
    const draft = props.reviews.state().draft
    if (!draft || draft.number !== target.number || draft.repository.toLowerCase() !== target.repository.toLowerCase()) {
      setToast({ id: ++toastId, title: "Review not submitted", message: "Review draft does not match this PR. Resolve the draft error and reopen Review." })
      return
    }
    setReviewSubmitting(target)
    setOverlay()
    try {
      const succeeded = await props.reviews.submit()
      if (disposed || renderer.isDestroyed || data().repo.nameWithOwner !== target.repository) return
      if (succeeded) {
        setToast({ id: ++toastId, title: "Review submitted", message: `PR #${target.number}`, duration: 2000, tone: "success" })
        if (activePullNumber() === target.number) void props.onLoadPull?.(target.number)
      } else setToast({ id: ++toastId, title: "Review not submitted", message: props.reviews.state().message ?? "Open the pending review to check its status." })
    } catch (error) {
      if (!disposed && !renderer.isDestroyed && data().repo.nameWithOwner === target.repository)
        setToast({ id: ++toastId, title: "Review not submitted", message: String(error) })
    } finally { setReviewSubmitting(undefined) }
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
  const pullMenuItems = createMemo(() => referencedItems([
    ...(pullDetail().references.value ?? []), ...(pullDetail().resource.value?.references ?? []),
  ], {
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
  const commitMenuItems = createMemo(() => referencedItems(commitResource().value?.references ?? []))
  const activeMenuItems = () => activeCommitSha() ? commitMenuItems() : activePullNumber() ? pullMenuItems() : issueMenuItems()
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
      else await props.onLoadPull?.(number, { force: true })
    } finally {
      setPullRefresh((current) => current === request ? undefined : current)
    }
  }
  const pullUrl = (number: number) => props.pullDetail?.number === number && props.pullDetail.resource.value
    ? props.pullDetail.resource.value.url : `${data().repo.url}/pull/${number}`
  const issues = () => data().issues[issueState()]
  const pulls = () => data().pulls[pullState()]
  // Open totals share the header tabs' source. GitHub gives no closed total, so closed shows loaded rows ("30+" when more exist).
  const loadedCount = (resource: ResourceState<Paginated<unknown>>) => resource.value
    ? `${resource.value.items.length}${resource.value.hasMore ? "+" : ""}` : resource.status === "error" ? "—" : "…"
  const openCount = (kind: "issues" | "pulls") => {
    const totals = data().workCounts
    if (totals.value) return String(totals.value[kind])
    return totals.status === "error" ? loadedCount(data()[kind].open) : "…"
  }
  const issueCounts = () => ({ open: openCount("issues"), closed: loadedCount(data().issues.closed) })
  const pullCounts = () => ({ open: openCount("pulls"), closed: loadedCount(data().pulls.closed) })
  // Loaded list rows seed detail headers while the full detail loads.
  const listed = <T,>(lists: ResourceState<Paginated<T>>[], match: (item: T) => boolean) =>
    lists.flatMap((list) => list.value?.items ?? []).find(match)
  const issueSummary = createMemo(() => listed([data().issues.open, data().issues.closed], (item) => item.number === issueNumber()))
  const pullSummary = createMemo(() => listed([data().pulls.open, data().pulls.closed], (item) => item.number === pullNumber()))
  const commitSummary = createMemo(() => listed([data().commits], (item) => item.sha === commitSha()))
  const runSummary = createMemo(() => listed([data().runs], (item) => item.id === runId()))
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
    const pendingDraft = pendingDraftUpdates().find((pending) => pending.repository === data().repo.nameWithOwner)
    if (pendingDraft) return pendingDraft.draft ? "marking-draft" : "marking-ready"
    if (postingInline()?.repository === data().repo.nameWithOwner) return "posting-comment"
    if (reviewSubmitting()?.repository === data().repo.nameWithOwner) return "submitting-review"
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
    if (activePullNumber()) return pullDetailPart() === "pull" ? "pull request" : pullDetailPart() === "context" ? "merge readiness" : pullDetailPart()
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
    if (overlay() === "issue-references" || overlay() === "issue-actions" || overlay() === "issue-action" || overlay() === "pull-merge" || overlay() === "pull-draft" || overlay() === "pull-review" || overlay() === "review-comment" || overlay() === "inline-retry") { setInlineRetry(); setOverlay(); setIssueAction(); setMergeTarget(); setDraftTarget() }
  })

  createEffect(() => {
    if (!overviewDocuments().some((document) => document.id === overviewDocument())) {
      setOverviewDocument(overviewDocuments()[0]?.id)
      overviewScroll?.scrollTo(0)
    }
  })

  onCleanup(() => { disposed = true; props.onCloseDiff?.(); props.onCloseRun?.(); props.onCloseCommit?.(); props.onCloseIssue?.(); props.onClosePull?.() })

  const closeDetail = () => batch(() => {
    const detail = navigation().details?.[page()]
    const next = back(navigation())
    setNavigation(next)
    if (detail?.kind === "run") props.onCloseRun?.()
    if (detail?.kind === "commit") props.onCloseCommit?.()
    if (detail?.kind === "issue") { props.onCloseIssue?.(); setRevealActivity() }
    if (detail?.kind === "pull") { props.onClosePull?.(); setRevealActivity() }
    // Each resource slot holds one entity; a same-tab link may have replaced it.
    const restored = next.details?.[next.page]
    if (restored?.kind === "run" && props.runDetail?.id !== restored.id) void props.onLoadRun?.(restored.id)
    if (restored?.kind === "commit" && props.commitDetail?.sha !== restored.sha) void props.onLoadCommit?.(restored.sha)
    if (restored?.kind === "issue" && props.issueDetail?.number !== restored.number) void props.onLoadIssue?.(restored.number)
    if (restored?.kind === "pull" && props.pullDetail?.number !== restored.number) void props.onLoadPull?.(restored.number)
  })
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
  const referencesContextItems = (): ContextMenuItem[] =>
    (activeIssueNumber() || activePullNumber() || activeCommitSha()) && !diffTarget() && activeMenuItems().length ? [{
      label: "References…",
      run: () => { if (activeMenuItems().length) setOverlay("issue-references") },
      get disabled() { return !activeMenuItems().length },
    }] : []
  const timelineContextItems = (): ContextMenuItem[] =>
    (activeIssueNumber() || activePullNumber()) && !diffTarget() ? [{
      label: timelineCollapsed() ? "Expand" : "Collapse",
      run: () => setTimelineCollapsed((collapsed) => !collapsed),
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
      ...referencesContextItems(),
      ...timelineContextItems(),
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
    items.push(...commentContextItems(), ...issueActionsContextItems(), ...referencesContextItems(), ...timelineContextItems(), ...backContextItems());
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
    const timeline: HintEntry = ["detail.toggleTimeline", timelineCollapsed() ? "expand" : "collapse"]
    const help: HintEntry = ["global.help", "help"]
    const close: HintEntry = ["dialog.close", "close"]
    const picker: HintEntry[] = [["picker.accept", "open"], [["picker.up", "picker.down"], "select"], close]
    if (overlay() === "context-menu") return undefined
    if (overlay() === "reactions") return hint(["navigation.activate", "add"], select, close)
    if (overlay() === "issue-action" || overlay() === "pull-merge" || overlay() === "pull-draft" || overlay() === "pull-review" || overlay() === "review-comment" || overlay() === "inline-retry") return issueActionHint()
    if (overlay() === "issue-actions") return hint(open, select, close)
    if (overlay() === "help") return hint(close)
    if (overlay() === "settings") return settingsHint()
    if (overlay() === "command") return commandHint()
    if (overlay() === "branch-picker" || overlay() === "switch-repo") return hint(...picker)
    if (overlay() === "issue-references") return hint(open, select, ["references.switchTab", "switch tabs"], copy, close)
    // Arrays are priority lists, identical at every terminal width. The footer
    // fits whole hints without hiding recovery/primary actions behind copy/open.
    const common: HintEntry[] = [...(props.onSwitchRepository ? [["global.switchRepository", "switch repo"] as const] : []), help]
    const resource = activeResource()
    if (resource?.status === "loading" && resource.value === undefined) {
      const detail = diffTarget() || activeRunId() || activeCommitSha() || activeIssueNumber() || activePullNumber()
      const tabs: HintEntry = [["navigation.previousTab", "navigation.nextTab"], "tabs"]
      return hint(...(detail ? [back] : []), ...(!diffTarget() ? [tabs] : []), ...common)
    }
    const canRefresh = operations().refresh.status !== "loading" && resource?.status !== "loading"
    const retry: HintEntry[] = canRefresh && resource?.status === "error" ? [["view.refresh", "retry"]] : []
    const refresh: HintEntry[] = canRefresh && resource?.status !== "error" ? [["view.refresh", "refresh"]] : []
    const more = (available: boolean | undefined): HintEntry[] => available ? [["navigation.activate", "load more"]] : []
    const list = (hasItems: boolean): HintEntry[] => hasItems ? [open, select] : []
    if (diffTarget()) {
      const files = diffFocus()[page()] === "files"
      const horizontal: HintEntry = [files ? ["navigation.previousTab", "navigation.nextTab"] : ["diff.panLeft", "diff.panRight"], files ? "tabs" : "pan"]
      const failed = resource?.status === "error"
      const recovery: HintEntry[] = failed ? [...retry, ["navigation.activate", "file list"]]
        : canRefresh && diffResource().value?.kind === "files" ? [["view.refresh", "retry full diff"]] : []
      return hint(back, ...recovery, ["diff.focus", `focus ${files ? "diff" : "files"}`], horizontal,
        [["diff.previousHunk", "diff.nextHunk"], "hunks"],
        ...(props.reviews && diffTarget()?.kind === "pull" ? [["review.open", "review"] as const] : []),
        ...(failed ? [] : [["diff.toggleLayout", "layout"], ["diff.toggleWrap", "wrap"]] as const),
        ["diff.toggleFiles", "toggle files"], [["navigation.up", "navigation.down"], files ? "files" : "scroll"],
        ...refresh, github, ...common)
    }
    if (activeRunId()) return hint(back, ...retry,
      ...more(runDetail().jobs.status !== "loading" && runDetail().jobs.value?.hasMore), ...refresh, github, copy, ...common)
    if (activeCommitSha()) return hint(back, ...retry,
      ...more(commitResource().status !== "loading" && commitResource().value?.files.hasMore), diff,
      ...(commitMenuItems().length ? [["detail.references", "references"] as const] : []), ...refresh, github, copy, ...common)
    if (activeIssueNumber()) return hint(back, ...retry,
      ...more(issueDetail().comments.status !== "loading" && issueDetail().comments.value?.hasMore),
      ...(canActOnIssue("comment") ? [["issue.comment", "comment"] as const] : []),
      ...(hasIssueActions() ? [["issue.actions", "actions"] as const] : []),
      timeline, ...(issueMenuItems().length ? [["detail.references", "references"] as const] : []),
      ...refresh, github, copy, ...common)
    if (activePullNumber()) return hint(back, ...retry,
      ...more(pullDetail().comments.status !== "loading" && pullDetail().comments.value?.hasMore),
      ...(canCommentOnPull() ? [["issue.comment", "comment"] as const] : []),
      ...(canOfferReview() ? [["review.open", "review"] as const] : []),
      ...(hasIssueActions() ? [["issue.actions", "actions"] as const] : []), diff,
      timeline, ...(pullMenuItems().length ? [["detail.references", "references"] as const] : []),
      ...refresh, github, copy, ...common)
    if (page() === "actions") {
      const hasItems = !!data().runs.value?.items.length
      return hint(...retry, ...list(hasItems), ...refresh, github, ...(hasItems ? [copy] : []), ...common)
    }
    if (page() === "pulls" || page() === "issues") {
      const hasItems = !!(page() === "pulls" ? pulls() : issues()).value?.items.length
      return hint(...retry, ...list(hasItems), ["work.toggleState", "open/closed"],
        ...(page() === "pulls" && hasItems ? [diff] : []), ...refresh, github, ...(hasItems ? [copy] : []), ...common)
    }
    if (page() === "commits") {
      const hasItems = !!data().commits.value?.items.length
      return hint(...retry, ...list(hasItems), ["commits.chooseBranch", "branch"], ...(hasItems ? [diff] : []),
        ...refresh, github, ...(hasItems ? [copy] : []), ...common)
    }
    if (page() === "overview") return hint(...retry,
      ...(overviewDocuments().length > 1 ? [["overview.nextDocument", "documents"] as const] : []),
      ...(canClone() ? [["command.clone", "clone"] as const] : []), ...refresh, github, copy, ...common)
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
      if (diff) {
        if (diffResource().status !== "loading") {
          void props.onLoadDiff?.(diff, false, { force: true })
          if (diff.kind === "pull") void props.onLoadPull?.(diff.number, { force: true })
        }
        return
      }
      const run = activeRunId()
      if (run) {
        clearRunFailures(run)
        const jobs = runDetail().jobs
        if (runDetail().resource.status === "ready" && jobs.status === "error" && jobs.phase === "pagination") void props.onLoadMoreRunJobs?.()
        else void props.onLoadRun?.(run, { force: true })
      } else if (activeCommitSha()) {
        const resource = commitResource()
        if (resource.status === "loading") return
        if (resource.status === "error" && resource.phase === "pagination") void props.onLoadMoreCommitFiles?.()
        else void props.onLoadCommit?.(activeCommitSha()!, { force: true })
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
    "review.open": () => {
      const diff = diffTarget()
      if (diff?.kind === "pull" && props.reviews) { void openReview(diff.number); return }
      if (!canOfferReview()) return false
      void openReview()
    },
    "issue.actions": () => { if (!(activeIssueNumber() || activePullNumber()) || diffTarget() || !hasIssueActions()) return false; setOverlay("issue-actions") },
    "detail.toggleTimeline": () => {
      if (diffTarget() || !(activeIssueNumber() || activePullNumber())) return false
      setTimelineCollapsed((collapsed) => !collapsed)
    },
    "detail.references": () => { if (diffTarget() || !(activeIssueNumber() || activePullNumber() || activeCommitSha()) || !activeMenuItems().length) return false; setOverlay("issue-references") },
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
              summary={runSummary()}
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
              summary={commitSummary()}
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
              summary={issueSummary()}
              detail={issueDetail()}
              onOpenReference={openReference}
              timelineCollapsed={timelineCollapsed()}
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
              summary={pullSummary()}
              detail={pullDetail()}
              onOpenReference={openReference}
              timelineCollapsed={timelineCollapsed()}
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
              review={reviewForDiff(target)} threads={threadsForDiff(target)} repositoryUrl={data().repo.url}
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
        zIndex={overlay() && (config().showStatusBarHints || (status() && !fullscreenEditorOpen())) ? 350 : 0} />
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
          hasDocumentTabs={overviewDocuments().length > 1}
          hasMoreFiles={commitResource().value?.files.hasMore}
          hasMoreComments={activePullNumber() ? pullDetail().comments.value?.hasMore : issueDetail().comments.value?.hasMore}
          hasReferences={activeMenuItems().length > 0}
          canComment={canComment()}
          hasIssueActions={hasIssueActions()}
          canReview={!!props.reviews && (diffTarget()?.kind === "pull" || canOfferReview())}
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
          draftAction={canChangeDraft(true) ? "draft" : canChangeDraft(false) ? "ready" : undefined}
          onChangeDraft={openDraftChange}
          onReview={canOfferReview() ? () => { void openReview() } : undefined}
          onOpenGitHub={props.onOpenInBrowser ? () => { setOverlay(); void openInBrowser(activePullNumber()) } : undefined}
          onSelect={openIssueAction}
          onClose={() => setOverlay()}
        />
      </Show>
      <Show when={overlay() === "pull-draft" ? draftTarget() : undefined} keyed>
        {(target) => <PullDraftDialog number={target.number} draft={target.draft} disabled={!draftChangeAvailable()}
          onSubmit={() => void submitDraftChange()} onClose={closeDraftChange} onHintChange={setIssueActionHint} />}
      </Show>
      <Show when={overlay() === "pull-review" && props.reviews && reviewTarget()}>
        <PullReviewDialog onEditorActiveChange={setReviewEditorActive} number={reviewTarget()?.number} session={props.reviews!} repositoryUrl={data().repo.url} showScrollbar={config().showScrollbars}
          expanded={issueEditorExpanded()} onExpandedChange={setIssueEditorExpanded} showStatusBarHints={config().showStatusBarHints}
          onSubmit={() => { void submitReview() }} onClose={() => setOverlay()} onJump={jumpReview}
          onOpenGitHub={() => { void openInBrowser(reviewTarget()?.number) }} onHintChange={setIssueActionHint} />
      </Show>
      <Show when={overlay() === "inline-retry" ? inlineRetry() : undefined} keyed>
        {(input) => <InlineCommentRetryDialog input={input} onHintChange={setIssueActionHint}
          onClose={() => { setInlineRetry(); setOverlay() }}
          onOpenGitHub={() => { void openInBrowser(input.number, input.repository) }}
          onConfirm={() => {
            const context = inlineContext()
            if (context && data().repo.nameWithOwner === input.repository && JSON.stringify({ ...context, body: input.body }) === JSON.stringify(input)) {
              setInlineRetry()
              void submitInlineComment(input.body, true)
            } else { setInlineRetry(); setOverlay() }
          }} />}
      </Show>
      <Show when={overlay() === "review-comment" ? reviewAnchor() : undefined} keyed>
        {(anchor) => <ReviewCommentDialog anchor={anchor} body={inlineBody()} headSha={inlineContext()?.headSha ?? ""}
          repositoryUrl={data().repo.url} showScrollbar={config().showScrollbars}
          expanded={issueEditorExpanded()} onExpandedChange={setIssueEditorExpanded} showStatusBarHints={config().showStatusBarHints}
          onSave={(body) => { void submitInlineComment(body) }} onClose={() => setOverlay()} onHintChange={setIssueActionHint} />}
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
            onEditorActiveChange={setIssueEditorActive}
            parent={action.parent}
            state={props.getIssueAction?.(action.number, action.parent) ?? emptyIssueAction}
            showScrollbar={config().showScrollbars}
            showStatusBarHints={config().showStatusBarHints}
            expanded={action.kind !== "duplicate" && issueEditorExpanded()}
            onExpandedChange={setIssueEditorExpanded}
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
      <Show when={overlay() === "issue-references" && (activeIssueNumber() || activePullNumber() || activeCommitSha())}>
        <IssueReferencesPicker
          references={activeMenuItems()}
          currentIssue={activeCommitSha() ? undefined : { repository: data().repo.nameWithOwner, number: (activeIssueNumber() ?? activePullNumber())! }}
          showScrollbar={config().showScrollbars}
          onOpen={openReference}
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
