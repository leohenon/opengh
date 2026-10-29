import { createSignal, type Accessor, type Setter } from "solid-js"
import {
  loadGitHubBranches,
  loadGitHubCommit,
  loadGitHubCommits,
  loadGitHubCommitCount,
  loadGitHubDocument,
  loadGitHubDocuments,
  loadGitHubIssue,
  loadGitHubIssueComments,
  loadGitHubIssueReferences,
  loadGitHubIssueTimeline,
  loadGitHubIssues,
  loadGitHubHasIssues,
  loadGitHubMetadata,
  loadGitHubWorkCounts,
  loadGitHubPull,
  loadGitHubPullCommits,
  loadGitHubPullContext,
  loadGitHubPulls,
  loadGitHubRuns,
  loadGitHubRun,
  loadGitHubRunJobs,
  createGitHubIssueComment,
  updateGitHubIssueState,
  updateGitHubPullState,
  updateGitHubPullDraft,
  mergeGitHubPull,
  loadGitHubPullMergeMessage,
  setGitHubIssueAssignees,
  loadGitHubAssignableUsers,
  markGitHubIssueDuplicate,
  addGitHubReaction,
} from "./github/client"
import { GitHubApiError } from "./github/transport"
import { createCacheBudget, createDetailCache, type DetailCacheOptions } from "./detail-cache"
import { createDiskDraftStore, type DraftKind, type DraftStore, type IssueDraft } from "./drafts"
import { loadGitHubDiff } from "./github/diff"
import { pullMergeBlocker } from "./pull-merge"
import { reactionKey, reactionParent, validateReactionKind } from "./reactions"
import type {
  CommitDetail,
  DiffContent,
  DiffTarget,
  CommitSummary,
  IssueSummary,
  IssueDetail,
  IssueComment,
  IssueReference,
  IssueActionKind,
  IssueActionParent,
  IssueActionResult,
  IssueCloseReason,
  IssueTimeline,
  ListState,
  Paginated,
  PullRequestDetail,
  PullMergeMethod,
  PullMergeMessage,
  PullMergeDraft,
  PullContext,
  PullRequestSummary,
  Repo,
  RepositoryDocument,
  WorkflowRunSummary,
  WorkflowRunDetail,
  WorkflowJob,
  ReactionKind,
  ReactionState,
  ReactionTarget,
} from "./models"
import type {
  CommitDetailState,
  RunDetailState,
  DiffState,
  IssueDetailState,
  IssueActionState,
  ReactionActionState,
  OperationState,
  PullDetailState,
  RepositoryData,
  RepositoryDocumentState,
  RepositoryResource,
  RepositoryState,
  ResourcePhase,
  ResourceState,
} from "./repository-state"

type Page<T> = { items: T[]; hasMore: boolean }

export type RepositoryLoaders = {
  addReaction?(repository: string, target: ReactionTarget, kind: ReactionKind): Promise<ReactionState>
  diff?(repository: string, target: DiffTarget, signal: AbortSignal, filesOnly?: boolean): Promise<DiffContent>
  metadata(repository: string): Promise<Repo>
  workCounts(repository: string): Promise<{ issues: number; pulls: number }>
  documents(repo: Repo, branch: string): Promise<RepositoryDocument[]>
  document(source: RepositoryDocument): Promise<string>
  branches(repository: string, fallbackBranch: string, page?: number): Promise<Page<string>>
  commits(repository: string, branch: string, page?: number): Promise<Page<CommitSummary>>
  commitCount(repository: string, branch: string): Promise<number>
  commit(repository: string, sha: string, page?: number): Promise<CommitDetail>
  issue(repository: string, number: number): Promise<IssueDetail>
  issueComments(repository: string, number: number, page?: number): Promise<Page<IssueComment>>
  issueReferences(repository: string, number: number): Promise<IssueReference[]>
  createIssueComment?(repository: string, number: number, body: string): Promise<IssueComment>
  updateIssueState?(repository: string, number: number, state: ListState, reason?: IssueCloseReason): Promise<IssueDetail>
  updatePullState?(repository: string, number: number, state: ListState): Promise<PullRequestDetail>
  updatePullDraft?(repository: string, number: number, draft: boolean): Promise<PullRequestDetail>
  pullMergeMessage?(repository: string, number: number, expectedHeadSha: string): Promise<PullMergeMessage>
  mergePull?(repository: string, number: number, method: PullMergeMethod, expectedHeadSha: string, message?: PullMergeMessage): Promise<PullRequestDetail>
  setIssueAssignees?(repository: string, number: number, assignees: string[]): Promise<IssueDetail>
  assignableUsers?(repository: string, page?: number): Promise<Page<string>>
  markIssueDuplicate?(repository: string, number: number, canonicalNumber: number): Promise<IssueDetail>
  issueTimeline?(repository: string, number: number): Promise<IssueTimeline>
  issues(repository: string, state: ListState, page?: number): Promise<Page<IssueSummary>>
  hasIssues?(repository: string, state: ListState): Promise<boolean>
  pull?(repository: string, number: number): Promise<PullRequestDetail>
  pullCommits(repository: string, number: number): Promise<CommitSummary[]>
  pullContext(repository: string, number: number): Promise<PullContext>
  pulls(repository: string, state: ListState, page?: number): Promise<Page<PullRequestSummary>>
  run?(repository: string, id: number): Promise<WorkflowRunDetail>
  runJobs?(repository: string, id: number, attempt: number, page?: number): Promise<Page<WorkflowJob>>
  runs(repository: string, page?: number): Promise<Page<WorkflowRunSummary>>
}

export type RepositorySession = {
  state: Accessor<RepositoryState>
  flushDrafts?(): void
  draftSaveError?: Accessor<string | undefined>
  reactionAction(target: ReactionTarget): ReactionActionState
  addReaction(target: ReactionTarget, kind: ReactionKind): Promise<ReactionState>
  diffs?: Accessor<Partial<Record<DiffTarget["kind"], DiffState>>>
  loadDiff?(target: DiffTarget, filesOnly?: boolean, options?: { force?: boolean }): Promise<void>
  clearDiff?(target?: DiffTarget): void
  runDetail: Accessor<RunDetailState | undefined>
  loadRun(id: number, options?: { force?: boolean }): Promise<void>
  loadMoreRunJobs(): Promise<void>
  clearRun(): void
  commitDetail: Accessor<CommitDetailState | undefined>
  loadCommit(sha: string, options?: { force?: boolean }): Promise<void>
  loadMoreCommitFiles(): Promise<void>
  clearCommit(): void
  pullDetail: Accessor<PullDetailState | undefined>
  loadPull(number: number, options?: { force?: boolean }): Promise<void>
  updatePullDraft(number: number, draft: boolean): Promise<PullRequestDetail>
  loadPullMergeMessage(number: number, expectedHeadSha: string): Promise<PullMergeDraft>
  mergePull(number: number, method: PullMergeMethod, expectedHeadSha: string, message?: PullMergeMessage): Promise<PullRequestDetail>
  loadMorePullComments(): Promise<void>
  retryPullReferences(): Promise<void>
  retryPullCommits(): Promise<void>
  retryPullContext(): Promise<void>
  clearPull(): void
  // Marks a retained PR stale after a change made outside the session (reviews, inline comments).
  invalidatePull?(repository: string, number: number): void
  issueDetail: Accessor<IssueDetailState | undefined>
  loadIssue(number: number, options?: { force?: boolean }): Promise<void>
  loadMoreIssueComments(): Promise<void>
  retryIssueReferences(): Promise<void>
  clearIssue(): void
  assignableUsers?: Accessor<ResourceState<Paginated<string>> | undefined>
  loadAssignableUsers?(): Promise<void>
  issueAction(number: number, parent?: IssueActionParent): IssueActionState
  prepareIssueAction(number: number, kind: IssueActionKind, parent?: IssueActionParent): void
  updateIssueDraft(number: number, draft: Partial<Pick<IssueActionState, "body" | "reason" | "duplicateTarget" | "selectedAssignees">>, parent?: IssueActionParent): void
  discardIssueDraft(number: number, parent?: IssueActionParent): void
  submitIssueAction(number: number, kind: IssueActionKind, parent?: IssueActionParent): Promise<IssueActionResult>
  load(repository: string): Promise<void>
  refresh(): Promise<void>
  retryResource(resource: RepositoryResource): Promise<void>
  canSwitchBranch(): boolean
  switchBranch(branch: string): Promise<void>
  loadMoreBranches(): Promise<void>
  loadMoreCommits(): Promise<void>
  loadMoreRuns(): Promise<void>
  loadMoreIssues(state: ListState): Promise<void>
  loadMorePulls(state: ListState): Promise<void>
}

const defaultLoaders: RepositoryLoaders = {
  addReaction: addGitHubReaction,
  diff: loadGitHubDiff,
  metadata: loadGitHubMetadata,
  workCounts: loadGitHubWorkCounts,
  documents: loadGitHubDocuments,
  document: loadGitHubDocument,
  branches: loadGitHubBranches,
  commits: loadGitHubCommits,
  commitCount: loadGitHubCommitCount,
  commit: loadGitHubCommit,
  issue: loadGitHubIssue,
  issueComments: loadGitHubIssueComments,
  issueReferences: loadGitHubIssueReferences,
  createIssueComment: createGitHubIssueComment,
  updateIssueState: updateGitHubIssueState,
  updatePullState: updateGitHubPullState,
  updatePullDraft: updateGitHubPullDraft,
  mergePull: mergeGitHubPull,
  pullMergeMessage: loadGitHubPullMergeMessage,
  setIssueAssignees: setGitHubIssueAssignees,
  assignableUsers: loadGitHubAssignableUsers,
  markIssueDuplicate: markGitHubIssueDuplicate,
  issueTimeline: loadGitHubIssueTimeline,
  issues: loadGitHubIssues,
  hasIssues: loadGitHubHasIssues,
  pull: loadGitHubPull,
  pullCommits: loadGitHubPullCommits,
  pullContext: loadGitHubPullContext,
  pulls: loadGitHubPulls,
  runs: loadGitHubRuns,
  run: loadGitHubRun,
  runJobs: loadGitHubRunJobs,
}

const idle = (): OperationState => ({ status: "idle" })
const loading = (): OperationState => ({ status: "loading" })
const messageFrom = (error: unknown) => error instanceof Error ? error.message : "Unknown error"
const page = <T>(result: Page<T>, pageNumber = 1): Paginated<T> => ({ ...result, page: pageNumber })

async function loadPageSet<T, K>(
  pageCount: number,
  loadPage: (page: number) => Promise<Page<T>>,
  key: (item: T) => K,
): Promise<Paginated<T>> {
  const pages = await Promise.all(Array.from({ length: Math.max(1, pageCount) }, (_, index) => loadPage(index + 1)))
  const seen = new Set<K>()
  const items = pages.flatMap((result) => result.items).filter((item) => {
    const itemKey = key(item)
    if (seen.has(itemKey)) return false
    seen.add(itemKey)
    return true
  })
  return { items, page: pages.length, hasMore: pages.at(-1)?.hasMore ?? false }
}
const loadingResource = <T>(value?: T, phase: ResourcePhase = "load"): ResourceState<T> => value === undefined
  ? { status: "loading", phase }
  : { status: "loading", phase, value }
const failedResource = <T>(error: unknown, value?: T, phase: ResourcePhase = "load"): ResourceState<T> => value === undefined
  ? { status: "error", phase, message: messageFrom(error) }
  : { status: "error", phase, message: messageFrom(error), value }

async function loadDocument(load: () => Promise<string>, previous?: string): Promise<ResourceState<string>> {
  try {
    return { status: "ready", value: await load() }
  } catch (error) {
    return failedResource(error, previous)
  }
}

function hasLoadingDocuments(data: RepositoryData) {
  return data.documents.status === "loading"
    || data.documents.value?.some((document) => document.resource.status === "loading") === true
}

function hasLoadingResource(data: RepositoryData) {
  return hasLoadingDocuments(data)
    || data.branches.status === "loading"
    || data.commits.status === "loading"
    || data.runs.status === "loading"
    || data.issues.open.status === "loading"
    || data.issues.closed.status === "loading"
    || data.pulls.open.status === "loading"
    || data.pulls.closed.status === "loading"
}

function initialData(repo: Repo): RepositoryData {
  return {
    repo,
    currentBranch: repo.defaultBranch,
    workCounts: loadingResource(),
    documents: loadingResource(),
    branches: loadingResource(),
    commits: loadingResource(),
    commitCount: loadingResource(),
    issues: { open: loadingResource(), closed: loadingResource() },
    pulls: { open: loadingResource(), closed: loadingResource() },
    runs: loadingResource(),
  }
}

function updateReady(
  setState: Setter<RepositoryState>,
  generation: number,
  currentGeneration: () => number,
  repository: string,
  update: (state: Extract<RepositoryState, { status: "ready" }>) => RepositoryState,
) {
  setState((state) => {
    if (generation !== currentGeneration() || state.status !== "ready" || state.repository !== repository) return state
    return update(state)
  })
}

// Owns repository data and async coordination; pages only receive state and callbacks.
// Generations reject obsolete repository/branch results; reloads retain usable data.
export function createRepositorySession(
  loaders: RepositoryLoaders = defaultLoaders,
  draftStore: DraftStore | undefined = loaders === defaultLoaders ? createDiskDraftStore() : undefined,
  cacheOptions: DetailCacheOptions = {},
): RepositorySession {
  // Recently visited details stay reusable after navigating away; closing a page
  // deactivates it instead of discarding confirmed data.
  const cacheBudget = cacheOptions.budget ?? createCacheBudget(cacheOptions.maxBytes)
  const issueCache = createDetailCache<IssueDetailState>({ ...cacheOptions, budget: cacheBudget })
  const pullCache = createDetailCache<PullDetailState>({ ...cacheOptions, budget: cacheBudget })
  // Repository overview data (metadata, documents, branches, lists, counts) for recently opened repositories.
  const repositoryCache = createDetailCache<RepositoryData>({ ...cacheOptions, budget: cacheBudget, maxEntries: cacheOptions.maxEntries ?? 4 })
  const runCache = createDetailCache<RunDetailState>({ ...cacheOptions, budget: cacheBudget })
  // Commit content is immutable; only idle retention and the shared budget limit it.
  const commitCache = createDetailCache<CommitDetailState>({ ...cacheOptions, budget: cacheBudget, freshMs: cacheOptions.freshMs ?? Number.POSITIVE_INFINITY })
  const diffCache = createDetailCache<DiffContent>({ ...cacheOptions, budget: cacheBudget, maxEntries: cacheOptions.maxEntries ?? 6,
    freshMs: cacheOptions.freshMs ?? Number.POSITIVE_INFINITY, maxValueBytes: 8 * 1024 * 1024 })
  // Every detail key starts with `${repository}:` so caches can be scoped to one repository.
  const detailCacheKey = (repository: string, number: number, parent: IssueActionParent = "issue") => `${repository.toLowerCase()}:${parent}:${number}`
  // Loading sections with a value are reusable; errors stay visible so the page keeps its retry affordance.
  const settled = <T>(resource: ResourceState<T>): ResourceState<T> | undefined =>
    resource.status !== "loading" ? resource : resource.value === undefined ? undefined : { status: "ready", value: resource.value }
  const complete = (resources: ResourceState<unknown>[]) => resources.every((resource) => resource.status === "ready")
  const [draftSaveError, setDraftSaveError] = createSignal<string>()
  const draftErrors = new Map<string, string>()
  const publishDraftError = () => setDraftSaveError(draftErrors.values().next().value)
  const activeDraftKinds = new Map<string, DraftKind>()
  const unpreparedDraftEdits = new Set<string>()
  const savedDrafts = new Map<string, IssueDraft>()
  const dirtyDrafts = new Map<string, IssueDraft>()
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  const flushDrafts = () => {
    clearTimeout(draftTimer)
    draftTimer = undefined
    if (!draftStore) return
    for (const [key, draft] of dirtyDrafts) {
      try {
        draftStore.save(key, draft)
        dirtyDrafts.delete(key)
        draftErrors.delete(`save:${key}`)
      } catch (error) {
        draftErrors.set(`save:${key}`, `Draft save failed: ${messageFrom(error)}. Draft retained in memory; automatic local saving is unavailable.`)
      }
    }
    publishDraftError()
  }
  const draftSnapshot = (action: IssueActionState): IssueDraft => ({ body: action.body, reason: action.reason, retry: action.retry })
  const saveDraft = (key: string, action: IssueActionState) => {
    const kind = activeDraftKinds.get(key)
    if (!draftStore || !kind) return
    const draftKey = `${key}:${kind}`
    const draft = draftSnapshot(action)
    const previous = savedDrafts.get(draftKey)
    if (previous?.body === draft.body && previous.reason === draft.reason && previous.retry === draft.retry) return
    savedDrafts.set(draftKey, draft)
    dirtyDrafts.set(draftKey, draft)
    clearTimeout(draftTimer)
    draftTimer = setTimeout(flushDrafts, 200)
    draftTimer.unref?.()
  }
  const [state, setState] = createSignal<RepositoryState>({ status: "loading", repository: "" })
  const [runDetail, setRunDetail] = createSignal<RunDetailState>()
  let runGeneration = 0
  const [commitDetail, setCommitDetail] = createSignal<CommitDetailState>()
  const [diffs, setDiffs] = createSignal<Partial<Record<DiffTarget["kind"], DiffState>>>({})
  const diffGeneration: Record<DiffTarget["kind"], number> = { commit: 0, pull: 0 }
  const diffAbort: Partial<Record<DiffTarget["kind"], AbortController>> = {}
  // Diff identity is content-addressed: a commit SHA, or a PR number pinned to verified base/head commits.
  const diffCacheKey = (repository: string, target: DiffTarget, value: DiffContent | undefined, filesOnly: boolean) => {
    if (target.kind === "commit") return /^[a-f0-9]{40}$/i.test(target.sha) ? `${repository.toLowerCase()}:commit:${target.sha.toLowerCase()}:${filesOnly ? "files" : "patch"}` : undefined
    if (filesOnly || value?.kind !== "patch" || !value.headSha || !value.baseSha) return undefined
    return `${repository.toLowerCase()}:pull:${target.number}:${value.baseSha.toLowerCase()}:${value.headSha.toLowerCase()}`
  }
  const retainDiff = (repository: string, target: DiffTarget, value: DiffContent, filesOnly: boolean) => {
    const key = diffCacheKey(repository, target, value, filesOnly)
    if (key) diffCache.set(key, value)
  }
  const cachedDiff = (repository: string, target: DiffTarget, filesOnly: boolean) => {
    if (filesOnly) return target.kind === "commit" ? diffCache.get(diffCacheKey(repository, target, undefined, true) ?? "")?.value : undefined
    if (target.kind === "commit") return diffCache.get(diffCacheKey(repository, target, undefined, false) ?? "")?.value
    // A retained PR diff is only reusable while the loaded PR still points at the same head commit.
    const pull = pullDetail()?.number === target.number ? pullDetail()?.resource.value : undefined
    const headSha = pull?.headSha?.toLowerCase()
    if (!headSha || pullDetail()?.resource.status === "loading") return undefined
    // Prefer the most recently retained match; an older entry may carry an outdated base commit.
    const key = diffCache.keys().findLast((key) => key.startsWith(`${repository.toLowerCase()}:pull:${target.number}:`) && key.endsWith(`:${headSha}`))
    return key ? diffCache.get(key)?.value : undefined
  }
  const clearDiff = (target?: DiffTarget) => {
    const kinds = target ? [target.kind] : ["commit", "pull"] as const
    for (const kind of kinds) {
      ++diffGeneration[kind]
      diffAbort[kind]?.abort()
      delete diffAbort[kind]
    }
    setDiffs((current) => {
      const next = { ...current }
      for (const kind of kinds) delete next[kind]
      return next
    })
  }
  const loadDiff = async (target: DiffTarget, filesOnly = false, options: { force?: boolean } = {}) => {
    const current = state()
    if (current.status !== "ready") return
    const kind = target.kind
    diffAbort[kind]?.abort()
    const controller = new AbortController()
    diffAbort[kind] = controller
    const request = ++diffGeneration[kind]
    const cached = options.force ? undefined : cachedDiff(current.repository, target, filesOnly)
    if (cached) {
      delete diffAbort[kind]
      setDiffs((current) => ({ ...current, [kind]: { target, resource: { status: "ready", value: cached } } }))
      return
    }
    setDiffs((current) => ({ ...current, [kind]: { target, resource: loadingResource<DiffContent>() } }))
    try {
      if (!loaders.diff) throw new Error("Diff loading is unavailable")
      const value = await loaders.diff(current.repository, target, controller.signal, filesOnly)
      if (request === diffGeneration[kind] && !controller.signal.aborted) {
        setDiffs((current) => ({ ...current, [kind]: { target, resource: { status: "ready", value } } }))
        retainDiff(current.repository, target, value, filesOnly)
      }
    } catch (error) {
      if (request === diffGeneration[kind] && !controller.signal.aborted)
        setDiffs((current) => ({ ...current, [kind]: { target, resource: failedResource<DiffContent>(error) } }))
    }
  }
  const [issueDetail, setIssueDetail] = createSignal<IssueDetailState>()
  const [issueActions, setIssueActions] = createSignal<Record<string, IssueActionState>>({})
  const emptyIssueAction: IssueActionState = { body: "", reason: "completed", operation: idle() }
  const issueKey = (repository: string, number: number, parent: IssueActionParent = "issue") => `${repository.toLowerCase()}#${number}${parent === "pull" ? ":pull" : ""}`
  const postedComments = new Map<string, IssueComment[]>()
  const issueWriteRevision = new Map<string, number>()
  const pullActionRevision = new Map<string, number>()
  const confirmIssueWrite = (key: string) => {
    issueWriteRevision.set(key, (issueWriteRevision.get(key) ?? 0) + 1)
    // Confirmed writes may land after the page closed; a retained snapshot must revalidate before reuse.
    const [repository, rest] = key.split("#")
    const number = Number(rest?.replace(":pull", ""))
    if (repository && Number.isSafeInteger(number)) (rest?.endsWith(":pull") ? pullCache : issueCache).markStale(detailCacheKey(repository, number, rest?.endsWith(":pull") ? "pull" : "issue"))
  }
  let repositoryScope = 0
  const issueListGeneration: Record<ListState, number> = { open: 0, closed: 0 }
  const pullListGeneration: Record<ListState, number> = { open: 0, closed: 0 }
  const [pullDetail, setPullDetail] = createSignal<PullDetailState>()
  let pullGeneration = 0
  let pullDraftGeneration = 0
  let issueGeneration = 0
  let issueReferencesGeneration = 0
  let commitGeneration = 0
  let repositoryGeneration = 0
  let branchGeneration = 0
  let commitCountGeneration = 0
  const generation = () => repositoryGeneration
  const [reactionActions, setReactionActions] = createSignal<Record<string, ReactionActionState>>({})
  const emptyReactionAction: ReactionActionState = { operation: idle() }
  const reactionEpoch = { issue: 0, pull: 0 }
  let reactionRevision = 0
  const confirmedReactions = new Map<string, { revision: number; value: ReactionState }>()
  const reactionRequests = new Map<string, { token: object; kind: ReactionKind; promise: Promise<ReactionState> }>()
  const resetReactionOwner = (owner: "issue" | "pull") => {
    reactionEpoch[owner]++
    const prefix = `${owner}:`
    for (const key of confirmedReactions.keys()) if (key.startsWith(prefix)) confirmedReactions.delete(key)
    for (const key of reactionRequests.keys()) if (key.startsWith(prefix)) reactionRequests.delete(key)
    setReactionActions((actions) => Object.fromEntries(Object.entries(actions).filter(([key]) => !key.startsWith(prefix))))
  }
  const reactionAction = (target: ReactionTarget) => reactionActions()[reactionKey(target)] ?? emptyReactionAction
  const reactionSubject = (target: ReactionTarget): (Partial<ReactionState> & { nodeId?: string }) | undefined => {
    if (target.kind === "review-comment") {
      const detail = pullDetail()
      return detail?.number === target.number ? detail.context.value?.threads.flatMap((thread) => thread.comments).find((comment) => comment.id === target.id) : undefined
    }
    const detail = reactionParent(target) === "issue" ? issueDetail() : pullDetail()
    if (detail?.number !== target.number) return
    if (target.kind === "comment") return detail.comments.value?.items.find((comment) => comment.id === target.id)
    return detail.resource.value?.number === target.number ? detail.resource.value : undefined
  }
  const withReactionFields = <T extends Partial<ReactionState>>(target: ReactionTarget, value: T, readRevision: number): T => {
    const key = reactionKey(target)
    const confirmed = confirmedReactions.get(key)
    if (!confirmed) return value
    if (confirmed.revision > readRevision) return { ...value, ...confirmed.value }
    // A newer read owns counts/membership; missing optional viewer data is not an empty set.
    const reactions = value.reactions ?? confirmed.value.reactions
    const observed: ReactionState = { reactions,
      viewerReactions: value.viewerReactions ?? confirmed.value.viewerReactions.filter((kind) => (reactions[kind] ?? 0) > 0),
      canReact: value.canReact ?? confirmed.value.canReact,
    }
    confirmedReactions.set(key, { ...confirmed, value: observed })
    return { ...value, ...observed }
  }
  const withCommentReactions = (parent: "issue" | "pull", number: number, value: Paginated<IssueComment>, revision: number): Paginated<IssueComment> => ({
    ...value, items: value.items.map((comment) => withReactionFields({ kind: "comment", parent, number, id: comment.id }, comment, revision)),
  })
  const withThreadReactions = (number: number, value: PullContext, revision: number): PullContext => ({
    ...value, threads: value.threads.map((thread) => ({ ...thread, comments: thread.comments.map((comment) =>
      withReactionFields({ kind: "review-comment", number, id: comment.id }, comment, revision)) })),
  })
  // Only runs while the reacted page is displayed; the patched page is retained when it is left.
  const applyReaction = (target: ReactionTarget, value: ReactionState) => {
    if (target.kind === "issue") setIssueDetail((detail) => detail?.number === target.number && detail.resource.value
      ? { ...detail, resource: { ...detail.resource, value: { ...detail.resource.value, ...value } } } : detail)
    else if (target.kind === "pull") setPullDetail((detail) => detail?.number === target.number && detail.resource.value
      ? { ...detail, resource: { ...detail.resource, value: { ...detail.resource.value, ...value } } } : detail)
    else if (target.kind === "comment") {
      const update = <T extends IssueDetailState | PullDetailState>(detail: T | undefined): T | undefined => detail?.number === target.number && detail.comments.value
        ? { ...detail, comments: { ...detail.comments, value: { ...detail.comments.value,
          items: detail.comments.value.items.map((comment) => comment.id === target.id ? { ...comment, ...value } : comment),
        } } } : detail
      if (target.parent === "issue") setIssueDetail(update)
      else setPullDetail(update)
    } else setPullDetail((detail) => detail?.number === target.number && detail.context.value
      ? { ...detail, context: { ...detail.context, value: { ...detail.context.value,
        threads: detail.context.value.threads.map((thread) => thread.comments.some((comment) => comment.id === target.id)
          ? { ...thread, comments: thread.comments.map((comment) => comment.id === target.id ? { ...comment, ...value } : comment) } : thread),
      } } } : detail)
  }
  const addReaction = (requested: ReactionTarget, kind: ReactionKind): Promise<ReactionState> => {
    const target = { ...requested }
    let key: string
    try { key = reactionKey(target); validateReactionKind(kind) } catch (error) { return Promise.reject(error) }
    const current = state()
    const subject = reactionSubject(target)
    if (current.status !== "ready" || !subject) return Promise.reject(new Error("Load this message before reacting to it."))
    if (target.nodeId !== undefined && target.nodeId !== subject.nodeId && target.kind !== "review-comment")
      return Promise.reject(new Error("The reaction subject changed. Refresh the message before retrying."))
    if (subject.nodeId) target.nodeId = subject.nodeId
    if (subject.canReact === false) return Promise.reject(new Error("You do not have permission to react to this message."))
    if (!loaders.addReaction) return Promise.reject(new Error("Adding reactions is unavailable."))
    const existing = reactionRequests.get(key)
    if (existing) return existing.kind === kind ? existing.promise : Promise.reject(new Error("A reaction is already in progress for this message."))
    const scope = repositoryScope
    const owner = reactionParent(target)
    const epoch = reactionEpoch[owner]
    const token = {}
    const owns = () => scope === repositoryScope && state().repository === current.repository
      && epoch === reactionEpoch[owner] && reactionRequests.get(key)?.token === token
    const sameSubject = () => {
      const latest = reactionSubject(target)
      return latest && (!subject.nodeId || latest.nodeId === subject.nodeId)
    }
    const publish = (operation: OperationState) => setReactionActions((actions) => owns() ? { ...actions, [key]: { kind, operation } } : actions)
    const promise = Promise.resolve().then(() => {
      if (!owns() || !sameSubject()) throw new Error("The message changed before the reaction was submitted.")
      return loaders.addReaction!(current.data.repo.nameWithOwner, target, kind)
    }).then((value) => {
      if (owns() && sameSubject()) {
        confirmedReactions.set(key, { revision: ++reactionRevision, value })
        if (target.kind === "comment" && target.parent === "issue") {
          const postedKey = issueKey(current.repository, target.number)
          const posted = postedComments.get(postedKey)
          if (posted) postedComments.set(postedKey, posted.map((comment) => comment.id === target.id ? { ...comment, ...value } : comment))
        }
        applyReaction(target, value)
      }
      publish(idle())
      return value
    }, (error) => {
      if (sameSubject()) publish({ status: "error", message: messageFrom(error) })
      else publish(idle())
      throw error
    }).finally(() => { if (reactionRequests.get(key)?.token === token) reactionRequests.delete(key) })
    reactionRequests.set(key, { token, kind, promise })
    publish(loading())
    return promise
  }

  const fetchDocument = async (
    source: RepositoryDocument,
    repository: string,
    branch: string,
    request: number,
    previous?: string,
  ) => {
    const resource = await loadDocument(() => loaders.document(source), previous)
    updateReady(setState, request, generation, repository, (current) => {
      const documents = current.data.documents
      if (current.data.currentBranch !== branch || !documents.value) return current
      return {
        ...current,
        data: {
          ...current.data,
          documents: {
            ...documents,
            value: documents.value.map((document) => document.id === source.id ? { ...document, resource } : document),
          },
        },
      }
    })
  }

  const fetchDocuments = async (repository: string, repo: Repo, branch: string, request: number) => {
    try {
      const sources = await loaders.documents(repo, branch)
      const current = state()
      if (request !== repositoryGeneration || current.status !== "ready"
        || current.repository !== repository || current.data.currentBranch !== branch) return
      const previous = new Map(current.data.documents.value?.map((document) => [document.id, document]))
      const documents = sources.map((source): RepositoryDocumentState => ({
        ...source,
        resource: loadingResource(previous.get(source.id)?.ref === source.ref
          ? previous.get(source.id)?.resource.value : undefined),
      }))
      setState({ ...current, data: { ...current.data, documents: { status: "ready", value: documents } } })
      await Promise.all(documents.map((document) =>
        fetchDocument(document, repository, branch, request, document.resource.value)))
    } catch (error) {
      updateReady(setState, request, generation, repository, (current) => current.data.currentBranch === branch
        ? { ...current, data: { ...current.data, documents: failedResource(error, current.data.documents.value) } }
        : current)
    }
  }

  const fetchBranches = async (repository: string, fallbackBranch: string, request: number, pageCount = 1) => {
    try {
      const value = await loadPageSet(
        pageCount,
        (page) => loaders.branches(repository, fallbackBranch, page),
        (branch) => branch,
      )
      updateReady(setState, request, generation, repository, (current) => ({
        ...current,
        data: { ...current.data, branches: { status: "ready", value } },
      }))
    } catch (error) {
      updateReady(setState, request, generation, repository, (current) => ({
        ...current,
        data: { ...current.data, branches: failedResource(error, current.data.branches.value) },
      }))
    }
  }

  const fetchCommitCount = async (repository: string, branch: string, request: number) => {
    const countRequest = ++commitCountGeneration
    try {
      const value = await loaders.commitCount(repository, branch)
      updateReady(setState, request, generation, repository, (current) =>
        countRequest !== commitCountGeneration || current.data.currentBranch !== branch ? current : ({
          ...current, data: { ...current.data, commitCount: { status: "ready", value } },
        }))
    } catch (error) {
      updateReady(setState, request, generation, repository, (current) =>
        countRequest !== commitCountGeneration || current.data.currentBranch !== branch ? current : ({
          ...current, data: { ...current.data, commitCount: failedResource(error, current.data.commitCount.value) },
        }))
    }
  }

  const fetchCommits = async (repository: string, branch: string, request: number, pageCount = 1) => {
    try {
      const result = await loadPageSet(pageCount, (page) => loaders.commits(repository, branch, page), (item) => item.sha)
      updateReady(setState, request, generation, repository, (current) => current.data.currentBranch === branch
        ? { ...current, data: { ...current.data, commits: { status: "ready", value: result } } }
        : current)
    } catch (error) {
      updateReady(setState, request, generation, repository, (current) => current.data.currentBranch === branch
        ? { ...current, data: { ...current.data, commits: failedResource(error, current.data.commits.value) } }
        : current)
    }
  }

  const fetchIssues = async (repository: string, listState: ListState, request: number, pageCount = 1) => {
    const listRequest = ++issueListGeneration[listState]
    try {
      const result = await loadPageSet(pageCount, (page) => loaders.issues(repository, listState, page), (item) => item.number)
      // REST issue pages include PRs. An empty filtered page with more pages cannot prove there are no issues.
      if (result.items.length === 0 && result.hasMore && loaders.hasIssues) {
        const current = state()
        if (request !== repositoryGeneration || current.status !== "ready" || current.repository !== repository) return
        result.hasMore = await loaders.hasIssues(current.data.repo.nameWithOwner, listState)
      }
      updateReady(setState, request, generation, repository, (current) => listRequest !== issueListGeneration[listState] ? current : ({
        ...current,
        data: {
          ...current.data,
          issues: { ...current.data.issues, [listState]: { status: "ready", value: result } },
        },
      }))
    } catch (error) {
      updateReady(setState, request, generation, repository, (current) => listRequest !== issueListGeneration[listState] ? current : ({
        ...current,
        data: {
          ...current.data,
          issues: {
            ...current.data.issues,
            [listState]: failedResource(error, current.data.issues[listState].value),
          },
        },
      }))
    }
  }

  const fetchPulls = async (repository: string, listState: ListState, request: number, pageCount = 1) => {
    const listRequest = ++pullListGeneration[listState]
    try {
      const result = await loadPageSet(pageCount, (page) => loaders.pulls(repository, listState, page), (item) => item.number)
      if (listRequest !== pullListGeneration[listState]) return
      updateReady(setState, request, generation, repository, (current) => ({
        ...current,
        data: {
          ...current.data,
          pulls: { ...current.data.pulls, [listState]: { status: "ready", value: result } },
        },
      }))
    } catch (error) {
      if (listRequest !== pullListGeneration[listState]) return
      updateReady(setState, request, generation, repository, (current) => ({
        ...current,
        data: {
          ...current.data,
          pulls: {
            ...current.data.pulls,
            [listState]: failedResource(error, current.data.pulls[listState].value),
          },
        },
      }))
    }
  }

  const fetchRuns = async (repository: string, request: number, pageCount = 1) => {
    const before = state()
    const summaries = new Map(before.status === "ready" ? before.data.runs.value?.items.map((run) => [run.id, run]) : [])
    try {
      const result = await loadPageSet(pageCount, (page) => loaders.runs(repository, page), (item) => item.id)
      updateReady(setState, request, generation, repository, (current) => {
        const latest = new Map(current.data.runs.value?.items.map((run) => [run.id, run]))
        // Detail responses received during this request are newer than its list snapshot.
        const items = result.items.map((run) => {
          const updated = latest.get(run.id)
          return updated && updated !== summaries.get(run.id) ? updated : run
        })
        return { ...current, data: { ...current.data, runs: { status: "ready", value: { ...result, items } } } }
      })
    } catch (error) {
      updateReady(setState, request, generation, repository, (current) => ({
        ...current,
        data: { ...current.data, runs: failedResource(error, current.data.runs.value) },
      }))
    }
  }

  let workCountsGeneration = 0
  const fetchWorkCounts = async (repository: string, request: number) => {
    const countRequest = ++workCountsGeneration
    try {
      const value = await loaders.workCounts(repository)
      updateReady(setState, request, generation, repository, (current) => countRequest !== workCountsGeneration ? current : ({
        ...current, data: { ...current.data, workCounts: { status: "ready", value } },
      }))
    } catch (error) {
      updateReady(setState, request, generation, repository, (current) => countRequest !== workCountsGeneration ? current : ({
        ...current, data: { ...current.data, workCounts: failedResource(error, current.data.workCounts.value) },
      }))
    }
  }

  const loadResources = async (
    repository: string,
    branch: string,
    repo: Repo,
    request: number,
    previous?: RepositoryData,
  ) => {
    await Promise.all([
      fetchWorkCounts(repository, request),
      fetchDocuments(repository, repo, branch, request),
      fetchBranches(repository, repo.defaultBranch, request, previous?.branches.value?.page),
      fetchCommits(repository, branch, request, previous?.commits.value?.page),
      fetchCommitCount(repository, branch, request),
      fetchIssues(repository, "open", request, previous?.issues.open.value?.page),
      fetchIssues(repository, "closed", request, previous?.issues.closed.value?.page),
      fetchPulls(repository, "open", request, previous?.pulls.open.value?.page),
      fetchPulls(repository, "closed", request, previous?.pulls.closed.value?.page),
      fetchRuns(repository, request, previous?.runs.value?.page),
    ])
  }

  const retainRun = (detail: RunDetailState | undefined, fresh: boolean) => {
    const current = state()
    if (!detail || current.status !== "ready") return
    const key = `${current.repository.toLowerCase()}:run:${detail.id}`
    const resource = settled(detail.resource)
    if (resource?.status !== "ready") { runCache.markStale(key); return }
    const jobs = settled(detail.jobs) ?? { status: "error" as const, phase: "load" as const, message: "Loading was interrupted; refresh to retry." }
    // Unfinished runs change constantly; keep them reusable but always revalidate.
    const whole = jobs.status === "ready" && resource.value.status === "completed"
    runCache.set(key, { id: detail.id, resource, jobs }, fresh && whole)
    if (!whole) runCache.markStale(key)
  }
  const clearRun = () => {
    retainRun(runDetail(), false)
    ++runGeneration
    setRunDetail(undefined)
  }

  const loadRun = async (id: number, options: { force?: boolean } = {}) => {
    const current = state()
    let previous = runDetail()
    if (current.status !== "ready" || (previous?.id === id && (previous.resource.status === "loading" || previous.jobs.status === "loading"))) return
    if (previous?.id !== id) {
      if (previous) retainRun(previous, false)
      const cached = runCache.get(`${current.repository.toLowerCase()}:run:${id}`)
      if (cached) {
        previous = cached.value
        ++runGeneration
        setRunDetail(cached.value)
        if (!cached.stale && !options.force) return
      }
    }
    const request = ++runGeneration
    const retained = previous?.id === id ? previous : undefined
    setRunDetail({ id, resource: loadingResource(retained?.resource.value), jobs: loadingResource(retained?.jobs.value) })
    let run: WorkflowRunDetail
    try {
      if (!loaders.run) throw new Error("Workflow run details are unavailable")
      run = await loaders.run(current.repository, id)
      if (request !== runGeneration) return
      setState((latest) => latest.status === "ready" && latest.repository === current.repository && latest.data.runs.value
        ? { ...latest, data: { ...latest.data, runs: { ...latest.data.runs, value: {
          ...latest.data.runs.value,
          items: latest.data.runs.value.items.map((item) => item.id === id ? { ...item,
            name: run.name, title: run.title, status: run.status, conclusion: run.conclusion, createdAt: run.createdAt,
          } : item),
        } } } }
        : latest)
    } catch (error) {
      if (request === runGeneration) setRunDetail({
        id, resource: failedResource(error, retained?.resource.value),
        jobs: retained?.jobs ?? failedResource(error),
      })
      return
    }
    const sameAttempt = retained?.resource.value?.attempt === run.attempt
    const jobs = sameAttempt ? retained?.jobs.value : undefined
    setRunDetail({ id, resource: { status: "ready", value: run }, jobs: loadingResource(jobs) })
    try {
      if (!loaders.runJobs) throw new Error("Workflow jobs are unavailable")
      const value = await loadPageSet(jobs?.page ?? 1,
        (page) => loaders.runJobs!(current.repository, id, run.attempt, page), (job) => job.id)
      if (request === runGeneration) {
        setRunDetail({ id, resource: { status: "ready", value: run }, jobs: { status: "ready", value } })
        retainRun(runDetail(), true)
      }
    } catch (error) {
      if (request === runGeneration) setRunDetail({ id, resource: { status: "ready", value: run }, jobs: failedResource(error, jobs) })
    }
  }

  const loadMoreRunJobs = async () => {
    const current = state()
    const detail = runDetail()
    const run = detail?.resource.value
    const jobs = detail?.jobs.value
    if (current.status !== "ready" || !detail || !run || !jobs?.hasMore
      || detail.resource.status !== "ready" || detail.jobs.status === "loading"
      || (detail.jobs.status === "error" && detail.jobs.phase === "load") || !loaders.runJobs) return
    const request = runGeneration
    setRunDetail({ ...detail, jobs: loadingResource(jobs, "pagination") })
    try {
      const next = await loaders.runJobs(current.repository, detail.id, run.attempt, jobs.page + 1)
      if (request !== runGeneration) return
      const existing = new Set(jobs.items.map((job) => job.id))
      setRunDetail({ ...detail, jobs: { status: "ready", value: {
        ...next, page: jobs.page + 1,
        items: [...jobs.items, ...next.items.filter((job) => !existing.has(job.id))],
      } } })
    } catch (error) {
      if (request === runGeneration) setRunDetail({ ...detail, jobs: failedResource(error, jobs, "pagination") })
    }
  }

  const retainCommit = (detail: CommitDetailState | undefined) => {
    const current = state()
    if (!detail || current.status !== "ready") return
    const resource = settled(detail.resource)
    if (resource?.status !== "ready") return
    commitCache.set(`${current.repository.toLowerCase()}:commit:${detail.sha.toLowerCase()}`, { sha: detail.sha, resource })
  }
  const clearCommit = () => {
    retainCommit(commitDetail())
    ++commitGeneration
    setCommitDetail(undefined)
  }

  const loadCommit = async (sha: string, options: { force?: boolean } = {}) => {
    const current = state()
    let previous = commitDetail()
    if (current.status !== "ready" || (previous?.sha === sha && previous.resource.status === "loading")) return
    if (previous?.sha !== sha) {
      if (previous) retainCommit(previous)
      const cached = commitCache.get(`${current.repository.toLowerCase()}:commit:${sha.toLowerCase()}`)
      if (cached) {
        previous = cached.value
        ++commitGeneration
        setCommitDetail(cached.value)
        if (!cached.stale && !options.force) return
      }
    }
    const repository = current.repository
    const request = ++commitGeneration
    const value = previous?.sha === sha ? previous.resource.value : undefined
    setCommitDetail({ sha, resource: loadingResource(value) })
    try {
      const pages = await Promise.all(Array.from({ length: value?.files.page ?? 1 }, (_, index) =>
        loaders.commit(repository, sha, index + 1)))
      if (request !== commitGeneration) return
      const first = pages[0]!
      const last = pages.at(-1)!
      setCommitDetail({
        sha,
        resource: {
          status: "ready",
          value: {
            ...first,
            files: { ...last.files, items: pages.flatMap((page) => page.files.items) },
            filesTruncated: last.filesTruncated,
          },
        },
      })
      retainCommit(commitDetail())
    } catch (error) {
      if (request === commitGeneration) setCommitDetail({ sha, resource: failedResource(error, value) })
    }
  }

  const loadMoreCommitFiles = async () => {
    const current = state()
    const detail = commitDetail()
    const value = detail?.resource.value
    if (current.status !== "ready" || !detail || !value?.files.hasMore || detail.resource.status === "loading") return
    const { sha } = detail
    const request = commitGeneration
    setCommitDetail({ sha, resource: loadingResource(value, "pagination") })
    try {
      const next = await loaders.commit(current.repository, sha, value.files.page + 1)
      if (request !== commitGeneration) return
      const existing = new Set(value.files.items.map((file) => file.path))
      setCommitDetail({
        sha,
        resource: {
          status: "ready",
          value: {
            ...value,
            files: { ...next.files, items: [...value.files.items, ...next.files.items.filter((file) => !existing.has(file.path))] },
            filesTruncated: next.filesTruncated,
          },
        },
      })
    } catch (error) {
      if (request === commitGeneration) setCommitDetail({ sha, resource: failedResource(error, value, "pagination") })
    }
  }

  const retainPull = (detail: PullDetailState | undefined, fresh: boolean) => {
    const current = state()
    if (!detail || current.status !== "ready") return
    const key = detailCacheKey(current.repository, detail.number, "pull")
    const resource = settled(detail.resource)
    if (resource?.status !== "ready") { pullCache.markStale(key); return }
    const interrupted = <T>(): ResourceState<T> => ({ status: "error", phase: "load", message: "Loading was interrupted; refresh to retry." })
    const snapshot: PullDetailState = { ...detail, resource,
      comments: settled(detail.comments) ?? interrupted(), references: settled(detail.references) ?? interrupted(),
      commits: settled(detail.commits) ?? interrupted(), context: settled(detail.context) ?? interrupted() }
    const whole = complete([snapshot.resource, snapshot.comments, snapshot.references, snapshot.commits, snapshot.context])
    pullCache.set(key, snapshot, fresh && whole)
    if (!whole) pullCache.markStale(key)
  }
  const invalidatePull = (repository: string, number: number) => pullCache.markStale(detailCacheKey(repository, number, "pull"))
  const pendingReactions = (owner: "issue" | "pull") => [...reactionRequests.keys()].some((key) => key.startsWith(`${owner}:`))
  // Leaving a page retains it. A pending reaction can no longer publish into it, so its result arrives on revalidation.
  const leavePull = (detail: PullDetailState | undefined) => {
    retainPull(detail, false)
    const current = state()
    if (detail && pendingReactions("pull") && current.status === "ready") invalidatePull(current.repository, detail.number)
    resetReactionOwner("pull")
  }
  const clearPull = () => {
    leavePull(pullDetail())
    ++pullGeneration
    setPullDetail(undefined)
  }

  const fetchPullComments = async (
    repository: string,
    number: number,
    request: number,
    pageCount: number,
    previous?: Paginated<IssueComment>,
  ) => {
    const revision = reactionRevision
    try {
      const loaded = await loadPageSet(pageCount, (page) => loaders.issueComments(repository, number, page), (comment) => comment.id)
      if (request !== pullGeneration) return
      const value = withCommentReactions("pull", number, withPostedComments(repository, number, loaded, loaded.items, "pull"), revision)
      setPullDetail((current) => current?.number === number
        ? { ...current, comments: { status: "ready", value } } : current)
    } catch (error) {
      if (request !== pullGeneration) return
      setPullDetail((current) => current?.number === number
        ? { ...current, comments: failedResource(error, current.comments.value ?? previous) } : current)
    }
  }

  const fetchPullReferences = async (repository: string, number: number, request: number, previous?: IssueReference[]) => {
    const key = issueKey(repository, number, "pull")
    const revision = pullActionRevision.get(key)
    try {
      const timeline = loaders.issueTimeline
        ? await loaders.issueTimeline(repository, number)
        : { references: await loaders.issueReferences(repository, number), events: [] }
      if (request !== pullGeneration || revision !== pullActionRevision.get(key)) return
      setPullDetail((current) => current?.number === number
        ? { ...current, references: { status: "ready", value: timeline.references }, events: timeline.events } : current)
    } catch (error) {
      if (request !== pullGeneration || revision !== pullActionRevision.get(key)) return
      setPullDetail((current) => current?.number === number ? { ...current, references: failedResource(error, previous) } : current)
    }
  }

  const fetchPullCommits = async (repository: string, number: number, request: number, previous?: CommitSummary[]) => {
    try {
      const value = await loaders.pullCommits(repository, number)
      if (request !== pullGeneration) return
      setPullDetail((current) => current?.number === number ? { ...current, commits: { status: "ready", value } } : current)
    } catch (error) {
      if (request !== pullGeneration) return
      setPullDetail((current) => current?.number === number ? { ...current, commits: failedResource(error, previous) } : current)
    }
  }

  const fetchPullContext = async (repository: string, number: number, request: number, previous?: PullContext) => {
    const revision = reactionRevision
    const draftGeneration = pullDraftGeneration
    try {
      const loaded = await loaders.pullContext(repository, number)
      if (request !== pullGeneration || draftGeneration !== pullDraftGeneration) return
      const current = pullDetail()
      const draft = current?.number === number ? current.resource.value?.draft : undefined
      if (typeof draft === "boolean" && typeof loaded.readiness.isDraft === "boolean" && draft !== loaded.readiness.isDraft)
        throw new Error("Merge readiness does not match the PR stage yet. Refresh the pull request.")
      const value = withThreadReactions(number, loaded, revision)
      setPullDetail((current) => current?.number === number ? { ...current, context: { status: "ready", value } } : current)
    } catch (error) {
      if (request !== pullGeneration || draftGeneration !== pullDraftGeneration) return
      setPullDetail((current) => current?.number === number ? { ...current, context: failedResource(error, current.context.value ?? previous) } : current)
    }
  }

  const retryPullContext = async () => {
    const current = state()
    const detail = pullDetail()
    if (current.status !== "ready" || detail?.resource.status !== "ready" || detail.context.status === "loading") return
    setPullDetail({ ...detail, context: loadingResource(detail.context.value) })
    return fetchPullContext(current.repository, detail.number, pullGeneration, detail.context.value)
  }

  const retryPullCommits = async () => {
    const current = state()
    const detail = pullDetail()
    if (current.status !== "ready" || detail?.resource.status !== "ready" || detail.commits.status === "loading") return
    setPullDetail({ ...detail, commits: loadingResource(detail.commits.value) })
    return fetchPullCommits(current.repository, detail.number, pullGeneration, detail.commits.value)
  }

  const retryPullReferences = async () => {
    const current = state()
    const detail = pullDetail()
    if (current.status !== "ready" || !detail?.resource.value || detail.resource.status === "loading"
      || detail.references.status === "loading") return
    setPullDetail({ ...detail, references: loadingResource(detail.references.value) })
    return fetchPullReferences(current.repository, detail.number, pullGeneration, detail.references.value)
  }

  const loadPull = async (number: number, options: { force?: boolean } = {}) => {
    const current = state()
    let previous = pullDetail()
    if (current.status !== "ready" || (previous?.number === number
      && (previous.resource.status === "loading" || previous.comments.status === "loading"
        || previous.references.status === "loading" || previous.commits.status === "loading" || previous.context.status === "loading"))) return
    if (previous?.number !== number) {
      leavePull(previous)
      const cached = pullCache.get(detailCacheKey(current.repository, number, "pull"))
      if (cached) {
        previous = cached.value
        // Retire any in-flight load for another PR before showing the retained one.
        ++pullGeneration
        setPullDetail(cached.value)
        if (!cached.stale && !options.force) return
      }
    }
    const revision = reactionRevision
    const repository = current.repository
    const request = ++pullGeneration
    const draftGeneration = pullDraftGeneration
    const value = previous?.number === number ? previous.resource.value : undefined
    let comments = previous?.number === number ? previous.comments.value : undefined
    const references = previous?.number === number ? previous.references.value : undefined
    const commits = previous?.number === number ? previous.commits.value : undefined
    let context = previous?.number === number ? previous.context.value : undefined
    const events = previous?.number === number ? previous.events ?? [] : []
    setPullDetail({ number, resource: loadingResource(value), comments: loadingResource(comments),
      references: loadingResource(references), events, commits: loadingResource(commits), context: loadingResource(context) })
    try {
      const key = issueKey(repository, number, "pull")
      let writeRevision = issueWriteRevision.get(key)
      let actionRevision = pullActionRevision.get(key)
      let loaded = await (loaders.pull ?? loadGitHubPull)(repository, number)
      if (request !== pullGeneration || draftGeneration !== pullDraftGeneration) return
      while (actionRevision !== pullActionRevision.get(key)) {
        actionRevision = pullActionRevision.get(key)
        loaded = await (loaders.pull ?? loadGitHubPull)(repository, number)
        if (request !== pullGeneration || draftGeneration !== pullDraftGeneration) return
      }
      // Retain confirmed comment metadata without discarding fresh permissions or PR state.
      while (writeRevision !== issueWriteRevision.get(key)) {
        const confirmed = pullDetail()?.resource.value
        if (confirmed) {
          loaded = { ...loaded, commentCount: Math.max(loaded.commentCount, confirmed.commentCount),
            updatedAt: Date.parse(loaded.updatedAt) >= Date.parse(confirmed.updatedAt) ? loaded.updatedAt : confirmed.updatedAt }
          break
        }
        writeRevision = issueWriteRevision.get(key)
        loaded = await (loaders.pull ?? loadGitHubPull)(repository, number)
        if (request !== pullGeneration) return
      }
      if (value?.nodeId && loaded.nodeId && value.nodeId !== loaded.nodeId) resetReactionOwner("pull")
      const pull = withReactionFields({ kind: "pull", number }, loaded, revision)
      comments = pullDetail()?.comments.value ?? comments
      context = pullDetail()?.context.value ?? context
      const hasComments = pull.commentCount > 0 || (postedComments.get(key)?.length ?? 0) > 0
      setPullDetail({ number, resource: { status: "ready", value: pull },
        comments: !hasComments
          ? { status: "ready", value: { items: [], page: 1, hasMore: false } } : loadingResource(comments),
        references: loadingResource(references), events,
        commits: pull.commitCount === 0 ? { status: "ready", value: [] } : loadingResource(commits), context: loadingResource(context) })
      await Promise.all([
        hasComments ? fetchPullComments(repository, number, request, comments?.page ?? 1, comments) : Promise.resolve(),
        fetchPullReferences(repository, number, request, references),
        pull.commitCount > 0 ? fetchPullCommits(repository, number, request, commits) : Promise.resolve(),
        fetchPullContext(repository, number, request, context),
      ])
      if (request === pullGeneration && draftGeneration === pullDraftGeneration) retainPull(pullDetail(), true)
    } catch (error) {
      if (request === pullGeneration && draftGeneration === pullDraftGeneration) setPullDetail((latest) => ({ number, resource: failedResource(error, latest?.resource.value ?? value),
        comments: previous?.number === number ? { ...previous.comments, ...(latest?.comments.value ? { value: latest.comments.value } : {}) }
          : { status: "ready", value: { items: [], page: 1, hasMore: false } },
        references: previous?.number === number ? previous.references : { status: "ready", value: [] },
        events, commits: previous?.number === number ? previous.commits : { status: "ready", value: [] },
        context: previous?.number === number ? { ...previous.context, ...(latest?.context.value ? { value: latest.context.value } : {}) } : failedResource<PullContext>(error) }))
    }
  }

  const loadMorePullComments = async () => {
    const current = state()
    const detail = pullDetail()
    if (current.status !== "ready" || !detail?.resource.value || detail.resource.status === "loading"
      || detail.comments.status === "loading") return
    const { number } = detail
    const value = detail.comments.value
    const request = pullGeneration
    const revision = reactionRevision
    const reload = value === undefined || (detail.comments.status === "error" && detail.comments.phase === "load")
    if (!reload && !value?.hasMore) return
    setPullDetail({ ...detail, comments: loadingResource(value, reload ? "load" : "pagination") })
    if (reload) return fetchPullComments(current.repository, number, request, value?.page ?? 1, value)
    try {
      const next = await loaders.issueComments(current.repository, number, value!.page + 1)
      if (request !== pullGeneration) return
      setPullDetail((latest) => {
        if (latest?.number !== number) return latest
        const merged = new Map((latest.comments.value?.items ?? value!.items).map((comment) => [comment.id, comment]))
        for (const comment of next.items) merged.set(comment.id, comment)
        return { ...latest, comments: { status: "ready", value: withCommentReactions("pull", number,
          withPostedComments(current.repository, number,
            page({ items: [...merged.values()], hasMore: next.hasMore }, value!.page + 1), next.items, "pull"), revision) } }
      })
    } catch (error) {
      if (request === pullGeneration) setPullDetail((latest) => latest?.number === number
        ? { ...latest, comments: failedResource(error, latest.comments.value ?? value, "pagination") } : latest)
    }
  }

  const retainIssue = (detail: IssueDetailState | undefined, fresh: boolean) => {
    const current = state()
    if (!detail || current.status !== "ready") return
    const key = detailCacheKey(current.repository, detail.number)
    const resource = settled(detail.resource)
    if (resource?.status !== "ready") { issueCache.markStale(key); return }
    const interrupted = <T>(): ResourceState<T> => ({ status: "error", phase: "load", message: "Loading was interrupted; refresh to retry." })
    const snapshot: IssueDetailState = { ...detail, resource,
      comments: settled(detail.comments) ?? interrupted(), references: settled(detail.references) ?? interrupted() }
    const whole = complete([snapshot.resource, snapshot.comments, snapshot.references])
    issueCache.set(key, snapshot, fresh && whole)
    if (!whole) issueCache.markStale(key)
  }
  const leaveIssue = (detail: IssueDetailState | undefined) => {
    retainIssue(detail, false)
    const current = state()
    if (detail && pendingReactions("issue") && current.status === "ready") issueCache.markStale(detailCacheKey(current.repository, detail.number))
    resetReactionOwner("issue")
  }
  const clearIssue = () => {
    leaveIssue(issueDetail())
    ++issueGeneration
    setIssueDetail(undefined)
  }

  // Keep confirmed new comments visible across unloaded pages and refreshes. Once the
  // server returns a comment, it owns that entry again (including later edits/deletion).
  const withPostedComments = (
    repository: string, number: number, value: Paginated<IssueComment>, returned: readonly IssueComment[] = value.items,
    parent: IssueActionParent = "issue",
  ): Paginated<IssueComment> => {
    const key = issueKey(repository, number, parent)
    const ids = new Set(returned.map((comment) => comment.id))
    const missing = (postedComments.get(key) ?? []).filter((comment) => !ids.has(comment.id))
    if (missing.length) postedComments.set(key, missing)
    else postedComments.delete(key)
    const merged = new Map(value.items.map((comment) => [comment.id, comment]))
    for (const comment of missing) if (!merged.has(comment.id)) merged.set(comment.id, comment)
    return { ...value, items: [...merged.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)) }
  }

  const fetchIssueComments = async (
    repository: string,
    number: number,
    request: number,
    pageCount: number,
    previous?: Paginated<IssueComment>,
  ) => {
    const revision = reactionRevision
    try {
      const loaded = await loadPageSet(pageCount, (page) => loaders.issueComments(repository, number, page), (comment) => comment.id)
      if (request !== issueGeneration) return
      const value = withCommentReactions("issue", number, withPostedComments(repository, number, loaded), revision)
      setIssueDetail((current) => current?.number === number
        ? { ...current, comments: { status: "ready", value } } : current)
    } catch (error) {
      if (request !== issueGeneration) return
      setIssueDetail((current) => current?.number === number
        ? { ...current, comments: failedResource(error, current.comments.value ?? previous) } : current)
    }
  }

  const fetchIssueReferences = async (repository: string, number: number, request: number, previous?: IssueReference[]) => {
    const referenceRequest = ++issueReferencesGeneration
    try {
      const timeline = loaders.issueTimeline
        ? await loaders.issueTimeline(repository, number)
        : { references: await loaders.issueReferences(repository, number), events: [] }
      if (request !== issueGeneration || referenceRequest !== issueReferencesGeneration) return
      setIssueDetail((current) => current?.number === number
        ? { ...current, references: { status: "ready", value: timeline.references }, events: timeline.events } : current)
    } catch (error) {
      if (request !== issueGeneration || referenceRequest !== issueReferencesGeneration) return
      setIssueDetail((current) => current?.number === number ? { ...current, references: failedResource(error, previous) } : current)
    }
  }

  const retryIssueReferences = async () => {
    const current = state()
    const detail = issueDetail()
    if (current.status !== "ready" || !detail?.resource.value || detail.resource.status === "loading"
      || detail.references.status === "loading") return
    setIssueDetail({ ...detail, references: loadingResource(detail.references.value) })
    return fetchIssueReferences(current.repository, detail.number, issueGeneration, detail.references.value)
  }

  const loadIssue = async (number: number, options: { force?: boolean } = {}) => {
    const current = state()
    let previous = issueDetail()
    if (current.status !== "ready" || (previous?.number === number
      && (previous.resource.status === "loading" || previous.comments.status === "loading" || previous.references.status === "loading"))) return
    if (previous?.number !== number) {
      leaveIssue(previous)
      const cached = issueCache.get(detailCacheKey(current.repository, number))
      if (cached) {
        previous = cached.value
        ++issueGeneration
        setIssueDetail(cached.value)
        if (!cached.stale && !options.force) return
      }
    }
    const reactionRead = reactionRevision
    const repository = current.repository
    const request = ++issueGeneration
    const value = previous?.number === number ? previous.resource.value : undefined
    let comments = previous?.number === number ? previous.comments.value : undefined
    const references = previous?.number === number ? previous.references.value : undefined
    let events = previous?.number === number ? previous.events ?? [] : []
    setIssueDetail({ number, resource: loadingResource(value), comments: loadingResource(comments), references: loadingResource(references), events })
    try {
      const key = issueKey(repository, number)
      let revision = issueWriteRevision.get(key)
      let issue = await loaders.issue(repository, number)
      if (request !== issueGeneration) return
      // A confirmed write must not be overwritten by an earlier read response.
      while (revision !== issueWriteRevision.get(key)) {
        const confirmed = issueDetail()?.resource.value
        if (confirmed) { issue = confirmed; break }
        revision = issueWriteRevision.get(key)
        issue = await loaders.issue(repository, number)
        if (request !== issueGeneration) return
      }
      if (value?.nodeId && issue.nodeId && value.nodeId !== issue.nodeId) resetReactionOwner("issue")
      issue = withReactionFields({ kind: "issue", number }, issue, reactionRead)
      comments = issueDetail()?.comments.value ?? comments
      events = issueDetail()?.events ?? events
      setIssueDetail({ number, resource: { status: "ready", value: issue }, comments: loadingResource(comments), references: loadingResource(references), events })
      const hasComments = issue.commentCount > 0 || (postedComments.get(issueKey(repository, number))?.length ?? 0) > 0
      if (!hasComments) {
        setIssueDetail({ number, resource: { status: "ready", value: issue },
          comments: { status: "ready", value: { items: [], page: 1, hasMore: false } }, references: loadingResource(references), events })
      }
      await Promise.all([
        hasComments ? fetchIssueComments(repository, number, request, comments?.page ?? 1, comments) : Promise.resolve(),
        fetchIssueReferences(repository, number, request, references),
      ])
      if (request === issueGeneration) retainIssue(issueDetail(), true)
    } catch (error) {
      if (request === issueGeneration) setIssueDetail((latest) => ({ number, resource: failedResource(error, latest?.resource.value ?? value),
        comments: previous?.number === number ? { ...previous.comments, ...(latest?.comments.value ? { value: latest.comments.value } : {}) }
          : { status: "ready", value: latest?.comments.value ?? { items: [], page: 1, hasMore: false } },
        references: previous?.number === number ? previous.references : { status: "ready", value: [] },
        events: latest?.events ?? events }))
    }
  }

  const loadMoreIssueComments = async () => {
    const current = state()
    const detail = issueDetail()
    if (current.status !== "ready" || !detail?.resource.value || detail.resource.status === "loading"
      || detail.comments.status === "loading") return
    const { number } = detail
    const value = detail.comments.value
    const request = issueGeneration
    const revision = reactionRevision
    const reload = value === undefined || (detail.comments.status === "error" && detail.comments.phase === "load")
    if (!reload && !value?.hasMore) return
    setIssueDetail({ ...detail, comments: loadingResource(value, reload ? "load" : "pagination") })
    if (reload) return fetchIssueComments(current.repository, number, request, value?.page ?? 1, value)
    try {
      const next = await loaders.issueComments(current.repository, number, value!.page + 1)
      if (request !== issueGeneration) return
      setIssueDetail((latest) => {
        if (latest?.number !== number) return latest
        const existing = latest.comments.value?.items ?? value!.items
        const merged = new Map(existing.map((comment) => [comment.id, comment]))
        for (const comment of next.items) merged.set(comment.id, comment)
        return {
          ...latest,
          comments: { status: "ready", value: withCommentReactions("issue", number, withPostedComments(current.repository, number,
            page({ items: [...merged.values()], hasMore: next.hasMore }, value!.page + 1), next.items), revision) },
        }
      })
    } catch (error) {
      if (request === issueGeneration) setIssueDetail((latest) => latest?.number === number
        ? { ...latest, comments: failedResource(error, latest.comments.value ?? value, "pagination") } : latest)
    }
  }

  // Repository-keyed resources retain pages and in-flight requests across picker opens.
  const [assignableUserCache, setAssignableUserCache] = createSignal<Record<string, ResourceState<Paginated<string>>>>({})
  const assignableUsers = () => assignableUserCache()[state().repository.toLowerCase()]
  const loadAssignableUsers = async () => {
    const current = state()
    if (current.status !== "ready") return
    const repository = current.repository
    const key = repository.toLowerCase()
    const previous = assignableUserCache()[key]
    if (previous?.status === "loading" || (previous?.value && !previous.value.hasMore)) return
    const value = previous?.value
    const nextPage = (value?.page ?? 0) + 1
    const phase = value ? "pagination" : "load"
    const store = (resource: ResourceState<Paginated<string>>) =>
      setAssignableUserCache((cache) => ({ ...cache, [key]: resource }))
    const pending = loadingResource(value, phase)
    store(pending)
    const finish = (resource: ResourceState<Paginated<string>>) => {
      // A repository refresh invalidates this request along with its cached pages.
      if (assignableUserCache()[key] === pending) store(resource)
    }
    try {
      if (!loaders.assignableUsers) throw new Error("Assignable users are unavailable.")
      const next = await loaders.assignableUsers(repository, nextPage)
      const seen = new Set<string>()
      const items = [...(value?.items ?? []), ...next.items].filter((login) => {
        const key = login.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      finish({ status: "ready", value: { items, page: nextPage, hasMore: next.hasMore } })
    } catch (error) {
      finish(failedResource(error, value, phase))
    }
  }

  const issueAction = (number: number, parent: IssueActionParent = "issue") => issueActions()[issueKey(state().repository, number, parent)] ?? emptyIssueAction
  const updateAction = (key: string, update: (action: IssueActionState) => IssueActionState, confirmed = false) => {
    setIssueActions((actions) => {
      const action = update(actions[key] ?? emptyIssueAction)
      saveDraft(key, action)
      return { ...actions, [key]: action }
    })
    // Persist the cleared text/retry marker before any second GitHub write or UI work.
    if (confirmed) flushDrafts()
  }
  const prepareIssueAction = (number: number, kind: IssueActionKind, parent: IssueActionParent = "issue") => {
    if (parent === "pull" && kind === "duplicate") throw new Error("Pull requests cannot be marked as duplicates.")
    const key = issueKey(state().repository, number, parent)
    const current = issueActions()[key]
    if (draftStore && current?.operation.status !== "loading" && (kind === "comment" || kind === "close" || kind === "reopen")) {
      const previousKind = activeDraftKinds.get(key)
      if (previousKind !== kind) {
        if (previousKind && current) saveDraft(key, current)
        const draftKey = `${key}:${kind}`
        let draft = savedDrafts.get(draftKey)
        // Callers may already have edited the current draft before first prepare.
        // Never replace such edits with a lazy disk restore.
        const hasEdits = !previousKind && current && unpreparedDraftEdits.has(key)
        if (!draft && hasEdits) draft = draftSnapshot(current)
        if (!draft) {
          try {
            draft = draftStore.load(draftKey)
            draftErrors.delete(`load:${draftKey}`)
          } catch (error) {
            draftErrors.set(`load:${draftKey}`, `Draft load failed: ${messageFrom(error)}`)
          }
          publishDraftError()
        }
        activeDraftKinds.set(key, kind)
        const restored = { ...emptyIssueAction, ...draft, selectedAssignees: current?.selectedAssignees, duplicateTarget: current?.duplicateTarget }
        setIssueActions((actions) => ({ ...actions, [key]: restored }))
        if (hasEdits) saveDraft(key, restored)
        else savedDrafts.set(draftKey, draftSnapshot(restored))
        unpreparedDraftEdits.delete(key)
      }
    }
    updateAction(key, (action) => {
      if (action.operation.status === "loading" || action.retry === kind) return action
      // Selecting a new action must not resume a different failed state change.
      const detail = parent === "pull" ? pullDetail() : issueDetail()
      const issue = detail?.number === number ? detail.resource.value : undefined
      const selectedAssignees = issue && kind === "assignees" ? [...issue.assignees] : action.selectedAssignees
      return { ...action, selectedAssignees, retry: draftStore ? action.retry : undefined, operation: idle() }
    })
    if (kind === "assignees" && !assignableUsers()) void loadAssignableUsers()
  }
  const updateIssueDraft = (number: number, draft: Partial<Pick<IssueActionState, "body" | "reason" | "duplicateTarget" | "selectedAssignees">>, parent: IssueActionParent = "issue") => {
    const key = issueKey(state().repository, number, parent)
    updateAction(key, (action) => {
      if (action.operation.status === "loading" || action.retry) return action
      if (!activeDraftKinds.has(key) && (draft.body !== undefined || draft.reason !== undefined)) unpreparedDraftEdits.add(key)
      return { ...action, ...draft, operation: idle() }
    })
  }
  const discardIssueDraft = (number: number, parent: IssueActionParent = "issue") => {
    updateAction(issueKey(state().repository, number, parent), (action) => action.operation.status === "loading" ? action : emptyIssueAction)
    flushDrafts()
  }

  const actionError = (error: unknown, locked: boolean, subject = "issue") => {
    const message = messageFrom(error)
    if (!(error instanceof GitHubApiError)) return message
    if (error.status === 403 && locked) return `${message}. This thread is locked; maintainer access may be required.`
    if (error.status === 404) return `${message}. The ${subject} may be unavailable to your account.`
    if (error.status === undefined || error.status >= 500)
      return `${message}. GitHub did not confirm the change; check the ${subject} on GitHub before retrying.`
    return message
  }

  const reconcileIssueState = (repository: string, number: number, updated: IssueDetail, scope: number, reactionRead: number) => {
    confirmIssueWrite(issueKey(repository, number))
    const stillHere = () => scope === repositoryScope && state().repository === repository
    if (!stillHere()) return updated
    updated = withReactionFields({ kind: "issue", number }, updated, reactionRead)
    setIssueDetail((latest) => latest?.number === number
      ? { ...latest, resource: { status: "ready", value: updated }, references: loadingResource(latest.references.value) } : latest)
    if (issueDetail()?.number === number) {
      // Refresh state events without clearing the existing timeline or treating a read failure as a failed write.
      void fetchIssueReferences(repository, number, issueGeneration, issueDetail()?.references.value)
    }
    setState((latest) => {
      if (latest.status !== "ready" || latest.repository !== repository) return latest
      const lists = { ...latest.data.issues }
      for (const listState of ["open", "closed"] as const) {
        const resource = lists[listState]
        if (!resource.value) continue
        const items = resource.value.items.filter((item) => item.number !== number)
        if (listState === updated.state) {
          const { title, author, createdAt, state } = updated
          items.push({ number, title, author, createdAt, state })
          items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        }
        lists[listState] = loadingResource({ ...resource.value, items })
      }
      return { ...latest, data: { ...latest.data, issues: lists } }
    })
    // Writes succeeded; any refresh failure is a separate read error, not a failed write.
    const latest = state()
    if (latest.status === "ready") {
      const request = repositoryGeneration
      void fetchIssues(repository, "open", request, latest.data.issues.open.value?.page)
      void fetchIssues(repository, "closed", request, latest.data.issues.closed.value?.page)
      void fetchWorkCounts(repository, request)
      void loaders.metadata(repository).then((repo) => {
        if (stillHere()) updateReady(setState, request, generation, repository, (state) => ({
          ...state, data: { ...state.data, repo },
        }))
      }).catch(() => {})
    }
    return updated
  }

  const submitPullComment = async (number: number): Promise<IssueActionResult> => {
    const current = state()
    const detail = pullDetail()
    const pull = detail?.resource.value
    if (current.status !== "ready" || detail?.number !== number || !pull || detail.resource.status === "loading")
      throw new Error("Wait for the pull request to load before commenting.")
    const repository = current.repository
    const key = issueKey(repository, number, "pull")
    const action = issueActions()[key] ?? emptyIssueAction
    if (action.operation.status === "loading") throw new Error("A pull request action is already in progress.")
    const scope = repositoryScope
    const stillHere = () => scope === repositoryScope && state().repository === repository
    updateAction(key, (draft) => ({ ...draft, operation: loading() }))
    try {
      if (!pull.permissions?.comment) throw new Error("You do not have permission to comment on this pull request.")
      if (!action.body.trim()) throw new Error("Write a comment before posting.")
      if (!loaders.createIssueComment) throw new Error("Commenting is unavailable.")
      const comment = await loaders.createIssueComment(repository, number, action.body)
      confirmIssueWrite(key)
      postedComments.set(key, [...(postedComments.get(key) ?? []), comment])
      // Settle the original repository's draft even after navigating away.
      updateAction(key, (draft) => ({ ...draft, body: "", operation: idle() }), true)
      if (stillHere()) {
        setPullDetail((latest) => {
          if (latest?.number !== number) return latest
          const comments = latest.comments.value ?? { items: [], page: 0, hasMore: true }
          const items = [...comments.items.filter((item) => item.id !== comment.id), comment]
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          return {
            ...latest,
            resource: latest.resource.value ? { ...latest.resource, value: {
              ...latest.resource.value, commentCount: Math.max(latest.resource.value.commentCount, pull.commentCount + 1),
              updatedAt: Date.parse(latest.resource.value.updatedAt) >= Date.parse(comment.createdAt) ? latest.resource.value.updatedAt : comment.createdAt,
            } } : latest.resource,
            comments: { ...latest.comments, value: { ...comments, items } },
          }
        })
      }
      return { comment }
    } catch (error) {
      const message = actionError(error, pull.locked ?? false, "pull request")
      updateAction(key, (draft) => ({ ...draft, operation: { status: "error", message } }))
      throw new Error(message)
    }
  }

  const reconcilePullState = (repository: string, number: number, updated: PullRequestDetail, scope: number, reactionRead: number) => {
    const key = issueKey(repository, number, "pull")
    confirmIssueWrite(key)
    pullActionRevision.set(key, (pullActionRevision.get(key) ?? 0) + 1)
    if (scope !== repositoryScope || state().repository !== repository) return updated
    updated = withReactionFields({ kind: "pull", number }, updated, reactionRead)
    setPullDetail((latest) => latest?.number === number
      ? { ...latest, resource: { status: "ready", value: updated }, references: loadingResource(latest.references.value) } : latest)
    if (pullDetail()?.number === number)
      void fetchPullReferences(repository, number, pullGeneration, pullDetail()?.references.value)
    setState((latest) => {
      if (latest.status !== "ready" || latest.repository !== repository) return latest
      const lists = { ...latest.data.pulls }
      for (const listState of ["open", "closed"] as const) {
        const resource = lists[listState]
        if (!resource.value) continue
        const items = resource.value.items.filter((item) => item.number !== number)
        if (listState === updated.state) {
          const { title, author, createdAt, state, merged, draft } = updated
          items.push({ number, title, author, createdAt, state, merged, draft })
          items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        }
        lists[listState] = loadingResource({ ...resource.value, items })
      }
      return { ...latest, data: { ...latest.data, pulls: lists } }
    })
    const latest = state()
    if (latest.status === "ready") {
      void fetchPulls(repository, "open", repositoryGeneration, latest.data.pulls.open.value?.page)
      void fetchPulls(repository, "closed", repositoryGeneration, latest.data.pulls.closed.value?.page)
      void fetchWorkCounts(repository, repositoryGeneration)
    }
    return updated
  }

  const updatePullDraft = async (number: number, draft: boolean): Promise<PullRequestDetail> => {
    const current = state()
    const detail = pullDetail()
    const pull = detail?.resource.value
    if (current.status !== "ready" || detail?.number !== number || !pull || detail.resource.status !== "ready")
      throw new Error("Reload the pull request successfully before changing its stage.")
    const repository = current.repository
    const key = issueKey(repository, number, "pull")
    const action = issueActions()[key] ?? emptyIssueAction
    if (action.operation.status === "loading") throw new Error("A pull request action is already in progress.")
    if (action.retry) throw new Error("Retry or discard the pending action first.")
    const scope = repositoryScope
    const reactionRead = reactionRevision
    updateAction(key, value => ({ ...value, operation: loading() }))
    try {
      if (typeof draft !== "boolean" || pull.state !== "open" || pull.merged || pull.draft !== !draft)
        throw new Error("Pull request stage changed; refresh before trying again.")
      if (pull.permissions?.[draft ? "markDraft" : "markReady"] !== true)
        throw new Error("You do not have permission to change this pull request's stage.")
      if (!loaders.updatePullDraft) throw new Error("Pull request draft changes are unavailable.")
      const loaded = await loaders.updatePullDraft(repository, number, draft)
      if (loaded.number !== number || loaded.draft !== draft || loaded.state !== "open" || loaded.merged
        || pull.nodeId !== undefined && loaded.nodeId !== pull.nodeId)
        throw new Error("GitHub did not confirm the draft change. Check GitHub before retrying.")
      const here = scope === repositoryScope && state().repository === repository
      // Draft transitions invalidate context even when the head commit is unchanged.
      if (here && pullDetail()?.number === number) ++pullDraftGeneration
      const updated = reconcilePullState(repository, number, loaded, scope, reactionRead)
      if (here && pullDetail()?.number === number) {
        const request = pullGeneration
        const generation = pullDraftGeneration
        const revision = pullActionRevision.get(key)
        setPullDetail(latest => latest?.number === number ? { ...latest, context: loadingResource<PullContext>() } : latest)
        void fetchPullContext(repository, number, request)
        // Refresh capabilities, but never replace a confirmed stage with an eventually-consistent read.
        void (async () => {
          try {
            const fresh = await (loaders.pull ?? loadGitHubPull)(repository, number)
            if (scope !== repositoryScope || request !== pullGeneration || generation !== pullDraftGeneration
              || revision !== pullActionRevision.get(key) || fresh.number !== number || fresh.nodeId !== loaded.nodeId
              || fresh.draft !== draft || fresh.state !== loaded.state || fresh.merged !== loaded.merged
              || fresh.headSha !== loaded.headSha) return
            setPullDetail(latest => latest?.number === number && latest.resource.value ? { ...latest,
              resource: { ...latest.resource, value: { ...latest.resource.value, permissions: fresh.permissions, merge: fresh.merge } } } : latest)
          } catch {
            // The confirmed transition remains successful when capability refresh is unavailable.
          }
        })()
        // An overlapping full refresh may have been invalidated before starting these resources.
        const latest = pullDetail()
        if (latest?.comments.status === "loading") void fetchPullComments(repository, number, request, latest.comments.value?.page ?? 1, latest.comments.value)
        if (latest?.commits.status === "loading") void fetchPullCommits(repository, number, request, latest.commits.value)
      }
      updateAction(key, value => ({ ...value, operation: idle() }))
      return updated
    } catch (error) {
      const message = actionError(error, pull.locked ?? false, "pull request")
      updateAction(key, value => ({ ...value, operation: { status: "error", message } }))
      throw new Error(message)
    }
  }

  const loadPullMergeMessage = async (number: number, expectedHeadSha: string): Promise<PullMergeDraft> => {
    const current = state()
    const detail = pullDetail()
    if (current.status !== "ready" || detail?.number !== number || detail.resource.status !== "ready"
      || detail.resource.value.number !== number)
      throw new Error("Reload the pull request successfully before editing its merge message.")
    const key = issueKey(current.repository, number, "pull")
    const action = issueActions()[key] ?? emptyIssueAction
    if (action.operation.status === "loading") throw new Error("A pull request action is already in progress.")
    if (!/^[a-f\d]{40}$/i.test(expectedHeadSha) || detail.resource.value.headSha !== expectedHeadSha)
      throw new Error("Head changed; refresh the pull request before merging.")
    if (!loaders.pullMergeMessage) throw new Error("Pull request merge messages are unavailable.")
    const scope = repositoryScope
    const revision = pullActionRevision.get(key)
    const message = await loaders.pullMergeMessage(current.repository, number, expectedHeadSha)
    const latest = pullDetail()
    if (scope !== repositoryScope || state().repository !== current.repository
      || latest?.number !== number || latest.resource.status !== "ready"
      || revision !== pullActionRevision.get(key))
      throw new Error("Pull request changed while loading the merge message. Try again.")
    const saved = issueActions()[key] ?? emptyIssueAction
    if (saved.operation.status === "loading") throw new Error("A pull request action is already in progress.")
    if (latest.resource.value.headSha !== expectedHeadSha)
      throw new Error("Head changed; refresh the pull request before merging.")
    return { ...message, headSha: expectedHeadSha }
  }

  const mergePull = async (number: number, method: PullMergeMethod, expectedHeadSha: string, message?: PullMergeMessage): Promise<PullRequestDetail> => {
    const current = state()
    const detail = pullDetail()
    const pull = detail?.resource.value
    if (current.status !== "ready" || detail?.number !== number || !pull || detail.resource.status !== "ready")
      throw new Error("Reload the pull request successfully before merging.")
    const repository = current.repository
    const key = issueKey(repository, number, "pull")
    const action = issueActions()[key] ?? emptyIssueAction
    if (action.operation.status === "loading") throw new Error("A pull request action is already in progress.")
    if (action.retry) throw new Error("Retry or discard the pending action first.")
    const scope = repositoryScope
    const reactionRead = reactionRevision
    updateAction(key, draft => ({ ...draft, operation: loading() }))
    try {
      const blocker = pullMergeBlocker(pull, detail.context.status === "ready" ? detail.context.value : undefined)
      if (blocker) throw new Error(blocker)
      if (pull.headSha !== expectedHeadSha) throw new Error("Head changed; refresh the pull request before merging.")
      if (!pull.merge?.methods.includes(method)) throw new Error("The selected merge method is not enabled.")
      if (!loaders.mergePull) throw new Error("Pull request merging is unavailable.")
      if (message !== undefined) {
        if (method !== "squash") throw new Error("Custom commit messages are only supported for squash merges.")
        if (typeof message?.headline !== "string" || !message.headline.trim() || /[\r\n]/.test(message.headline))
          throw new Error("Commit headline must be nonblank and single-line.")
        if (typeof message.body !== "string") throw new Error("Commit body must be text.")
      }
      const loaded = await loaders.mergePull(repository, number, method, expectedHeadSha, message)
      if (loaded.number !== number || !loaded.merged || loaded.state !== "closed" || loaded.headSha !== expectedHeadSha
        || pull.nodeId !== undefined && loaded.nodeId !== pull.nodeId)
        throw new Error("GitHub did not confirm the merge. Check GitHub before retrying.")
      const updated = reconcilePullState(repository, number, loaded, scope, reactionRead)
      // Merge is independent of the comment/assignee drafts.
      updateAction(key, draft => ({ ...draft, operation: idle() }))
      return updated
    } catch (error) {
      const message = actionError(error, pull.locked ?? false, "pull request")
      updateAction(key, draft => ({ ...draft, operation: { status: "error", message } }))
      if (scope === repositoryScope && state().repository === repository && pullDetail()?.number === number)
        void loadPull(number)
      throw new Error(message)
    }
  }

  const submitPullAction = async (number: number, kind: "close" | "reopen" | "assignees"): Promise<IssueActionResult> => {
    const current = state()
    const detail = pullDetail()
    const pull = detail?.resource.value
    if (current.status !== "ready" || detail?.number !== number || !pull || detail.resource.status !== "ready")
      throw new Error("Reload the pull request successfully before taking action.")
    const repository = current.repository
    const key = issueKey(repository, number, "pull")
    const action = issueActions()[key] ?? emptyIssueAction
    if (action.operation.status === "loading") throw new Error("A pull request action is already in progress.")
    if (action.retry && action.retry !== kind) throw new Error("Retry or discard the pending action first.")
    const scope = repositoryScope
    const result: IssueActionResult = {}
    updateAction(key, (draft) => ({ ...draft, operation: loading() }))
    try {
      if (pull.merged && kind !== "assignees") throw new Error("Merged pull requests cannot be closed or reopened.")
      if (!pull.permissions?.[kind]) throw new Error("You do not have permission to perform this pull request action.")
      if (kind === "assignees") {
        if (!loaders.setIssueAssignees) throw new Error("Assigning pull requests is unavailable.")
        if (!action.selectedAssignees) throw new Error("Open the assignee picker before saving.")
        const allowed = new Set([...pull.assignees, ...(assignableUsers()?.value?.items ?? [])].map((login) => login.toLowerCase()))
        if (action.selectedAssignees.some((login) => !allowed.has(login.toLowerCase())))
          throw new Error("Select assignees from the suggested users.")
        const seen = new Set<string>()
        const selected = action.selectedAssignees.filter((login) => {
          const key = login.toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        if (selected.length > 10) throw new Error("A pull request can have at most 10 assignees.")
        const reactionRead = reactionRevision
        const loaded = await loaders.setIssueAssignees(repository, number, selected)
        const confirmed = new Set(loaded.assignees.map((login) => login.toLowerCase()))
        if (loaded.number !== number || confirmed.size !== selected.length || selected.some((login) => !confirmed.has(login.toLowerCase())))
          throw new Error("GitHub did not confirm the requested assignees.")
        // The issues endpoint cannot supply PR-specific fields or permissions.
        const latest = scope === repositoryScope && state().repository === repository && pullDetail()?.number === number
          ? pullDetail()?.resource.value ?? pull : pull
        const updated = reconcilePullState(repository, number, { ...latest, assignees: loaded.assignees, updatedAt: loaded.updatedAt }, scope, reactionRead)
        updateAction(key, (draft) => ({ ...draft, selectedAssignees: undefined, operation: idle() }))
        return { pull: updated }
      }
      if (!loaders.updatePullState) throw new Error("Pull request state changes are unavailable.")
      if (!action.retry && action.body.trim()) {
        if (!pull.permissions.comment) throw new Error("You do not have permission to comment on this pull request.")
        if (!loaders.createIssueComment) throw new Error("Commenting is unavailable.")
        const comment = await loaders.createIssueComment(repository, number, action.body)
        result.comment = comment
        confirmIssueWrite(key)
        postedComments.set(key, [...(postedComments.get(key) ?? []), comment])
        updateAction(key, (draft) => ({ ...draft, body: "", retry: kind }), true)
        if (scope === repositoryScope && state().repository === repository) setPullDetail((latest) => {
          if (latest?.number !== number) return latest
          const comments = latest.comments.value ?? { items: [], page: 0, hasMore: true }
          const items = [...comments.items.filter((item) => item.id !== comment.id), comment]
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          return {
            ...latest,
            resource: latest.resource.value ? { ...latest.resource, value: {
              ...latest.resource.value, commentCount: Math.max(latest.resource.value.commentCount, pull.commentCount + 1),
              updatedAt: Date.parse(latest.resource.value.updatedAt) >= Date.parse(comment.createdAt) ? latest.resource.value.updatedAt : comment.createdAt,
            } } : latest.resource,
            comments: { ...latest.comments, value: { ...comments, items } },
          }
        })
      }
      const nextState = kind === "close" ? "closed" : "open"
      const reactionRead = reactionRevision
      const loaded = await loaders.updatePullState(repository, number, nextState)
      if (loaded.number !== number || loaded.state !== nextState || loaded.merged)
        throw new Error("GitHub did not confirm the requested pull request state.")
      const latest = scope === repositoryScope && state().repository === repository && pullDetail()?.number === number
        ? pullDetail()?.resource.value : undefined
      const previous = latest ?? pull
      result.pull = reconcilePullState(repository, number, { ...loaded,
        reactions: loaded.reactions ?? previous.reactions,
        viewerReactions: loaded.viewerReactions ?? previous.viewerReactions,
        canReact: loaded.canReact ?? previous.canReact,
        commentCount: Math.max(loaded.commentCount, previous.commentCount),
        updatedAt: Date.parse(loaded.updatedAt) >= Date.parse(previous.updatedAt) ? loaded.updatedAt : previous.updatedAt,
      }, scope, reactionRead)
      updateAction(key, () => emptyIssueAction, true)
      return result
    } catch (error) {
      const retry = issueActions()[key]?.retry
      const failure = actionError(error, pull.locked ?? false, "pull request")
      const message = retry ? `Comment posted, but ${retry === "close" ? "closing" : "reopening"} failed. ${failure}` : failure
      updateAction(key, (draft) => ({ ...draft, operation: { status: "error", message } }))
      throw new Error(message)
    }
  }

  const submitIssueAction = async (number: number, kind: IssueActionKind, parent: IssueActionParent = "issue"): Promise<IssueActionResult> => {
    if (parent === "pull") {
      if (kind === "duplicate") throw new Error("Pull requests cannot be marked as duplicates.")
      if (kind === "comment") {
        if (issueAction(number, "pull").retry) throw new Error("Retry or discard the pending action first.")
        return submitPullComment(number)
      }
      return submitPullAction(number, kind)
    }
    const current = state()
    const detail = issueDetail()
    const issue = detail?.resource.value
    if (current.status !== "ready" || detail?.number !== number || !issue || detail.resource.status !== "ready")
      throw new Error("Reload the issue successfully before taking action.")
    const repository = current.repository
    const key = issueKey(repository, number)
    const action = issueActions()[key] ?? emptyIssueAction
    if (action.operation.status === "loading") throw new Error("An issue action is already in progress.")
    if (action.retry && action.retry !== kind) throw new Error(`Retry ${action.retry === "close" ? "closing" : "reopening"} or discard the pending action first.`)
    const scope = repositoryScope
    const result: IssueActionResult = {}
    const stillHere = () => scope === repositoryScope && state().repository === repository
    updateAction(key, (draft) => ({ ...draft, operation: loading() }))
    try {
      if (!issue.permissions?.[kind]) throw new Error("You do not have permission to perform this issue action.")
      if (kind === "assignees") {
        if (!loaders.setIssueAssignees) throw new Error("Assigning issues is unavailable.")
        if (!action.selectedAssignees) throw new Error("Open the assignee picker before saving.")
        const candidates = [...issue.assignees, ...(assignableUsers()?.value?.items ?? [])]
        const allowed = new Set(candidates.map((login) => login.toLowerCase()))
        if (action.selectedAssignees.some((login) => !allowed.has(login.toLowerCase())))
          throw new Error("Select assignees from the suggested users.")
        const seen = new Set<string>()
        const selected = action.selectedAssignees.filter((login) => {
          const key = login.toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        if (selected.length > 10) throw new Error("An issue can have at most 10 assignees.")
        const reactionRead = reactionRevision
        const loaded = await loaders.setIssueAssignees(repository, number, selected)
        if (loaded.number !== number) throw new Error("GitHub returned a different issue.")
        const updated = reconcileIssueState(repository, number, loaded, scope, reactionRead)
        // Assignment never posts or discards the independent comment draft.
        updateAction(key, (draft) => ({ ...draft, selectedAssignees: undefined, operation: idle() }))
        return { issue: updated }
      }
      if (!action.retry && kind !== "duplicate" && action.body.trim() && !issue.permissions.comment)
        throw new Error("You do not have permission to comment on this issue.")
      if (kind === "duplicate") {
        if (issue.state !== "open") throw new Error("Reopen the issue before marking it as a duplicate.")
        const match = action.duplicateTarget?.trim().match(/^#?([1-9]\d*)$/)
        const canonicalNumber = Number(match?.[1])
        if (!Number.isSafeInteger(canonicalNumber) || canonicalNumber <= 0) throw new Error("Enter a valid target issue number.")
        if (canonicalNumber === number) throw new Error("An issue cannot be a duplicate of itself.")
        if (!loaders.markIssueDuplicate) throw new Error("Marking duplicates is unavailable.")
        const reactionRead = reactionRevision
        const loaded = await loaders.markIssueDuplicate(repository, number, canonicalNumber)
        if (loaded.number !== number || loaded.state !== "closed" || loaded.stateReason !== "duplicate")
          throw new Error("GitHub did not confirm that this issue was closed as a duplicate.")
        const updated = reconcileIssueState(repository, number, loaded, scope, reactionRead)
        // Duplicate marking must not post or discard an unrelated comment draft.
        updateAction(key, (draft) => ({ ...draft, duplicateTarget: "", operation: idle() }))
        return { issue: updated, duplicateOf: canonicalNumber }
      }
      if (kind === "comment" && !action.body.trim()) throw new Error("Write a comment before posting.")
      if (kind !== "comment" && !loaders.updateIssueState) throw new Error("Issue state changes are unavailable.")
      if (!action.retry && action.body.trim()) {
        if (!loaders.createIssueComment) throw new Error("Commenting is unavailable.")
        const comment = await loaders.createIssueComment(repository, number, action.body)
        result.comment = comment
        confirmIssueWrite(key)
        postedComments.set(key, [...(postedComments.get(key) ?? []), comment])
        // Clear only after confirmation. Save the retry target before the second write.
        updateAction(key, (draft) => ({ ...draft, body: "", ...(kind !== "comment" ? { retry: kind } : {}) }), true)
        if (stillHere()) setIssueDetail((latest) => {
          if (latest?.number !== number) return latest
          const comments = latest.comments.value ?? { items: [], page: 0, hasMore: true }
          const items = [...comments.items.filter((item) => item.id !== comment.id), comment]
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          return {
            ...latest,
            resource: latest.resource.value ? { status: "ready", value: {
              ...latest.resource.value, commentCount: latest.resource.value.commentCount + 1,
              updatedAt: comment.createdAt,
            } } : latest.resource,
            comments: { ...latest.comments, value: { ...comments, items } },
          }
        })
      }
      if (kind !== "comment") {
        const nextState = kind === "close" ? "closed" : "open"
        const reactionRead = reactionRevision
        const updated = await loaders.updateIssueState!(repository, number, nextState, action.reason)
        if (updated.state !== nextState) throw new Error("GitHub did not change the issue state. Check your permissions on GitHub.")
        result.issue = reconcileIssueState(repository, number, updated, scope, reactionRead)
      }
      updateAction(key, () => emptyIssueAction, true)
      return result
    } catch (error) {
      const retry = issueActions()[key]?.retry
      const failure = actionError(error, issue.locked)
      const message = retry ? `Comment posted, but ${retry === "close" ? "closing" : "reopening"} failed. ${failure}` : failure
      updateAction(key, (draft) => ({ ...draft, operation: { status: "error", message } }))
      throw new Error(message)
    }
  }

  // Only settled sections are reusable; a resumed load refetches the rest.
  const settledData = (data: RepositoryData): RepositoryData => {
    const resource = <T>(value: ResourceState<T>): ResourceState<T> =>
      settled(value) ?? { status: "error", phase: "load", message: "Loading was interrupted; refresh to retry." }
    return { ...data,
      workCounts: resource(data.workCounts),
      documents: data.documents.value === undefined ? resource(data.documents)
        : { ...resource(data.documents), value: data.documents.value.map((document) => ({ ...document, resource: resource(document.resource) })) },
      branches: resource(data.branches), commits: resource(data.commits), commitCount: resource(data.commitCount),
      issues: { open: resource(data.issues.open), closed: resource(data.issues.closed) },
      pulls: { open: resource(data.pulls.open), closed: resource(data.pulls.closed) },
      runs: resource(data.runs) }
  }
  const retainRepository = (current: RepositoryState, fresh: boolean) => {
    if (current.status !== "ready" || current.operations.branch.status === "loading") return
    const data = settledData(current.data)
    const key = current.repository.toLowerCase()
    const whole = complete([data.workCounts, data.documents, data.branches, data.commits, data.commitCount,
      data.issues.open, data.issues.closed, data.pulls.open, data.pulls.closed, data.runs])
      && !data.documents.value?.some((document) => document.resource.status !== "ready")
    repositoryCache.set(key, data, fresh && whole)
    if (!whole) repositoryCache.markStale(key)
  }
  const load = async (repository: string) => {
    clearDiff()
    // Keep the outgoing repository and its open pages reusable; cache keys are repository-scoped,
    // so details survive switching repositories (e.g. following a cross-repository reference and back).
    retainRepository(state(), false)
    ++repositoryScope
    clearCommit()
    clearRun()
    clearIssue()
    clearPull()
    const request = ++repositoryGeneration
    ++branchGeneration
    const cached = repositoryCache.get(repository.toLowerCase())
    if (cached && cached.value.repo.nameWithOwner.toLowerCase() === repository.toLowerCase()) {
      // Reopen on the default branch: branch-specific commits/documents are only reusable there.
      const onDefault = cached.value.currentBranch === cached.value.repo.defaultBranch
      const data = onDefault ? cached.value
        : { ...cached.value, currentBranch: cached.value.repo.defaultBranch, commits: loadingResource<Paginated<CommitSummary>>(),
          commitCount: loadingResource<number>(), documents: loadingResource<RepositoryDocumentState[]>() }
      const revalidate = cached.stale || !onDefault
      setState({ status: "ready", repository, data, operations: { refresh: revalidate ? loading() : idle(), branch: idle() } })
      if (!revalidate) return
      try {
        const repo = await loaders.metadata(repository)
        if (request !== repositoryGeneration) return
        // Revalidate in the background: retained values stay visible while sections reload.
        setState((latest) => latest.status === "ready" && latest.repository === repository ? { ...latest, data: {
          ...latest.data, repo,
          workCounts: loadingResource(latest.data.workCounts.value), documents: loadingResource(latest.data.documents.value),
          branches: loadingResource(latest.data.branches.value), commits: loadingResource(latest.data.commits.value),
          commitCount: loadingResource(latest.data.commitCount.value),
          issues: { open: loadingResource(latest.data.issues.open.value), closed: loadingResource(latest.data.issues.closed.value) },
          pulls: { open: loadingResource(latest.data.pulls.open.value), closed: loadingResource(latest.data.pulls.closed.value) },
          runs: loadingResource(latest.data.runs.value),
        } } : latest)
        await loadResources(repository, repo.defaultBranch, repo, request, data)
        updateReady(setState, request, generation, repository, (latest) => ({ ...latest, operations: { ...latest.operations, refresh: idle() } }))
        if (request === repositoryGeneration) retainRepository(state(), true)
      } catch (error) {
        // Sections never left without a value and no way to retry.
        const failed = <T>(resource: ResourceState<T>): ResourceState<T> => resource.status === "loading" ? failedResource(error, resource.value) : resource
        updateReady(setState, request, generation, repository, (latest) => ({
          ...latest, operations: { ...latest.operations, refresh: { status: "error", message: messageFrom(error) } },
          data: { ...latest.data, commits: failed(latest.data.commits), commitCount: failed(latest.data.commitCount), documents: failed(latest.data.documents) } }))
      }
      return
    }
    setState({ status: "loading", repository })
    try {
      const repo = await loaders.metadata(repository)
      if (request !== repositoryGeneration) return
      setState({
        status: "ready",
        repository,
        data: initialData(repo),
        operations: { refresh: idle(), branch: idle() },
      })
      await loadResources(repository, repo.defaultBranch, repo, request)
      if (request === repositoryGeneration) retainRepository(state(), true)
    } catch (error) {
      if (request === repositoryGeneration) {
        setState({ status: "error", repository, message: messageFrom(error) })
      }
    }
  }

  const refresh = async () => {
    const current = state()
    if (current.status !== "ready" || current.operations.refresh.status === "loading"
      || current.operations.branch.status === "loading" || hasLoadingResource(current.data)) return

    const request = ++repositoryGeneration
    ++branchGeneration
    const repository = current.repository
    // Repository refresh is an explicit freshness request; this repository's retained details revalidate on next open.
    const inRepository = (key: string) => key.startsWith(`${repository.toLowerCase()}:`)
    issueCache.markStale(inRepository)
    pullCache.markStale(inRepository)
    runCache.markStale(inRepository)
    repositoryCache.markStale(repository.toLowerCase())
    setAssignableUserCache((cache) => {
      const next = { ...cache }
      delete next[repository.toLowerCase()]
      return next
    })
    const branch = current.data.currentBranch
    setState({ ...current, operations: { ...current.operations, refresh: loading() } })
    try {
      const repo = await loaders.metadata(repository)
      if (request !== repositoryGeneration) return
      setState((latest) => latest.status !== "ready" || latest.repository !== repository
        ? latest
        : {
            ...latest,
            data: {
              ...latest.data,
              repo,
              workCounts: loadingResource(latest.data.workCounts.value),
              documents: loadingResource(latest.data.documents.value),
              branches: loadingResource(latest.data.branches.value),
              commits: loadingResource(latest.data.commits.value),
              commitCount: loadingResource(latest.data.commitCount.value),
              issues: {
                open: loadingResource(latest.data.issues.open.value),
                closed: loadingResource(latest.data.issues.closed.value),
              },
              pulls: {
                open: loadingResource(latest.data.pulls.open.value),
                closed: loadingResource(latest.data.pulls.closed.value),
              },
              runs: loadingResource(latest.data.runs.value),
            },
          })
      await loadResources(repository, branch, repo, request, current.data)
      updateReady(setState, request, generation, repository, (latest) => ({
        ...latest,
        operations: { ...latest.operations, refresh: idle() },
      }))
      // Refreshed data is fresh; returning later should not reload it again.
      if (request === repositoryGeneration) retainRepository(state(), true)
    } catch (error) {
      updateReady(setState, request, generation, repository, (latest) => ({
        ...latest,
        operations: { ...latest.operations, refresh: { status: "error", message: messageFrom(error) } },
      }))
    }
  }

  const retryResource = async (resource: RepositoryResource) => {
    const current = state()
    if (current.status !== "ready" || current.operations.refresh.status === "loading"
      || current.operations.branch.status === "loading") return
    const repository = current.repository
    const request = repositoryGeneration
    const branch = current.data.currentBranch

    if (resource.kind === "branches" && current.data.branches.status === "error"
      && current.data.branches.phase === "pagination") return loadMoreBranches()
    if (resource.kind === "commits" && current.data.commits.status === "error"
      && current.data.commits.phase === "pagination") return loadMoreCommits()
    if (resource.kind === "runs" && current.data.runs.status === "error"
      && current.data.runs.phase === "pagination") return loadMoreRuns()
    if (resource.kind === "issues") {
      const issueResource = current.data.issues[resource.state]
      if (issueResource.status === "error" && issueResource.phase === "pagination")
        return loadMoreIssues(resource.state)
    }
    if (resource.kind === "pulls") {
      const pullResource = current.data.pulls[resource.state]
      if (pullResource.status === "error" && pullResource.phase === "pagination")
        return loadMorePulls(resource.state)
    }

    if (resource.kind === "documents") {
      if (hasLoadingDocuments(current.data)) return
      setState({ ...current, data: { ...current.data, documents: loadingResource(current.data.documents.value) } })
      return fetchDocuments(repository, current.data.repo, branch, request)
    }
    if (resource.kind === "document") {
      const documents = current.data.documents
      const source = documents.value?.find((document) => document.id === resource.id)
      if (!source || documents.status === "loading" || source.resource.status === "loading") return
      setState({
        ...current,
        data: {
          ...current.data,
          documents: {
            ...documents,
            value: documents.value!.map((document) => document.id === source.id
              ? { ...document, resource: loadingResource(document.resource.value) } : document),
          },
        },
      })
      return fetchDocument(source, repository, branch, request, source.resource.value)
    }
    if (resource.kind === "branches") {
      setState({ ...current, data: { ...current.data, branches: loadingResource(current.data.branches.value) } })
      return fetchBranches(repository, current.data.repo.defaultBranch, request, current.data.branches.value?.page)
    }
    if (resource.kind === "commits") {
      setState({ ...current, data: { ...current.data, commits: loadingResource(current.data.commits.value) } })
      return fetchCommits(repository, branch, request, current.data.commits.value?.page)
    }
    if (resource.kind === "runs") {
      setState({ ...current, data: { ...current.data, runs: loadingResource(current.data.runs.value) } })
      return fetchRuns(repository, request, current.data.runs.value?.page)
    }
    if (resource.kind === "issues") {
      setState({
        ...current,
        data: {
          ...current.data,
          issues: { ...current.data.issues, [resource.state]: loadingResource(current.data.issues[resource.state].value) },
        },
      })
      return fetchIssues(repository, resource.state, request, current.data.issues[resource.state].value?.page)
    }
    setState({
      ...current,
      data: {
        ...current.data,
        pulls: { ...current.data.pulls, [resource.state]: loadingResource(current.data.pulls[resource.state].value) },
      },
    })
    return fetchPulls(repository, resource.state, request, current.data.pulls[resource.state].value?.page)
  }

  const canSwitchBranch = () => {
    const current = state()
    return current.status === "ready"
      && current.operations.branch.status !== "loading" && current.operations.refresh.status !== "loading"
      && current.data.commits.status !== "loading" && !hasLoadingDocuments(current.data)
  }

  const switchBranch = async (branch: string) => {
    const current = state()
    if (current.status !== "ready" || current.data.currentBranch === branch || !canSwitchBranch()) return

    const request = ++branchGeneration
    const repositoryRequest = repositoryGeneration
    const repository = current.repository
    setState({ ...current, operations: { ...current.operations, branch: loading() } })
    try {
      const [commits, documents] = await Promise.all([
        loaders.commits(repository, branch),
        loaders.documents(current.data.repo, branch).then((sources) => Promise.all(sources.map(async (source) => ({
          ...source,
          resource: await loadDocument(() => loaders.document(source)),
        })))),
      ])
      setState((latest) => {
        if (repositoryRequest !== repositoryGeneration || request !== branchGeneration
          || latest.status !== "ready" || latest.repository !== repository) return latest
        return {
          ...latest,
          data: {
            ...latest.data,
            currentBranch: branch,
            documents: { status: "ready", value: documents },
            commits: { status: "ready", value: page(commits) },
            commitCount: loadingResource(),
          },
          operations: { ...latest.operations, branch: idle() },
        }
      })
      if (repositoryRequest === repositoryGeneration && request === branchGeneration) {
        await fetchCommitCount(repository, branch, repositoryRequest)
      }
    } catch (error) {
      setState((latest) => {
        if (repositoryRequest !== repositoryGeneration || request !== branchGeneration
          || latest.status !== "ready" || latest.repository !== repository) return latest
        return {
          ...latest,
          operations: { ...latest.operations, branch: { status: "error", message: messageFrom(error) } },
        }
      })
    }
  }

  const loadMoreBranches = async () => {
    const current = state()
    const value = current.status === "ready" ? current.data.branches.value : undefined
    if (current.status !== "ready" || !value?.hasMore || current.data.branches.status === "loading"
      || current.operations.refresh.status === "loading") return

    const repository = current.repository
    const request = repositoryGeneration
    const nextPage = value.page + 1
    setState({ ...current, data: { ...current.data, branches: loadingResource(value, "pagination") } })
    try {
      const result = await loaders.branches(repository, current.data.repo.defaultBranch, nextPage)
      updateReady(setState, request, generation, repository, (latest) => {
        const latestValue = latest.data.branches.value
        if (!latestValue || latestValue.page !== nextPage - 1) return latest
        const existing = new Set(latestValue.items)
        const branches = result.items.filter((branch) => {
          if (existing.has(branch)) return false
          existing.add(branch)
          return true
        })
        return {
          ...latest,
          data: {
            ...latest.data,
            branches: {
              status: "ready",
              value: page({ items: [...latestValue.items, ...branches], hasMore: result.hasMore }, nextPage),
            },
          },
        }
      })
    } catch (error) {
      updateReady(setState, request, generation, repository, (latest) => ({
        ...latest,
        data: { ...latest.data, branches: failedResource(error, latest.data.branches.value, "pagination") },
      }))
    }
  }

  const loadMoreCommits = async () => {
    const current = state()
    const value = current.status === "ready" ? current.data.commits.value : undefined
    if (current.status !== "ready" || !value?.hasMore || current.data.commits.status === "loading"
      || current.operations.refresh.status === "loading" || current.operations.branch.status === "loading") return

    const repository = current.repository
    const branch = current.data.currentBranch
    const request = repositoryGeneration
    const branchRequest = branchGeneration
    const nextPage = value.page + 1
    setState({ ...current, data: { ...current.data, commits: loadingResource(value, "pagination") } })
    try {
      const result = await loaders.commits(repository, branch, nextPage)
      setState((latest) => {
        const latestValue = latest.status === "ready" ? latest.data.commits.value : undefined
        if (request !== repositoryGeneration || branchRequest !== branchGeneration
          || latest.status !== "ready" || latest.repository !== repository
          || latest.data.currentBranch !== branch || latestValue?.page !== nextPage - 1) return latest
        const existing = new Set(latestValue.items.map((commit) => commit.sha))
        return {
          ...latest,
          data: {
            ...latest.data,
            commits: {
              status: "ready",
              value: page({ items: [...latestValue.items, ...result.items.filter((item) => !existing.has(item.sha))], hasMore: result.hasMore }, nextPage),
            },
          },
        }
      })
    } catch (error) {
      updateReady(setState, request, generation, repository, (latest) => latest.data.currentBranch === branch
        ? { ...latest, data: { ...latest.data, commits: failedResource(error, latest.data.commits.value, "pagination") } }
        : latest)
    }
  }

  const loadMoreRuns = async () => {
    const current = state()
    const value = current.status === "ready" ? current.data.runs.value : undefined
    if (current.status !== "ready" || !value?.hasMore || current.data.runs.status === "loading"
      || current.operations.refresh.status === "loading") return
    const repository = current.repository
    const request = repositoryGeneration
    const nextPage = value.page + 1
    setState({ ...current, data: { ...current.data, runs: loadingResource(value, "pagination") } })
    try {
      const result = await loaders.runs(repository, nextPage)
      updateReady(setState, request, generation, repository, (latest) => {
        const latestValue = latest.data.runs.value
        if (!latestValue || latestValue.page !== nextPage - 1) return latest
        const existing = new Set(latestValue.items.map((run) => run.id))
        return {
          ...latest,
          data: {
            ...latest.data,
            runs: {
              status: "ready",
              value: page({ items: [...latestValue.items, ...result.items.filter((item) => !existing.has(item.id))], hasMore: result.hasMore }, nextPage),
            },
          },
        }
      })
    } catch (error) {
      updateReady(setState, request, generation, repository, (latest) => ({
        ...latest,
        data: { ...latest.data, runs: failedResource(error, latest.data.runs.value, "pagination") },
      }))
    }
  }

  const loadMoreIssues = async (listState: ListState) => {
    const current = state()
    const resource = current.status === "ready" ? current.data.issues[listState] : undefined
    const value = resource?.value
    if (current.status !== "ready" || !resource || !value?.hasMore || resource.status === "loading"
      || current.operations.refresh.status === "loading") return
    const repository = current.repository
    const request = repositoryGeneration
    const nextPage = value.page + 1
    const listRequest = issueListGeneration[listState]
    setState({
      ...current,
      data: { ...current.data, issues: { ...current.data.issues, [listState]: loadingResource(value, "pagination") } },
    })
    try {
      const result = await loaders.issues(repository, listState, nextPage)
      updateReady(setState, request, generation, repository, (latest) => {
        const latestValue = latest.data.issues[listState].value
        if (listRequest !== issueListGeneration[listState] || !latestValue || latestValue.page !== nextPage - 1) return latest
        const existing = new Set(latestValue.items.map((item) => item.number))
        return {
          ...latest,
          data: {
            ...latest.data,
            issues: {
              ...latest.data.issues,
              [listState]: {
                status: "ready",
                value: page({ items: [...latestValue.items, ...result.items.filter((item) => !existing.has(item.number))], hasMore: result.hasMore }, nextPage),
              },
            },
          },
        }
      })
    } catch (error) {
      updateReady(setState, request, generation, repository, (latest) => listRequest !== issueListGeneration[listState] ? latest : ({
        ...latest,
        data: {
          ...latest.data,
          issues: { ...latest.data.issues, [listState]: failedResource(error, latest.data.issues[listState].value, "pagination") },
        },
      }))
    }
  }

  const loadMorePulls = async (listState: ListState) => {
    const current = state()
    const resource = current.status === "ready" ? current.data.pulls[listState] : undefined
    const value = resource?.value
    if (current.status !== "ready" || !resource || !value?.hasMore || resource.status === "loading"
      || current.operations.refresh.status === "loading") return
    const repository = current.repository
    const request = repositoryGeneration
    const nextPage = value.page + 1
    const listRequest = pullListGeneration[listState]
    setState({
      ...current,
      data: { ...current.data, pulls: { ...current.data.pulls, [listState]: loadingResource(value, "pagination") } },
    })
    try {
      const result = await loaders.pulls(repository, listState, nextPage)
      if (listRequest !== pullListGeneration[listState]) return
      updateReady(setState, request, generation, repository, (latest) => {
        const latestValue = latest.data.pulls[listState].value
        if (!latestValue || latestValue.page !== nextPage - 1) return latest
        const existing = new Set(latestValue.items.map((item) => item.number))
        return {
          ...latest,
          data: {
            ...latest.data,
            pulls: {
              ...latest.data.pulls,
              [listState]: {
                status: "ready",
                value: page({ items: [...latestValue.items, ...result.items.filter((item) => !existing.has(item.number))], hasMore: result.hasMore }, nextPage),
              },
            },
          },
        }
      })
    } catch (error) {
      updateReady(setState, request, generation, repository, (latest) => ({
        ...latest,
        data: {
          ...latest.data,
          pulls: listRequest !== pullListGeneration[listState] ? latest.data.pulls
            : { ...latest.data.pulls, [listState]: failedResource(error, latest.data.pulls[listState].value, "pagination") },
        },
      }))
    }
  }

  return {
    state,
    flushDrafts,
    draftSaveError,
    reactionAction,
    addReaction,
    diffs,
    loadDiff,
    clearDiff,
    runDetail,
    loadRun,
    loadMoreRunJobs,
    clearRun,
    commitDetail,
    loadCommit,
    loadMoreCommitFiles,
    clearCommit,
    pullDetail,
    loadPull,
    mergePull,
    updatePullDraft,
    loadPullMergeMessage,
    loadMorePullComments,
    retryPullReferences,
    retryPullCommits,
    retryPullContext,
    clearPull,
    invalidatePull,
    issueDetail,
    loadIssue,
    loadMoreIssueComments,
    retryIssueReferences,
    clearIssue,
    assignableUsers,
    loadAssignableUsers,
    issueAction,
    prepareIssueAction,
    updateIssueDraft,
    discardIssueDraft,
    submitIssueAction,
    load,
    refresh,
    retryResource,
    canSwitchBranch,
    switchBranch,
    loadMoreBranches,
    loadMoreCommits,
    loadMoreRuns,
    loadMoreIssues,
    loadMorePulls,
  }
}
