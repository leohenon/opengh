import type { IssuePullReference, IssueReference, ListState, PullRequestSummary } from "../models"
import { unicodeIcons, type IconSet } from "./icons"
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

export function pullRequestIcon(pull: Pick<PullRequestSummary, "state" | "merged" | "draft">, icons: IconSet = unicodeIcons) {
  return pull.merged ? icons.pullRequest.merged : pull.state === "closed" ? icons.pullRequest.closed
    : pull.draft ? icons.pullRequest.draft : icons.pullRequest.open
}

export function issueIcon(state: ListState, icons: IconSet = unicodeIcons) {
  return state === "closed" ? icons.issue.closed : icons.issue.open
}

export function referenceIcon(reference: IssueReference, icons: IconSet = unicodeIcons) {
  if (reference.kind === "commit") return icons.commit
  if (reference.kind === "issue") return issueIcon(reference.state, icons)
  return pullRequestIcon(reference, icons)
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
