import { createMemo, For, Show } from "solid-js"
import type { PullCheck, PullContext } from "../../models"
import { relativeTime } from "../format"
import { mergeReadinessStatus } from "../merge-readiness"
import { useIcons } from "../icon-style"
import { useTheme } from "../theme"
import { MetadataField } from "./detail-metadata"
import { TimelineEntry } from "./timeline-entry"

export function PullContextMetadata(props: { context: PullContext; compact: boolean; repository?: string; omitEmpty?: boolean }) {
  const { colors } = useTheme()
  return (
    <box width="100%" minWidth={0} flexShrink={0} flexDirection="column">
      <Show when={!props.omitEmpty || props.context.milestone}>
      <MetadataField label="Milestone" compact={props.compact} muted={!props.context.milestone}>
        <Show when={props.context.milestone} fallback="none">
          {(milestone) => (
            <>
              <span style={{ fg: colors.blue }}><a href={milestone().url}>{milestone().title}</a></span>
              <Show when={milestone().dueAt}>{` · due ${relativeTime(milestone().dueAt!)}`}</Show>
            </>
          )}
        </Show>
      </MetadataField>
      </Show>
      <Show when={!props.omitEmpty || props.context.projects?.length}>
      <MetadataField label="Projects" compact={props.compact} muted={!props.context.projects?.length}>
        <Show when={props.context.projects !== undefined} fallback="unavailable">
          <For each={props.context.projects} fallback="none">
            {(project, index) => (
              <>
                <Show when={index() > 0}><Show when={props.compact} fallback={<br />}>{" · "}</Show></Show>
                <span style={{ fg: colors.blue }}><a href={project.url}>{project.title}</a></span>
              </>
            )}
          </For>
        </Show>
      </MetadataField>
      </Show>
      <Show when={!props.omitEmpty || props.context.closingIssues?.length}>
      <MetadataField label="Issues closed on merge" compact={props.compact} muted={!props.context.closingIssues?.length}>
        <Show when={props.context.closingIssues !== undefined} fallback="unavailable">
          <For each={props.context.closingIssues} fallback="none">
            {(issue, index) => (
              <>
                <Show when={index() > 0}><Show when={props.compact} fallback={<br />}>{" · "}</Show></Show>
                <span style={{ fg: colors.blue }}><a href={issue.url}>{issue.repository === props.repository ? "" : issue.repository}#{issue.number}</a></span>
                {` · ${issue.state === "closed" ? "Closed" : "Open"} · ${issue.title}`}
              </>
            )}
          </For>
        </Show>
      </MetadataField>
      </Show>
    </box>
  )
}

const checkLabels: Record<PullCheck["state"], string> = {
  success: "Passed", failure: "Failed", pending: "Pending", neutral: "Neutral",
  skipped: "Skipped", cancelled: "Cancelled", unknown: "Unknown",
}

const readinessLabels = {
  ready: "Ready to merge", blocked: "Merge blocked", waiting: "Waiting for requirements",
  unavailable: "Readiness unavailable", draft: "Draft pull request",
}

const checkOrder: Record<PullCheck["state"], number> = {
  failure: 0, pending: 1, cancelled: 2, unknown: 3, success: 4, neutral: 5, skipped: 6,
}

export function PullReadinessPanel(props: { context: PullContext; expectedHeadSha?: string; backgroundColor?: string }) {
  const { colors } = useTheme()
  const icons = useIcons()
  const readiness = () => props.context.readiness
  const status = createMemo(() => mergeReadinessStatus(readiness(), props.expectedHeadSha))
  const statusColor = () => status().status === "ready" ? colors.green
    : status().status === "blocked" ? colors.red : colors.yellow
  const statusIcon = () => status().status === "ready" ? icons().workflow.success
    : status().status === "blocked" ? icons().workflow.failure
    : status().status === "waiting" ? icons().workflow.clock : icons().workflow.attention
  const checks = createMemo(() => [...readiness().checks].sort((a, b) => checkOrder[a.state] - checkOrder[b.state]))
  const requiredSummary = createMemo(() => {
    const required = readiness().checks.filter(check => check.required === true)
    return (Object.keys(checkOrder) as PullCheck["state"][])
      .map(state => ({ state, count: required.filter(check => check.state === state).length }))
      .filter(item => item.count > 0)
  })
  const reviewLabel = () => readiness().reviewDecision === "APPROVED" ? "Approved"
    : readiness().reviewDecision === "CHANGES_REQUESTED" ? "Changes requested"
    : readiness().reviewDecision === "REVIEW_REQUIRED" ? "Required approvals still needed"
    : readiness().reviewDecision === null ? "No blocking review decision" : "Unavailable"
  const reviewColor = () => readiness().reviewDecision === "CHANGES_REQUESTED" ? colors.red : colors.text
  const checkColor = (check: PullCheck) => check.state === "success" ? colors.green
    : check.state === "failure" || check.state === "cancelled" ? colors.red
    : check.state === "pending" || check.state === "unknown" ? colors.yellow : colors.muted
  const checkIcon = (check: PullCheck) => {
    const workflow = icons().workflow
    return check.state === "success" ? workflow.success : check.state === "failure" ? workflow.failure
      : check.state === "pending" ? workflow.clock : check.state === "cancelled" ? workflow.cancelled
      : check.state === "skipped" ? workflow.skipped : check.state === "unknown" ? workflow.attention : workflow.neutral
  }
  return (
    <TimelineEntry icon={statusIcon()} color={statusColor()} nodeOffset={2}>
      <box id="pull-merge-readiness" width="100%" minWidth={0} flexShrink={0} paddingX={2} paddingY={1} backgroundColor={props.backgroundColor} flexDirection="column">
        <text width="100%" flexShrink={0} fg={statusColor()}>
          <b>{readinessLabels[status().status]}</b><span style={{ fg: colors.muted }}> · Current status</span>
        </text>
        <For each={status().reasons}>
          {(reason) => <text width="100%" flexShrink={0} fg={colors.muted}>{reason}</text>}
        </For>
        <text width="100%" flexShrink={0} fg={colors.muted}>
          Reviews: <span style={{ fg: reviewColor() }}>{reviewLabel()}</span>
        </text>
        <text width="100%" flexShrink={0} fg={colors.muted}>
          Branch: <span style={{ fg: colors.text }}>
            {readiness().mergeable === "CONFLICTING" || readiness().mergeStateStatus === "DIRTY" ? "Conflicts reported"
              : readiness().mergeable === "MERGEABLE" ? "No conflicts" : "Conflict status unknown"}
          </span>
        </text>
        <Show when={requiredSummary().length}>
          <text width="100%" flexShrink={0} fg={colors.muted}>
            Required checks: {requiredSummary().map(item => `${item.count} ${checkLabels[item.state].toLowerCase()}`).join(" · ")}
          </text>
        </Show>
        <For each={checks()} fallback={(
          <text width="100%" flexShrink={0} fg={colors.muted}>
            {readiness().checksComplete ? "No checks reported." : "Check details unavailable."}
          </text>
        )}>
          {(check) => (
            <box width="100%" minWidth={0} flexShrink={0} flexDirection="row">
              <text width={12} flexShrink={0} fg={checkColor(check)}>{checkIcon(check)} {checkLabels[check.state]}</text>
              <text flexGrow={1} flexBasis={0} minWidth={0} flexShrink={0} fg={colors.muted}>
                <Show when={check.url} fallback={check.name}>
                  {(url) => <span style={{ fg: colors.blue }}><a href={url()}>{check.name}</a></span>}
                </Show>
                {check.required === true ? " · Required" : check.required === false ? " · Optional" : " · Unknown"}
              </text>
            </box>
          )}
        </For>
      </box>
    </TimelineEntry>
  )
}
