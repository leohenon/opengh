import type { Page } from "../navigation"

export const tabs: ReadonlyArray<{ page: Page; label: string }> = [
  { page: "overview", label: "Overview" },
  { page: "commits", label: "Commits" },
  { page: "issues", label: "Issues" },
  { page: "pulls", label: "Pull requests" },
  { page: "actions", label: "Actions" },
]
