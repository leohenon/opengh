import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const script = fileURLToPath(new URL("../scripts/ci-release-check.mjs", import.meta.url))

test.each([
  "version only", "tag", "pull request", "ordinary subject", "source change", "other manifest field",
  "wrong version", "invalid manifest", "formatting change", "multiple commits", "initial commit",
])("CI scope is conservative for %s", async scenario => {
  const directory = await mkdtemp(join(tmpdir(), "opengh-ci-scope-"))
  directories.push(directory)
  const repo = join(directory, "repo")
  await mkdir(repo)
  const output = join(directory, "output")
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "CI test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "CI test", GIT_COMMITTER_EMAIL: "test@example.invalid",
    GITHUB_EVENT_NAME: scenario === "pull request" ? "pull_request" : "push",
    GITHUB_REF: scenario === "tag" ? "refs/tags/v0.0.1-beta.1" : "refs/heads/main", GITHUB_OUTPUT: output }
  const run = async (args: string[], extra = {}) => {
    const child = Bun.spawn(args, { cwd: repo, env: { ...env, ...extra }, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ code, error }, error).toMatchObject({ code: 0 })
    return out.trim()
  }
  const git = (...args: string[]) => run(["git", ...args])
  await git("init", "-b", "main")
  await git("config", "core.hooksPath", "/dev/null")
  await git("config", "commit.gpgsign", "false")
  const before = '{\n  "name": "opengh",\n  "version": "0.0.0"\n}\n'
  await writeFile(join(repo, "package.json"), before)
  await git("add", ".")
  await git("commit", "-m", "initial")
  const parent = await git("rev-parse", "HEAD")
  if (scenario !== "initial commit") {
    if (scenario === "multiple commits") {
      await writeFile(join(repo, "source.ts"), "// new code\n")
      await git("add", ".")
      await git("commit", "-m", "change code")
    }
    let after = before.replace('"0.0.0"', '"0.0.1-beta.1"')
    if (scenario === "other manifest field") after = after.replace('"opengh"', '"different-name"')
    if (scenario === "wrong version") after = after.replace("beta.1", "beta.2")
    if (scenario === "invalid manifest") after += "invalid JSON"
    if (scenario === "formatting change") after = after.replaceAll("  ", "    ")
    await writeFile(join(repo, "package.json"), after)
    if (scenario === "source change") await writeFile(join(repo, "source.ts"), "// new code\n")
    await git("add", ".")
    await git("commit", "-m", scenario === "ordinary subject" ? "update package version" : "release 0.0.1-beta.1")
  }
  await run(["node", script], { PUSH_BEFORE: parent })
  expect(await readFile(output, "utf8")).toBe(`run_ci=${scenario !== "version only"}\n`)
})

test("both CI matrices are gated without removing release-tag CI", async () => {
  const ci = Bun.YAML.parse(await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")) as {
    on: Record<string, unknown>
    jobs: Record<string, { needs?: string; if?: string; outputs?: Record<string, string>; steps?: Array<{ id?: string; run?: string }> }>
  }
  expect(ci.on).toHaveProperty("workflow_call")
  expect(ci.jobs.changes!.outputs?.run_ci).toBe("${{ steps.scope.outputs.run_ci }}")
  expect(ci.jobs.changes!.steps?.find(step => step.id === "scope")?.run).toBe("node scripts/ci-release-check.mjs")
  for (const job of [ci.jobs.test!, ci.jobs.nix!]) {
    expect(job.needs).toBe("changes")
    expect(job.if).toBe("${{ needs.changes.outputs.run_ci == 'true' }}")
  }
})
