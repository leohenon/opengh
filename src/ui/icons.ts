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

export type IconSet = {
  pullRequest: { open: string; merged: string; closed: string; draft: string }
  issue: { open: string; closed: string }
  repository: { fork: string; star: string; watching: string }
  workflow: { success: string; failure: string; cancelled: string; skipped: string; clock: string; attention: string; neutral: string }
  user: string
  commit: string
  branch: string
}

export const nerdIcons: IconSet = {
  pullRequest: pullRequestIcons,
  issue: issueIcons,
  repository: repositoryIcons,
  workflow: workflowIcons,
  user: "\uf007",
  commit: "\uf417",
  branch: "\uf418",
}

export const unicodeIcons: IconSet = {
  pullRequest: { open: "⑂", merged: "⑃", closed: "×", draft: "◌" },
  issue: issueIcons,
  repository: { fork: "⑂", star: "☆", watching: "◉" },
  workflow: { success: "✓", failure: "×", cancelled: "⊘", skipped: "↷", clock: "◷", attention: "!", neutral: "−" },
  user: "●",
  commit: "◇",
  branch: "⑂",
}
