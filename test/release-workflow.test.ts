import { afterEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Execute the actual workflow steps with local stand-ins: these tests must never publish anything.
const workflow = Bun.YAML.parse(await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")) as {
  concurrency?: { group: string; "cancel-in-progress": boolean; queue: string }
  jobs: Record<string, { name?: string; uses?: string; needs?: string | string[]; if?: string; permissions?: Record<string, string>; steps?: Array<{ name?: string; run?: string }> }>
}
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "opengh-release-workflow-"))
  directories.push(directory)
  const tools = join(directory, "tools")
  await mkdir(tools)
  const env = { ...process.env, PATH: `${tools}:${process.env.PATH}`, HOME: directory, GH_TOKEN: "", GITHUB_TOKEN: "", NODE_AUTH_TOKEN: "",
    GITHUB_REPOSITORY: "fixture/repository", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "file" }
  async function tool(name: string, body: string) {
    await writeFile(join(tools, name), `#!/bin/sh\nset -eu\n${body}\n`)
    await chmod(join(tools, name), 0o755)
  }
  async function run(args: string[], cwd = directory, extra: Record<string, string> = {}) {
    const child = Bun.spawn(args, { cwd, env: { ...env, ...extra }, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, out, error }
  }
  async function step(job: string, name: string, cwd: string, version: string, extra: Record<string, string> = {}) {
    const script = workflow.jobs[job]!.steps?.find(step => step.name === name)?.run
    if (!script) throw new Error(`Missing workflow step ${job}/${name}`)
    return run(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script], cwd, { GITHUB_REF_NAME: `v${version}`, ...extra })
  }
  return { directory, tool, run, step }
}

test("release reporting runs after every stage with isolated issue permissions", () => {
  const report = workflow.jobs.report!
  expect(report.needs).toEqual(["test", "build", "draft", "npm", "publish", "homebrew"])
  expect(report.if).toBe("${{ always() }}")
  expect(report.permissions).toEqual({ contents: "read", issues: "write" })
  expect(report.steps?.find(step => step.name === "Update the release failure issue")?.run).toBe("node scripts/release-status.mjs")
})

async function reportingFixture() {
  const f = await fixture()
  const runtime = Bun.which("node")!
  const registry = join(f.directory, "issues.json")
  type State = { issues: Array<{ number: number; title: string; body: string; state: string; pull_request?: object }>;
    calls: string[][]; failLookup?: boolean; loseCreateAcknowledgement?: boolean }
  await writeFile(registry, JSON.stringify({ issues: [], calls: [] }))
  const read = async (): Promise<State> => JSON.parse(await readFile(registry, "utf8"))
  const update = async (values: Partial<State>) => writeFile(registry, JSON.stringify({ ...await read(), ...values }))
  const mock = join(f.directory, "gh.mjs")
  await writeFile(mock, `
import fs from "node:fs"
const file = process.env.ISSUES_FILE, state = JSON.parse(fs.readFileSync(file, "utf8"))
const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1]
state.calls.push(args)
const save = () => fs.writeFileSync(file, JSON.stringify(state))
if (args[0] === "api") {
  if (!args.includes("--paginate") || !args.includes("--slurp")) throw Error("missing pagination")
  if (!args.at(-1).endsWith("/issues?state=all&per_page=100")) throw Error("unexpected API")
  save()
  if (state.failLookup) { console.error("lookup failed"); process.exit(1) }
  console.log(JSON.stringify([[], state.issues]))
} else if (args[0] === "issue") {
  if (value("--repo") !== "fixture/repository") throw Error("wrong repository")
  const issue = state.issues.find(issue => issue.number === Number(args[2]))
  switch (args[1]) {
    case "create":
      state.issues.push({ number: 42, title: value("--title"), body: fs.readFileSync(0, "utf8"), state: "open" })
      save()
      if (state.loseCreateAcknowledgement) process.exit(1)
      break
    case "edit": issue.body = fs.readFileSync(0, "utf8"); break
    case "close": issue.state = "closed"; break
    case "reopen": issue.state = "open"; break
    default: throw Error("unexpected issue mutation")
  }
  save()
} else throw Error("unexpected gh command")
`)
  await f.tool("gh", `exec ${JSON.stringify(runtime)} ${JSON.stringify(mock)} "$@"`)
  const script = join(f.directory, "report.mjs")
  await writeFile(script, await readFile(new URL("../scripts/release-status.mjs", import.meta.url), "utf8"))
  const report = (overrides: Record<string, string> = {}) => f.run([runtime, script], f.directory, {
    ISSUES_FILE: registry, GITHUB_REF_NAME: "v0.0.0-beta.1", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2",
    RELEASE_JOBS: JSON.stringify(Object.fromEntries(["test", "build", "draft", "npm", "publish", "homebrew"]
      .map(key => [key, { result: overrides[key] ?? "success" }]))),
  })
  return { read, update, report }
}

test("release failure reporting updates one issue, closes on recovery, and reopens on another failure", async () => {
  const f = await reportingFixture()
  const failure = { npm: "failure", publish: "skipped", homebrew: "skipped" }
  expect((await f.report(failure)).code).toBe(0)
  let state = await f.read()
  expect(state.issues).toHaveLength(1)
  expect(state.issues[0]).toMatchObject({ title: "release v0.0.0-beta.1 failed", state: "open" })
  expect(state.issues[0]!.body).toContain("| npm publication | failure |")
  expect(state.issues[0]!.body).toContain("| GitHub publication | skipped |")
  expect(state.issues[0]!.body).toContain("/actions/runs/123/attempts/2")
  expect(state.issues[0]!.body).toContain("may have partially succeeded")
  expect(state.issues[0]!.body).toContain("re-run failed jobs")
  expect((await f.report(failure)).code).toBe(0)
  expect((await f.read()).issues).toHaveLength(1)
  expect((await f.report()).code).toBe(0)
  state = await f.read()
  expect(state.issues[0]!.state).toBe("closed")
  expect(state.issues[0]!.body).toContain("recovered successfully")
  const mutations = state.calls.filter(args => args[0] === "issue").length
  expect((await f.report()).code).toBe(0)
  expect((await f.read()).calls.filter(args => args[0] === "issue")).toHaveLength(mutations)
  expect((await f.report({ homebrew: "failure" })).code).toBe(0)
  state = await f.read()
  expect(state.issues).toHaveLength(1)
  expect(state.issues[0]!.state).toBe("open")
  expect(state.issues[0]!.body).toContain("| GitHub publication | success |")
  expect(state.issues[0]!.body).toContain("| Homebrew tap update | failure |")
})

test("successful and cancelled releases do not create failure issues", async () => {
  const f = await reportingFixture()
  expect((await f.report()).code).toBe(0)
  expect((await f.read()).issues).toEqual([])
  const calls = (await f.read()).calls.length
  expect((await f.report({ npm: "cancelled", publish: "skipped", homebrew: "skipped" })).code).toBe(0)
  expect((await f.read()).calls).toHaveLength(calls)
  expect((await f.report({ npm: "unexpected" })).code).not.toBe(0)
  expect((await f.read()).calls).toHaveLength(calls)
})

test("release issue lookup failures stop writes and lost create acknowledgements do not cause duplicates", async () => {
  const f = await reportingFixture()
  await f.update({ failLookup: true })
  expect((await f.report({ homebrew: "failure" })).code).not.toBe(0)
  expect((await f.read()).calls.every(args => args[0] === "api")).toBe(true)
  await f.update({ failLookup: false, loseCreateAcknowledgement: true })
  expect((await f.report({ homebrew: "failure" })).code).not.toBe(0)
  expect((await f.read()).issues).toHaveLength(1)
  expect((await f.read()).calls.filter(args => args[1] === "create")).toHaveLength(1)
  expect((await f.report({ homebrew: "failure" })).code).toBe(0)
  expect((await f.read()).issues).toHaveLength(1)
  expect((await f.read()).calls.filter(args => args[1] === "create")).toHaveLength(1)
})

test("release reporting ignores unrelated issues and pull requests", async () => {
  const f = await reportingFixture()
  const title = "release v0.0.0-beta.1 failed", body = "<!-- opengh-release-failure:v0.0.0-beta.1 -->"
  await f.update({ issues: [
    { number: 1, title, body: "Manually written issue", state: "open" },
    { number: 2, title, body, state: "open", pull_request: {} },
    { number: 3, title: "release v0.0.0-beta.2 failed", body, state: "open" },
  ] })
  expect((await f.report()).code).toBe(0)
  expect((await f.read()).calls.every(args => args[0] === "api")).toBe(true)
  expect((await f.report({ build: "failure", draft: "skipped", npm: "skipped", publish: "skipped", homebrew: "skipped" })).code).toBe(0)
  expect((await f.read()).issues).toHaveLength(4)
})

test("publication retries leave an already published release alone and stop on a lookup error", async () => {
  const f = await fixture()
  const calls = join(f.directory, "edits")
  await f.tool("gh", `
case "$1 $2" in
  'release view')
    case "$RELEASE_STATE" in error) echo 'lookup failed' >&2; exit 1;; *) printf '%s\\n' "$RELEASE_STATE";; esac ;;
  'release edit') printf '%s\\n' "$*" >> "$CALLS" ;;
  'api --paginate') printf '%s\\n' "" ;;
  *) exit 2 ;;
esac`)
  const publish = (version: string, state: string) => f.step("publish", "Publish the staged release", f.directory, version, { RELEASE_STATE: state, CALLS: calls })
  // A newer release is already latest. Retrying this older version must not invoke `--latest`.
  expect((await publish("0.0.1", "false")).code).toBe(0)
  expect(await Bun.file(calls).exists()).toBe(false)
  expect((await publish("0.0.2", "error")).code).not.toBe(0)
  expect((await publish("0.0.2", "unexpected")).code).not.toBe(0)
  expect(await Bun.file(calls).exists()).toBe(false)
  expect((await publish("0.0.2", "true")).code).toBe(0)
  expect((await publish("0.0.3-rc.1", "true")).code).toBe(0)
  expect((await readFile(calls, "utf8")).trim().split("\n")).toEqual([
    "release edit v0.0.2 --repo fixture/repository --draft=false --latest",
    "release edit v0.0.3-rc.1 --repo fixture/repository --draft=false --latest=false",
  ])
})

test("the Homebrew step installs and upgrades but an old release cannot downgrade the tap", async () => {
  expect(workflow.jobs.homebrew!.if).toBeUndefined() // Prereleases run this job too.
  expect(workflow.jobs.homebrew!.needs).toBe("publish")
  const f = await fixture()
  await f.tool("bun", `exec ${JSON.stringify(process.execPath)} "$@"`)
  const tap = join(f.directory, "tap"), generated = join(f.directory, "dist/homebrew")
  await mkdir(tap)
  await mkdir(generated, { recursive: true })
  const remote = join(f.directory, "remote.git")
  const command = async (args: string[], cwd = tap) => {
    const result = await f.run(["git", ...args], cwd)
    expect(result, result.error).toMatchObject({ code: 0 })
    return result.out.trim()
  }
  await command(["init", "--bare", remote], f.directory)
  await command(["init", "-b", "main"])
  await command(["config", "user.name", "Release test"])
  await command(["config", "user.email", "test@example.invalid"])
  await command(["config", "commit.gpgsign", "false"])
  await command(["config", "core.hooksPath", "/dev/null"])
  await command(["remote", "add", "origin", remote])
  const formula = (version: string) => `class Opengh < Formula\n  version "${version}"\nend\n`
  const install = async (version: string) => {
    await writeFile(join(generated, "opengh.rb"), formula(version))
    const result = await f.step("homebrew", "Commit the formula", tap, version)
    expect(result, result.error).toMatchObject({ code: 0 })
  }
  await install("0.0.0-beta.1")
  expect(await readFile(join(tap, "Formula/opengh.rb"), "utf8")).toBe(formula("0.0.0-beta.1"))
  await install("0.0.0-beta.2")
  const betaHead = await command(["rev-parse", "HEAD"])
  await install("0.0.0-beta.1")
  expect(await command(["rev-parse", "HEAD"])).toBe(betaHead)
  await install("0.0.0")
  const stableHead = await command(["rev-parse", "HEAD"])
  await install("0.0.0-beta.2")
  expect(await command(["rev-parse", "HEAD"])).toBe(stableHead)
  await install("0.0.1-beta.1") // A newer beta can replace the stable formula.
  expect(await readFile(join(tap, "Formula/opengh.rb"), "utf8")).toBe(formula("0.0.1-beta.1"))
  await install("0.0.1")
  await install("0.0.2")
  const head = await command(["rev-parse", "HEAD"])
  await install("0.0.2")
  await install("0.0.1")
  expect(await command(["rev-parse", "HEAD"])).toBe(head)
  expect(await readFile(join(tap, "Formula/opengh.rb"), "utf8")).toBe(formula("0.0.2"))
  await install("0.0.10") // Compare numerically, not lexicographically.
  expect(await command(["--git-dir", remote, "show", "refs/heads/main:Formula/opengh.rb"])).toBe(formula("0.0.10").trim())
}, 15_000)

test("an unfinished older GitHub release is published without downgrading latest", async () => {
  const f = await fixture()
  const calls = join(f.directory, "edits")
  await f.tool("gh", `
case "$1 $2" in
  'release view') printf '%s\\n' true ;;
  'api --paginate')
    if [ "\${FAIL_LIST:-}" = true ]; then echo 'offline' >&2; exit 1; fi
    printf '%s\\n' "$PUBLISHED" ;;
  'release edit') printf '%s\\n' "$*" >> "$CALLS" ;;
  *) exit 2 ;;
esac`)
  const publish = (version: string, published: string, fail = false) => f.step("publish", "Publish the staged release", f.directory, version,
    { PUBLISHED: published, CALLS: calls, FAIL_LIST: String(fail) })
  expect((await publish("0.0.1", "v0.0.2\nv0.0.10")).code).toBe(0)
  expect((await publish("0.0.3", "v0.0.2\nv0.0.10")).code).toBe(0)
  expect((await publish("0.1.0", "v0.0.2\nv0.0.10")).code).toBe(0)
  expect((await publish("0.0.0", "")).code).toBe(0) // First release has no published versions to compare.
  expect((await publish("0.1.0-rc.1", "v0.0.10")).code).toBe(0)
  const expected = [
    "release edit v0.0.1 --repo fixture/repository --draft=false --latest=false",
    "release edit v0.0.3 --repo fixture/repository --draft=false --latest=false",
    "release edit v0.1.0 --repo fixture/repository --draft=false --latest",
    "release edit v0.0.0 --repo fixture/repository --draft=false --latest",
    "release edit v0.1.0-rc.1 --repo fixture/repository --draft=false --latest=false",
  ]
  expect((await readFile(calls, "utf8")).trim().split("\n")).toEqual(expected)
  expect((await publish("0.2.0", "", true)).code).not.toBe(0)
  expect((await readFile(calls, "utf8")).trim().split("\n")).toEqual(expected) // Lookup failure must not mean "no newer version".
})

test("all release versions share a non-cancelling publication queue", () => {
  expect(workflow.concurrency).toEqual({ group: "release-publication", "cancel-in-progress": false, queue: "max" })
})

// The registry is a JSON file. Only the npm operations used by the workflow are accepted.
async function npmFixture() {
  const f = await fixture()
  const registry = join(f.directory, "registry.json"), script = join(f.directory, "registry.cjs")
  type Registry = { versions: Record<string, string[]>; tags: Record<string, Record<string, string>>;
    log: string[][]; failPublish?: string; failPromote?: string; failLookup?: boolean }
  const empty: Registry = { versions: {}, tags: {}, log: [] }
  await writeFile(registry, JSON.stringify(empty))
  await writeFile(script, `
const fs = require("node:fs"), path = require("node:path")
const state = JSON.parse(fs.readFileSync(process.env.REGISTRY, "utf8")), args = process.argv.slice(2)
const save = () => fs.writeFileSync(process.env.REGISTRY, JSON.stringify(state))
const split = value => { const at = value.lastIndexOf("@"); return [value.slice(0, at), value.slice(at + 1)] }
if (args[0] === "view" && args[2] === "version") {
  const [name, version] = split(args[1])
  if (!(state.versions[name] || []).includes(version)) process.exit(1)
  console.log(version)
} else if (args[0] === "view" && args[2] === "dist-tags" && args[3] === "--json") {
  if (state.failLookup) { console.error("registry offline"); process.exit(1) }
  // npm view first selects a version, even for a package-level field. A new staged package has no latest.
  const [name, version] = args[1].includes("@") ? split(args[1]) : [args[1], state.tags[args[1]]?.latest]
  if (!(state.versions[name] || []).includes(version)) process.exit(0)
  console.log(JSON.stringify(state.tags[name] || {}))
} else if (args[0] === "publish") {
  const pkg = JSON.parse(fs.readFileSync(path.join(args[1], "package.json"), "utf8"))
  if (state.failPublish === pkg.name) { console.error("publish failed"); process.exit(1) }
  const versions = state.versions[pkg.name] ||= []
  if (versions.includes(pkg.version)) { console.error("already published"); process.exit(1) }
  const tag = args[args.indexOf("--tag") + 1]
  versions.push(pkg.version)
  ;(state.tags[pkg.name] ||= {})[tag] = pkg.version
  state.log.push(["publish", pkg.name, pkg.version, tag]); save()
} else if (args[0] === "dist-tag" && args[1] === "add") {
  const [name, version] = split(args[2]), tag = args[3]
  if (!(state.versions[name] || []).includes(version)) throw Error("promoting an unpublished version")
  if (state.failPromote === name) { console.error("promotion failed"); process.exit(1) }
  ;(state.tags[name] ||= {})[tag] = version
  state.log.push(["promote", name, version, tag]); save()
} else throw Error("Unexpected npm call: " + args.join(" "))
`)
  await f.tool("npm", `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"`)
  // Match the pinned runtime running the workflow's semver comparisons, rather than an arbitrary PATH Bun.
  await f.tool("bun", `exec ${JSON.stringify(process.execPath)} "$@"`)
  const names = ["opengh-darwin-arm64", "opengh-linux-x64", "opengh"]
  const state = async (): Promise<Registry> => JSON.parse(await readFile(registry, "utf8"))
  const set = async (fields: Partial<Registry>) => { await writeFile(registry, JSON.stringify({ ...await state(), ...fields })) }
  const publish = async (version: string) => {
    await writeFile(join(f.directory, "package.json"), JSON.stringify({ version }))
    for (const name of names) {
      const directory = join(f.directory, "dist/npm", name)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, "package.json"), JSON.stringify({ name, version }))
    }
    return f.step("npm", "Publish", f.directory, version, { REGISTRY: registry, PRIVATE_REPOSITORY: "true" })
  }
  return { state, set, names, publish }
}

test.each(["upload", "promotion"] as const)("retrying incomplete npm %s cannot downgrade latest after a newer release", async failure => {
  const f = await npmFixture()
  await f.set(failure === "upload" ? { failPublish: "opengh" } : { failPromote: "opengh" })
  expect((await f.publish("0.0.1")).code).not.toBe(0)
  // Finish a newer release before retrying the old one.
  await f.set({ failPublish: undefined, failPromote: undefined })
  expect((await f.publish("0.0.2")).code).toBe(0)
  expect((await f.publish("0.0.1")).code).toBe(0)
  const state = await f.state()
  for (const name of f.names) {
    expect(state.versions[name]).toContain("0.0.1")
    expect(state.tags[name]!.latest).toBe("0.0.2")
  }
  expect(state.log.filter(call => call[0] === "publish").every(call => call[3] === "staged")).toBe(true)
}, 15_000)

test("npm stages every package before promotion, repairs failed promotion, and does not downgrade next", async () => {
  const f = await npmFixture()
  await f.set({ failPublish: "opengh" })
  expect((await f.publish("0.0.0")).code).not.toBe(0)
  expect(Object.values((await f.state()).tags).every(tags => !tags.latest && !tags.next)).toBe(true)
  await f.set({ failPublish: undefined, failPromote: "opengh" })
  expect((await f.publish("0.0.0")).code).not.toBe(0)
  const publishes = (await f.state()).log.filter(call => call[0] === "publish").length
  await f.set({ failPromote: undefined })
  expect((await f.publish("0.0.0")).code).toBe(0)
  expect((await f.state()).log.filter(call => call[0] === "publish")).toHaveLength(publishes)
  expect((await f.publish("0.0.1-rc.9")).code).toBe(0)
  expect((await f.publish("0.0.1-rc.10")).code).toBe(0)
  expect((await f.publish("0.0.1-rc.8")).code).toBe(0)
  for (const name of f.names) expect((await f.state()).tags[name]).toMatchObject({ latest: "0.0.0", next: "0.0.1-rc.10" })
}, 20_000)

test("npm does not promote when it cannot determine the current channel version", async () => {
  const f = await npmFixture()
  await f.set({ failLookup: true })
  expect((await f.publish("0.0.0")).code).not.toBe(0)
  expect((await f.state()).log.filter(call => call[0] === "promote")).toEqual([])
  expect(Object.values((await f.state()).tags).every(tags => !tags.latest && !tags.next)).toBe(true)
})

test("the workflow extracts an annotated tag's notes without changing their whitespace", async () => {
  const f = await fixture()
  const repo = join(f.directory, "repo"), remote = join(f.directory, "remote.git"), output = join(f.directory, "output")
  await Promise.all([mkdir(repo), mkdir(output)])
  const git = async (...args: string[]) => {
    const result = await f.run(["git", ...args], repo)
    expect(result, result.error).toMatchObject({ code: 0 })
  }
  await git("init", "--bare", remote)
  await git("init", "-b", "main")
  await git("config", "user.name", "Release test")
  await git("config", "user.email", "test@example.invalid")
  await git("config", "commit.gpgsign", "false")
  await git("config", "core.hooksPath", "/dev/null")
  await git("commit", "--allow-empty", "-m", "initial")
  const notes = "    indented code\n\n<!-- Author comment -->\n\nLast line.  "
  const file = join(f.directory, "saved-notes.md")
  await writeFile(file, notes)
  await git("tag", "--annotate", "--no-sign", "--cleanup=verbatim", "--file", file, "v0.0.0")
  await git("remote", "add", "origin", remote)
  await git("push", "origin", "main", "refs/tags/v0.0.0")
  const result = await f.step("draft", "Read the release notes from the tag", repo, "0.0.0", { RUNNER_TEMP: output })
  expect(result, result.error).toMatchObject({ code: 0 })
  expect(await readFile(join(output, "notes.md"), "utf8")).toBe(notes)
}, 15_000)

test("staging uses the tag notes for new and existing drafts but never edits a published release", async () => {
  const f = await fixture()
  const dist = join(f.directory, "dist"), output = join(f.directory, "output"), body = join(f.directory, "release-body.md")
  await Promise.all([mkdir(dist), mkdir(output)])
  await writeFile(join(dist, "opengh-linux-x64.tar.gz"), "fixture archive")
  await writeFile(join(dist, "opengh-linux-x64.tar.gz.sha256"), "fixture checksum")
  await writeFile(join(f.directory, "install.sh"), "fixture installer")
  // Checksums are unrelated to this test; the Ubuntu-only command is replaced to keep it portable.
  await f.tool("sha256sum", 'test "$1" = --check')
  const calls = join(f.directory, "mutations")
  await f.tool("gh", `
case "$1 $2" in
  'release view')
    if [ "$RELEASE_STATE" = missing ]; then exit 1; fi
    printf '%s\\n' "$RELEASE_STATE" ;;
  'release upload') printf 'upload\\n' >> "$CALLS" ;;
  'release edit'|'release create')
    printf '%s\\n' "$2" >> "$CALLS"
    if [ "\${FAIL_NOTES:-}" = true ]; then echo 'notes update failed' >&2; exit 1; fi
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --notes-file ]; then cp "$2" "$BODY"; exit 0; fi
      shift
    done
    echo 'missing --notes-file' >&2; exit 2 ;;
  *) exit 2 ;;
esac`)
  const notes = "    indented note\n\n<!-- Author comment -->\nNew release notes.  \n"
  await writeFile(join(output, "notes.md"), notes)
  const stage = (state: string, fail = false) => f.step("draft", "Stage the release as a draft", f.directory, "0.0.0",
    { RELEASE_STATE: state, RUNNER_TEMP: output, BODY: body, CALLS: calls, FAIL_NOTES: String(fail) })
  for (const state of ["missing", "true"]) {
    await writeFile(body, "Outdated draft notes.")
    const result = await stage(state)
    expect(result, result.error).toMatchObject({ code: 0 })
    expect(await readFile(body, "utf8")).toBe(notes)
  }
  await writeFile(body, "Notes already published, possibly edited on GitHub.")
  const before = await readFile(calls, "utf8")
  expect((await stage("false")).code).toBe(0)
  expect(await readFile(body, "utf8")).toBe("Notes already published, possibly edited on GitHub.")
  expect(await readFile(calls, "utf8")).toBe(before)
  expect((await stage("true", true)).code).not.toBe(0) // Must not allow the downstream publication job to run.
})

test("release builds require reusable CI on the release tag", () => {
  expect(workflow.jobs.test).toEqual({ name: "Release CI", uses: "./.github/workflows/ci.yml" })
  expect(workflow.jobs.build!.needs).toBe("test")
})

test("reusable release CI cannot be cancelled by main-branch CI", async () => {
  const ci = Bun.YAML.parse(await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")) as {
    on: Record<string, unknown>
    concurrency: { group: string }
  }
  expect(ci.on).toHaveProperty("workflow_call")
  const group = (name: string, ref: string) => ci.concurrency.group
    .replaceAll("${{ github.workflow }}", name)
    .replaceAll("${{ github.ref }}", ref)
  expect(group("Release", "refs/tags/v0.1.0")).not.toBe(group("CI", "refs/heads/main"))
  expect(group("Release", "refs/tags/v0.1.0")).not.toBe(group("Release", "refs/tags/v0.2.0"))
  expect(group("Release", "refs/tags/v0.1.0")).not.toBe(workflow.concurrency!.group)
})
