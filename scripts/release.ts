// Releases a version: writes the notes with you, then commits the version, tags, and pushes.
//
//   bun run release 0.1.0             a release
//   bun run release 0.1.0-rc.1        a pre-release
//   bun run release 0.1.0 --dry-run   everything except the commit, tag, and push
//
// The pushed tag starts .github/workflows/release.yml, which builds and publishes every channel.
// The tag's message is the release notes, published exactly as saved here.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { root } from "./targets"

const roadmap = "https://github.com/leohenon/opengh/blob/main/ROADMAP.md"
// Semantic versioning without build metadata. npm rejects anything looser, such as 01.0.0 or 1.0.0-rc.01,
// and it would do so only after the tag was pushed.
const identifier = "(0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)"
const versionPattern = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-${identifier}(\\.${identifier})*)?$`)

function fail(message: string): never {
  console.error(`release: ${message}`)
  process.exit(1)
}

function git(...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd: root })
  return { code: result.exitCode, ok: result.exitCode === 0, out: result.stdout.toString().trimEnd(), error: result.stderr.toString().trim() }
}
function mustGit(...args: string[]) {
  const result = git(...args)
  if (!result.ok) fail(`git ${args.join(" ")} failed: ${result.error}`)
  return result.out
}

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const [version, ...extra] = args.filter((arg) => arg !== "--dry-run")
if (!version || extra.length) fail("usage: bun run release <version> [--dry-run]")
if (!versionPattern.test(version)) fail(`"${version}" is not a version such as 0.1.0 or 0.1.0-rc.1.`)
const tag = `v${version}`

// The release is built from the tagged commit, so it must be exactly what is on GitHub and what CI tested.
if (mustGit("branch", "--show-current") !== "main") fail("releases are made from main.")
const dirty = mustGit("status", "--porcelain", "--untracked-files=no")
if (dirty) fail(`commit or stash these changes first; a release contains only committed work:\n${dirty}`)
mustGit("fetch", "--quiet", "--tags", "origin", "main")
const head = mustGit("rev-parse", "HEAD")
if (head !== mustGit("rev-parse", "origin/main")) fail("main and origin/main differ. Push or pull first, so CI has run on this commit.")
for (const file of ["LICENSE", "README.md"]) {
  if (!git("cat-file", "-e", `${head}:${file}`).ok) fail(`${file} must be committed before releasing; release builds use a clean checkout.`)
}

const tags = mustGit("tag", "--list", "v*").split("\n").filter(Boolean)
if (tags.includes(tag)) fail(`${tag} already exists.`)
const newest = tags.map((name) => name.slice(1)).filter((name) => versionPattern.test(name)).sort(Bun.semver.order).at(-1)
if (newest && Bun.semver.order(version, newest) <= 0) fail(`${version} is not newer than the latest release, ${newest}.`)
const manifestPath = join(root, "package.json")
const manifestText = readFileSync(manifestPath, "utf8")
const manifestIndex = mustGit("ls-tree", "--format=%(objectmode) %(objectname) 0\t%(path)", head, "--", "package.json")
const current = JSON.parse(manifestText).version as string

const ci = Bun.spawnSync(["gh", "run", "list", "--workflow", "ci.yml", "--commit", head, "--limit", "1", "--json", "status,conclusion"], { cwd: root })
if (ci.exitCode !== 0) fail(`could not read the CI result for this commit: ${ci.stderr.toString().trim()}`)
const [run] = JSON.parse(ci.stdout.toString() || "[]") as Array<{ status: string; conclusion: string }>
if (!run) fail("CI has not run on this commit.")
if (run.status !== "completed") fail("CI is still running on this commit.")
if (run.conclusion !== "success") fail(`CI did not pass on this commit (${run.conclusion}).`)

// Draft: roadmap items ticked since the last release, then the commits since it.
// A full release is compared with the last full release, so it also covers its own pre-releases.
const previous = git("describe", "--tags", "--abbrev=0", "--match", "v*", ...(version.includes("-") ? [] : ["--exclude", "v*-*"]), "HEAD")
const ticked = (ref: string) => {
  const file = git("show", `${ref}:ROADMAP.md`)
  return file.ok ? [...file.out.matchAll(/^\s*- \[x\] (.+)$/gim)].map((match) => match[1]!.trim()) : []
}
const before = new Set(previous.ok ? ticked(previous.out) : [])
const highlights = ticked("HEAD").filter((item) => !before.has(item))
const commits = previous.ok
  ? mustGit("log", "--no-merges", "--reverse", "--format=%s", `${previous.out}..HEAD`).split("\n").filter((subject) => subject && !/^release \d/.test(subject))
  : []
// GitHub identifies first-time contributors from merged PRs. This endpoint only generates
// text; it does not create a release or tag. Keep our own notes and use just its contributor list.
const generated = Bun.spawnSync(["gh", "api", "--method", "POST", "repos/leohenon/opengh/releases/generate-notes",
  "-f", `tag_name=${tag}`, "-f", `target_commitish=${head}`,
  ...(previous.ok ? ["-f", `previous_tag_name=${previous.out}`] : []),
], { cwd: root })
if (generated.exitCode !== 0) fail(`could not generate new contributors: ${generated.stderr.toString().trim()}`)
let generatedNotes: unknown
try { generatedNotes = JSON.parse(generated.stdout.toString()) }
catch { fail("invalid generated release notes response.") }
if (!generatedNotes || typeof generatedNotes !== "object" || !("body" in generatedNotes) || typeof generatedNotes.body !== "string") {
  fail("invalid generated release notes response.")
}
const contributorLines: string[] = []
let inContributors = false
for (const line of generatedNotes.body.split(/\r?\n/)) {
  if (/^## New Contributors\s*$/i.test(line)) { inContributors = true; continue }
  if (inContributors && (/^#{1,6} /.test(line) || /^\*\*Full Changelog\b/i.test(line))) break
  if (inContributors) contributorLines.push(line)
}
const contributors = contributorLines.join("\n").trim()
const instructions = [
  "<!-- opengh-release-instructions",
  `Edit release notes for ${tag} below.`,
  "This comment is removed before publishing. Clear the file to cancel.",
  "-->",
].join("\n")
const draft = [
  ...(highlights.length ? [`## What's new\n\n${highlights.map((item) => `- ${item}`).join("\n")}`] : []),
  ...(commits.length ? [`## Changes\n\n${commits.map((subject) => `- ${subject}`).join("\n")}`] : []),
  ...(contributors ? [`## New contributors\n\n${contributors}`] : []),
  ...(previous.ok ? [`**Full changelog:** https://github.com/leohenon/opengh/compare/${previous.out}...${tag}`] : []),
  ...(git("cat-file", "-e", "HEAD:ROADMAP.md").ok ? [`[Roadmap](${roadmap})`] : []),
].join("\n\n")

const scratch = mkdtempSync(join(tmpdir(), "opengh-release-"))
const notesPath = join(scratch, "notes.md")
writeFileSync(notesPath, `${instructions}\n\n${draft}\n`)
const editor = process.env.VISUAL || process.env.EDITOR || "vi"
// The editor setting may carry arguments, such as "code --wait".
const edited = Bun.spawnSync(["sh", "-c", `${editor} "$1"`, "sh", notesPath], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
if (edited.exitCode !== 0) fail(`the editor did not exit cleanly; nothing was released.\nYour notes are kept in ${notesPath}`)
const saved = readFileSync(notesPath, "utf8")
// Remove only our exact prefix (also allowing an editor's CRLF line endings), not authored Markdown or comments.
const prefix = [instructions, instructions.replaceAll("\n", "\r\n")].find(value => saved.startsWith(value))
const notes = prefix ? saved.slice(prefix.length).replace(/^\r?\n\r?\n/, "") : saved
if (!notes.trim()) {
  rmSync(scratch, { recursive: true, force: true })
  fail("the notes are empty; nothing was released.")
}
writeFileSync(notesPath, notes)
// Written notes outlive a failed or cancelled release, so they need not be typed again.
const stop = (message: string) => fail(`${message}\nNothing was released. Your notes are kept in ${notesPath}`)

const bump = version !== current
console.log(`\n${notes}\n`)
console.log(`Release ${tag} from ${head.slice(0, 7)}${bump ? `, after a "release ${version}" commit that sets the version` : ""}.`)
if (dryRun) {
  rmSync(scratch, { recursive: true, force: true })
  console.log("Dry run: nothing was committed, tagged, or pushed.")
  process.exit(0)
}
if (!/^y(es)?$/i.test(prompt(`Tag and push ${tag}? [y/N]`)?.trim() ?? "")) stop("Cancelled.")
// The notes may have been open for a while. Release only the commit that was checked above.
if (mustGit("rev-parse", "HEAD") !== head || mustGit("branch", "--show-current") !== "main") stop("main changed while the notes were open.")
if (readFileSync(manifestPath, "utf8") !== manifestText) stop("package.json changed while the notes were open.")
if (mustGit("ls-files", "--stage", "--", "package.json") !== manifestIndex) stop("the staged package.json changed while the notes were open.")
let writtenManifest: string | undefined
let releaseCommit: string | undefined
let tagObject: string | undefined
try {
  if (bump) {
    const updated = manifestText.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`)
    if (JSON.parse(updated).version !== version) throw new Error("could not set the version in package.json")
    writeFileSync(manifestPath, updated)
    writtenManifest = updated
    const commit = git("commit", "--quiet", "-m", `release ${version}`, "--", "package.json")
    if (!commit.ok) throw new Error(commit.error)
    const committed = git("rev-parse", "HEAD")
    if (!committed.ok) stop(`Could not identify the release commit; local state needs manual recovery: ${committed.error}`)
    releaseCommit = committed.out
  }
  // Freeze the selected commit: another process may move HEAD or main before tagging or pushing.
  const releaseHead = releaseCommit ?? head
  // Unsigned and verbatim, so the workflow reads back exactly these notes, Markdown headings included.
  const tagged = git("tag", "--annotate", "--no-sign", "--cleanup=verbatim", "--file", notesPath, tag, releaseHead)
  if (!tagged.ok) throw new Error(tagged.error)
  const taggedObject = git("rev-parse", `refs/tags/${tag}`)
  if (!taggedObject.ok) stop(`Could not identify the created tag; local state needs manual recovery: ${taggedObject.error}`)
  tagObject = taggedObject.out
  // Push only the captured objects, regardless of concurrent ref changes or push.followTags settings.
  // Atomic: the selected commit and annotated tag arrive together or not at all.
  console.log("Pushing release commit and tag; pre-push checks may take several minutes.")
  // Inherit output so Git and pre-push checks are visible while they run.
  const pushed = Bun.spawnSync(["git", "push", "--progress", "--atomic", "--no-follow-tags", "origin",
    `${releaseHead}:refs/heads/main`, `${tagObject}:refs/tags/${tag}`,
  ], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  // An error can mean the acknowledgement was lost. Only our exact annotated tag proves success;
  // another maintainer's tag with the same name does not. Exit 2 means a successful lookup found no tag.
  if (pushed.exitCode !== 0) {
    const remote = git("ls-remote", "--exit-code", "--refs", "origin", `refs/tags/${tag}`)
    if (!remote.ok && remote.code !== 2) {
      fail(`Push failed and we could not verify its outcome: ${remote.error}\nThe release may already be running. The local commit and tag have been kept; check GitHub before retrying.\nYour notes are kept in ${notesPath}`)
    }
    if (!remote.ok) throw new Error(`push failed (exit ${pushed.exitCode}); see Git output above.`)
    if (remote.out.split(/\s+/)[0] !== tagObject) throw new Error(`origin has a different tag named ${tag}; our release was not pushed.`)
  }
} catch (error) {
  // A push can take time. Preserve the whole attempt if another writer has taken ownership.
  // Unlike mustGit, cleanup failures must report manual recovery, not exit without context.
  const cleanupGit = (...args: string[]) => {
    const result = git(...args)
    if (!result.ok) throw new Error(`git ${args.join(" ")} failed: ${result.error}`)
    return result.out
  }
  let cleanupMessage: string
  try {
    const expectedHead = releaseCommit ?? head
    if (cleanupGit("symbolic-ref", "HEAD") !== "refs/heads/main" || cleanupGit("rev-parse", "HEAD") !== expectedHead) {
      throw new Error("HEAD or the current branch changed")
    }
    if (releaseCommit && cleanupGit("rev-parse", `${releaseCommit}^`) !== head) {
      throw new Error("the release commit no longer directly follows the original HEAD")
    }
    if (writtenManifest !== undefined) {
      if (readFileSync(manifestPath, "utf8") !== writtenManifest) throw new Error("package.json changed")
      const expectedIndex = cleanupGit("ls-tree", "--format=%(objectmode) %(objectname) 0\t%(path)", expectedHead, "--", "package.json")
      if (!expectedIndex || cleanupGit("ls-files", "--stage", "--", "package.json") !== expectedIndex) {
        throw new Error("the staged package.json changed")
      }
    }
    // Compare-and-delete: never remove a replacement tag, even if it changes during cleanup.
    if (tagObject) cleanupGit("update-ref", "-d", `refs/tags/${tag}`, tagObject)
    // A compare-and-swap soft reset preserves unrelated index entries and concurrent commits.
    if (releaseCommit) cleanupGit("update-ref", "refs/heads/main", head, releaseCommit)
    if (writtenManifest !== undefined) cleanupGit("restore", "--source", head, "--staged", "--worktree", "--", "package.json")
    cleanupMessage = `main is back at ${head.slice(0, 7)}.`
  } catch (cleanupError) {
    cleanupMessage = `Cleanup stopped; local state needs manual recovery: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}. Inspect HEAD, the tag, and package.json before retrying.`
  }
  stop(`${error instanceof Error ? error.message : error}\n${cleanupMessage}`)
}
rmSync(scratch, { recursive: true, force: true })
console.log(`Pushed ${tag}. The release workflow publishes it: gh run watch`)
