import { spawnGitHub } from "./process"
import { GitHubApiError } from "./errors"

export async function openGitHub(repository: string, target?: string | number, view?: "diff"): Promise<void> {
  const runId = typeof target === "string" ? /^actions\/runs\/(\d+)$/.exec(target)?.[1] : undefined
  const qualifiedRepository = `github.com/${repository}`
  const args = runId
    ? ["run", "view", runId, "--web", "--repo", qualifiedRepository]
    : view === "diff" && typeof target === "number"
    ? ["pr", "diff", String(target), "--web", "--repo", qualifiedRepository]
    : ["browse", ...(target !== undefined ? [String(target)] : []), "--repo", qualifiedRepository]
  const child = spawnGitHub(args)
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, 20_000)
  try {
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (timedOut) throw new Error("Opening GitHub timed out")
    if (code !== 0) throw new GitHubApiError(repository, error.trim() || output.trim() || `Opening GitHub failed (${code})`, code === 4 ? 401 : undefined)
  } finally {
    clearTimeout(timeout)
  }
}
