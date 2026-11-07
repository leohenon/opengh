import type { DiffTarget } from "./models"

export type Page = "overview" | "commits" | "issues" | "pulls" | "actions"

// Detail routes identify entities, never selected row positions.
export type DetailTarget =
  | { kind: "commit"; sha: string }
  | { kind: "issue"; number: number }
  | { kind: "pull"; number: number }
  | { kind: "run"; id: number }

export type InitialNavigation = {
  page?: Page
  detail?: DetailTarget
  diff?: DiffTarget
}

export type NavigationState = {
  page: Page
  details?: Partial<Record<Page, DetailTarget>>
  diffs?: Partial<Record<Page, DiffTarget>>
  history?: Partial<Record<Page, DetailTarget[]>>
  document?: string
  pageOrigin?: { page: Page; state: NavigationState }
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

function sameDetail(left: DetailTarget, right: DetailTarget): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === "commit") return right.kind === "commit" && left.sha === right.sha
  if (left.kind === "run") return right.kind === "run" && left.id === right.id
  return (right.kind === "issue" || right.kind === "pull") && left.number === right.number
}

export function openDetail(state: NavigationState, detail: DetailTarget): NavigationState {
  const page = detailPage[detail.kind]
  const current = state.details?.[state.page]
  if (current && sameDetail(current, detail)) return withoutDiff(state, page)
  const next = { ...withoutDiff(state, page), page, details: { ...state.details, [page]: detail } }
  // Tab switches keep their own trails; only detail-to-detail navigation adds a step.
  return current ? { ...next, history: {
    ...state.history, [page]: [...(state.history?.[state.page] ?? []), current],
  } } : next
}

export function openPage(state: NavigationState, page: Page, document = state.document): NavigationState {
  if (state.page === page && !state.details?.[page] && !state.diffs?.[page] && document === state.document) return state
  const { details, history, ...next } = withoutDiff(state, page)
  const remaining = { ...details }
  const trails = { ...history }
  delete remaining[page]
  delete trails[page]
  return {
    ...next, page, document,
    ...(Object.keys(remaining).length ? { details: remaining } : {}),
    ...(Object.keys(trails).length ? { history: trails } : {}),
    pageOrigin: { page, state },
  }
}

export function atRepositoryEntry(state: NavigationState, entry: NavigationState): boolean {
  if (state.diffs?.[state.page] || state.page !== entry.page || state.pageOrigin !== entry.pageOrigin) return false
  const current = state.details?.[state.page]
  const original = entry.details?.[entry.page]
  return (current && original ? sameDetail(current, original) : current === original)
    && (state.history?.[state.page]?.length ?? 0) === (entry.history?.[entry.page]?.length ?? 0)
}

export function openDiff(state: NavigationState, diff: DiffTarget): NavigationState {
  return { ...state, diffs: { ...state.diffs, [state.page]: diff } }
}

export function back(state: NavigationState): NavigationState {
  if (state.diffs?.[state.page]) return withoutDiff(state, state.page)
  if (!state.details?.[state.page]) return state.pageOrigin?.page === state.page ? state.pageOrigin.state : state
  const { details, history, ...origin } = state
  const remaining = { ...details }
  const trails = { ...history }
  const trail = trails[state.page]
  delete remaining[state.page]
  delete trails[state.page]
  const previous = trail?.at(-1)
  const page = previous ? detailPage[previous.kind] : state.page
  if (previous && trail) {
    remaining[page] = previous
    if (trail.length > 1) trails[page] = trail.slice(0, -1)
    else delete trails[page]
  }
  return {
    ...origin, page,
    ...(Object.keys(remaining).length ? { details: remaining } : {}),
    ...(Object.keys(trails).length ? { history: trails } : {}),
  }
}
