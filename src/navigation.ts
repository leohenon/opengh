export type Page = "overview" | "commits" | "issues" | "pulls" | "actions"

// Detail routes identify entities, never selected row positions.
export type DetailTarget =
  | { kind: "commit"; sha: string }
  | { kind: "issue"; number: number }
  | { kind: "pull"; number: number }
  | { kind: "run"; id: number }

export type NavigationState = {
  page: Page
  details?: Partial<Record<Page, DetailTarget>>
}

const detailPage: Record<DetailTarget["kind"], Page> = {
  commit: "commits",
  issue: "issues",
  pull: "pulls",
  run: "actions",
}

export function navigate(state: NavigationState, page: Page): NavigationState {
  return { ...state, page }
}

export function openDetail(state: NavigationState, detail: DetailTarget): NavigationState {
  const page = detailPage[detail.kind]
  return { page, details: { ...state.details, [page]: detail } }
}

export function back(state: NavigationState): NavigationState {
  if (!state.details?.[state.page]) return state
  const details = { ...state.details }
  delete details[state.page]
  return Object.keys(details).length ? { ...state, details } : { page: state.page }
}
