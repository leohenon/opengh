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
  createGitHubIssueComment,
  updateGitHubIssueState,
  markGitHubIssueDuplicate,
} from "./github/client"
import { GitHubApiError } from "./github/transport"
import { loadGitHubDiff } from "./github/diff"
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
  IssueActionResult,
  IssueCloseReason,
  IssueTimeline,
  ListState,
  Paginated,
  PullRequestDetail,
  PullContext,
  PullRequestSummary,
  Repo,
  RepositoryDocument,
  WorkflowRunSummary,
} from "./models"
import type {
  CommitDetailState,
  DiffState,
  IssueDetailState,
  IssueActionState,
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
  markIssueDuplicate?(repository: string, number: number, canonicalNumber: number): Promise<IssueDetail>
  issueTimeline?(repository: string, number: number): Promise<IssueTimeline>
  issues(repository: string, state: ListState, page?: number): Promise<Page<IssueSummary>>
  hasIssues?(repository: string, state: ListState): Promise<boolean>
  pull?(repository: string, number: number): Promise<PullRequestDetail>
  pullCommits(repository: string, number: number): Promise<CommitSummary[]>
  pullContext(repository: string, number: number): Promise<PullContext>
  pulls(repository: string, state: ListState, page?: number): Promise<Page<PullRequestSummary>>
  runs(repository: string, page?: number): Promise<Page<WorkflowRunSummary>>
}

export type RepositorySession = {
  state: Accessor<RepositoryState>
  diffs?: Accessor<Partial<Record<DiffTarget["kind"], DiffState>>>
  loadDiff?(target: DiffTarget, filesOnly?: boolean): Promise<void>
  clearDiff?(target?: DiffTarget): void
  commitDetail: Accessor<CommitDetailState | undefined>
  loadCommit(sha: string): Promise<void>
  loadMoreCommitFiles(): Promise<void>
  clearCommit(): void
  pullDetail: Accessor<PullDetailState | undefined>
  loadPull(number: number): Promise<void>
  loadMorePullComments(): Promise<void>
  retryPullReferences(): Promise<void>
  retryPullCommits(): Promise<void>
  retryPullContext(): Promise<void>
  clearPull(): void
  issueDetail: Accessor<IssueDetailState | undefined>
  loadIssue(number: number): Promise<void>
  loadMoreIssueComments(): Promise<void>
  retryIssueReferences(): Promise<void>
  clearIssue(): void
  issueAction(number: number): IssueActionState
  prepareIssueAction(number: number, kind: IssueActionKind): void
  updateIssueDraft(number: number, draft: Partial<Pick<IssueActionState, "body" | "reason" | "duplicateTarget">>): void
  discardIssueDraft(number: number): void
  submitIssueAction(number: number, kind: IssueActionKind): Promise<IssueActionResult>
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
  markIssueDuplicate: markGitHubIssueDuplicate,
  issueTimeline: loadGitHubIssueTimeline,
  issues: loadGitHubIssues,
  hasIssues: loadGitHubHasIssues,
  pull: loadGitHubPull,
  pullCommits: loadGitHubPullCommits,
  pullContext: loadGitHubPullContext,
  pulls: loadGitHubPulls,
  runs: loadGitHubRuns,
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
export function createRepositorySession(loaders: RepositoryLoaders = defaultLoaders): RepositorySession {
  const [state, setState] = createSignal<RepositoryState>({ status: "loading", repository: "" })
  const [commitDetail, setCommitDetail] = createSignal<CommitDetailState>()
  const [diffs, setDiffs] = createSignal<Partial<Record<DiffTarget["kind"], DiffState>>>({})
  const diffGeneration: Record<DiffTarget["kind"], number> = { commit: 0, pull: 0 }
  const diffAbort: Partial<Record<DiffTarget["kind"], AbortController>> = {}
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
  const loadDiff = async (target: DiffTarget, filesOnly = false) => {
    const current = state()
    if (current.status !== "ready") return
    const kind = target.kind
    diffAbort[kind]?.abort()
    const controller = new AbortController()
    diffAbort[kind] = controller
    const request = ++diffGeneration[kind]
    setDiffs((current) => ({ ...current, [kind]: { target, resource: loadingResource<DiffContent>() } }))
    try {
      if (!loaders.diff) throw new Error("Diff loading is unavailable")
      const value = await loaders.diff(current.repository, target, controller.signal, filesOnly)
      if (request === diffGeneration[kind] && !controller.signal.aborted)
        setDiffs((current) => ({ ...current, [kind]: { target, resource: { status: "ready", value } } }))
    } catch (error) {
      if (request === diffGeneration[kind] && !controller.signal.aborted)
        setDiffs((current) => ({ ...current, [kind]: { target, resource: failedResource<DiffContent>(error) } }))
    }
  }
  const [issueDetail, setIssueDetail] = createSignal<IssueDetailState>()
  const [issueActions, setIssueActions] = createSignal<Record<string, IssueActionState>>({})
  const emptyIssueAction: IssueActionState = { body: "", reason: "completed", operation: idle() }
  const issueKey = (repository: string, number: number) => `${repository.toLowerCase()}#${number}`
  const postedComments = new Map<string, IssueComment[]>()
  const issueWriteRevision = new Map<string, number>()
  const confirmIssueWrite = (key: string) => issueWriteRevision.set(key, (issueWriteRevision.get(key) ?? 0) + 1)
  let repositoryScope = 0
  const issueListGeneration: Record<ListState, number> = { open: 0, closed: 0 }
  const [pullDetail, setPullDetail] = createSignal<PullDetailState>()
  let pullGeneration = 0
  let issueGeneration = 0
  let issueReferencesGeneration = 0
  let commitGeneration = 0
  let repositoryGeneration = 0
  let branchGeneration = 0
  let commitCountGeneration = 0
  const generation = () => repositoryGeneration

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
    try {
      const result = await loadPageSet(pageCount, (page) => loaders.pulls(repository, listState, page), (item) => item.number)
      updateReady(setState, request, generation, repository, (current) => ({
        ...current,
        data: {
          ...current.data,
          pulls: { ...current.data.pulls, [listState]: { status: "ready", value: result } },
        },
      }))
    } catch (error) {
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
    try {
      const result = await loadPageSet(pageCount, (page) => loaders.runs(repository, page), (item) => item.id)
      updateReady(setState, request, generation, repository, (current) => ({
        ...current,
        data: { ...current.data, runs: { status: "ready", value: result } },
      }))
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

  const clearCommit = () => {
    ++commitGeneration
    setCommitDetail(undefined)
  }

  const loadCommit = async (sha: string) => {
    const current = state()
    const previous = commitDetail()
    if (current.status !== "ready" || (previous?.sha === sha && previous.resource.status === "loading")) return
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

  const clearPull = () => {
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
    try {
      const value = await loadPageSet(pageCount, (page) => loaders.issueComments(repository, number, page), (comment) => comment.id)
      if (request !== pullGeneration) return
      setPullDetail((current) => current?.number === number
        ? { ...current, comments: { status: "ready", value } } : current)
    } catch (error) {
      if (request !== pullGeneration) return
      setPullDetail((current) => current?.number === number
        ? { ...current, comments: failedResource(error, previous) } : current)
    }
  }

  const fetchPullReferences = async (repository: string, number: number, request: number, previous?: IssueReference[]) => {
    try {
      const timeline = loaders.issueTimeline
        ? await loaders.issueTimeline(repository, number)
        : { references: await loaders.issueReferences(repository, number), events: [] }
      if (request !== pullGeneration) return
      setPullDetail((current) => current?.number === number
        ? { ...current, references: { status: "ready", value: timeline.references }, events: timeline.events } : current)
    } catch (error) {
      if (request !== pullGeneration) return
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
    try {
      const value = await loaders.pullContext(repository, number)
      if (request !== pullGeneration) return
      setPullDetail((current) => current?.number === number ? { ...current, context: { status: "ready", value } } : current)
    } catch (error) {
      if (request !== pullGeneration) return
      setPullDetail((current) => current?.number === number ? { ...current, context: failedResource(error, previous) } : current)
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

  const loadPull = async (number: number) => {
    const current = state()
    const previous = pullDetail()
    if (current.status !== "ready" || (previous?.number === number
      && (previous.resource.status === "loading" || previous.comments.status === "loading"
        || previous.references.status === "loading" || previous.commits.status === "loading" || previous.context.status === "loading"))) return
    const repository = current.repository
    const request = ++pullGeneration
    const value = previous?.number === number ? previous.resource.value : undefined
    const comments = previous?.number === number ? previous.comments.value : undefined
    const references = previous?.number === number ? previous.references.value : undefined
    const commits = previous?.number === number ? previous.commits.value : undefined
    const context = previous?.number === number ? previous.context.value : undefined
    const events = previous?.number === number ? previous.events ?? [] : []
    setPullDetail({ number, resource: loadingResource(value), comments: loadingResource(comments),
      references: loadingResource(references), events, commits: loadingResource(commits), context: loadingResource(context) })
    try {
      const pull = await (loaders.pull ?? loadGitHubPull)(repository, number)
      if (request !== pullGeneration) return
      setPullDetail({ number, resource: { status: "ready", value: pull },
        comments: pull.commentCount === 0
          ? { status: "ready", value: { items: [], page: 1, hasMore: false } } : loadingResource(comments),
        references: loadingResource(references), events,
        commits: pull.commitCount === 0 ? { status: "ready", value: [] } : loadingResource(commits), context: loadingResource(context) })
      await Promise.all([
        pull.commentCount > 0 ? fetchPullComments(repository, number, request, comments?.page ?? 1, comments) : Promise.resolve(),
        fetchPullReferences(repository, number, request, references),
        pull.commitCount > 0 ? fetchPullCommits(repository, number, request, commits) : Promise.resolve(),
        fetchPullContext(repository, number, request, context),
      ])
    } catch (error) {
      if (request === pullGeneration) setPullDetail({ number, resource: failedResource(error, value),
        comments: previous?.number === number ? previous.comments : { status: "ready", value: { items: [], page: 1, hasMore: false } },
        references: previous?.number === number ? previous.references : { status: "ready", value: [] },
        events, commits: previous?.number === number ? previous.commits : { status: "ready", value: [] },
        context: previous?.number === number ? previous.context : failedResource<PullContext>(error) })
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
    const reload = value === undefined || (detail.comments.status === "error" && detail.comments.phase === "load")
    if (!reload && !value?.hasMore) return
    setPullDetail({ ...detail, comments: loadingResource(value, reload ? "load" : "pagination") })
    if (reload) return fetchPullComments(current.repository, number, request, value?.page ?? 1, value)
    try {
      const next = await loaders.issueComments(current.repository, number, value!.page + 1)
      if (request !== pullGeneration) return
      const ids = new Set(value!.items.map((comment) => comment.id))
      const items = next.items.filter((comment) => {
        if (ids.has(comment.id)) return false
        ids.add(comment.id)
        return true
      })
      setPullDetail((latest) => latest?.number === number ? {
        ...latest, comments: { status: "ready", value: page({ items: [...value!.items, ...items], hasMore: next.hasMore }, value!.page + 1) },
      } : latest)
    } catch (error) {
      if (request === pullGeneration) setPullDetail((latest) => latest?.number === number
        ? { ...latest, comments: failedResource(error, value, "pagination") } : latest)
    }
  }

  const clearIssue = () => {
    ++issueGeneration
    setIssueDetail(undefined)
  }

  // Keep confirmed new comments visible across unloaded pages and refreshes. Once the
  // server returns a comment, it owns that entry again (including later edits/deletion).
  const withPostedComments = (
    repository: string, number: number, value: Paginated<IssueComment>, returned: readonly IssueComment[] = value.items,
  ): Paginated<IssueComment> => {
    const key = issueKey(repository, number)
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
    try {
      const loaded = await loadPageSet(pageCount, (page) => loaders.issueComments(repository, number, page), (comment) => comment.id)
      if (request !== issueGeneration) return
      const value = withPostedComments(repository, number, loaded)
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

  const loadIssue = async (number: number) => {
    const current = state()
    const previous = issueDetail()
    if (current.status !== "ready" || (previous?.number === number
      && (previous.resource.status === "loading" || previous.comments.status === "loading" || previous.references.status === "loading"))) return
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
          comments: { status: "ready", value: withPostedComments(current.repository, number,
            page({ items: [...merged.values()], hasMore: next.hasMore }, value!.page + 1), next.items) },
        }
      })
    } catch (error) {
      if (request === issueGeneration) setIssueDetail((latest) => latest?.number === number
        ? { ...latest, comments: failedResource(error, latest.comments.value ?? value, "pagination") } : latest)
    }
  }

  const issueAction = (number: number) => issueActions()[issueKey(state().repository, number)] ?? emptyIssueAction
  const updateAction = (key: string, update: (action: IssueActionState) => IssueActionState) => {
    setIssueActions((actions) => ({ ...actions, [key]: update(actions[key] ?? emptyIssueAction) }))
  }
  const prepareIssueAction = (number: number, kind: IssueActionKind) => {
    updateAction(issueKey(state().repository, number), (action) => {
      if (action.operation.status === "loading" || action.retry === kind) return action
      // Selecting a new action must not resume a different failed state change.
      return { ...action, retry: undefined, operation: idle() }
    })
  }
  const updateIssueDraft = (number: number, draft: Partial<Pick<IssueActionState, "body" | "reason" | "duplicateTarget">>) => {
    updateAction(issueKey(state().repository, number), (action) => action.operation.status === "loading" || action.retry
      ? action : { ...action, ...draft, operation: idle() })
  }
  const discardIssueDraft = (number: number) => {
    updateAction(issueKey(state().repository, number), (action) => action.operation.status === "loading" ? action : emptyIssueAction)
  }

  const actionError = (error: unknown, locked: boolean) => {
    const message = messageFrom(error)
    if (!(error instanceof GitHubApiError)) return message
    if (error.status === 401) return `${message}. Run gh auth login and try again.`
    if (error.status === 403) return `${message}. ${locked
      ? "This thread is locked; maintainer access may be required."
      : "Your account may not have permission, or GitHub may be rate limiting requests."}`
    if (error.status === 404) return `${message}. The issue may be unavailable to your account.`
    if (error.status === undefined || error.status >= 500)
      return `${message}. GitHub did not confirm the change; check the issue on GitHub before retrying.`
    return message
  }

  const reconcileIssueState = (repository: string, number: number, updated: IssueDetail, scope: number) => {
    confirmIssueWrite(issueKey(repository, number))
    const stillHere = () => scope === repositoryScope && state().repository === repository
    if (!stillHere()) return
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
  }

  const submitIssueAction = async (number: number, kind: IssueActionKind): Promise<IssueActionResult> => {
    const current = state()
    const detail = issueDetail()
    const issue = detail?.resource.value
    if (current.status !== "ready" || detail?.number !== number || !issue || detail.resource.status === "loading")
      throw new Error("Wait for the issue to load before taking action.")
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
      if (!action.retry && kind !== "duplicate" && action.body.trim() && !issue.permissions.comment)
        throw new Error("You do not have permission to comment on this issue.")
      if (kind === "duplicate") {
        if (issue.state !== "open") throw new Error("Reopen the issue before marking it as a duplicate.")
        const match = action.duplicateTarget?.trim().match(/^#?([1-9]\d*)$/)
        const canonicalNumber = Number(match?.[1])
        if (!Number.isSafeInteger(canonicalNumber) || canonicalNumber <= 0) throw new Error("Enter a valid target issue number.")
        if (canonicalNumber === number) throw new Error("An issue cannot be a duplicate of itself.")
        if (!loaders.markIssueDuplicate) throw new Error("Marking duplicates is unavailable.")
        const updated = await loaders.markIssueDuplicate(repository, number, canonicalNumber)
        if (updated.number !== number || updated.state !== "closed" || updated.stateReason !== "duplicate")
          throw new Error("GitHub did not confirm that this issue was closed as a duplicate.")
        reconcileIssueState(repository, number, updated, scope)
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
        updateAction(key, (draft) => ({ ...draft, body: "", ...(kind !== "comment" ? { retry: kind } : {}) }))
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
        const updated = await loaders.updateIssueState!(repository, number, nextState, action.reason)
        if (updated.state !== nextState) throw new Error("GitHub did not change the issue state. Check your permissions on GitHub.")
        result.issue = updated
        reconcileIssueState(repository, number, updated, scope)
      }
      updateAction(key, () => ({ ...emptyIssueAction, reason: action.reason }))
      return result
    } catch (error) {
      const retry = issueActions()[key]?.retry
      const failure = actionError(error, issue.locked)
      const message = retry ? `Comment posted, but ${retry === "close" ? "closing" : "reopening"} failed. ${failure}` : failure
      updateAction(key, (draft) => ({ ...draft, operation: { status: "error", message } }))
      throw new Error(message)
    }
  }

  const load = async (repository: string) => {
    clearDiff()
    ++repositoryScope
    clearCommit()
    clearIssue()
    clearPull()
    const request = ++repositoryGeneration
    ++branchGeneration
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
    setState({
      ...current,
      data: { ...current.data, pulls: { ...current.data.pulls, [listState]: loadingResource(value, "pagination") } },
    })
    try {
      const result = await loaders.pulls(repository, listState, nextPage)
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
          pulls: { ...latest.data.pulls, [listState]: failedResource(error, latest.data.pulls[listState].value, "pagination") },
        },
      }))
    }
  }

  return {
    state,
    diffs,
    loadDiff,
    clearDiff,
    commitDetail,
    loadCommit,
    loadMoreCommitFiles,
    clearCommit,
    pullDetail,
    loadPull,
    loadMorePullComments,
    retryPullReferences,
    retryPullCommits,
    retryPullContext,
    clearPull,
    issueDetail,
    loadIssue,
    loadMoreIssueComments,
    retryIssueReferences,
    clearIssue,
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
