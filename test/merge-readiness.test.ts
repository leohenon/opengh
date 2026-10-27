import { expect, test } from "bun:test"
import type { PullReadiness } from "../src/models"
import { mergeReadinessStatus } from "../src/ui/merge-readiness"

const clean: PullReadiness = {
  headSha: "a".repeat(40), isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
  reviewDecision: null, checks: [], checksComplete: true,
}

test("merge status distinguishes blockers, waiting, unknown data, optional failures, and a known non-blocking review decision", () => {
  expect(mergeReadinessStatus(clean).status).toBe("ready")
  expect(mergeReadinessStatus({ ...clean, reviewDecision: "APPROVED" }).status).toBe("ready")
  expect(mergeReadinessStatus({ ...clean, checks: [{ id: "optional", name: "lint", state: "failure", required: false }] }).status).toBe("ready")
  expect(mergeReadinessStatus({ ...clean, isDraft: true }).status).toBe("draft")
  expect(mergeReadinessStatus({ ...clean, reviewDecision: undefined }).status).toBe("unavailable")
  expect(mergeReadinessStatus({ ...clean, checksComplete: false }).status).toBe("unavailable")
  expect(mergeReadinessStatus({ ...clean, reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "BLOCKED" }).status).toBe("blocked")
  expect(mergeReadinessStatus({ ...clean, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }).status).toBe("blocked")
  expect(mergeReadinessStatus({ ...clean, reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED" }).status).toBe("waiting")
  expect(mergeReadinessStatus({ ...clean, checks: [{ id: "required", name: "build", state: "pending", required: true }] }).status).toBe("waiting")
  expect(mergeReadinessStatus({ ...clean, checks: [{ id: "required", name: "build", state: "failure", required: true }] }).status).toBe("blocked")
  expect(mergeReadinessStatus({ ...clean, checks: [{ id: "unknown", name: "build", state: "success" }] }).status).toBe("unavailable")
  expect(mergeReadinessStatus(clean, "b".repeat(40)).status).toBe("unavailable")
  const unstable: PullReadiness = { ...clean, mergeStateStatus: "UNSTABLE",
    checks: [{ id: "optional", name: "expected-failure", state: "failure", required: false }] }
  expect(mergeReadinessStatus(unstable).status).toBe("ready")
  expect(mergeReadinessStatus({ ...unstable, checks: [{ ...unstable.checks[0]!, required: true }] }).status).toBe("blocked")
  expect(mergeReadinessStatus({ ...unstable, checks: [{ ...unstable.checks[0]!, required: undefined }] }).status).toBe("unavailable")
  expect(mergeReadinessStatus({ ...unstable, checksComplete: false }).status).toBe("unavailable")
})
