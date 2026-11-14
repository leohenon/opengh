// Only the main-branch duplicate of a version-only release commit may skip CI.
// Tags (including reusable release CI), PRs, and ordinary pushes always run it.
import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"

function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim())
  return result.stdout
}

function shouldRunCI() {
  if (process.env.GITHUB_EVENT_NAME !== "push" || process.env.GITHUB_REF !== "refs/heads/main") return true
  const [head, ...parents] = git("rev-list", "--parents", "-n", "1", "HEAD").trim().split(" ")
  // A push containing other commits still needs normal CI, even if its tip is a release.
  if (parents.length !== 1 || parents[0] !== process.env.PUSH_BEFORE) return true
  const match = /^release (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(git("log", "-1", "--format=%s").trim())
  if (!match) return true
  if (git("diff", "--name-only", parents[0], head).trim() !== "package.json") return true
  const before = git("show", `${parents[0]}:package.json`)
  const after = git("show", `${head}:package.json`)
  try {
    if (JSON.parse(after).version !== match[1] || JSON.parse(before).version === match[1]) return true
  } catch { return true }
  // Require the exact edit made by scripts/release.ts, not just a release-looking subject.
  const expected = before.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${match[1]}$2`)
  return after !== expected
}

const run = shouldRunCI()
if (!process.env.GITHUB_OUTPUT) throw new Error("Missing GITHUB_OUTPUT")
appendFileSync(process.env.GITHUB_OUTPUT, `run_ci=${run}\n`)
console.log(run ? "Run CI." : "Version-only release commit; release-tag CI remains required.")
