import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import type { Config } from "../config"
import type { ListState } from "../models"
import { back, navigate, type NavigationState, type Page } from "../navigation"
import type {
  RepositoryData,
  RepositoryDocumentKind,
  RepositoryOperations,
  RepositoryResource,
  ResourceState,
} from "../repository-state"
import { BranchPicker } from "./components/branch-picker"
import { Header } from "./components/header"
import { Help } from "./components/help"
import { StatusBar, type StatusKind } from "./components/status-bar"
import { ActionsScreen } from "./pages/actions"
import { CommitsScreen } from "./pages/commits"
import { OverviewScreen, type OverviewDocument } from "./pages/overview"
import { WorkScreen } from "./pages/work"
import { tabs } from "./tabs"
import { colors } from "./theme"

type Overlay = "help" | "branch-picker"

export type AppProps = {
  data: RepositoryData | (() => RepositoryData)
  operations: RepositoryOperations | (() => RepositoryOperations)
  config?: Config
  onQuit?: () => void
  onRefresh?: () => void
  onRetryResource?: (resource: RepositoryResource) => void
  onBranchChange?: (branch: string) => void
  onLoadMoreBranches?: () => Promise<void>
  onLoadMoreCommits?: () => Promise<void>
  onLoadMoreRuns?: () => Promise<void>
  onLoadMoreIssues?: (state: ListState) => Promise<void>
  onLoadMorePulls?: (state: ListState) => Promise<void>
}

export function App(props: AppProps) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [navigation, setNavigation] = createSignal<NavigationState>({ page: "overview" })
  const [issueState, setIssueState] = createSignal<ListState>("open")
  const [pullState, setPullState] = createSignal<ListState>("open")
  const [overviewDocument, setOverviewDocument] = createSignal<RepositoryDocumentKind>("readme")
  const [overlay, setOverlay] = createSignal<Overlay>()
  let overviewScroll: ScrollBoxRenderable | undefined
  let defaultStateRepository: string | undefined
  let issueDefaultResolved = false
  let pullDefaultResolved = false

  const data = () => typeof props.data === "function" ? props.data() : props.data
  const operations = () => typeof props.operations === "function" ? props.operations() : props.operations
  const page = () => navigation().page
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
  const visibleTabs = () => {
    const runs = data().runs
    return runs.status === "ready" && runs.value.items.length === 0
      ? tabs.filter((tab) => tab.page !== "actions")
      : tabs
  }
  const documentResource = (kind: RepositoryDocumentKind) => data()[kind]
  const overviewDocuments = (): OverviewDocument[] => {
    const current = data()
    return [
      { kind: "readme", label: "README.md", resource: current.readme },
      ...(current.contributing.value === undefined
        ? []
        : [{ kind: "contributing" as const, label: "CONTRIBUTING.md", resource: current.contributing }]),
      ...(current.security.value === undefined
        ? []
        : [{ kind: "security" as const, label: "SECURITY.md", resource: current.security }]),
      ...(current.license.value === undefined
        ? []
        : [{ kind: "license" as const, label: "LICENSE", resource: current.license }]),
    ]
  }
  const activeResource = (): ResourceState<unknown> | undefined => {
    if (page() === "overview") return documentResource(overviewDocument())
    if (page() === "commits") return data().commits
    if (page() === "issues") return issues()
    if (page() === "pulls") return pulls()
    if (page() === "actions") return data().runs
    return undefined
  }
  const retryTarget = (): RepositoryResource | undefined => {
    if (page() === "overview") return { kind: overviewDocument() }
    if (page() === "commits") return { kind: "commits" }
    if (page() === "issues") return { kind: "issues", state: issueState() }
    if (page() === "pulls") return { kind: "pulls", state: pullState() }
    if (page() === "actions") return { kind: "runs" }
    return undefined
  }
  const statusKind = (): StatusKind | undefined => {
    const current = operations()
    if (current.refresh.status === "error") return "refresh-error"
    if (current.branch.status === "error") return "branch-error"
    if (current.refresh.status === "loading") return "refreshing"
    if (current.branch.status === "loading") return "switching-branch"
    const resource = activeResource()
    if (resource?.status === "error") return resource.phase === "pagination" ? "load-more-error" : "resource-error"
    if (resource?.status === "loading") {
      if (resource.phase === "pagination") return "loading-more"
      return resource.value === undefined ? undefined : "loading-resource"
    }
    return undefined
  }
  const statusDetail = () => {
    if (page() === "overview")
      return overviewDocuments().find((document) => document.kind === overviewDocument())?.label ?? "document"
    if (page() === "commits") return "commits"
    if (page() === "issues") return `${issueState()} issues`
    if (page() === "pulls") return `${pullState()} pull requests`
    if (page() === "actions") return "workflow runs"
    return undefined
  }
  const status = createMemo(statusKind)

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

    if (!issueDefaultResolved && current.issues.open.status === "ready" && current.issues.closed.status === "ready") {
      issueDefaultResolved = true
      if (current.issues.open.value.items.length === 0 && current.issues.closed.value.items.length > 0)
        setIssueState("closed")
    }

    if (!pullDefaultResolved && current.pulls.open.status === "ready" && current.pulls.closed.status === "ready") {
      pullDefaultResolved = true
      if (current.pulls.open.value.items.length === 0 && current.pulls.closed.value.items.length > 0)
        setPullState("closed")
    }
  })

  createEffect(() => {
    if (!visibleTabs().some((tab) => tab.page === page())) setNavigation((state) => navigate(state, "pulls"))
  })

  createEffect(() => {
    if (!overviewDocuments().some((document) => document.kind === overviewDocument())) {
      setOverviewDocument("readme")
      overviewScroll?.scrollTo(0)
    }
  })

  const selectPage = (next: Page) => setNavigation((state) => navigate(state, next))
  const movePage = (delta: number) => {
    const available = visibleTabs()
    const current = Math.max(0, available.findIndex((tab) => tab.page === page()))
    selectPage(available[(current + delta + available.length) % available.length]!.page)
  }
  const moveOverviewDocument = (delta: number) => {
    const available = overviewDocuments()
    const current = Math.max(0, available.findIndex((document) => document.kind === overviewDocument()))
    setOverviewDocument(available[(current + delta + available.length) % available.length]!.kind)
    overviewScroll?.scrollTo(0)
  }
  const quit = () => props.onQuit ? props.onQuit() : renderer.destroy()

  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") return quit()
    const escape = event.name === "escape" || event.name === "esc" || event.raw === "\u001b" || event.sequence === "\u001b"
    if (overlay() === "branch-picker") {
      if (escape) setOverlay()
      return
    }
    if (event.name === "q") return quit()
    if (overlay() === "help") {
      if (event.name === "?" || escape) setOverlay()
      return
    }
    if (event.name === "?") return setOverlay("help")
    if (escape && navigation().detail)
      return setNavigation(back)
    if (event.name >= "1" && event.name <= "5") {
      const target = visibleTabs()[Number(event.name) - 1]
      if (target) selectPage(target.page)
      return
    }
    if (event.name === "left" || event.name === "h") return movePage(-1)
    if (event.name === "right" || event.name === "l") return movePage(1)
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
    <box width={dimensions().width} height={dimensions().height} flexDirection="column" backgroundColor={colors.canvas}>
      <Header repo={data().repo} page={page()} tabs={visibleTabs()} />
      <box visible={page() === "overview"} flexGrow={1} minHeight={0}>
          <OverviewScreen
            repo={data().repo}
            documents={overviewDocuments()}
            currentDocument={overviewDocument()}
            showScrollbar={props.config?.showScrollbars ?? false}
            scrollRef={(value) => (overviewScroll = value)}
          />
        </box>
        <box visible={page() === "commits"} flexGrow={1} minHeight={0}>
          <CommitsScreen
            commits={data().commits}
            currentBranch={data().currentBranch}
            active={page() === "commits"}
            interactive={overlay() === undefined}
            showScrollbar={props.config?.showScrollbars ?? false}
            onEndReached={() => {
              const commits = data().commits
              if (commits.status === "ready" && commits.value.hasMore) void props.onLoadMoreCommits?.()
            }}
          />
        </box>
        <box visible={page() === "issues"} flexGrow={1} minHeight={0}>
          <WorkScreen
            title="Issues"
            kind="issue"
            state={issueState()}
            counts={issueCounts()}
            resource={issues()}
            active={page() === "issues"}
            interactive={overlay() === undefined}
            showScrollbar={props.config?.showScrollbars ?? false}
            onEndReached={() => {
              const resource = issues()
              if (resource.status === "ready" && resource.value.hasMore) void props.onLoadMoreIssues?.(issueState())
            }}
          />
        </box>
        <box visible={page() === "pulls"} flexGrow={1} minHeight={0}>
          <WorkScreen
            title="Pull requests"
            kind="pull"
            state={pullState()}
            counts={pullCounts()}
            resource={pulls()}
            active={page() === "pulls"}
            interactive={overlay() === undefined}
            showScrollbar={props.config?.showScrollbars ?? false}
            onEndReached={() => {
              const resource = pulls()
              if (resource.status === "ready" && resource.value.hasMore) void props.onLoadMorePulls?.(pullState())
            }}
          />
        </box>
        <Show when={visibleTabs().some((tab) => tab.page === "actions")}>
          <box visible={page() === "actions"} flexGrow={1} minHeight={0}>
            <ActionsScreen
              runs={data().runs}
              active={page() === "actions"}
              interactive={overlay() === undefined}
              showScrollbar={props.config?.showScrollbars ?? false}
              onEndReached={() => {
                const runs = data().runs
                if (runs.status === "ready" && runs.value.hasMore) void props.onLoadMoreRuns?.()
              }}
            />
          </box>
        </Show>
      <StatusBar kind={status()} detail={statusDetail()} />
      <Show when={overlay() === "help"}><Help /></Show>
      <Show when={overlay() === "branch-picker" && data().branches.value}>
        <BranchPicker
          branches={data().branches}
          current={data().currentBranch}
          showScrollbar={props.config?.showScrollbars ?? false}
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
  )
}
