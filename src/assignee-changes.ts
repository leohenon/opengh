export type AssigneeChanges = { add: string[]; remove: string[] }

// What a save sends: differences from when the picker opened, plus earlier changes whose outcome is unknown.
// Sending only changes leaves assignees that someone else changed meanwhile alone.
export function assigneeChanges(
  baseline: readonly string[],
  selected: readonly string[],
  uncertain: readonly string[] = [],
): AssigneeChanges {
  const key = (login: string) => login.toLowerCase()
  const unique = (logins: readonly string[]) =>
    logins.filter((login, index) => logins.findIndex((other) => key(other) === key(login)) === index)
  const before = new Set(baseline.map(key))
  const chosen = new Set(selected.map(key))
  const unknown = new Set(uncertain.map(key))
  return {
    add: unique(selected).filter((login) => !before.has(key(login)) || unknown.has(key(login))),
    remove: unique([...baseline, ...uncertain]).filter((login) => !chosen.has(key(login))),
  }
}
