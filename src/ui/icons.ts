// Nerd Font Octicons: keep GitHub entity and workflow states visually consistent.
export const pullRequestIcons = {
  open: "\uf407",
  merged: "\uf419",
  closed: "\uf4dc",
  draft: "\uf4dd",
} as const

export const issueIcons = {
  open: "◉",
  closed: "✓",
} as const

export const repositoryIcons = {
  fork: "\uf402",
  star: "\uf41e",
  watching: "\uf441",
} as const

export const workflowIcons = {
  success: "\uf49e",
  failure: "\uf52f",
  cancelled: "\uf468",
  skipped: "\uf517",
  clock: "\uf43a",
  attention: "\uf421",
  neutral: "\uf48b",
} as const
