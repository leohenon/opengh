import { spawnGitHub } from "./process"

export async function openGitHub(repository: string, sha?: string): Promise<void> {
  const child = spawnGitHub(["browse", ...(sha ? [sha] : []), "--repo", repository])
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
    if (code !== 0) throw new Error(error.trim() || output.trim() || `gh browse failed (${code})`)
  } finally {
    clearTimeout(timeout)
  }
}
