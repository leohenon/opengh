export function githubEnvironment() {
  const env: NodeJS.ProcessEnv = { ...process.env, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1" }
  // gh HTTP debugging logs private request and response bodies to stderr.
  delete env.GH_DEBUG
  delete env.DEBUG
  // This app has no Enterprise requests or ambient repository selection.
  delete env.GH_ENTERPRISE_TOKEN
  delete env.GITHUB_ENTERPRISE_TOKEN
  delete env.GH_REPO
  return env
}

const children = new Set<Bun.Subprocess<"ignore" | Uint8Array, "pipe", "pipe">>()
let stopping = false

export function spawnGitHub(args: string[], cwd?: string, input?: string) {
  if (stopping) throw new Error("Application is shutting down")
  let child: Bun.Subprocess<"ignore" | Uint8Array, "pipe", "pipe">
  try {
    child = Bun.spawn(["gh", ...args], {
      cwd,
      // Repository identifiers in opengh are scoped to GitHub.com.
      env: githubEnvironment(),
      stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !Bun.which("gh"))
      throw new Error("GitHub CLI (gh) was not found on PATH. Install it from https://cli.github.com, then run gh auth login --hostname github.com.")
    throw error
  }
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
