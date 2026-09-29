import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, Show } from "solid-js"
import type { GitHubData } from "../models"
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
  data: GitHubData | (() => GitHubData)
  refreshing?: boolean
  refreshError?: string
  onQuit?: () => void
  onRefresh?: () => void
  onBranchChange?: (branch: string) => void
  onLoadMoreCommits?: () => Promise<void>
  onLoadMoreRuns?: () => Promise<void>
  onLoadMoreIssues?: (state: "open" | "closed") => Promise<void>
  onLoadMorePulls?: (state: "open" | "closed") => Promise<void>
}

export function App(props: AppProps) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [tab, setTab] = createSignal(0)
  const [selected, setSelected] = createSignal([0, 0, 0, 0, 0])
  const [issueState, setIssueState] = createSignal<"open" | "closed">("open")
  const [pullState, setPullState] = createSignal<"open" | "closed">("open")
  const [branchPicker, setBranchPicker] = createSignal(false)
  const [loadingMoreCommits, setLoadingMoreCommits] = createSignal(false)
  const [loadingMoreRuns, setLoadingMoreRuns] = createSignal(false)
  const [commitLoadError, setCommitLoadError] = createSignal(false)
  const [runLoadError, setRunLoadError] = createSignal(false)
  const [loadingMoreWork, setLoadingMoreWork] = createSignal(false)
  const [workLoadError, setWorkLoadError] = createSignal(false)
  const [help, setHelp] = createSignal(false)
  let overviewScroll: ScrollBoxRenderable | undefined
  const data = () => typeof props.data === "function" ? props.data() : props.data
  const issues = () => data().issues.filter((issue) => issue.state === issueState())
  const issueCounts = () => ({
    open: data().issues.filter((issue) => issue.state === "open").length,
    closed: data().issues.filter((issue) => issue.state === "closed").length,
  })
  const pulls = () => data().pulls.filter((pull) => pull.state === pullState())
  const pullCounts = () => ({
    open: data().pulls.filter((pull) => pull.state === "open").length,
    closed: data().pulls.filter((pull) => pull.state === "closed").length,
  })
  const visibleTabs = () => data().runs.length > 0 ? tabs : tabs.slice(0, -1)
  const statusKind = (): StatusKind | undefined => {
    if (props.refreshError) return "refresh-error"
    if (props.refreshing) return "refreshing"
    if (commitLoadError() || runLoadError() || workLoadError()) return "load-more-error"
    if (loadingMoreCommits() || loadingMoreRuns() || loadingMoreWork()) return "loading-more"
    return undefined
  }

  createEffect(() => {
    if (tab() >= visibleTabs().length) setTab(visibleTabs().length - 1)
  })

  const loadMoreCommits = async () => {
    if (loadingMoreCommits() || !props.onLoadMoreCommits) return
    setLoadingMoreCommits(true)
    setCommitLoadError(false)
    try {
      await props.onLoadMoreCommits()
    } catch {
      setCommitLoadError(true)
    } finally {
      setLoadingMoreCommits(false)
    }
  }

  const loadMoreWork = async (kind: "issues" | "pulls", state: "open" | "closed") => {
    if (loadingMoreWork()) return
    const loader = kind === "issues" ? props.onLoadMoreIssues : props.onLoadMorePulls
    if (!loader) return
    setLoadingMoreWork(true)
    setWorkLoadError(false)
    try {
      await loader(state)
    } catch {
      setWorkLoadError(true)
    } finally {
      setLoadingMoreWork(false)
    }
  }

  const loadMoreRuns = async () => {
    if (loadingMoreRuns() || !props.onLoadMoreRuns) return
    setLoadingMoreRuns(true)
    setRunLoadError(false)
    try {
      await props.onLoadMoreRuns()
    } catch {
      setRunLoadError(true)
    } finally {
      setLoadingMoreRuns(false)
    }
  }

  createEffect(() => {
    if (tab() === 1 && data().commitsPage.hasMore && !loadingMoreCommits() && !commitLoadError()
      && selected()[1] >= data().commits.length - 3)
      void loadMoreCommits()
    if (tab() === 2 && data().issuesPage[issueState()].hasMore && !loadingMoreWork() && !workLoadError()
      && selected()[2] >= issues().length - 3)
      void loadMoreWork("issues", issueState())
    if (tab() === 3 && data().pullsPage[pullState()].hasMore && !loadingMoreWork() && !workLoadError()
      && selected()[3] >= pulls().length - 3)
      void loadMoreWork("pulls", pullState())
    if (tab() === 4 && data().runsPage.hasMore && !loadingMoreRuns() && !runLoadError()
      && selected()[4] >= data().runs.length - 3)
      void loadMoreRuns()
  })

  const lengths = () => [
    0,
    data().commits.length,
    issues().length,
    pulls().length,
    data().runs.length,
  ]
  const move = (delta: number) => {
    const max = lengths()[tab()]
    if (!max) return
    setSelected((values) => values.map((value, index) =>
      index === tab() ? Math.max(0, Math.min(max - 1, value + delta)) : value,
    ))
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
    if (event.name >= "1" && event.name <= "5") {
      const index = Number(event.name) - 1
      if (index < visibleTabs().length) return setTab(index)
      return
    }
    if (event.name === "left" || event.name === "h")
      return setTab((value) => (value + visibleTabs().length - 1) % visibleTabs().length)
    if (event.name === "tab") {
      if (tab() === 0 || tab() === 1) {
        setBranchPicker(true)
      } else if (tab() === 2) {
        setIssueState((value) => value === "open" ? "closed" : "open")
        setWorkLoadError(false)
        setSelected((values) => values.map((value, index) => index === 2 ? 0 : value))
      } else if (tab() === 3) {
        setPullState((value) => value === "open" ? "closed" : "open")
        setWorkLoadError(false)
        setSelected((values) => values.map((value, index) => index === 3 ? 0 : value))
      }
      return
    }
    if (event.name === "right" || event.name === "l")
      return setTab((value) => (value + 1) % visibleTabs().length)
    if (event.name === "up" || event.name === "k") {
      if (tab() === 0) return overviewScroll?.scrollBy(-1)
      return move(-1)
    }
    if (event.name === "down" || event.name === "j") {
      if (tab() === 0) return overviewScroll?.scrollBy(1)
      return move(1)
    }
    if (event.name === "r") {
      setCommitLoadError(false)
      setRunLoadError(false)
      setWorkLoadError(false)
      return props.onRefresh?.()
    }
  })

  return (
    <box width={dimensions().width} height={dimensions().height} flexDirection="column" backgroundColor={colors.canvas}>
      <Header
        data={data()}
        tab={tab()}
        tabs={visibleTabs()}
      />
      <Show when={!help()} fallback={<Help />}>
        <box visible={tab() === 0} flexGrow={1} minHeight={0}>
          <OverviewScreen data={data()} scrollRef={(value) => (overviewScroll = value)} />
        </box>
        <box visible={tab() === 1} flexGrow={1} minHeight={0}>
          <CommitsScreen
            data={data()}
            selected={selected()[1]}
          />
        </box>
        <box visible={tab() === 2} flexGrow={1} minHeight={0}>
          <WorkScreen title="Issues" kind="issue" state={issueState()} counts={issueCounts()} items={issues()} selected={selected()[2]} />
        </box>
        <box visible={tab() === 3} flexGrow={1} minHeight={0}>
          <WorkScreen title="Pull requests" kind="pull" state={pullState()} counts={pullCounts()} items={pulls()} selected={selected()[3]} />
        </box>
        <Show when={data().runs.length > 0}>
          <box visible={tab() === 4} flexGrow={1} minHeight={0}>
            <ActionsScreen
              runs={data().runs}
              selected={selected()[4]}
            />
          </box>
        </Show>
      </Show>
      <StatusBar kind={statusKind()} />
      <Show when={branchPicker()}>
        <BranchPicker
          branches={data().branches}
          current={data().currentBranch}
          onClose={() => setBranchPicker(false)}
          onSelect={(branch) => {
            setCommitLoadError(false)
            props.onBranchChange?.(branch)
            overviewScroll?.scrollTo(0)
            setSelected((values) => values.map((value, index) => index === 1 ? 0 : value))
            setBranchPicker(false)
          }}
        />
      </Show>
    </box>
  )
}
