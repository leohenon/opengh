const children = new Set<Bun.Subprocess<"ignore" | Uint8Array, "pipe", "pipe">>()
let stopping = false

export function spawnGitHub(args: string[], cwd?: string, input?: string) {
  if (stopping) throw new Error("Application is shutting down")
  const child = Bun.spawn(["gh", ...args], {
    cwd,
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  })
  children.add(child)
  void child.exited.then(
    () => children.delete(child),
    () => children.delete(child),
  )
  return child
}

export async function stopGitHubProcesses() {
  stopping = true
  const active = [...children]
  for (const child of active) child.kill("SIGKILL")
  await Promise.allSettled(active.map((child) => child.exited))
}
