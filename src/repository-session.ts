import { createSignal, type Accessor, type Setter } from "solid-js"
import {
  loadGitHubBranches,
  loadGitHubCommit,
  loadGitHubCommits,
  loadGitHubContributing,
  loadGitHubIssues,
  loadGitHubLicense,
  loadGitHubMetadata,
  loadGitHubPulls,
  loadGitHubReadme,
  loadGitHubRuns,
  loadGitHubSecurity,
} from "./github/client"
import type {
  CommitDetail,
  CommitSummary,
  IssueSummary,
  ListState,
  Paginated,
  PullRequestSummary,
  Repo,
  WorkflowRunSummary,
} from "./models"
import type {
  CommitDetailState,
  OperationState,
  RepositoryData,
  RepositoryDocumentKind,
  RepositoryResource,
  RepositoryState,
  ResourcePhase,
  ResourceState,
} from "./repository-state"

type Page<T> = { items: T[]; hasMore: boolean }
type OptionalDocumentKind = Exclude<RepositoryDocumentKind, "readme">

export type RepositoryLoaders = {
  metadata(repository: string): Promise<Repo>
  readme(repository: string, branch: string): Promise<string>
  contributing(repository: string, branch: string): Promise<string | undefined>
  security(repository: string, branch: string): Promise<string | undefined>
  license(repository: string, branch: string): Promise<string | undefined>
  branches(repository: string, fallbackBranch: string, page?: number): Promise<Page<string>>
  commits(repository: string, branch: string, page?: number): Promise<Page<CommitSummary>>
  commit(repository: string, sha: string, page?: number): Promise<CommitDetail>
  issues(repository: string, state: ListState, page?: number): Promise<Page<IssueSummary>>
  pulls(repository: string, state: ListState, page?: number): Promise<Page<PullRequestSummary>>
  runs(repository: string, page?: number): Promise<Page<WorkflowRunSummary>>
}

export type RepositorySession = {
  state: Accessor<RepositoryState>
  commitDetail: Accessor<CommitDetailState | undefined>
  loadCommit(sha: string): Promise<void>
  loadMoreCommitFiles(): Promise<void>
  clearCommit(): void
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
  metadata: loadGitHubMetadata,
  readme: loadGitHubReadme,
  contributing: loadGitHubContributing,
  security: loadGitHubSecurity,
  license: loadGitHubLicense,
  branches: loadGitHubBranches,
  commits: loadGitHubCommits,
  commit: loadGitHubCommit,
  issues: loadGitHubIssues,
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

async function loadOptionalDocument(load: () => Promise<string | undefined>): Promise<ResourceState<string | undefined>> {
  try {
    return { status: "ready", value: await load() }
  } catch (error) {
    return failedResource(error)
  }
}

function hasLoadingResource(data: RepositoryData) {
  return data.readme.status === "loading"
    || data.contributing.status === "loading"
    || data.security.status === "loading"
    || data.license.status === "loading"
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
    readme: loadingResource(),
    contributing: loadingResource(),
    security: loadingResource(),
    license: loadingResource(),
    branches: loadingResource(),
    commits: loadingResource(),
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
  let commitGeneration = 0
  let repositoryGeneration = 0
  let branchGeneration = 0
  const generation = () => repositoryGeneration

  const fetchReadme = async (repository: string, branch: string, request: number) => {
    try {
      const value = await loaders.readme(repository, branch)
      updateReady(setState, request, generation, repository, (current) => current.data.currentBranch === branch
        ? { ...current, data: { ...current.data, readme: { status: "ready", value } } }
        : current)
    } catch (error) {
      updateReady(setState, request, generation, repository, (current) => current.data.currentBranch === branch
        ? { ...current, data: { ...current.data, readme: failedResource(error, current.data.readme.value) } }
        : current)
    }
  }

  const fetchOptionalDocument = async (
    kind: OptionalDocumentKind,
    repository: string,
    branch: string,
    request: number,
  ) => {
    try {
      const value = await loaders[kind](repository, branch)
      const resource: ResourceState<string | undefined> = { status: "ready", value }
      updateReady(setState, request, generation, repository, (current) => current.data.currentBranch === branch
        ? { ...current, data: { ...current.data, [kind]: resource } }
        : current)
    } catch (error) {
      updateReady(setState, request, generation, repository, (current) => current.data.currentBranch === branch
        ? { ...current, data: { ...current.data, [kind]: failedResource(error, current.data[kind].value) } }
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
    try {
      const result = await loadPageSet(pageCount, (page) => loaders.issues(repository, listState, page), (item) => item.number)
      updateReady(setState, request, generation, repository, (current) => ({
        ...current,
        data: {
          ...current.data,
          issues: { ...current.data.issues, [listState]: { status: "ready", value: result } },
        },
      }))
    } catch (error) {
      updateReady(setState, request, generation, repository, (current) => ({
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

  const loadResources = async (
    repository: string,
    branch: string,
    fallbackBranch: string,
    request: number,
    previous?: RepositoryData,
  ) => {
    await Promise.all([
      fetchReadme(repository, branch, request),
      fetchOptionalDocument("contributing", repository, branch, request),
      fetchOptionalDocument("security", repository, branch, request),
      fetchOptionalDocument("license", repository, branch, request),
      fetchBranches(repository, fallbackBranch, request, previous?.branches.value?.page),
      fetchCommits(repository, branch, request, previous?.commits.value?.page),
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

  const load = async (repository: string) => {
    clearCommit()
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
      await loadResources(repository, repo.defaultBranch, repo.defaultBranch, request)
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
              readme: loadingResource(latest.data.readme.value),
              contributing: loadingResource(latest.data.contributing.value),
              security: loadingResource(latest.data.security.value),
              license: loadingResource(latest.data.license.value),
              branches: loadingResource(latest.data.branches.value),
              commits: loadingResource(latest.data.commits.value),
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
      await loadResources(repository, branch, repo.defaultBranch, request, current.data)
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

    if (resource.kind === "readme") {
      setState({ ...current, data: { ...current.data, readme: loadingResource(current.data.readme.value) } })
      return fetchReadme(repository, branch, request)
    }
    if (resource.kind === "contributing" || resource.kind === "security" || resource.kind === "license") {
      const kind = resource.kind
      setState({ ...current, data: { ...current.data, [kind]: loadingResource(current.data[kind].value) } })
      return fetchOptionalDocument(kind, repository, branch, request)
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
      && current.data.commits.status !== "loading" && current.data.readme.status !== "loading"
      && current.data.contributing.status !== "loading" && current.data.security.status !== "loading"
      && current.data.license.status !== "loading"
  }

  const switchBranch = async (branch: string) => {
    const current = state()
    if (current.status !== "ready" || current.data.currentBranch === branch || !canSwitchBranch()) return

    const request = ++branchGeneration
    const repositoryRequest = repositoryGeneration
    const repository = current.repository
    setState({ ...current, operations: { ...current.operations, branch: loading() } })
    try {
      const [commits, readme, contributing, security, license] = await Promise.all([
        loaders.commits(repository, branch),
        loaders.readme(repository, branch),
        loadOptionalDocument(() => loaders.contributing(repository, branch)),
        loadOptionalDocument(() => loaders.security(repository, branch)),
        loadOptionalDocument(() => loaders.license(repository, branch)),
      ])
      setState((latest) => {
        if (repositoryRequest !== repositoryGeneration || request !== branchGeneration
          || latest.status !== "ready" || latest.repository !== repository) return latest
        return {
          ...latest,
          data: {
            ...latest.data,
            currentBranch: branch,
            readme: { status: "ready", value: readme },
            contributing,
            security,
            license,
            commits: { status: "ready", value: page(commits) },
          },
          operations: { ...latest.operations, branch: idle() },
        }
      })
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
    setState({
      ...current,
      data: { ...current.data, issues: { ...current.data.issues, [listState]: loadingResource(value, "pagination") } },
    })
    try {
      const result = await loaders.issues(repository, listState, nextPage)
      updateReady(setState, request, generation, repository, (latest) => {
        const latestValue = latest.data.issues[listState].value
        if (!latestValue || latestValue.page !== nextPage - 1) return latest
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
      updateReady(setState, request, generation, repository, (latest) => ({
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
    commitDetail,
    loadCommit,
    loadMoreCommitFiles,
    clearCommit,
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
