import { spawnGitHub } from "./process"

export async function openGitHub(repository: string, target?: string | number, view?: "diff"): Promise<void> {
  const args = view === "diff" && typeof target === "number"
    ? ["pr", "diff", String(target), "--web", "--repo", repository]
    : ["browse", ...(target !== undefined ? [String(target)] : []), "--repo", repository]
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
    if (code !== 0) throw new Error(error.trim() || output.trim() || `Opening GitHub failed (${code})`)
  } finally {
    clearTimeout(timeout)
  }
}
