import type { AppColors } from "../theme"
import type { IconSet } from "./icons"

type WorkflowStatus = { status: string; conclusion: string }

export function runIcon(run: WorkflowStatus, icons: IconSet["workflow"]) {
  if (run.status !== "completed") return icons.clock
  switch (run.conclusion) {
    case "success": return icons.success
    case "failure":
    case "timed_out": return icons.failure
    case "cancelled":
    case "stale": return icons.cancelled
    case "skipped": return icons.skipped
    case "action_required": return icons.attention
    default: return icons.neutral
  }
}

export function runState(run: WorkflowStatus) {
  if (run.status !== "completed") return run.status.replaceAll("_", " ")
  return run.conclusion.replaceAll("_", " ") || "completed"
}

export function runColor(run: WorkflowStatus, colors: Pick<AppColors, "yellow" | "muted" | "green" | "red">) {
  if (run.status === "in_progress" || run.status === "waiting") return colors.yellow
  if (run.status !== "completed") return colors.muted
  if (run.conclusion === "success") return colors.green
  if (run.conclusion === "failure" || run.conclusion === "timed_out") return colors.red
  return run.conclusion === "action_required" ? colors.yellow : colors.muted
}
