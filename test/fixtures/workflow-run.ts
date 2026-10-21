import type { WorkflowJob, WorkflowRunDetail } from "../../src/models"

export const workflowRunFixture: WorkflowRunDetail = {
  id: 9812, name: "CI", title: "Build terminal UI", status: "completed", conclusion: "success",
  createdAt: "2026-04-14T09:02:00Z", updatedAt: "2026-04-14T09:03:00Z", startedAt: "2026-04-14T09:02:00Z",
  url: "https://github.com/sst/opentui/actions/runs/9812", number: 42, attempt: 2,
  event: "push", branch: "main", sha: "abcdef123456", actor: "octocat", workflowPath: ".github/workflows/ci.yml",
}

export const workflowJobFixture: WorkflowJob = {
  id: 123, name: "Build and test", status: "completed", conclusion: "success", runner: "ubuntu-latest",
  startedAt: "2026-04-14T09:02:00Z", completedAt: "2026-04-14T09:03:00Z",
  steps: [{ number: 1, name: "Run unit tests", status: "completed", conclusion: "success",
    startedAt: "2026-04-14T09:02:00Z", completedAt: "2026-04-14T09:03:00Z" }],
}
