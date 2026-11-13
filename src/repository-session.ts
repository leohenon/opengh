import { randomUUID } from "node:crypto"
import { createSignal, type Accessor, type Setter } from "solid-js"
import type { Page as NavigationPage } from "./navigation"

export type RepositoryScope = "full" | "detail" | NavigationPage
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
import { GitHubApiError, type RequestOptions } from "./github/transport"
import { loadGitHubMentionableUsers } from "./github/mentionable-users"
import type { IssueCommentConfirmation, IssueCommentDraft } from "./github/issue-comments"
import { createRequestBudget, MAX_AUTOMATIC_PAGES, RequestBudgetLimitError } from "./github/request-budget"
import { normalizeRepository } from "./repository-name"
import type { RepositoryTarget } from "./github/repository-target"
import { createCacheBudget, createDetailCache, type DetailCacheOptions } from "./detail-cache"
import { createDiskDraftStore, DraftConflictError, type DraftKind, type DraftStore, type IssueDraft } from "./drafts"
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
  addReaction?(repository: Repo, target: ReactionTarget, kind: ReactionKind): Promise<ReactionState>
  updatePullState?(repository: Repo, number: number, state: ListState): Promise<PullRequestDetail>
  updatePullDraft?(repository: Repo, number: number, draft: boolean): Promise<PullRequestDetail>
  pullMergeMessage?(repository: Repo, number: number, expectedHeadSha: string): Promise<PullMergeMessage>
  mergePull?(repository: Repo, number: number, method: PullMergeMethod, expectedHeadSha: string, message?: PullMergeMessage): Promise<PullRequestDetail>
  diff?(repository: RepositoryTarget, target: DiffTarget, signal: AbortSignal, filesOnly?: boolean): Promise<DiffContent>
  metadata(repository: string, options?: RequestOptions): Promise<Repo>
  workCounts(repository: RepositoryTarget, options?: RequestOptions): Promise<{ issues: number; pulls: number }>
  documents(repo: Repo, branch: string, options?: RequestOptions): Promise<RepositoryDocument[]>
  document(repository: RepositoryTarget, source: RepositoryDocument, options?: RequestOptions): Promise<string>
  branches(repository: RepositoryTarget, fallbackBranch: string, page?: number, options?: RequestOptions): Promise<Page<string>>
  commits(repository: RepositoryTarget, branch: string, page?: number, options?: RequestOptions): Promise<Page<CommitSummary>>
  commitCount(repository: RepositoryTarget, branch: string, options?: RequestOptions): Promise<number>
  commit(repository: RepositoryTarget, sha: string, page?: number, options?: RequestOptions): Promise<CommitDetail>
  issue(repository: RepositoryTarget, number: number, options?: RequestOptions): Promise<IssueDetail>
  issueComments(repository: RepositoryTarget, number: number, page?: number, options?: RequestOptions): Promise<Page<IssueComment>>
  issueReferences(repository: RepositoryTarget, number: number, options?: RequestOptions): Promise<IssueReference[]>
  createIssueComment?(repository: Repo, number: number, body: string, onConfirmed?: IssueCommentConfirmation, draftKey?: string, draft?: IssueCommentDraft): Promise<IssueComment>
  updateIssueState?(repository: Repo, number: number, state: ListState, reason?: IssueCloseReason): Promise<IssueDetail>
  setIssueAssignees?(repository: Repo, number: number, assignees: string[]): Promise<IssueDetail>
  assignableUsers?(repository: RepositoryTarget, page?: number, options?: RequestOptions): Promise<Page<string>>
  mentionableUsers?(repository: RepositoryTarget, query: string, options?: RequestOptions): Promise<string[]>
  markIssueDuplicate?(repository: Repo, number: number, canonicalNumber: number): Promise<IssueDetail>
  issueTimeline?(repository: RepositoryTarget, number: number, options?: RequestOptions): Promise<IssueTimeline>
  issues(repository: RepositoryTarget, state: ListState, page?: number, options?: RequestOptions): Promise<Page<IssueSummary>>
  hasIssues?(repository: RepositoryTarget, state: ListState, options?: RequestOptions): Promise<boolean>
  pull(repository: RepositoryTarget, number: number, options?: RequestOptions): Promise<PullRequestDetail>
  pullCommits(repository: RepositoryTarget, number: number, options?: RequestOptions): Promise<CommitSummary[]>
  pullContext(repository: RepositoryTarget, number: number, options?: RequestOptions): Promise<PullContext>
  pulls(repository: RepositoryTarget, state: ListState, page?: number, options?: RequestOptions): Promise<Page<PullRequestSummary>>
  run?(repository: RepositoryTarget, id: number, options?: RequestOptions): Promise<WorkflowRunDetail>
  runJobs?(repository: RepositoryTarget, id: number, attempt: number, page?: number, options?: RequestOptions): Promise<Page<WorkflowJob>>
  runs(repository: RepositoryTarget, page?: number, options?: RequestOptions): Promise<Page<WorkflowRunSummary>>
}

export type RepositorySession = {
  state: Accessor<RepositoryState>
  flushDrafts?(): boolean
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
  // Optional so hand-built test sessions need not stub it.
  invalidatePull?(repository: string, number: number): void
  issueDetail: Accessor<IssueDetailState | undefined>
  loadIssue(number: number, options?: { force?: boolean }): Promise<void>
  loadMoreIssueComments(): Promise<void>
  retryIssueReferences(): Promise<void>
  clearIssue(): void
  assignableUsers?: Accessor<ResourceState<Paginated<string>> | undefined>
  loadAssignableUsers?(): Promise<void>
  searchMentionableUsers?(query: string, signal?: AbortSignal): Promise<readonly string[]>
  commentDraft?(number: number, parent?: IssueActionParent): string
  issueAction(number: number, parent?: IssueActionParent): IssueActionState
  prepareIssueAction(number: number, kind: IssueActionKind, parent?: IssueActionParent): void
  updateIssueDraft(number: number, draft: Partial<Pick<IssueActionState, "body" | "reason" | "duplicateTarget" | "selectedAssignees">>, parent?: IssueActionParent): void
  discardIssueDraft(number: number, parent?: IssueActionParent): void
  submitIssueAction(number: number, kind: IssueActionKind, parent?: IssueActionParent): Promise<IssueActionResult>
  load(repository: string, scope?: RepositoryScope): Promise<void>
  ensure?(scope: RepositoryScope): Promise<void>
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
  mentionableUsers: loadGitHubMentionableUsers,
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

async function mapBounded<T, R>(items: readonly T[], load: (item: T, index: number) => Promise<R>, options?: RequestOptions): Promise<R[]> {
  const result = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      options?.signal?.throwIfAborted()
      options?.budget?.signal.throwIfAborted()
      const index = next++
      result[index] = await load(items[index]!, index)
    }
  }))
  return result
}

async function loadPageSet<T, K>(
  pageCount: number,
  loadPage: (page: number) => Promise<Page<T>>,
  key: (item: T) => K,
  options?: RequestOptions,
): Promise<Paginated<T>> {
  if (pageCount > MAX_AUTOMATIC_PAGES) throw new RequestBudgetLimitError("Refreshing the loaded pages exceeds the viewing limit")
  const pages = await mapBounded(Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1), loadPage, options)
  const seen = new Set<K>()
  const items = pages.flatMap((result) => result.items).filter((item) => {
    const itemKey = key(item)
    if (seen.has(itemKey)) return false
    seen.add(itemKey)
    return true
  })
  return { items, page: pages.length, hasMore: pages.at(-1)?.hasMore ?? false }
}
async function withRequestBudget<T>(options: RequestOptions, load: (options: RequestOptions) => Promise<T>): Promise<T> {
  const budget = options.budget ?? createRequestBudget(options.signal)
  try { return await load({ ...options, budget }) }
  finally { if (!options.budget) budget.dispose() }
}

const loadingResource = <T>(value?: T, phase: ResourcePhase = "load"): ResourceState<T> => value === undefined
  ? { status: "loading", phase }
  : { status: "loading", phase, value }
const failedResource = <T>(error: unknown, value?: T, phase: ResourcePhase = "load"): ResourceState<T> => value === undefined
  ? { status: "error", phase, message: messageFrom(error) }
  : { status: "error", phase, message: messageFrom(error), value }

function stoppedResource<T>(resource: ResourceState<T>, error: unknown): ResourceState<T> {
  // A replacement load aborted these requests; their old generations can no
  // longer finish. Preserve cached values, but leave a retryable state.
  return resource.status === "loading" ? failedResource(error, resource.value, resource.phase) : resource
}

async function loadDocument(load: () => Promise<string>, previous?: string): Promise<ResourceState<string>> {
  try {
    return { status: "ready", value: await load() }
  } catch (error) {
    return failedResource(error, previous)
  }
}

const deferredResource = <T>(value?: T): ResourceState<T> => ({ status: "loading", phase: "load", deferred: true, ...(value === undefined ? {} : { value }) })
const isDeferred = (resource: ResourceState<unknown>) => resource.status === "loading" && resource.deferred === true
const isLoading = (resource: ResourceState<unknown>) => resource.status === "loading" && !resource.deferred
const reloadResource = <T>(resource: ResourceState<T>): ResourceState<T> => isDeferred(resource) ? resource : loadingResource(resource.value)

function hasLoadingDocuments(data: RepositoryData) {
  return isLoading(data.documents)
    || data.documents.value?.some((document) => document.resource.status === "loading") === true
}

function hasLoadingResource(data: RepositoryData) {
  return hasLoadingDocuments(data)
    || isLoading(data.branches)
    || isLoading(data.commits)
    || isLoading(data.runs)
    || isLoading(data.issues.open)
    || isLoading(data.issues.closed)
    || isLoading(data.pulls.open)
    || isLoading(data.pulls.closed)
}

function initialData(repo: Repo): RepositoryData {
  return {
    repo,
    currentBranch: repo.defaultBranch,
    workCounts: deferredResource(),
    documents: deferredResource(),
    branches: deferredResource(),
    commits: deferredResource(),
    commitCount: deferredResource(),
    issues: { open: deferredResource(), closed: deferredResource() },
    pulls: { open: deferredResource(), closed: deferredResource() },
    runs: deferredResource(),
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
  // Detail keys include both canonical name and stable ID, isolating name replacements.
  const detailCacheKey = (repository: string, number: number, parent: IssueActionParent = "issue") => `${cacheRepositoryKey(repository)}:${parent}:${number}`
  // Loading sections with a value are reusable; errors stay visible so the page keeps its retry affordance.
  const settled = <T>(resource: ResourceState<T>): ResourceState<T> | undefined =>
    resource.status !== "loading" ? resource : resource.value === undefined ? undefined : { status: "ready", value: resource.value }
  // A section whose load was cut off is retained as a retryable error, never as empty data.
  const retainable = <T>(resource: ResourceState<T>): ResourceState<T> =>
    isDeferred(resource) ? resource : settled(resource) ?? { status: "error", phase: "load", message: "Loading was interrupted; refresh to retry." }
  const complete = (resources: ResourceState<unknown>[]) => resources.every((resource) => resource.status === "ready" || isDeferred(resource))
  const [draftSaveError, setDraftSaveError] = createSignal<string>()
  const draftErrors = new Map<string, string>()
  const publishDraftError = () => setDraftSaveError(draftErrors.values().next().value)
  const activeDraftKinds = new Map<string, DraftKind>()
  const unpreparedDraftEdits = new Set<string>()
  const [savedDrafts, setSavedDrafts] = createSignal(new Map<string, IssueDraft>())
  const rememberDraft = (key: string, draft: IssueDraft) => setSavedDrafts(current => new Map(current).set(key, draft))
  const persistedDrafts = new Map<string, IssueDraft | undefined>()
  const dirtyDrafts = new Map<string, IssueDraft>()
  const pendingPublications = new Map<string, IssueDraft>()
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  const draftSnapshot = (action: IssueActionState): IssueDraft => ({ generation: randomUUID(), body: action.body, reason: action.reason, retry: action.retry })
  const sameDraft = (draft: IssueDraft | undefined, action: Pick<IssueActionState, "body" | "reason" | "retry">) =>
    draft?.body === action.body && draft.reason === action.reason && draft.retry === action.retry
  const persistDraft = (key: string, draft: IssueDraft) => {
    const pending = pendingPublications.get(key)
    if (pending && pending.generation !== draft.generation) {
      draftStore!.save(key, pending, persistedDrafts.get(key)?.generation)
      persistedDrafts.set(key, pending)
      pendingPublications.delete(key)
    }
    try { draftStore!.save(key, draft, persistedDrafts.get(key)?.generation) }
    catch (error) {
      if (!(error instanceof DraftConflictError)) pendingPublications.set(key, draft)
      throw error
    }
    persistedDrafts.set(key, draft)
    pendingPublications.delete(key)
    if (dirtyDrafts.get(key) === draft) dirtyDrafts.delete(key)
    draftErrors.delete(`save:${key}`)
  }
  const flushDrafts = (): boolean => {
    clearTimeout(draftTimer)
    draftTimer = undefined
    if (!draftStore) return true
    for (const [key, draft] of dirtyDrafts) {
      try { persistDraft(key, draft) }
      catch (error) {
        draftErrors.set(`save:${key}`, `Draft save failed: ${messageFrom(error)}. Draft retained in memory; clear local changes to reload a conflicting draft.`)
      }
    }
    publishDraftError()
    return dirtyDrafts.size === 0
  }
  const saveDraft = (key: string, action: IssueActionState) => {
    const kind = activeDraftKinds.get(key)
    if (!kind) return
    const draftKey = `${key}:${kind}`
    if (sameDraft(savedDrafts().get(draftKey), action)) return
    const draft = draftSnapshot(action)
    rememberDraft(draftKey, draft)
    if (!draftStore) return
    dirtyDrafts.set(draftKey, draft)
    clearTimeout(draftTimer)
    draftTimer = setTimeout(flushDrafts, 200)
    draftTimer.unref?.()
  }
  const [state, setState] = createSignal<RepositoryState>({ status: "loading", repository: "" })
  const [runDetail, setRunDetail] = createSignal<RunDetailState>()
  let runAbort = new AbortController()
  let commitAbort = new AbortController()
  let issueAbort = new AbortController()
  let issueReferencesAbort = new AbortController()
  let pullAbort = new AbortController()
  let documentsAbort = new AbortController()
  let runGeneration = 0
  const [commitDetail, setCommitDetail] = createSignal<CommitDetailState>()
  const [diffs, setDiffs] = createSignal<Partial<Record<DiffTarget["kind"], DiffState>>>({})
  const diffGeneration: Record<DiffTarget["kind"], number> = { commit: 0, pull: 0 }
  const diffAbort: Partial<Record<DiffTarget["kind"], AbortController>> = {}
  // Diff identity is content-addressed: a commit SHA, or a PR number pinned to its base/head commits.
  const commitDiffKey = (repository: string, sha: string, filesOnly: boolean) =>
    /^[a-f0-9]{40}$/i.test(sha) ? `${cacheRepositoryKey(repository)}:commit:${sha.toLowerCase()}:${filesOnly ? "files" : "patch"}` : undefined
  const pullDiffKey = (repository: string, number: number, commits: { baseSha?: string; headSha?: string } | undefined) =>
    commits?.baseSha && commits.headSha ? `${cacheRepositoryKey(repository)}:pull:${number}:${commits.baseSha.toLowerCase()}:${commits.headSha.toLowerCase()}` : undefined
  const retainDiff = (repository: string, target: DiffTarget, value: DiffContent, filesOnly: boolean) => {
    const key = target.kind === "commit" ? commitDiffKey(repository, target.sha, filesOnly)
      : !filesOnly && value.kind === "patch" ? pullDiffKey(repository, target.number, value) : undefined
    if (key) diffCache.set(key, value)
  }
  // The PR snapshot trusted to name the current base/head commits: the displayed PR once loaded,
  // or a fresh retained one (e.g. "View diff" from the list).
  const diffPull = (repository: string, number: number) => {
    const displayed = pullDetail()
    if (displayed?.number === number) return displayed.resource.status === "loading" ? undefined : displayed.resource.value
    const cached = pullCache.get(detailCacheKey(repository, number, "pull"))
    return cached && !cached.stale ? cached.value.resource.value : undefined
  }
  const cachedDiff = (repository: string, target: DiffTarget, filesOnly: boolean) => {
    const key = target.kind === "commit" ? commitDiffKey(repository, target.sha, filesOnly)
      : filesOnly ? undefined : pullDiffKey(repository, target.number, diffPull(repository, target.number))
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
      const value = await loaders.diff(current.data.repo, target, controller.signal, filesOnly)
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
  const repositoryIds = new Map<string, number>()
  const cacheRepositoryKey = (repository: string) => `${repository.toLowerCase()}@${repositoryIds.get(repository.toLowerCase()) ?? "unknown"}`
  const issueKey = (repository: string, number: number, parent: IssueActionParent = "issue") => `${cacheRepositoryKey(repository)}#${number}${parent === "pull" ? ":pull" : ""}`
  const postedComments = new Map<string, IssueComment[]>()
  const issueWriteRevision = new Map<string, number>()
  const issueActionRevision = new Map<string, number>()
  const pullActionRevision = new Map<string, number>()
  const confirmIssueWrite = (key: string) => {
    issueWriteRevision.set(key, (issueWriteRevision.get(key) ?? 0) + 1)
    // Confirmed writes may land after the page closed; a retained snapshot must revalidate before reuse.
    const [repository, rest] = key.split("#")
    // The stable write key names the origin, even when another repository is now active.
    if (repository) repositoryCache.markStale(repository.split("@")[0]!)
    const number = Number(rest?.replace(":pull", ""))
    if (repository && Number.isSafeInteger(number)) (rest?.endsWith(":pull") ? pullCache : issueCache).markStale(`${repository}:${rest?.endsWith(":pull") ? "pull" : "issue"}:${number}`)
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
  const mentionUserCache = new Map<string, readonly string[]>()
  let repositoryAbort = new AbortController()
  let branchReadAbort = new AbortController()
  const repositoryReads = (): RequestOptions => ({ signal: repositoryAbort.signal })
  const branchReads = (): RequestOptions => ({ signal: AbortSignal.any([repositoryAbort.signal, branchReadAbort.signal]) })
  const resetRepositoryReads = () => {
    mentionUserCache.clear()
    repositoryAbort.abort()
    repositoryAbort = new AbortController()
    branchReadAbort.abort()
    branchReadAbort = new AbortController()
  }
  let branchGeneration = 0
  let commitCountGeneration = 0
  let documentsGeneration = 0
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
      return loaders.addReaction!(current.data.repo, target, kind)
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

  const repositorySnapshot = (repository: string, request?: number): Repo => {
    const current = state()
    if (current.status !== "ready" || current.repository !== repository
      || (request !== undefined && request !== repositoryGeneration))
      throw new DOMException("Repository view changed", "AbortError")
    return current.data.repo
  }

  const fetchDocument = async (
    source: RepositoryDocument,
    repository: string,
    branch: string,
    request: number,
    previous?: string,
    options: RequestOptions = { signal: documentsAbort.signal },
    documentRequest = documentsGeneration,
  ) => {
    const target = repositorySnapshot(repository, request)
    const resource = await withRequestBudget(options, (options) => loadDocument(() => loaders.document(target, source, options), previous))
    if (documentRequest !== documentsGeneration) return
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
    documentsAbort.abort()
    documentsAbort = new AbortController()
    const documentRequest = ++documentsGeneration
    const budget = createRequestBudget(documentsAbort.signal)
    const options = { signal: documentsAbort.signal, budget }
    try {
      const sources = await loaders.documents(repo, branch, options)
      if (sources.length > MAX_AUTOMATIC_PAGES) throw new RequestBudgetLimitError("The repository has too many overview documents to load automatically")
      budget.consumeItems(sources.length)
      const current = state()
      if (documentRequest !== documentsGeneration || request !== repositoryGeneration || current.status !== "ready"
        || current.repository !== repository || current.data.currentBranch !== branch) return
      const previous = new Map(current.data.documents.value?.map((document) => [document.id, document]))
      const documents = sources.map((source): RepositoryDocumentState => ({
        ...source,
        resource: loadingResource(previous.get(source.id)?.ref === source.ref
          ? previous.get(source.id)?.resource.value : undefined),
      }))
      setState({ ...current, data: { ...current.data, documents: { status: "ready", value: documents } } })
      await mapBounded(documents, (document) =>
        fetchDocument(document, repository, branch, request, document.resource.value, options, documentRequest), options)
    } catch (error) {
      if (documentRequest !== documentsGeneration) return
      updateReady(setState, request, generation, repository, (current) => current.data.currentBranch === branch
        ? { ...current, data: { ...current.data, documents: failedResource(error, current.data.documents.value?.map((document) => ({
          ...document,
          // Cancellation stops queued workers too. Settle their loading states
          // so retry, refresh and branch switching remain available.
          resource: stoppedResource(document.resource, error),
        }))) } }
        : current)
    } finally { budget.dispose() }
  }

  const fetchBranches = async (repository: string, fallbackBranch: string, request: number, pageCount = 1) => {
    const options = repositoryReads()
    try {
      const target = repositorySnapshot(repository, request)
      const value = await loadPageSet(
        pageCount,
        (page) => loaders.branches(target, fallbackBranch, page, options),
        (branch) => branch, options,
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
      const target = repositorySnapshot(repository, request)
      const value = await loaders.commitCount(target, branch, branchReads())
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
    const options = branchReads()
    try {
      const target = repositorySnapshot(repository, request)
      const result = await loadPageSet(pageCount, (page) => loaders.commits(target, branch, page, options), (item) => item.sha, options)
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
    const options = repositoryReads()
    try {
      const target = repositorySnapshot(repository, request)
      const result = await loadPageSet(pageCount, (page) => loaders.issues(target, listState, page, options), (item) => item.number, options)
      // REST issue pages include PRs. An empty filtered page with more pages cannot prove there are no issues.
      if (result.items.length === 0 && result.hasMore && loaders.hasIssues) {
        const current = state()
        if (request !== repositoryGeneration || current.status !== "ready" || current.repository !== repository) return
        result.hasMore = await loaders.hasIssues(target, listState, options)
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
    const options = repositoryReads()
    try {
      const target = repositorySnapshot(repository, request)
      const result = await loadPageSet(pageCount, (page) => loaders.pulls(target, listState, page, options), (item) => item.number, options)
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
    const options = repositoryReads()
    const before = state()
    const summaries = new Map(before.status === "ready" ? before.data.runs.value?.items.map((run) => [run.id, run]) : [])
    try {
      const target = repositorySnapshot(repository, request)
      const result = await loadPageSet(pageCount, (page) => loaders.runs(target, page, options), (item) => item.id, options)
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
      const target = repositorySnapshot(repository, request)
      const value = await loaders.workCounts(target, repositoryReads())
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
    scope?: RepositoryScope,
    onlyDeferred = false,
  ) => {
    const current = state()
    if (current.status !== "ready" || request !== repositoryGeneration) return
    const data = current.data
    const tasks: Promise<void>[] = []
    const start = <T>(resource: ResourceState<T>, pages: NavigationPage[], mark: () => void, fetch: () => Promise<void>) => {
      const selected = scope ? scope === "full" || pages.includes(scope as NavigationPage) : !isDeferred(resource)
      if (!selected || (onlyDeferred && !isDeferred(resource))) return
      mark()
      tasks.push(fetch())
    }
    const section = <K extends "workCounts" | "documents" | "branches" | "commits" | "commitCount" | "runs">(
      key: K, pages: NavigationPage[], fetch: () => Promise<void>,
    ) => start<unknown>(data[key], pages, () => updateReady(setState, request, generation, repository, (latest) => ({
      ...latest, data: { ...latest.data, [key]: loadingResource(latest.data[key].value) },
    })), fetch)
    section("workCounts", ["issues", "pulls"], () => fetchWorkCounts(repository, request))
    section("documents", ["overview"], () => fetchDocuments(repository, repo, branch, request))
    section("branches", ["commits"], () => fetchBranches(repository, repo.defaultBranch, request, previous?.branches.value?.page))
    section("commits", ["commits"], () => fetchCommits(repository, branch, request, previous?.commits.value?.page))
    section("commitCount", ["commits"], () => fetchCommitCount(repository, branch, request))
    for (const kind of ["issues", "pulls"] as const) for (const listState of ["open", "closed"] as const) {
      start(data[kind][listState], [kind], () => updateReady(setState, request, generation, repository, (latest) => ({
        ...latest, data: { ...latest.data, [kind]: { ...latest.data[kind], [listState]: loadingResource(latest.data[kind][listState].value) } },
      })), () => kind === "issues" ? fetchIssues(repository, listState, request, previous?.issues[listState].value?.page)
        : fetchPulls(repository, listState, request, previous?.pulls[listState].value?.page))
    }
    section("runs", ["actions"], () => fetchRuns(repository, request, previous?.runs.value?.page))
    await Promise.all(tasks)
  }

  const ensure = async (scope: RepositoryScope) => {
    const current = state()
    if (current.status !== "ready" || current.operations.refresh.status === "loading") return
    await loadResources(current.repository, current.data.currentBranch, current.data.repo, repositoryGeneration, current.data, scope, true)
  }

  const retainRun = (detail: RunDetailState | undefined, fresh: boolean) => {
    const current = state()
    if (!detail || current.status !== "ready") return
    const key = `${cacheRepositoryKey(current.repository)}:run:${detail.id}`
    const resource = settled(detail.resource)
    if (resource?.status !== "ready") { runCache.markStale(key); return }
    const jobs = retainable(detail.jobs)
    // Unfinished runs change constantly; keep them reusable but always revalidate.
    const whole = jobs.status === "ready" && resource.value.status === "completed"
    runCache.set(key, { id: detail.id, resource, jobs }, fresh && whole)
    if (!whole) runCache.markStale(key)
  }
  const clearRun = () => {
    retainRun(runDetail(), false)
    runAbort.abort()
    ++runGeneration
    setRunDetail(undefined)
  }

  const loadRun = async (id: number, options: { force?: boolean } = {}) => {
    const current = state()
    let previous = runDetail()
    if (current.status !== "ready" || (previous?.id === id && (previous.resource.status === "loading" || previous.jobs.status === "loading"))) return
    runAbort.abort()
    runAbort = new AbortController()
    if (previous?.id !== id) {
      if (previous) retainRun(previous, false)
      const cached = runCache.get(`${cacheRepositoryKey(current.repository)}:run:${id}`)
      if (cached) {
        previous = cached.value
        ++runGeneration
        setRunDetail(cached.value)
        if (!cached.stale && !options.force) return
      }
    }
    const budget = createRequestBudget(runAbort.signal)
    const requestOptions = { signal: runAbort.signal, budget }
    try {
    const request = ++runGeneration
    const retained = previous?.id === id ? previous : undefined
    setRunDetail({ id, resource: loadingResource(retained?.resource.value), jobs: loadingResource(retained?.jobs.value) })
    let run: WorkflowRunDetail
    try {
      if (!loaders.run) throw new Error("Workflow run details are unavailable")
      run = await loaders.run(current.data.repo, id, requestOptions)
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
        jobs: retained ? stoppedResource(retained.jobs, error) : failedResource<Paginated<WorkflowJob>>(error),
      })
      return
    }
    const sameAttempt = retained?.resource.value?.attempt === run.attempt
    const jobs = sameAttempt ? retained?.jobs.value : undefined
    setRunDetail({ id, resource: { status: "ready", value: run }, jobs: loadingResource(jobs) })
    try {
      if (!loaders.runJobs) throw new Error("Workflow jobs are unavailable")
      const value = await loadPageSet(jobs?.page ?? 1,
        (page) => loaders.runJobs!(current.data.repo, id, run.attempt, page, requestOptions), (job) => job.id, requestOptions)
      if (request === runGeneration) {
        setRunDetail({ id, resource: { status: "ready", value: run }, jobs: { status: "ready", value } })
        retainRun(runDetail(), true)
      }
    } catch (error) {
      if (request === runGeneration) setRunDetail({ id, resource: { status: "ready", value: run }, jobs: failedResource(error, jobs) })
    }
    } finally { budget.dispose() }
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
      const next = await withRequestBudget({ signal: runAbort.signal }, (options) => loaders.runJobs!(current.data.repo, detail.id, run.attempt, jobs.page + 1, options))
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
    commitCache.set(`${cacheRepositoryKey(current.repository)}:commit:${detail.sha.toLowerCase()}`, { sha: detail.sha, resource })
  }
  const clearCommit = () => {
    retainCommit(commitDetail())
    commitAbort.abort()
    ++commitGeneration
    setCommitDetail(undefined)
  }

  const loadCommit = async (sha: string, options: { force?: boolean } = {}) => {
    const current = state()
    let previous = commitDetail()
    if (current.status !== "ready" || (previous?.sha === sha && previous.resource.status === "loading")) return
    commitAbort.abort()
    commitAbort = new AbortController()
    if (previous?.sha !== sha) {
      if (previous) retainCommit(previous)
      const cached = commitCache.get(`${cacheRepositoryKey(current.repository)}:commit:${sha.toLowerCase()}`)
      if (cached) {
        previous = cached.value
        ++commitGeneration
        setCommitDetail(cached.value)
        if (!cached.stale && !options.force) return
      }
    }
    const budget = createRequestBudget(commitAbort.signal)
    const requestOptions = { signal: commitAbort.signal, budget }
    try {
    const request = ++commitGeneration
    const value = previous?.sha === sha ? previous.resource.value : undefined
    setCommitDetail({ sha, resource: loadingResource(value) })
    try {
      const count = value?.files.page ?? 1
      if (count > MAX_AUTOMATIC_PAGES) throw new RequestBudgetLimitError("Refreshing commit files exceeds the viewing limit")
      const pages: CommitDetail[] = []
      for (let page = 1; page <= count; page++) pages.push(await loaders.commit(current.data.repo, sha, page, requestOptions))
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
    } finally { budget.dispose() }
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
      const next = await withRequestBudget({ signal: commitAbort.signal }, (options) => loaders.commit(current.data.repo, sha, value.files.page + 1, options))
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
    const snapshot: PullDetailState = { ...detail, resource,
      comments: retainable(detail.comments), references: retainable(detail.references),
      commits: retainable(detail.commits), context: retainable(detail.context) }
    const whole = complete([snapshot.resource, snapshot.comments, snapshot.references, snapshot.commits, snapshot.context])
    pullCache.set(key, snapshot, fresh && whole)
    if (!whole) pullCache.markStale(key)
  }
  // Callers may name the repository as GitHub reports it; cache keys use the requested name,
  // which differs for a renamed (redirected) repository.
  const invalidatePull = (repository: string, number: number) => {
    const current = state()
    const requested = current.status === "ready" && current.data.repo.nameWithOwner.toLowerCase() === repository.toLowerCase()
      ? current.repository : repository
    pullCache.markStale(detailCacheKey(requested, number, "pull"))
    repositoryCache.markStale(requested.toLowerCase())
  }
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
    pullAbort.abort()
    ++pullGeneration
    setPullDetail(undefined)
  }

  const fetchPullComments = async (
    repository: string,
    number: number,
    request: number,
    pageCount: number,
    previous?: Paginated<IssueComment>,
    options: RequestOptions = { signal: pullAbort.signal },
  ) => {
    const revision = reactionRevision
    try {
      const target = repositorySnapshot(repository)
      const loaded = await withRequestBudget(options, (options) => loadPageSet(pageCount, (page) => loaders.issueComments(target, number, page, options), (comment) => comment.id, options))
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

  const fetchPullReferences = async (repository: string, number: number, request: number, previous?: IssueReference[], options: RequestOptions = { signal: pullAbort.signal }) => {
    const key = issueKey(repository, number, "pull")
    const revision = pullActionRevision.get(key)
    try {
      const target = repositorySnapshot(repository)
      const timeline = await withRequestBudget(options, async (options) => loaders.issueTimeline
        ? loaders.issueTimeline(target, number, options)
        : { references: await loaders.issueReferences(target, number, options), events: [] })
      if (request !== pullGeneration || revision !== pullActionRevision.get(key)) return
      setPullDetail((current) => current?.number === number
        ? { ...current, references: { status: "ready", value: timeline.references }, events: timeline.events } : current)
    } catch (error) {
      if (request !== pullGeneration || revision !== pullActionRevision.get(key)) return
      setPullDetail((current) => current?.number === number ? { ...current, references: failedResource(error, previous) } : current)
    }
  }

  const fetchPullCommits = async (repository: string, number: number, request: number, previous?: CommitSummary[], options: RequestOptions = { signal: pullAbort.signal }) => {
    try {
      const target = repositorySnapshot(repository)
      const value = await withRequestBudget(options, (options) => loaders.pullCommits(target, number, options))
      if (request === pullGeneration && (pullDetail()?.resource.value?.commitCount ?? 0) > value.length)
        throw new RequestBudgetLimitError("The complete PR commit list is not available in the terminal")
      if (request !== pullGeneration) return
      setPullDetail((current) => current?.number === number ? { ...current, commits: { status: "ready", value } } : current)
    } catch (error) {
      if (request !== pullGeneration) return
      setPullDetail((current) => current?.number === number ? { ...current, commits: failedResource(error, previous) } : current)
    }
  }

  const fetchPullContext = async (repository: string, number: number, request: number, previous?: PullContext, options: RequestOptions = { signal: pullAbort.signal }) => {
    const revision = reactionRevision
    const draftGeneration = pullDraftGeneration
    try {
      const target = repositorySnapshot(repository)
      const loaded = await withRequestBudget(options, (options) => loaders.pullContext(target, number, options))
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
    if (current.status !== "ready" || !detail?.resource.value || detail.resource.status === "loading" || detail.context.status === "loading") return
    setPullDetail({ ...detail, context: loadingResource(detail.context.value) })
    return fetchPullContext(current.repository, detail.number, pullGeneration, detail.context.value)
  }

  const retryPullCommits = async () => {
    const current = state()
    const detail = pullDetail()
    if (current.status !== "ready" || !detail?.resource.value || detail.resource.status === "loading" || detail.commits.status === "loading") return
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
    if (current.status !== "ready" || (previous?.number === number && previous.resource.status === "loading")) return
    restoreCommentDraft(number, "pull")
    pullAbort.abort()
    pullAbort = new AbortController()
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
    const budget = createRequestBudget(pullAbort.signal)
    const requestOptions = { signal: pullAbort.signal, budget }
    try {
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
      let loaded = await loaders.pull(current.data.repo, number, requestOptions)
      if (request !== pullGeneration || draftGeneration !== pullDraftGeneration) return
      while (actionRevision !== pullActionRevision.get(key)) {
        actionRevision = pullActionRevision.get(key)
        loaded = await loaders.pull(current.data.repo, number, requestOptions)
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
        loaded = await loaders.pull(current.data.repo, number, requestOptions)
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
        hasComments ? fetchPullComments(repository, number, request, comments?.page ?? 1, comments, requestOptions) : Promise.resolve(),
        fetchPullReferences(repository, number, request, references, requestOptions),
        pull.commitCount > 0 ? fetchPullCommits(repository, number, request, commits, requestOptions) : Promise.resolve(),
        fetchPullContext(repository, number, request, context, requestOptions),
      ])
      if (request === pullGeneration && draftGeneration === pullDraftGeneration) retainPull(pullDetail(), true)
    } catch (error) {
      if (request === pullGeneration && draftGeneration === pullDraftGeneration) setPullDetail((latest) => ({ number, resource: failedResource(error, latest?.resource.value ?? value),
        comments: previous?.number === number ? { ...stoppedResource(previous.comments, error), ...(latest?.comments.value ? { value: latest.comments.value } : {}) }
          : { status: "ready", value: { items: [], page: 1, hasMore: false } },
        references: previous?.number === number ? stoppedResource(previous.references, error) : { status: "ready", value: [] },
        events, commits: previous?.number === number ? stoppedResource(previous.commits, error) : { status: "ready", value: [] },
        context: previous?.number === number ? { ...stoppedResource(previous.context, error), ...(latest?.context.value ? { value: latest.context.value } : {}) } : failedResource<PullContext>(error) }))
    }
    } finally { budget.dispose() }
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
      const next = await withRequestBudget({ signal: pullAbort.signal }, (options) => loaders.issueComments(current.data.repo, number, value!.page + 1, options))
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
    const snapshot: IssueDetailState = { ...detail, resource,
      comments: retainable(detail.comments), references: retainable(detail.references) }
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
    issueAbort.abort()
    issueReferencesAbort.abort()
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
    options: RequestOptions = { signal: issueAbort.signal },
  ) => {
    const revision = reactionRevision
    try {
      const target = repositorySnapshot(repository)
      const loaded = await withRequestBudget(options, (options) => loadPageSet(pageCount, (page) => loaders.issueComments(target, number, page, options), (comment) => comment.id, options))
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

  const fetchIssueReferences = async (repository: string, number: number, request: number, previous?: IssueReference[], options: RequestOptions = { signal: issueAbort.signal }) => {
    issueReferencesAbort.abort()
    issueReferencesAbort = new AbortController()
    options = { ...options, signal: AbortSignal.any([options.signal ?? issueAbort.signal, issueReferencesAbort.signal]) }
    const referenceRequest = ++issueReferencesGeneration
    try {
      const target = repositorySnapshot(repository)
      const timeline = await withRequestBudget(options, async (options) => loaders.issueTimeline
        ? loaders.issueTimeline(target, number, options)
        : { references: await loaders.issueReferences(target, number, options), events: [] })
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
    if (current.status !== "ready" || (previous?.number === number && previous.resource.status === "loading")) return
    restoreCommentDraft(number, "issue")
    issueAbort.abort()
    issueAbort = new AbortController()
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
    const budget = createRequestBudget(issueAbort.signal)
    const requestOptions = { signal: issueAbort.signal, budget }
    try {
    const request = ++issueGeneration
    const value = previous?.number === number ? previous.resource.value : undefined
    let comments = previous?.number === number ? previous.comments.value : undefined
    const references = previous?.number === number ? previous.references.value : undefined
    let events = previous?.number === number ? previous.events ?? [] : []
    setIssueDetail({ number, resource: loadingResource(value), comments: loadingResource(comments), references: loadingResource(references), events })
    try {
      const key = issueKey(repository, number)
      let writeRevision = issueWriteRevision.get(key)
      let actionRevision = issueActionRevision.get(key)
      let issue = await loaders.issue(current.data.repo, number, requestOptions)
      if (request !== issueGeneration) return
      // A confirmed state change is GitHub's own response to the write; an earlier read must not replace it.
      while (actionRevision !== issueActionRevision.get(key)) {
        const confirmed = issueDetail()?.resource.value
        if (confirmed) { issue = confirmed; break }
        actionRevision = issueActionRevision.get(key)
        issue = await loaders.issue(current.data.repo, number, requestOptions)
        if (request !== issueGeneration) return
      }
      // Retain confirmed comment metadata without discarding fresh title, lock state or permissions.
      while (writeRevision !== issueWriteRevision.get(key)) {
        const confirmed = issueDetail()?.resource.value
        if (confirmed) {
          issue = { ...issue, commentCount: Math.max(issue.commentCount, confirmed.commentCount),
            updatedAt: Date.parse(issue.updatedAt) >= Date.parse(confirmed.updatedAt) ? issue.updatedAt : confirmed.updatedAt }
          break
        }
        writeRevision = issueWriteRevision.get(key)
        issue = await loaders.issue(current.data.repo, number, requestOptions)
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
        hasComments ? fetchIssueComments(repository, number, request, comments?.page ?? 1, comments, requestOptions) : Promise.resolve(),
        fetchIssueReferences(repository, number, request, references, requestOptions),
      ])
      if (request === issueGeneration) retainIssue(issueDetail(), true)
    } catch (error) {
      if (request === issueGeneration) setIssueDetail((latest) => ({ number, resource: failedResource(error, latest?.resource.value ?? value),
        comments: previous?.number === number ? { ...stoppedResource(previous.comments, error), ...(latest?.comments.value ? { value: latest.comments.value } : {}) }
          : { status: "ready", value: latest?.comments.value ?? { items: [], page: 1, hasMore: false } },
        references: previous?.number === number ? stoppedResource(previous.references, error) : { status: "ready", value: [] },
        events: latest?.events ?? events }))
    }
    } finally { budget.dispose() }
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
      const next = await withRequestBudget({ signal: issueAbort.signal }, (options) => loaders.issueComments(current.data.repo, number, value!.page + 1, options))
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
  const assignableUsers = () => {
    const current = state()
    return current.status === "ready" ? assignableUserCache()[String(current.data.repo.id)] : undefined
  }
  const loadAssignableUsers = async () => {
    const current = state()
    if (current.status !== "ready") return
    const key = String(current.data.repo.id)
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
      const next = await loaders.assignableUsers(current.data.repo, nextPage, repositoryReads())
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

  const searchMentionableUsers = async (query: string, callerSignal?: AbortSignal): Promise<readonly string[]> => {
    if (!/^[a-z\d-]{0,39}$/i.test(query)) throw new TypeError("Invalid username query.")
    const current = state()
    if (current.status !== "ready") throw new Error("Open a repository before searching users.")
    const signal = AbortSignal.any([repositoryAbort.signal, ...(callerSignal ? [callerSignal] : [])])
    signal.throwIfAborted()
    const normalized = query.toLowerCase()
    const key = `${current.data.repo.id}:${normalized}`
    const cached = mentionUserCache.get(key)
    if (cached) return cached
    if (!loaders.mentionableUsers) throw new Error("User suggestions are unavailable.")
    const scope = repositoryScope
    const items = await withRequestBudget({ signal }, options => loaders.mentionableUsers!(current.data.repo, normalized, options))
    signal.throwIfAborted()
    const latest = state()
    if (scope !== repositoryScope || latest.status !== "ready" || latest.data.repo.id !== current.data.repo.id)
      throw new DOMException("Repository changed.", "AbortError")
    const result = Object.freeze([...items])
    mentionUserCache.set(key, result)
    if (mentionUserCache.size > 40) mentionUserCache.delete(mentionUserCache.keys().next().value!)
    return result
  }

  const readDraft = (draftKey: string) => {
    const dirty = dirtyDrafts.get(draftKey)
    if (dirty) return dirty
    if (!draftStore) return savedDrafts().get(draftKey)
    try {
      const draft = draftStore.load(draftKey)
      persistedDrafts.set(draftKey, draft)
      draftErrors.delete(`load:${draftKey}`)
      return draft
    } catch (error) {
      draftErrors.set(`load:${draftKey}`, `Draft load failed: ${messageFrom(error)}`)
      return savedDrafts().get(draftKey)
    } finally { publishDraftError() }
  }
  const restoreCommentDraft = (number: number, parent: IssueActionParent = "issue") => {
    const draftKey = `${issueKey(state().repository, number, parent)}:comment`
    if (!draftStore || savedDrafts().has(draftKey)) return
    const draft = readDraft(draftKey)
    if (!draftErrors.has(`load:${draftKey}`)) rememberDraft(draftKey, draft ?? draftSnapshot(emptyIssueAction))
  }
  const commentDraft = (number: number, parent: IssueActionParent = "issue") => {
    const key = issueKey(state().repository, number, parent)
    const action = issueActions()[key]
    return action && (activeDraftKinds.get(key) === "comment" || unpreparedDraftEdits.has(key))
      ? action.body : savedDrafts().get(`${key}:comment`)?.body ?? ""
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
  type DraftCompletion = { draftKey: string; generation?: string }
  const postComment = async (repository: Repo, number: number, key: string, body: string, kind: DraftKind) => {
    if (!loaders.createIssueComment) throw new Error("Commenting is unavailable.")
    const draftKind = activeDraftKinds.get(key) ?? kind
    const draftKey = `${key}:${draftKind}`
    let submitted: IssueDraft | undefined
    if (draftStore) {
      if (!savedDrafts().has(draftKey)) {
        const loaded = draftStore.load(draftKey)
        persistedDrafts.set(draftKey, loaded)
        rememberDraft(draftKey, loaded ?? draftSnapshot(emptyIssueAction))
      }
      activeDraftKinds.set(key, draftKind)
      saveDraft(key, issueActions()[key] ?? emptyIssueAction)
      submitted = savedDrafts().get(draftKey)!
      if (submitted.body !== body) throw new DraftConflictError()
      if (dirtyDrafts.has(draftKey)) persistDraft(draftKey, submitted)
      publishDraftError()
    }
    const guard: IssueCommentDraft | undefined = submitted && draftStore ? {
      generation: submitted.generation,
      withCurrent: publish => draftStore.withCurrent(draftKey, submitted!.generation, body, publish),
    } : undefined
    let settled = false
    let recovered = false
    let commentCount: number | undefined
    let completion: DraftCompletion | undefined
    const onConfirmed: IssueCommentConfirmation = (_comment, wasRecovered, total) => {
      const current = issueActions()[key] ?? emptyIssueAction
      const action = { ...current, body: "", reason: submitted?.reason ?? current.reason, retry: kind === "comment" ? undefined : kind }
      if (draftStore && submitted) {
        let replacement = draftSnapshot(action)
        try {
          try { draftStore.save(draftKey, replacement, submitted.generation) }
          catch (error) {
            if (!(error instanceof DraftConflictError)) throw error
            // A newer revision retires this one too; preserve it and verify its durability.
            const latest = draftStore.load(draftKey)
            if (latest) { draftStore.save(draftKey, latest, latest.generation); replacement = latest }
            else draftStore.save(draftKey, replacement, undefined)
          }
        } catch (error) {
          const message = `Comment confirmed, but its draft could not be settled: ${messageFrom(error)}. Retry after fixing local storage; the comment will not be posted again.`
          draftErrors.set(`save:${draftKey}`, message)
          publishDraftError()
          throw new Error(message)
        }
        completion = { draftKey }
        if (savedDrafts().get(draftKey)?.generation === submitted.generation) {
          persistedDrafts.set(draftKey, replacement)
          pendingPublications.delete(draftKey)
          rememberDraft(draftKey, replacement)
          if (dirtyDrafts.get(draftKey)?.generation === submitted.generation) dirtyDrafts.delete(draftKey)
          draftErrors.delete(`save:${draftKey}`)
          publishDraftError()
          setIssueActions(actions => ({ ...actions, [key]: { ...current,
            body: replacement.body, reason: replacement.reason, retry: replacement.retry } }))
          if (sameDraft(replacement, action)) completion.generation = replacement.generation
        }
      } else setIssueActions(actions => ({ ...actions, [key]: action }))
      recovered = wasRecovered
      commentCount = total
      settled = true
    }
    const comment = await (guard
      ? loaders.createIssueComment(repository, number, body, onConfirmed, draftKey, guard)
      : loaders.createIssueComment(repository, number, body, onConfirmed, draftKey))
    // Injected loaders can return a plain comment without an acknowledgement callback.
    if (!settled) onConfirmed(comment, false)
    return { comment, recovered, commentCount, completion }
  }
  const completeAction = (key: string, completion?: DraftCompletion) => {
    if (completion && (!completion.generation || savedDrafts().get(completion.draftKey)?.generation !== completion.generation)) {
      updateAction(key, action => ({ ...action, operation: idle() }))
      return
    }
    updateAction(key, () => emptyIssueAction, true)
  }
  const prepareIssueAction = (number: number, kind: IssueActionKind, parent: IssueActionParent = "issue") => {
    if (parent === "pull" && kind === "duplicate") throw new Error("Pull requests cannot be marked as duplicates.")
    const key = issueKey(state().repository, number, parent)
    const current = issueActions()[key]
    if (current?.operation.status !== "loading" && (kind === "comment" || kind === "close" || kind === "reopen")) {
      const previousKind = activeDraftKinds.get(key)
      if (previousKind && previousKind !== kind && current) saveDraft(key, current)
      const draftKey = `${key}:${kind}`
      const draft = readDraft(draftKey)
      const hasEdits = !previousKind && current && unpreparedDraftEdits.has(key)
      const restored = { ...emptyIssueAction,
        ...(draft ? { body: draft.body, reason: draft.reason, retry: draft.retry } : {}),
        ...(hasEdits ? { body: current.body, reason: current.reason, retry: current.retry } : {}),
        selectedAssignees: current?.selectedAssignees, duplicateTarget: current?.duplicateTarget }
      activeDraftKinds.set(key, kind)
      setIssueActions((actions) => ({ ...actions, [key]: restored }))
      rememberDraft(draftKey, draft ?? draftSnapshot(emptyIssueAction))
      if (hasEdits) saveDraft(key, restored)
      unpreparedDraftEdits.delete(key)
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
    const key = issueKey(state().repository, number, parent)
    if (issueActions()[key]?.operation.status === "loading") return
    const kind = activeDraftKinds.get(key)
    if (draftStore && kind) {
      const draftKey = `${key}:${kind}`
      try {
        const latest = draftStore.load(draftKey)
        const dirty = dirtyDrafts.get(draftKey)
        if (latest?.generation !== persistedDrafts.get(draftKey)?.generation
          && !(dirty && latest?.generation === dirty.generation && sameDraft(latest, dirty))) {
          // Discard stale local edits, not another process's newer draft.
          persistedDrafts.set(draftKey, latest)
          rememberDraft(draftKey, latest ?? draftSnapshot(emptyIssueAction))
          dirtyDrafts.delete(draftKey)
          pendingPublications.delete(draftKey)
          draftErrors.delete(`save:${draftKey}`)
          draftErrors.delete(`load:${draftKey}`)
          setIssueActions(actions => ({ ...actions, [key]: { ...emptyIssueAction,
            ...(latest ? { body: latest.body, reason: latest.reason, retry: latest.retry } : {}) } }))
          publishDraftError()
          return
        }
        persistedDrafts.set(draftKey, latest)
        pendingPublications.delete(draftKey)
      } catch (error) {
        draftErrors.set(`load:${draftKey}`, `Draft load failed: ${messageFrom(error)}`)
        publishDraftError()
        return
      }
    }
    updateAction(key, () => emptyIssueAction)
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

  const revalidateReturnedOverview = (key: string, scope: "issues" | "pulls") => {
    const current = state()
    const originId = Number(key.split("#")[0]?.split("@")[1])
    if (current.status !== "ready" || current.data.repo.id !== originId) return
    void loadResources(current.repository, current.data.currentBranch, current.data.repo,
      repositoryGeneration, current.data, scope)
  }

  const reconcileIssueState = (repository: string, number: number, updated: IssueDetail, scope: number, reactionRead: number, key: string) => {
    confirmIssueWrite(key)
    issueActionRevision.set(key, (issueActionRevision.get(key) ?? 0) + 1)
    const stillHere = () => scope === repositoryScope && state().repository === repository
    if (!stillHere()) {
      revalidateReturnedOverview(key, "issues")
      return updated
    }
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
      void loaders.metadata(repository, repositoryReads()).then((repo) => {
        if (!stillHere() || request !== repositoryGeneration) return
        if (repo.id !== repositoryIds.get(repository.toLowerCase())) return invalidateRepository(repository)
        if (repo.nameWithOwner.toLowerCase() !== repository.toLowerCase()) return
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
    if (current.status !== "ready" || detail?.number !== number || !pull || detail.resource.status !== "ready")
      throw new Error(detail?.number === number && detail.resource.status === "error"
        ? "Reload the pull request successfully before commenting." : "Wait for the pull request to load before commenting.")
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
      const { comment, recovered, commentCount } = await postComment(current.data.repo, number, key, action.body, "comment")
      confirmIssueWrite(key)
      postedComments.set(key, [...(postedComments.get(key) ?? []).filter(item => item.id !== comment.id), comment])
      updateAction(key, (draft) => ({ ...draft, operation: idle() }))
      if (stillHere()) {
        setPullDetail((latest) => {
          if (latest?.number !== number) return latest
          const comments = latest.comments.value ?? { items: [], page: 0, hasMore: true }
          const items = [...comments.items.filter((item) => item.id !== comment.id), comment]
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          return {
            ...latest,
            resource: latest.resource.value ? { ...latest.resource, value: {
              ...latest.resource.value, commentCount: Math.max(latest.resource.value.commentCount, commentCount ?? (recovered ? items.length : pull.commentCount + 1)),
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

  const reconcilePullState = (repository: string, number: number, updated: PullRequestDetail, scope: number, reactionRead: number, key: string) => {
    confirmIssueWrite(key)
    pullActionRevision.set(key, (pullActionRevision.get(key) ?? 0) + 1)
    if (scope !== repositoryScope || state().repository !== repository) {
      revalidateReturnedOverview(key, "pulls")
      return updated
    }
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
      const loaded = await loaders.updatePullDraft(current.data.repo, number, draft)
      if (loaded.number !== number || loaded.draft !== draft || loaded.state !== "open" || loaded.merged
        || pull.nodeId !== undefined && loaded.nodeId !== pull.nodeId)
        throw new Error("GitHub did not confirm the draft change. Check GitHub before retrying.")
      const here = scope === repositoryScope && state().repository === repository
      // Draft transitions invalidate context even when the head commit is unchanged.
      if (here && pullDetail()?.number === number) ++pullDraftGeneration
      const updated = reconcilePullState(repository, number, loaded, scope, reactionRead, key)
      if (here && pullDetail()?.number === number) {
        const request = pullGeneration
        const generation = pullDraftGeneration
        const revision = pullActionRevision.get(key)
        setPullDetail(latest => latest?.number === number ? { ...latest, context: loadingResource<PullContext>() } : latest)
        void fetchPullContext(repository, number, request)
        // Refresh capabilities, but never replace a confirmed stage with an eventually-consistent read.
        void (async () => {
          try {
            const fresh = await withRequestBudget({ signal: pullAbort.signal }, (options) => loaders.pull(current.data.repo, number, options))
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
    const message = await loaders.pullMergeMessage(current.data.repo, number, expectedHeadSha)
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
      const loaded = await loaders.mergePull(current.data.repo, number, method, expectedHeadSha, message)
      if (loaded.number !== number || !loaded.merged || loaded.state !== "closed" || loaded.headSha !== expectedHeadSha
        || pull.nodeId !== undefined && loaded.nodeId !== pull.nodeId)
        throw new Error("GitHub did not confirm the merge. Check GitHub before retrying.")
      const updated = reconcilePullState(repository, number, loaded, scope, reactionRead, key)
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
    let commentCompletion: DraftCompletion | undefined
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
        const loaded = await loaders.setIssueAssignees(current.data.repo, number, selected)
        const confirmed = new Set(loaded.assignees.map((login) => login.toLowerCase()))
        if (loaded.number !== number || confirmed.size !== selected.length || selected.some((login) => !confirmed.has(login.toLowerCase())))
          throw new Error("GitHub did not confirm the requested assignees.")
        // The issues endpoint cannot supply PR-specific fields or permissions.
        const latest = scope === repositoryScope && state().repository === repository && pullDetail()?.number === number
          ? pullDetail()?.resource.value ?? pull : pull
        const updated = reconcilePullState(repository, number, { ...latest, assignees: loaded.assignees, updatedAt: loaded.updatedAt }, scope, reactionRead, key)
        updateAction(key, (draft) => ({ ...draft, selectedAssignees: undefined, operation: idle() }))
        return { pull: updated }
      }
      if (!loaders.updatePullState) throw new Error("Pull request state changes are unavailable.")
      if (!action.retry && action.body.trim()) {
        if (!pull.permissions.comment) throw new Error("You do not have permission to comment on this pull request.")
        const { comment, recovered, commentCount, completion } = await postComment(current.data.repo, number, key, action.body, kind)
        commentCompletion = completion
        result.comment = comment
        confirmIssueWrite(key)
        postedComments.set(key, [...(postedComments.get(key) ?? []).filter(item => item.id !== comment.id), comment])
        if (scope === repositoryScope && state().repository === repository) setPullDetail((latest) => {
          if (latest?.number !== number) return latest
          const comments = latest.comments.value ?? { items: [], page: 0, hasMore: true }
          const items = [...comments.items.filter((item) => item.id !== comment.id), comment]
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          return {
            ...latest,
            resource: latest.resource.value ? { ...latest.resource, value: {
              ...latest.resource.value, commentCount: Math.max(latest.resource.value.commentCount, commentCount ?? (recovered ? items.length : pull.commentCount + 1)),
              updatedAt: Date.parse(latest.resource.value.updatedAt) >= Date.parse(comment.createdAt) ? latest.resource.value.updatedAt : comment.createdAt,
            } } : latest.resource,
            comments: { ...latest.comments, value: { ...comments, items } },
          }
        })
      }
      const nextState = kind === "close" ? "closed" : "open"
      const reactionRead = reactionRevision
      const loaded = await loaders.updatePullState(current.data.repo, number, nextState)
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
      }, scope, reactionRead, key)
      completeAction(key, commentCompletion)
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
    let commentCompletion: DraftCompletion | undefined
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
        const loaded = await loaders.setIssueAssignees(current.data.repo, number, selected)
        if (loaded.number !== number) throw new Error("GitHub returned a different issue.")
        const updated = reconcileIssueState(repository, number, loaded, scope, reactionRead, key)
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
        const loaded = await loaders.markIssueDuplicate(current.data.repo, number, canonicalNumber)
        if (loaded.number !== number || loaded.state !== "closed" || loaded.stateReason !== "duplicate")
          throw new Error("GitHub did not confirm that this issue was closed as a duplicate.")
        const updated = reconcileIssueState(repository, number, loaded, scope, reactionRead, key)
        // Duplicate marking must not post or discard an unrelated comment draft.
        updateAction(key, (draft) => ({ ...draft, duplicateTarget: "", operation: idle() }))
        return { issue: updated, duplicateOf: canonicalNumber }
      }
      if (kind === "comment" && !action.body.trim()) throw new Error("Write a comment before posting.")
      if (kind !== "comment" && !loaders.updateIssueState) throw new Error("Issue state changes are unavailable.")
      if (!action.retry && action.body.trim()) {
        const { comment, recovered, commentCount, completion } = await postComment(current.data.repo, number, key, action.body, kind)
        commentCompletion = completion
        result.comment = comment
        confirmIssueWrite(key)
        postedComments.set(key, [...(postedComments.get(key) ?? []).filter(item => item.id !== comment.id), comment])
        if (stillHere()) setIssueDetail((latest) => {
          if (latest?.number !== number) return latest
          const comments = latest.comments.value ?? { items: [], page: 0, hasMore: true }
          const items = [...comments.items.filter((item) => item.id !== comment.id), comment]
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          return {
            ...latest,
            resource: latest.resource.value ? { ...latest.resource, value: {
              ...latest.resource.value, commentCount: Math.max(latest.resource.value.commentCount, commentCount ?? (recovered ? items.length : issue.commentCount + 1)),
              updatedAt: Date.parse(latest.resource.value.updatedAt) >= Date.parse(comment.createdAt) ? latest.resource.value.updatedAt : comment.createdAt,
            } } : latest.resource,
            comments: { ...latest.comments, value: { ...comments, items } },
          }
        })
      }
      if (kind !== "comment") {
        const nextState = kind === "close" ? "closed" : "open"
        const reactionRead = reactionRevision
        const updated = await loaders.updateIssueState!(current.data.repo, number, nextState, action.reason)
        if (updated.state !== nextState) throw new Error("GitHub did not change the issue state. Check your permissions on GitHub.")
        result.issue = reconcileIssueState(repository, number, updated, scope, reactionRead, key)
      }
      completeAction(key, commentCompletion)
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
  const settledData = (data: RepositoryData): RepositoryData => ({ ...data,
    workCounts: retainable(data.workCounts),
    documents: data.documents.value === undefined ? retainable(data.documents)
      : { ...retainable(data.documents), value: data.documents.value.map((document) => ({ ...document, resource: retainable(document.resource) })) },
    branches: retainable(data.branches), commits: retainable(data.commits), commitCount: retainable(data.commitCount),
    issues: { open: retainable(data.issues.open), closed: retainable(data.issues.closed) },
    pulls: { open: retainable(data.pulls.open), closed: retainable(data.pulls.closed) },
    runs: retainable(data.runs) })
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
  const invalidRepositories = new Set<string>()
  const clearRepositoryDetails = () => {
    clearDiff()
    documentsAbort.abort()
    ++repositoryScope
    clearCommit()
    clearRun()
    clearIssue()
    clearPull()
  }
  function invalidateRepository(repository: string) {
    resetRepositoryReads()
    invalidRepositories.add(repository.toLowerCase())
    repositoryCache.markStale(repository.toLowerCase())
    clearRepositoryDetails()
    ++repositoryGeneration
    ++branchGeneration
    setState({ status: "error", repository, message: "The repository identity changed. Reopen and verify the intended repository before continuing." })
  }
  const canonicalRepository = (repo: Repo) => {
    const canonical = normalizeRepository(repo.nameWithOwner)
    if (!canonical || !Number.isSafeInteger(repo.id) || repo.id <= 0 || typeof repo.nodeId !== "string" || !repo.nodeId.trim())
      throw new Error("GitHub returned an invalid repository identity.")
    return canonical
  }
  const load = async (repository: string, scope: RepositoryScope = "full", expectedId?: number) => {
    retainRepository(state(), false)
    resetRepositoryReads()
    clearRepositoryDetails()
    const request = ++repositoryGeneration
    ++branchGeneration
    const retained = invalidRepositories.has(repository.toLowerCase()) ? undefined : repositoryCache.get(repository.toLowerCase())
    const cached = expectedId === undefined || retained?.value.repo.id === expectedId ? retained : undefined
    // Overview snapshots are indexed by canonical name and validate their stable ID on revalidation.
    if (cached) {
      // Reopen on the default branch: branch-specific commits/documents are only reusable there.
      const onDefault = cached.value.currentBranch === cached.value.repo.defaultBranch
      let data = onDefault ? cached.value
        : { ...cached.value, currentBranch: cached.value.repo.defaultBranch, commits: loadingResource<Paginated<CommitSummary>>(),
          commitCount: loadingResource<number>(), documents: loadingResource<RepositoryDocumentState[]>() }
      const revalidate = cached.stale || !onDefault
      if (revalidate && scope !== "full") data = {
        ...data,
        workCounts: deferredResource(data.workCounts.value), documents: deferredResource(data.documents.value),
        branches: deferredResource(data.branches.value), commits: deferredResource(data.commits.value),
        commitCount: deferredResource(data.commitCount.value), runs: deferredResource(data.runs.value),
        issues: { open: deferredResource(data.issues.open.value), closed: deferredResource(data.issues.closed.value) },
        pulls: { open: deferredResource(data.pulls.open.value), closed: deferredResource(data.pulls.closed.value) },
      }
      repositoryIds.set(repository.toLowerCase(), data.repo.id)
      setState({ status: "ready", repository, data, operations: { refresh: revalidate ? loading() : idle(), branch: idle() } })
      if (!revalidate) { await ensure(scope); return }
      try {
        const repo = await loaders.metadata(repository, repositoryReads())
        if (request !== repositoryGeneration) return
        const canonical = canonicalRepository(repo)
        if (repo.id !== data.repo.id || expectedId !== undefined && repo.id !== expectedId) return invalidateRepository(repository)
        if (canonical.toLowerCase() !== repository.toLowerCase()) return load(canonical, scope, repo.id)
        repositoryIds.set(canonical.toLowerCase(), repo.id)
        // Reopen on the fresh default branch before starting branch-guarded requests.
        // Keep stale values only on the same branch; unrequested sections remain deferred.
        const branchResources = data.currentBranch === repo.defaultBranch ? {} : {
          documents: deferredResource<RepositoryDocumentState[]>(),
          commits: deferredResource<Paginated<CommitSummary>>(),
          commitCount: deferredResource<number>(),
        }
        data = { ...data, repo, currentBranch: repo.defaultBranch, ...branchResources }
        setState((latest) => latest.status === "ready" && latest.repository === repository ? { ...latest, data: {
          ...latest.data, repo, currentBranch: repo.defaultBranch, ...branchResources,
        } } : latest)
        await loadResources(repository, repo.defaultBranch, repo, request, data, scope)
        updateReady(setState, request, generation, repository, (latest) => ({ ...latest, operations: { ...latest.operations, refresh: idle() } }))
        if (request === repositoryGeneration) { await ensure(scope); retainRepository(state(), true) }
      } catch (error) {
        // Sections never left without a value and no way to retry.
        const failed = <T>(resource: ResourceState<T>): ResourceState<T> => isLoading(resource) ? failedResource(error, resource.value) : resource
        updateReady(setState, request, generation, repository, (latest) => ({
          ...latest, operations: { ...latest.operations, refresh: { status: "error", message: messageFrom(error) } },
          data: { ...latest.data, commits: failed(latest.data.commits), commitCount: failed(latest.data.commitCount), documents: failed(latest.data.documents) } }))
      }
      return
    }
    setState({ status: "loading", repository })
    try {
      const repo = await loaders.metadata(repository, repositoryReads())
      if (request !== repositoryGeneration) return
      const canonical = canonicalRepository(repo)
      if (expectedId !== undefined && repo.id !== expectedId) return invalidateRepository(repository)
      repositoryIds.set(canonical.toLowerCase(), repo.id)
      invalidRepositories.delete(canonical.toLowerCase())
      setState({
        status: "ready",
        repository: canonical,
        data: initialData(repo),
        operations: { refresh: idle(), branch: idle() },
      })
      await loadResources(canonical, repo.defaultBranch, repo, request, undefined, scope, true)
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
      || current.operations.branch.status === "loading" || hasLoadingResource(current.data)
      || isLoading(current.data.workCounts) || isLoading(current.data.commitCount)) return

    resetRepositoryReads()
    const request = ++repositoryGeneration
    ++branchGeneration
    const repository = current.repository
    // Repository refresh is an explicit freshness request; this repository's retained details revalidate on next open.
    const inRepository = (key: string) => key.startsWith(`${cacheRepositoryKey(repository)}:`)
    issueCache.markStale(inRepository)
    pullCache.markStale(inRepository)
    runCache.markStale(inRepository)
    repositoryCache.markStale(repository.toLowerCase())
    setAssignableUserCache((cache) => {
      const next = { ...cache }
      delete next[String(current.data.repo.id)]
      return next
    })
    const branch = current.data.currentBranch
    mentionUserCache.clear()
    setState({ ...current, operations: { ...current.operations, refresh: loading() } })
    try {
      const repo = await loaders.metadata(repository, repositoryReads())
      if (request !== repositoryGeneration) return
      if (repo.id !== current.data.repo.id) return invalidateRepository(repository)
      const canonical = canonicalRepository(repo)
      if (canonical.toLowerCase() !== repository.toLowerCase()) return load(canonical, "full", repo.id)
      setState((latest) => latest.status !== "ready" || latest.repository !== repository
        ? latest
        : {
            ...latest,
            data: {
              ...latest.data,
              repo,
              workCounts: reloadResource(latest.data.workCounts),
              documents: reloadResource(latest.data.documents),
              branches: reloadResource(latest.data.branches),
              commits: reloadResource(latest.data.commits),
              commitCount: reloadResource(latest.data.commitCount),
              issues: {
                open: reloadResource(latest.data.issues.open),
                closed: reloadResource(latest.data.issues.closed),
              },
              pulls: {
                open: reloadResource(latest.data.pulls.open),
                closed: reloadResource(latest.data.pulls.closed),
              },
              runs: reloadResource(latest.data.runs),
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

    branchReadAbort.abort()
    branchReadAbort = new AbortController()
    const request = ++branchGeneration
    const repositoryRequest = repositoryGeneration
    const repository = current.repository
    documentsAbort.abort()
    documentsAbort = new AbortController()
    ++documentsGeneration
    const budget = createRequestBudget(documentsAbort.signal)
    const options = { signal: documentsAbort.signal, budget }
    setState({ ...current, operations: { ...current.operations, branch: loading() } })
    try {
      const [commits, documents] = await Promise.all([
        loaders.commits(current.data.repo, branch, 1, branchReads()),
        loaders.documents(current.data.repo, branch, options).then((sources) => {
          if (sources.length > MAX_AUTOMATIC_PAGES) throw new RequestBudgetLimitError("The repository has too many overview documents to load automatically")
          budget.consumeItems(sources.length)
          return mapBounded(sources, async (source) => ({
            ...source, resource: await loadDocument(() => loaders.document(current.data.repo, source, options)),
          }), options)
        }),
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
    } finally { budget.dispose() }
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
      const result = await loaders.branches(current.data.repo, current.data.repo.defaultBranch, nextPage, repositoryReads())
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
      const result = await loaders.commits(current.data.repo, branch, nextPage, branchReads())
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
      const result = await loaders.runs(current.data.repo, nextPage, repositoryReads())
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
      const result = await loaders.issues(current.data.repo, listState, nextPage, repositoryReads())
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
      const result = await loaders.pulls(current.data.repo, listState, nextPage, repositoryReads())
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
    searchMentionableUsers,
    issueAction,
    commentDraft,
    prepareIssueAction,
    updateIssueDraft,
    discardIssueDraft,
    submitIssueAction,
    load,
    refresh,
    retryResource,
    ensure,
    canSwitchBranch,
    switchBranch,
    loadMoreBranches,
    loadMoreCommits,
    loadMoreRuns,
    loadMoreIssues,
    loadMorePulls,
  }
}
