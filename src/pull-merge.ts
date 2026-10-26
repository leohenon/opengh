import type { PullContext, PullRequestDetail } from "./models"
import { mergeReadinessStatus } from "./ui/merge-readiness"

/** Normal merges only: never bypass requirements or enqueue a pull request. */
export function pullMergeBlocker(pull: PullRequestDetail, context?: PullContext): string | undefined {
  if (pull.merged || pull.state !== "open") return "Only open, unmerged pull requests can be merged."
  if (pull.draft === true) return "Mark ready for review before merging."
  if (pull.draft !== false) return "Draft status unavailable; refresh the pull request."
  if (pull.permissions?.merge !== true) return "Merge permission unavailable or not granted."
  if (!pull.merge) return "Merge methods and queue requirements are unavailable."
  if (pull.merge.queueRequired !== false) return "This pull request requires a merge queue; use GitHub."
  if (!pull.merge.methods.length || pull.merge.methods.some(method => !["merge", "squash", "rebase"].includes(method)))
    return "No verified merge method is available."
  if (!pull.headSha || !/^[a-f\d]{40}$/i.test(pull.headSha)) return "Head commit unavailable; refresh the pull request."
  if (!context) return "Merge readiness unavailable; wait for checks or refresh."
  const readiness = mergeReadinessStatus(context.readiness, pull.headSha)
  if (readiness.status !== "ready") return readiness.reasons.join(" ") || "Merge readiness unavailable."
  if (context.readiness.mergeStateStatus !== "CLEAN") return "GitHub has not confirmed a clean merge state."
}
