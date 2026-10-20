import type { DiffTarget } from "./models"

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
  diffs?: Partial<Record<Page, DiffTarget>>
}

const detailPage: Record<DetailTarget["kind"], Page> = {
  commit: "commits",
  issue: "issues",
  pull: "pulls",
  run: "actions",
}

function withoutDiff(state: NavigationState, page: Page): NavigationState {
  if (!state.diffs?.[page]) return state
  const { diffs, ...origin } = state
  const remaining = { ...diffs }
  delete remaining[page]
  return Object.keys(remaining).length ? { ...origin, diffs: remaining } : origin
}

export function navigate(state: NavigationState, page: Page): NavigationState {
  return { ...state, page }
}

export function openDetail(state: NavigationState, detail: DetailTarget): NavigationState {
  const page = detailPage[detail.kind]
  return { ...withoutDiff(state, page), page, details: { ...state.details, [page]: detail } }
}

export function openDiff(state: NavigationState, diff: DiffTarget): NavigationState {
  return { ...state, diffs: { ...state.diffs, [state.page]: diff } }
}

export function back(state: NavigationState): NavigationState {
  if (state.diffs?.[state.page]) return withoutDiff(state, state.page)
  if (!state.details?.[state.page]) return state
  const { details, ...origin } = state
  const remaining = { ...details }
  delete remaining[state.page]
  return Object.keys(remaining).length ? { ...origin, details: remaining } : origin
}
