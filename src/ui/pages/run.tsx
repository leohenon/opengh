import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyActions } from "../keybindings"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { defaultConfig, type DetailLayout } from "../../config"
import type { WorkflowRunSummary } from "../../models"
import type { RunDetailState } from "../../repository-state"
import { ResourceStateView } from "../components/resource-state"
import { detailContentWidth } from "../detail-layout"
import { ago, exactDate } from "../format"
import { useIcons } from "../icon-style"
import { iconPrefix } from "../icons"
import { createScrollbarVisibility } from "../scrollbar-visibility"
import { useTheme } from "../theme"
import { runColor, runIcon, runState } from "../workflow-status"

function duration(start: string | null, end: string | null, running: boolean) {
  if (!start || (!end && !running)) return "—"
  const elapsed = (end ? Date.parse(end) : Date.now()) - Date.parse(start)
  if (!Number.isFinite(elapsed) || elapsed < 0) return "—"
  const seconds = Math.floor(elapsed / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function RunScreen(props: {
  id: number
  summary?: WorkflowRunSummary
  detail: RunDetailState
  active: boolean
  onRefresh?: () => Promise<void>
  interactive: boolean
  showScrollbar: boolean
  detailLayout?: DetailLayout
}) {
  const { colors } = useTheme()
  const icons = useIcons()
  const repositoryUrl = () => props.detail.resource.value?.url.replace(/\/actions\/runs\/\d+.*$/, "")
  const centered = () => (props.detailLayout ?? defaultConfig.detailLayout) === "centered"
  const contentWidth = () => detailContentWidth(props.detailLayout)
  let scroll: ScrollBoxRenderable | undefined
  const bindScrollbar = createScrollbarVisibility(() => props.showScrollbar)
  const polling = createMemo(() => props.active && Boolean(props.onRefresh)
    && props.detail.resource.value !== undefined
    && (props.detail.resource.value.status !== "completed" || props.detail.jobs.status !== "ready"
      || props.detail.jobs.value.items.some((job) => job.status !== "completed"
        || job.steps.some((step) => step.status !== "completed"))))

  createEffect(() => {
    if (!polling()) return
    // The session prevents overlapping loads and preserves data on refresh failures.
    const timer = setInterval(() => { void props.onRefresh?.() }, 5000)
    onCleanup(() => clearInterval(timer))
  })

  const keys = useKeyActions({
    "navigation.up": () => scroll!.scrollBy(-1),
    "navigation.down": () => scroll!.scrollBy(1),
    "navigation.halfPageUp": () => scroll!.scrollBy(-Math.max(1, Math.floor(scroll!.viewport.height / 2))),
    "navigation.halfPageDown": () => scroll!.scrollBy(Math.max(1, Math.floor(scroll!.viewport.height / 2))),
    "navigation.pageUp": () => scroll!.scrollBy(-scroll!.viewport.height),
    "navigation.pageDown": () => scroll!.scrollBy(scroll!.viewport.height),
    "navigation.last": () => scroll!.scrollTo(Math.max(0, scroll!.scrollHeight - scroll!.viewport.height)),
    "navigation.first": () => scroll!.scrollTo(0),
  }, { when: () => props.interactive && Boolean(scroll) })

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" backgroundColor={colors.canvas} paddingX={2}>
      <scrollbox
        focusable={false}
        onMouseScroll={(event) => event.stopPropagation()}
        id="run-detail-scroll"
        ref={(value) => { scroll = value; bindScrollbar(value) }}
        flexGrow={1}
        minWidth={0}
        minHeight={0}
        scrollY
        scrollX={false}
        contentOptions={{ paddingTop: 0, paddingBottom: 1, alignItems: centered() ? "center" : "stretch" }}
      >
        <box width="100%" maxWidth={contentWidth()} minWidth={0} flexShrink={0} flexDirection="column" paddingTop={1} paddingBottom={1}>
          <text width="100%" flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>
            {props.detail.resource.value?.title || props.summary?.title || `Workflow run ${props.id}`}
          </text>
        </box>
        <ResourceStateView resource={props.detail.resource} hideError>
          {(run) => (
            <box width="100%" maxWidth={contentWidth()} minWidth={0} flexShrink={0} flexDirection="column">
              <text width="100%" flexShrink={0} fg={runColor(run(), colors)}>
                {iconPrefix(runIcon(run(), icons().workflow))}{runState(run())}
                <span style={{ fg: colors.muted }}> · {duration(run().startedAt, run().status === "completed" ? run().updatedAt : null, run().status === "in_progress")}</span>
              </text>
              <text width="100%" flexShrink={0} fg={colors.text}>
                <a href={run().url}>{run().name} #{run().number}</a> · attempt {run().attempt}
              </text>
              <text width="100%" flexShrink={0} fg={colors.muted}>
                {run().event} · {iconPrefix(icons().user)}<Show when={run().actor} fallback="Unknown actor">{(login) => <a href={`https://github.com/${login()}`}>{login()}</a>}</Show>
              </text>
              <text width="100%" flexShrink={0} wrapMode="char" fg={colors.muted}>
                {iconPrefix(icons().branch)}<Show when={run().branch} fallback="Unknown branch">{(branch) => <a href={`${repositoryUrl()}/tree/${encodeURIComponent(branch())}`}>{branch()}</a>}</Show> · <Show when={run().sha} fallback="Unknown commit">{(sha) => <a href={`${repositoryUrl()}/commit/${sha()}`}>{sha().slice(0, 7)}</a>}</Show>
              </text>
              <text width="100%" flexShrink={0} fg={colors.muted}>Created {exactDate(run().createdAt)} · {ago(run().createdAt)}</text>
              <Show when={run().startedAt}>
                {(startedAt) => <text width="100%" flexShrink={0} fg={colors.muted}>Started {exactDate(startedAt())}</text>}
              </Show>
              <text width="100%" flexShrink={0} fg={colors.muted}>Updated {exactDate(run().updatedAt)}</text>
              <Show when={run().workflowPath}>
                <text width="100%" flexShrink={0} wrapMode="char" fg={colors.muted}><a href={`${repositoryUrl()}/blob/${encodeURIComponent(run().sha)}/${run().workflowPath.split("/").map(encodeURIComponent).join("/")}`}>{run().workflowPath}</a></text>
              </Show>
              <text width="100%" flexShrink={0} marginTop={1} fg={colors.text} attributes={TextAttributes.BOLD}>
                Jobs{props.detail.jobs.value ? ` · ${props.detail.jobs.value.items.length}${props.detail.jobs.value.hasMore ? " loaded" : ""}` : ""}
              </text>
              <box width="100%" minWidth={0} flexShrink={0} flexDirection="column">
                <ResourceStateView resource={props.detail.jobs} hideError>
                  {(jobs) => (
                    <box width="100%" minWidth={0} flexShrink={0} flexDirection="column">
                      <For each={jobs().items} fallback={<text width="100%" flexShrink={0} fg={colors.muted}>No jobs.</text>}>
                        {(job) => (
                          <box width="100%" minWidth={0} flexShrink={0} flexDirection="column" marginTop={1}>
                            <text width="100%" flexShrink={0} fg={runColor(job, colors)}>
                              {iconPrefix(runIcon(job, icons().workflow))}<b><span style={{ fg: colors.text }}><a href={`${run().url}/job/${job.id}`}>{job.name}</a></span></b>
                              {" · "}{runState(job)} · {duration(job.startedAt, job.completedAt, job.status === "in_progress")}
                            </text>
                            <text width="100%" flexShrink={0} fg={colors.muted}>  Runner: {job.runner || "Not assigned"}</text>
                            <box width="100%" minWidth={0} flexShrink={0} flexDirection="column" paddingLeft={2}>
                              <For each={job.steps} fallback={<text width="100%" flexShrink={0} fg={colors.muted}>No steps.</text>}>
                                {(step) => (
                                  <text width="100%" flexShrink={0} fg={runColor(step, colors)}>
                                    {iconPrefix(runIcon(step, icons().workflow))}<span style={{ fg: colors.text }}>{step.name}</span>
                                    {" · "}{runState(step)} · {duration(step.startedAt, step.completedAt, step.status === "in_progress")}
                                  </text>
                                )}
                              </For>
                            </box>
                          </box>
                        )}
                      </For>
                      <Show when={jobs().hasMore}>
                        <text width="100%" flexShrink={0} marginTop={1} fg={colors.muted}>{keys.hint("navigation.activate", "load more jobs")}</text>
                      </Show>
                    </box>
                  )}
                </ResourceStateView>
              </box>
            </box>
          )}
        </ResourceStateView>
      </scrollbox>
    </box>
  )
}
