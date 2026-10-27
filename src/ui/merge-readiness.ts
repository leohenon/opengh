import type { PullReadiness } from "../models"

export type MergeReadinessStatus = {
  status: "ready" | "blocked" | "waiting" | "unavailable" | "draft"
  /** Short, actionable explanations, in display order; empty when ready. */
  reasons: string[]
}

/**
 * Conservative readiness for the current head, not permission to merge.
 * Missing/stale heads take precedence; otherwise draft, known blockers,
 * missing information, then waiting requirements. Neutral/skipped checks
 * are accepted outcomes, but cancelled and unknown checks are not passes.
 * A null review decision is known/non-blocking; undefined is unavailable.
 */
export function mergeReadinessStatus(readiness: PullReadiness, expectedHeadSha?: string): MergeReadinessStatus {
  if (!readiness.headSha) return { status: "unavailable", reasons: ["Head commit unavailable; refresh readiness."] }
  if (expectedHeadSha && expectedHeadSha !== readiness.headSha) {
    return { status: "unavailable", reasons: ["Head changed; refresh readiness."] }
  }

  const blocked: string[] = []
  const waiting: string[] = []
  const unavailable: string[] = []
  const draft = readiness.isDraft === true || readiness.mergeStateStatus === "DRAFT"
  const required = readiness.checks.filter(check => check.required === true)
  if (readiness.mergeable === "CONFLICTING" || readiness.mergeStateStatus === "DIRTY") blocked.push("Resolve branch conflicts.")
  if (readiness.reviewDecision === "CHANGES_REQUESTED") blocked.push("Address requested changes.")
  if (required.some(check => check.state === "failure")) blocked.push("Fix failed required checks.")
  if (required.some(check => check.state === "cancelled")) blocked.push("Rerun cancelled required checks.")
  if (readiness.reviewDecision === "REVIEW_REQUIRED") waiting.push("Required approvals still needed.")
  if (required.some(check => check.state === "pending")) waiting.push("Wait for required checks.")

  if (readiness.isDraft === undefined && !draft) unavailable.push("Draft status unavailable; refresh readiness.")
  if (readiness.reviewDecision === undefined) unavailable.push("Review decision unavailable; refresh readiness.")
  if (!readiness.checksComplete) unavailable.push("Check data incomplete; refresh readiness.")
  if (readiness.checks.some(check => check.required === undefined)) unavailable.push("Check requirements unknown; confirm on GitHub.")
  if (required.some(check => check.state === "unknown")) unavailable.push("Required check results unknown; refresh readiness.")
  if (readiness.mergeable !== "MERGEABLE" && readiness.mergeable !== "CONFLICTING") {
    unavailable.push("Conflict status unknown; refresh readiness.")
  }
  switch (readiness.mergeStateStatus) {
    // UNSTABLE means non-passing checks, not unknown readiness. Required
    // checks are evaluated above; failures in optional checks do not block merging.
    case "CLEAN": case "UNSTABLE": case "DIRTY": case "DRAFT": break
    case "BLOCKED":
      if (!draft && !blocked.length && !waiting.length) blocked.push("Repository requirements block merging; check GitHub.")
      break
    case "BEHIND": unavailable.push("Branch is behind base; confirm update requirements on GitHub."); break
    case "HAS_HOOKS": unavailable.push("Merge hooks reported; confirm requirements on GitHub."); break
    default: unavailable.push("Merge state unavailable; refresh readiness.")
  }

  const reasons = [...blocked, ...waiting, ...unavailable]
  if (draft) return { status: "draft", reasons: ["Mark ready for review before merging.", ...reasons] }
  if (blocked.length) return { status: "blocked", reasons }
  if (unavailable.length) return { status: "unavailable", reasons }
  if (waiting.length) return { status: "waiting", reasons }
  return { status: "ready", reasons: [] }
}
