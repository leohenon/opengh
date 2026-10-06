export type Page = "overview" | "commits" | "issues" | "pulls" | "actions"

export type DetailTarget =
  | { kind: "commit"; sha: string }
  | { kind: "issue"; number: number }
  | { kind: "pull"; number: number }
  | { kind: "run"; id: number }

export type NavigationState = {
  page: Page
  detail?: DetailTarget
}

const detailPage: Record<DetailTarget["kind"], Page> = {
  commit: "commits",
  issue: "issues",
  pull: "pulls",
  run: "actions",
}

export function navigate(_state: NavigationState, page: Page): NavigationState {
  return { page }
}

export function openDetail(_state: NavigationState, detail: DetailTarget): NavigationState {
  return { page: detailPage[detail.kind], detail }
}

export function back(state: NavigationState): NavigationState {
  return state.detail ? { page: state.page } : state
}
