import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import type { Config } from "../config"
import type { ListState } from "../models"
import { back, navigate, type NavigationState, type Page } from "../navigation"
import type { RepositoryData, RepositoryOperations, RepositoryResource, ResourceState } from "../repository-state"
import { BranchPicker } from "./components/branch-picker"
import { Header } from "./components/header"
import { Help } from "./components/help"
import { StatusBar, type StatusKind } from "./components/status-bar"
import { ActionsScreen } from "./pages/actions"
import { CommitsScreen } from "./pages/commits"
import { OverviewScreen } from "./pages/overview"
import { WorkScreen } from "./pages/work"
import { tabs } from "./tabs"
import { colors } from "./theme"

export type AppProps = {
  data: RepositoryData | (() => RepositoryData)
  operations: RepositoryOperations | (() => RepositoryOperations)
  config?: Config
  onQuit?: () => void
  onRefresh?: () => void
  onRetryResource?: (resource: RepositoryResource) => void
  onBranchChange?: (branch: string) => void
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
  const [branchPicker, setBranchPicker] = createSignal(false)
  const [help, setHelp] = createSignal(false)
  let overviewScroll: ScrollBoxRenderable | undefined

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
  const activeResource = (): ResourceState<unknown> | undefined => {
    if (page() === "overview") return data().readme
    if (page() === "commits") return data().commits
    if (page() === "issues") return issues()
    if (page() === "pulls") return pulls()
    if (page() === "actions") return data().runs
    return undefined
  }
  const retryTarget = (): RepositoryResource | undefined => {
    if (page() === "overview") return { kind: "readme" }
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
    if (resource?.status === "loading") return resource.phase === "pagination" ? "loading-more" : "loading-resource"
    return undefined
  }
  const status = createMemo(statusKind)

  createEffect(() => {
    if (!visibleTabs().some((tab) => tab.page === page())) setNavigation((state) => navigate(state, "pulls"))
  })

  const selectPage = (next: Page) => setNavigation((state) => navigate(state, next))
  const movePage = (delta: number) => {
    const available = visibleTabs()
    const current = Math.max(0, available.findIndex((tab) => tab.page === page()))
    selectPage(available[(current + delta + available.length) % available.length]!.page)
  }
  const quit = () => props.onQuit ? props.onQuit() : renderer.destroy()

  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") return quit()
    if (branchPicker()) {
      if (event.name === "escape" || event.name === "esc" || event.raw === "\u001b" || event.sequence === "\u001b")
        setBranchPicker(false)
      return
    }
    if (event.name === "q") return quit()
    if (event.name === "?" || (help() && (event.name === "escape" || event.name === "esc")))
      return setHelp((value) => !value)
    if (help()) return
    if ((event.name === "escape" || event.name === "esc") && navigation().detail)
      return setNavigation(back)
    if (event.name >= "1" && event.name <= "5") {
      const target = visibleTabs()[Number(event.name) - 1]
      if (target) selectPage(target.page)
      return
    }
    if (event.name === "left" || event.name === "h") return movePage(-1)
    if (event.name === "right" || event.name === "l") return movePage(1)
    if (event.name === "tab") {
      if (page() === "overview" || page() === "commits") {
        const branches = data().branches
        if (branches.status === "error") props.onRetryResource?.({ kind: "branches" })
        if (branches.value) setBranchPicker(true)
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
      <Show when={!help()} fallback={<Help />}>
        <box visible={page() === "overview"} flexGrow={1} minHeight={0}>
          <OverviewScreen
            repo={data().repo}
            currentBranch={data().currentBranch}
            readme={data().readme}
            showScrollbar={props.config?.showScrollbars ?? false}
            scrollRef={(value) => (overviewScroll = value)}
          />
        </box>
        <box visible={page() === "commits"} flexGrow={1} minHeight={0}>
          <CommitsScreen
            commits={data().commits}
            currentBranch={data().currentBranch}
            branchCount={data().branches.value?.length ?? 1}
            active={page() === "commits"}
            interactive={!help() && !branchPicker()}
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
            interactive={!help() && !branchPicker()}
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
            interactive={!help() && !branchPicker()}
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
              interactive={!help() && !branchPicker()}
              showScrollbar={props.config?.showScrollbars ?? false}
              onEndReached={() => {
                const runs = data().runs
                if (runs.status === "ready" && runs.value.hasMore) void props.onLoadMoreRuns?.()
              }}
            />
          </box>
        </Show>
      </Show>
      <StatusBar kind={status()} />
      <Show when={branchPicker() && data().branches.value}>
        <BranchPicker
          branches={data().branches.value ?? []}
          current={data().currentBranch}
          showScrollbar={props.config?.showScrollbars ?? false}
          onClose={() => setBranchPicker(false)}
          onSelect={(branch) => {
            props.onBranchChange?.(branch)
            overviewScroll?.scrollTo(0)
            setBranchPicker(false)
          }}
        />
      </Show>
    </box>
  )
}
