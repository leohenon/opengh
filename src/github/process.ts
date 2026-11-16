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

type Child = Bun.Subprocess<"ignore" | Uint8Array, "pipe", "pipe">
const children = new Set<Child>()
const writes = new Set<Child>()
let stopping = false
let abandoned = false
// Longer than the transport's request timeout.
const WRITE_SHUTDOWN_LIMIT_MS = 30_000

export function abandonGitHubWrites() {
  abandoned = true
}

export function spawnGitHub(args: string[], cwd?: string, input?: string, write = false) {
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
      throw new Error(
        "GitHub CLI (gh) was not found on PATH. Install it from https://cli.github.com, then run gh auth login --hostname github.com.",
      )
    throw error
  }
  children.add(child)
  if (write) writes.add(child)
  const forget = () => {
    children.delete(child)
    writes.delete(child)
  }
  void child.exited.then(forget, forget)
  return child
}

// Lets writes finish unless abandoned.
export async function stopGitHubProcesses() {
  stopping = true
  const active = [...children]
  const finishing = active.filter((child) => writes.has(child) && !abandoned)
  for (const child of active) if (!finishing.includes(child)) child.kill("SIGKILL")
  let timer: ReturnType<typeof setTimeout> | undefined
  if (finishing.length)
    timer = setTimeout(() => {
      for (const child of finishing) child.kill("SIGKILL")
    }, WRITE_SHUTDOWN_LIMIT_MS)
  await Promise.allSettled(active.map((child) => child.exited))
  clearTimeout(timer)
}
