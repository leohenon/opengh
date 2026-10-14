import type { IssuePullReference, IssueReference, ListState, PullRequestSummary } from "../models"
import { issueIcons, pullRequestIcons } from "./icons"
import type { AppColors } from "../theme"

export type IssueLinkReference = Extract<IssueReference, { kind: "pull" | "issue" }>

export function referencedItems(
  references: readonly IssueReference[],
  currentIssue?: { repository: string; number: number },
): IssueLinkReference[] {
  const latest = new Map<string, IssueLinkReference>()
  for (const reference of references) {
    if (reference.kind === "commit") continue
    if (currentIssue && reference.repository === currentIssue.repository && reference.number === currentIssue.number) continue
    const key = `${reference.repository}#${reference.number}`
    const previous = latest.get(key)
    if (!previous || Date.parse(reference.createdAt) > Date.parse(previous.createdAt)) latest.set(key, reference)
  }
  return [...latest.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

export function referencedPulls(references: readonly IssueReference[]): IssuePullReference[] {
  return referencedItems(references).filter((reference): reference is IssuePullReference => reference.kind === "pull")
}

export function pullRequestIcon(pull: Pick<PullRequestSummary, "state" | "merged" | "draft">) {
  return pull.merged ? pullRequestIcons.merged : pull.state === "closed" ? pullRequestIcons.closed
    : pull.draft ? pullRequestIcons.draft : pullRequestIcons.open
}

export function issueIcon(state: ListState) {
  return state === "closed" ? issueIcons.closed : issueIcons.open
}

export function referenceIcon(reference: IssueReference) {
  if (reference.kind === "commit") return ""
  if (reference.kind === "issue") return issueIcon(reference.state)
  return pullRequestIcon(reference)
}

export function referenceState(reference: IssueReference) {
  if (reference.kind === "commit") return "Commit"
  if (reference.kind === "issue") return reference.state === "closed" ? "Closed" : "Open"
  return reference.merged ? "Merged" : reference.state === "closed" ? "Closed" : reference.draft ? "Draft" : "Open"
}

export function referenceColor(colors: AppColors, reference: IssueReference) {
  if (reference.kind === "commit") return colors.blue
  if (reference.kind === "issue") return reference.state === "closed" ? colors.closedState : colors.openState
  return reference.merged ? colors.purple : reference.state === "closed" ? colors.red : reference.draft ? colors.muted : colors.openState
}
