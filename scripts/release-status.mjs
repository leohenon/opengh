// Runs in the final release job using Node and gh, even if dependency installation failed.
import { spawnSync } from "node:child_process"

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function parseJson(value, source) {
  try { return JSON.parse(value) }
  catch { throw new Error(`Invalid JSON from ${source}`) }
}

function gh(args, input) {
  const result = spawnSync("gh", args, { input, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${result.stderr.trim()}`)
  return result.stdout
}

const stages = {
  test: "Release CI",
  build: "Build and smoke tests",
  draft: "GitHub draft and assets",
  npm: "npm publication",
  publish: "GitHub publication",
  homebrew: "Homebrew tap update",
}
const jobs = parseJson(required("RELEASE_JOBS"), "release job results")
const results = Object.keys(stages).map(key => {
  const result = jobs?.[key]?.result
  if (!["success", "failure", "cancelled", "skipped"].includes(result)) throw new Error(`Invalid result for ${key}`)
  return result
})
const failed = results.includes("failure")
const recovered = results.every(result => result === "success")
if (!failed && !recovered) {
  console.log("Release did not finish; leaving failure issues unchanged.")
} else {
  const repository = required("GITHUB_REPOSITORY")
  const tag = required("GITHUB_REF_NAME")
  const run = required("GITHUB_RUN_ID")
  const attempt = required("GITHUB_RUN_ATTEMPT")
  const marker = `<!-- opengh-release-failure:${tag} -->`
  const title = `release ${tag} failed`
  const url = `https://github.com/${repository}/actions/runs/${run}/attempts/${attempt}`
  // List all pages directly: search indexing delays must not create duplicate issues on retries.
  const pages = parseJson(gh(["api", "--paginate", "--slurp", `repos/${repository}/issues?state=all&per_page=100`]), "issue list")
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) throw new Error("Invalid issue list")
  const issues = pages.flat()
  for (const issue of issues) {
    if (!issue || !Number.isInteger(issue.number) || typeof issue.title !== "string"
      || !["open", "closed"].includes(issue.state) || (issue.body != null && typeof issue.body !== "string")) {
      throw new Error("Invalid issue in release failure lookup")
    }
  }
  const matches = issues.filter(issue => !issue.pull_request && issue.title === title && issue.body?.includes(marker))
  if (matches.length > 1) throw new Error(`Multiple failure issues found for ${tag}; reconcile them manually`)
  const issue = matches[0]
  const body = [
    marker,
    recovered ? `Release **${tag}** recovered successfully.` : "",
    `[Workflow run · attempt ${attempt}](${url})`,
    "| Stage | Result |\n| --- | --- |\n"
      + Object.values(stages).map((name, index) => `| ${name} | ${results[index]} |`).join("\n"),
    ...(failed ? [
      "Failed publications may have partially succeeded. No automatic rollback.",
      "Fix the cause, then re-run failed jobs—not the release command. Bad published artifacts need a new version. Closes automatically on recovery.",
    ] : []),
  ].filter(Boolean).join("\n\n") + "\n"
  // Do not retry writes blindly: a failed acknowledgement may still mean the issue was updated.
  if (issue) {
    if (failed || issue.state === "open") {
      gh(["issue", "edit", String(issue.number), "--repo", repository, "--body-file", "-"], body)
      if (failed && issue.state === "closed") gh(["issue", "reopen", String(issue.number), "--repo", repository])
      if (recovered && issue.state === "open") gh(["issue", "close", String(issue.number), "--repo", repository, "--reason", "completed"])
    }
  } else if (failed) {
    gh(["issue", "create", "--repo", repository, "--title", title, "--body-file", "-"], body)
  }
}
