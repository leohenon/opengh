import { afterEach, expect, test } from "bun:test"
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// A minimal project, an editor and gh stand-in, and a local bare remote. No real account or network.
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const realGit = Bun.which("git")!

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "opengh-release-command-"))
  directories.push(directory)
  const repo = join(directory, "repo"), remote = join(directory, "remote.git"), tools = join(directory, "tools")
  await Promise.all([mkdir(join(repo, "scripts"), { recursive: true }), mkdir(tools)])
  for (const file of ["release.ts", "targets.ts"]) await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(repo, "scripts", file))
  await writeFile(join(repo, "package.json"), '{\n  "name": "release-fixture",\n  "version": "0.0.0"\n}\n')
  await writeFile(join(repo, "LICENSE"), "MIT License\n")
  await writeFile(join(repo, "README.md"), "# Release fixture\n")
  await writeFile(join(repo, "work.txt"), "original\n")
  const editor = join(tools, "editor")
  const env = { ...process.env, PATH: `${tools}:${process.env.PATH}`, HOME: directory, VISUAL: editor, EDITOR: editor,
    GH_TOKEN: "", GITHUB_TOKEN: "", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "file",
    GIT_AUTHOR_NAME: "Release test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Release test", GIT_COMMITTER_EMAIL: "test@example.invalid",
    TMPDIR: directory, TEST_REPO: repo, TEST_REMOTE: remote }
  const tool = async (name: string, body: string) => {
    await writeFile(join(tools, name), `#!/bin/sh\nset -eu\n${body}\n`)
    await chmod(join(tools, name), 0o755)
  }
  await writeFile(join(directory, "generated-notes.json"), JSON.stringify({ body: "" }))
  await tool("gh", `if [ "$1" = api ]; then
  test "$2 $3 $4" = '--method POST repos/leohenon/opengh/releases/generate-notes'
  printf '%s\\n' "$@" > "$TMPDIR/generated-args"
  cat "$TMPDIR/generated-notes.json"
else
  test "$1 $2" = 'run list'
  printf '%s\\n' '[{"status":"completed","conclusion":"success"}]'
fi`)
  const notes = "## Highlights\n\n- The first release.\n"
  await writeFile(join(directory, "notes"), notes)
  await tool("editor", `cat "$TMPDIR/notes" > "$1"`)
  async function run(args: string[], input?: string) {
    const child = Bun.spawn(args, { cwd: repo, env, stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" })
    if (input !== undefined && child.stdin && typeof child.stdin !== "number") { child.stdin.write(input); child.stdin.end() }
    const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, out, error }
  }
  async function git(...args: string[]) {
    const result = await run([realGit, ...args])
    expect(result, result.error).toMatchObject({ code: 0 })
    return result.out.trim()
  }
  await git("init", "--bare", remote)
  await git("init", "-b", "main")
  await git("config", "core.hooksPath", "/dev/null")
  await git("config", "commit.gpgsign", "false")
  await git("add", ".")
  await git("commit", "-m", "initial")
  await git("remote", "add", "origin", remote)
  await git("push", "origin", "main")
  const head = await git("rev-parse", "HEAD")
  return { directory, repo, remote, head, tool, run, git, notes,
    release: (version: string, dry = false) => run([process.execPath, "scripts/release.ts", version, ...(dry ? ["--dry-run"] : [])], "y\n") }
}

test("the first release can be 0.0.0 and its editor notes reach the annotated tag", async () => {
  const f = await fixture()
  const result = await f.release("0.0.0")
  expect(result, result.error).toMatchObject({ code: 0 })
  expect(await f.git("rev-parse", "HEAD")).toBe(f.head) // No version-bump commit required.
  expect(await f.git("--git-dir", f.remote, "cat-file", "-t", "refs/tags/v0.0.0")).toBe("tag")
  expect(await f.git("--git-dir", f.remote, "for-each-ref", "--format=%(contents)", "refs/tags/v0.0.0")).toBe(f.notes.trim())
}, 15_000)

test.each([false, true])("new contributors appear in the editable draft (previous release: %s)", async previous => {
  const f = await fixture()
  if (previous) await f.git("tag", "v0.0.0")
  await writeFile(join(f.directory, "generated-notes.json"), JSON.stringify({ body:
    "## What's Changed\r\n* Generated change\r\n\r\n## New Contributors\r\n* @alice made their first contribution in https://github.com/leohenon/opengh/pull/12\r\n\r\n**Full Changelog**: generated comparison\r\n" }))
  await f.tool("editor", 'cp "$1" "$TMPDIR/draft"\nexit 1')
  expect((await f.release(previous ? "0.0.1" : "0.0.0")).code).not.toBe(0)
  const draft = await readFile(join(f.directory, "draft"), "utf8")
  expect(draft).toContain("## New contributors\n\n* @alice made their first contribution in https://github.com/leohenon/opengh/pull/12")
  expect(draft).not.toContain("Generated change")
  expect(draft).not.toContain("generated comparison")
  expect(draft.includes("**Full changelog:**")).toBe(previous)
  if (previous) expect(draft.indexOf("## New contributors")).toBeLessThan(draft.indexOf("**Full changelog:**"))
  const args = await readFile(join(f.directory, "generated-args"), "utf8")
  expect(args).toContain(`target_commitish=${f.head}`)
  expect(args).toContain(`tag_name=${previous ? "v0.0.1" : "v0.0.0"}`)
  expect(args.includes("previous_tag_name=v0.0.0")).toBe(previous)
}, 15_000)

test("no new contributors omits the section", async () => {
  const f = await fixture()
  await writeFile(join(f.directory, "generated-notes.json"), JSON.stringify({ body: "## What's Changed\n* A change\n" }))
  await f.tool("editor", 'cp "$1" "$TMPDIR/draft"\nexit 1')
  expect((await f.release("0.0.0")).code).not.toBe(0)
  expect(await readFile(join(f.directory, "draft"), "utf8")).not.toContain("## New contributors")
}, 15_000)

test.each(["failure", "malformed"])("contributor lookup %s stops before opening the editor", async mode => {
  const f = await fixture()
  if (mode === "failure") await f.tool("gh", `if [ "$1" = api ]; then echo 'API unavailable' >&2; exit 1; fi
printf '%s\\n' '[{"status":"completed","conclusion":"success"}]'`)
  else await writeFile(join(f.directory, "generated-notes.json"), JSON.stringify({ body: null }))
  await f.tool("editor", "echo 'editor must not open' >&2\nexit 1")
  const result = await f.release("0.0.0")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain(mode === "failure" ? "could not generate new contributors" : "invalid generated release notes response")
  expect(result.error).not.toContain("editor must not open")
  expect(await f.git("tag")).toBe("")
}, 15_000)

test("a dry run never pushes, and an invalid npm version is rejected before tagging", async () => {
  const f = await fixture()
  expect((await f.release("0.0.1", true)).code).toBe(0)
  expect((await f.release("01.0.0")).code).not.toBe(0)
  expect((await f.release("0.0.1-rc.01")).code).not.toBe(0)
  expect(await f.git("rev-parse", "HEAD")).toBe(f.head)
  expect(await f.git("tag")).toBe("")
  expect(await f.git("--git-dir", f.remote, "tag")).toBe("")
}, 15_000)

test.each(["LICENSE", "README.md"])("an untracked %s does not satisfy the committed release prerequisites", async file => {
  const f = await fixture()
  const original = await readFile(join(f.repo, file), "utf8")
  await f.git("rm", "--cached", "--", file)
  await f.git("commit", "-m", `untrack ${file}`)
  await f.git("push", "origin", "main")
  const head = await f.git("rev-parse", "HEAD")
  expect(await f.git("ls-tree", "HEAD", "--", file)).toBe("")
  await writeFile(join(f.directory, "calls"), "")
  await f.tool("editor", 'printf \'editor\\n\' >> "$TMPDIR/calls"\ncat "$TMPDIR/notes" > "$1"')
  await f.tool("git", `printf '%s\\n' "$*" >> "$TMPDIR/calls"\nexec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release("0.0.1")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain(file)
  // Check attempted publication too: rollback must not hide an editor, commit, tag, or push.
  expect(await readFile(join(f.directory, "calls"), "utf8")).not.toMatch(/^(editor|commit |tag --annotate |push )/m)
  expect(await readFile(join(f.repo, file), "utf8")).toBe(original)
  expect(await f.git("status", "--porcelain")).toBe(`?? ${file}`)
  expect(await f.git("rev-parse", "HEAD")).toBe(head)
  expect(await f.git("tag")).toBe("")
  expect(await f.git("--git-dir", f.remote, "rev-parse", "refs/heads/main")).toBe(head)
  expect(await f.git("--git-dir", f.remote, "tag")).toBe("")
}, 15_000)

test("push.followTags cannot publish an older local release alongside the selected release", async () => {
  const f = await fixture()
  await f.git("tag", "--annotate", "--no-sign", "-m", "Unpublished older notes", "v0.0.0")
  await f.git("config", "push.followTags", "true")
  const result = await f.release("0.0.1")
  expect(result, result.error).toMatchObject({ code: 0 })
  expect(await f.git("tag")).toBe("v0.0.0\nv0.0.1")
  expect(await f.git("--git-dir", f.remote, "tag")).toBe("v0.0.1")
  expect(await f.git("--git-dir", f.remote, "rev-parse", "refs/heads/main")).toBe(await f.git("rev-parse", "HEAD"))
  expect(await f.git("--git-dir", f.remote, "rev-parse", "v0.0.1^{commit}")).toBe(await f.git("rev-parse", "HEAD"))
}, 15_000)

test.each(["0.0.0", "0.0.1"])("an index-only manifest edit while notes are open aborts a %s release without overwriting it", async version => {
  const f = await fixture()
  const original = await readFile(join(f.repo, "package.json"), "utf8")
  const foreign = '{\n  "name": "other writer",\n  "version": "9.8.7"\n}\n'
  await writeFile(join(f.directory, "foreign.json"), foreign)
  await writeFile(join(f.directory, "calls"), "")
  await f.tool("editor", `cat "$TMPDIR/notes" > "$1"
cp package.json "$TMPDIR/original.json"
cp "$TMPDIR/foreign.json" package.json
${JSON.stringify(realGit)} add package.json
cp "$TMPDIR/original.json" package.json
${JSON.stringify(realGit)} ls-files --stage -- package.json > "$TMPDIR/expected-index"`)
  await f.tool("git", `printf '%s\\n' "$*" >> "$TMPDIR/calls"\nexec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release(version)
  expect(result.code).not.toBe(0)
  expect(result.error).toContain("package.json")
  expect(await readFile(join(f.directory, "calls"), "utf8")).not.toMatch(/^(commit |tag --annotate |push )/m)
  expect(await readFile(join(f.repo, "package.json"), "utf8")).toBe(original)
  expect(await f.git("show", ":package.json")).toBe(foreign.trim())
  expect(await f.git("ls-files", "--stage", "--", "package.json")).toBe((await readFile(join(f.directory, "expected-index"), "utf8")).trim())
  expect(await f.git("rev-parse", "HEAD")).toBe(f.head)
  expect(await f.git("tag")).toBe("")
  expect(await f.git("--git-dir", f.remote, "rev-parse", "refs/heads/main")).toBe(f.head)
  expect(await f.git("--git-dir", f.remote, "tag")).toBe("")
}, 15_000)

test.each(["0.0.0", "0.0.1"])("a foreign commit immediately before tagging is not included in a %s release", async version => {
  const f = await fixture()
  await f.tool("git", `
if [ "$1 $2" = 'tag --annotate' ]; then
  ${JSON.stringify(realGit)} rev-parse HEAD > "$TMPDIR/selected-head"
  printf 'committed elsewhere\\n' > work.txt
  ${JSON.stringify(realGit)} add work.txt
  ${JSON.stringify(realGit)} commit --quiet -m 'another process'
  ${JSON.stringify(realGit)} rev-parse HEAD > "$TMPDIR/foreign-head"
fi
exec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release(version)
  expect(result, result.error).toMatchObject({ code: 0 })
  const selectedHead = (await readFile(join(f.directory, "selected-head"), "utf8")).trim()
  const foreignHead = (await readFile(join(f.directory, "foreign-head"), "utf8")).trim()
  if (version === "0.0.0") expect(selectedHead).toBe(f.head)
  else {
    expect(await f.git("rev-parse", `${selectedHead}^`)).toBe(f.head)
    expect(await f.git("log", "-1", "--format=%s", selectedHead)).toBe(`release ${version}`)
  }
  expect(foreignHead).not.toBe(selectedHead)
  expect(await f.git("rev-parse", "HEAD")).toBe(foreignHead)
  expect(await readFile(join(f.repo, "work.txt"), "utf8")).toBe("committed elsewhere\n")
  expect(await f.git("show", ":work.txt")).toBe("committed elsewhere")
  expect(await f.git("status", "--porcelain")).toBe("")
  expect(await f.git("rev-parse", `v${version}^{commit}`)).toBe(selectedHead)
  expect(await f.git("--git-dir", f.remote, "rev-parse", "refs/heads/main")).toBe(selectedHead)
  expect(await f.git("--git-dir", f.remote, "rev-parse", `v${version}^{commit}`)).toBe(selectedHead)
  expect(await f.git("--git-dir", f.remote, "show", `v${version}:work.txt`)).toBe("original")
  expect(JSON.parse(await f.git("--git-dir", f.remote, "show", `v${version}:package.json`)).version).toBe(version)
}, 15_000)

test("a replacement tag immediately before pushing stays local and cannot replace the release notes or commit", async () => {
  const f = await fixture()
  await f.tool("git", `
if [ "$1" = push ]; then
  ${JSON.stringify(realGit)} rev-parse HEAD > "$TMPDIR/selected-head"
  ${JSON.stringify(realGit)} rev-parse refs/tags/v0.0.1 > "$TMPDIR/selected-tag"
  ${JSON.stringify(realGit)} tag --force --annotate --no-sign -m 'replacement notes' v0.0.1 ${JSON.stringify(f.head)}
  ${JSON.stringify(realGit)} rev-parse refs/tags/v0.0.1 > "$TMPDIR/foreign-tag"
fi
exec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release("0.0.1")
  expect(result, result.error).toMatchObject({ code: 0 })
  const selectedHead = (await readFile(join(f.directory, "selected-head"), "utf8")).trim()
  const selectedTag = (await readFile(join(f.directory, "selected-tag"), "utf8")).trim()
  const foreignTag = (await readFile(join(f.directory, "foreign-tag"), "utf8")).trim()
  expect(selectedHead).not.toBe(f.head)
  expect(foreignTag).not.toBe(selectedTag)
  expect(await f.git("rev-parse", "HEAD")).toBe(selectedHead)
  expect(await f.git("rev-parse", "refs/tags/v0.0.1")).toBe(foreignTag)
  expect(await f.git("rev-parse", "v0.0.1^{commit}")).toBe(f.head)
  expect(await f.git("for-each-ref", "--format=%(contents)", "refs/tags/v0.0.1")).toBe("replacement notes")
  expect(await f.git("status", "--porcelain")).toBe("")
  expect(await f.git("--git-dir", f.remote, "rev-parse", "refs/heads/main")).toBe(selectedHead)
  expect(await f.git("--git-dir", f.remote, "rev-parse", "refs/tags/v0.0.1")).toBe(selectedTag)
  expect(await f.git("--git-dir", f.remote, "rev-parse", "v0.0.1^{commit}")).toBe(selectedHead)
  expect(await f.git("--git-dir", f.remote, "for-each-ref", "--format=%(contents)", "refs/tags/v0.0.1")).toBe(f.notes.trim())
}, 15_000)

test.each([false, true])("a rejected push rolls back only the release and preserves edits made while notes were open (staged: %s)", async staged => {
  const f = await fixture()
  await f.tool("editor", `cat "$TMPDIR/notes" > "$1"\nprintf 'other session\\n' >> "$TEST_REPO/work.txt"\n${staged ? `${JSON.stringify(realGit)} add work.txt` : ""}`)
  await f.tool("git", `if [ "$1" = push ]; then echo 'push rejected' >&2; exit 1; fi\nexec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release("0.0.1")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain("push rejected")
  expect(await f.git("rev-parse", "HEAD")).toBe(f.head)
  expect(await f.git("tag")).toBe("")
  expect(JSON.parse(await readFile(join(f.repo, "package.json"), "utf8")).version).toBe("0.0.0")
  expect(await readFile(join(f.repo, "work.txt"), "utf8")).toBe("original\nother session\n")
  expect(await f.git("show", ":work.txt")).toBe(staged ? "original\nother session" : "original")
  expect(await f.git("diff", "--cached", "--name-only")).toBe(staged ? "work.txt" : "")
  expect(result.error).toContain("main is back")
}, 15_000)

test.each([
  ["0.0.0", "worktree"], ["0.0.0", "staged"], ["0.0.0", "index-only"],
  ["0.0.1", "worktree"], ["0.0.1", "staged"], ["0.0.1", "index-only"],
])("a failed %s push preserves another writer's %s manifest edit", async (version, edit) => {
  const f = await fixture()
  const foreign = '{\n  "name": "other writer",\n  "version": "9.8.7"\n}\n'
  await writeFile(join(f.directory, "foreign.json"), foreign)
  await f.tool("git", `
if [ "$1" = push ]; then
  cp package.json "$TMPDIR/ours.json"
  cp "$TMPDIR/foreign.json" package.json
  ${edit !== "worktree" ? `${JSON.stringify(realGit)} add package.json` : ""}
  ${edit === "index-only" ? 'cp "$TMPDIR/ours.json" package.json' : ""}
  ${JSON.stringify(realGit)} ls-files --stage -- package.json > "$TMPDIR/expected-index"
  ${JSON.stringify(realGit)} rev-parse HEAD > "$TMPDIR/expected-head"
  echo 'push rejected' >&2
  exit 1
fi
exec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release(version)
  expect(result.code).not.toBe(0)
  const ours = await readFile(join(f.directory, "ours.json"), "utf8")
  expect(await readFile(join(f.repo, "package.json"), "utf8")).toBe(edit === "index-only" ? ours : foreign)
  expect(await f.git("ls-files", "--stage", "--", "package.json")).toBe((await readFile(join(f.directory, "expected-index"), "utf8")).trim())
  expect(await f.git("rev-parse", "HEAD")).toBe((await readFile(join(f.directory, "expected-head"), "utf8")).trim())
  if (version === "0.0.1") {
    expect(result.error).toContain("manual recovery")
    expect(result.error).not.toContain("main is back")
  }
}, 15_000)

test.each(["0.0.0", "0.0.1"])("a failed %s push preserves an unrelated commit made during the push", async version => {
  const f = await fixture()
  await f.tool("git", `
if [ "$1" = push ]; then
  printf 'committed elsewhere\\n' > work.txt
  ${JSON.stringify(realGit)} add work.txt
  ${JSON.stringify(realGit)} commit --quiet -m 'another process'
  ${JSON.stringify(realGit)} rev-parse HEAD > "$TMPDIR/expected-head"
  echo 'push rejected' >&2
  exit 1
fi
exec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release(version)
  expect(result.code).not.toBe(0)
  expect(await f.git("rev-parse", "HEAD")).toBe((await readFile(join(f.directory, "expected-head"), "utf8")).trim())
  expect(await f.git("log", "-1", "--format=%s")).toBe("another process")
  expect(await f.git("status", "--porcelain")).toBe("")
  expect(JSON.parse(await readFile(join(f.repo, "package.json"), "utf8")).version).toBe(version)
  expect(result.error).not.toContain("main is back")
  expect(result.error).toContain("manual recovery")
}, 15_000)

test.each([false, true])("a failed commit restores only an unchanged manifest (hook edit: %s)", async hookEdit => {
  const f = await fixture()
  const original = await readFile(join(f.repo, "package.json"), "utf8")
  const foreign = '{"name":"hook edit","version":"0.0.1"}\n'
  await writeFile(join(f.directory, "foreign.json"), foreign)
  await f.tool("pre-commit", `
${hookEdit ? 'cp "$TMPDIR/foreign.json" package.json' : ""}
echo 'commit rejected' >&2
exit 1`)
  await f.git("config", "core.hooksPath", join(f.directory, "tools"))
  const result = await f.release("0.0.1")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain("commit rejected")
  expect(await f.git("rev-parse", "HEAD")).toBe(f.head)
  expect(await f.git("tag")).toBe("")
  expect(await f.git("diff", "--cached")).toBe("")
  expect(await readFile(join(f.repo, "package.json"), "utf8")).toBe(hookEdit ? foreign : original)
  if (hookEdit) expect(result.error).toContain("manual recovery")
}, 15_000)

test("a replacement local tag is not deleted after a rejected push", async () => {
  const f = await fixture()
  await f.tool("git", `
if [ "$1" = push ]; then
  ${JSON.stringify(realGit)} tag --force --annotate --no-sign -m 'replacement tag' v0.0.1
  ${JSON.stringify(realGit)} rev-parse refs/tags/v0.0.1 > "$TMPDIR/expected-tag"
  echo 'push rejected' >&2
  exit 1
fi
exec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release("0.0.1")
  expect(result.code).not.toBe(0)
  expect(await f.git("rev-parse", "refs/tags/v0.0.1")).toBe((await readFile(join(f.directory, "expected-tag"), "utf8")).trim())
  expect(result.error).toContain("manual recovery")
  expect(result.error).not.toContain("main is back")
}, 15_000)

test("a branch switch during a rejected push prevents rollback", async () => {
  const f = await fixture()
  await f.tool("git", `
if [ "$1" = push ]; then
  ${JSON.stringify(realGit)} checkout --quiet -b other-session
  echo 'push rejected' >&2
  exit 1
fi
exec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release("0.0.1")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain("manual recovery")
  expect(result.error).not.toContain("main is back")
  expect(await f.git("branch", "--show-current")).toBe("other-session")
  expect(await f.git("rev-parse", "HEAD")).not.toBe(f.head)
  expect(await f.git("rev-parse", "main")).toBe(await f.git("rev-parse", "HEAD"))
  expect(await f.git("status", "--porcelain")).toBe("")
  expect(await f.git("tag")).toBe("v0.0.1")
}, 15_000)

test.each(["tag", "branch", "manifest"])("a failed %s cleanup reports manual recovery instead of restoration", async step => {
  const f = await fixture()
  const condition = step === "tag" ? '[ "$1 $2" = "update-ref -d" ]'
    : step === "branch" ? '[ "$1 $2" = "update-ref refs/heads/main" ]' : '[ "$1" = restore ]'
  await f.tool("git", `
if [ "$1" = push ]; then echo 'push rejected' >&2; exit 1; fi
if ${condition}; then echo 'cleanup rejected' >&2; exit 1; fi
exec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release("0.0.1")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain("cleanup rejected")
  expect(result.error).toContain("manual recovery")
  expect(result.error).not.toContain("main is back")
  expect(JSON.parse(await readFile(join(f.repo, "package.json"), "utf8")).version).toBe("0.0.1")
  expect(JSON.parse(await f.git("show", ":package.json")).version).toBe("0.0.1")
  expect(await f.git("tag")).toBe(step === "tag" ? "v0.0.1" : "")
  if (step === "manifest") expect(await f.git("rev-parse", "HEAD")).toBe(f.head)
  else expect(await f.git("rev-parse", "HEAD")).not.toBe(f.head)
}, 15_000)

test("an unknown remote outcome retains the local release and notes", async () => {
  const f = await fixture()
  await f.tool("git", `
if [ "$1" = push ] || [ "$1" = ls-remote ]; then echo 'offline' >&2; exit 128; fi
exec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release("0.0.1")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain("could not verify")
  expect(result.error).not.toContain("Nothing was released")
  expect(await f.git("rev-parse", "HEAD")).not.toBe(f.head)
  expect(await f.git("rev-parse", "v0.0.1^{commit}")).toBe(await f.git("rev-parse", "HEAD"))
  expect(await f.git("status", "--porcelain")).toBe("")
  expect(JSON.parse(await readFile(join(f.repo, "package.json"), "utf8")).version).toBe("0.0.1")
  const notesPath = result.error.match(/Your notes are kept in (.+)/)![1]!
  expect(await readFile(notesPath, "utf8")).toBe(f.notes)
  expect(await f.git("--git-dir", f.remote, "tag")).toBe("")
}, 15_000)

test("a remote tag with someone else's notes is not confirmation that our failed push succeeded", async () => {
  const f = await fixture()
  const foreign = await f.git("tag", "--annotate", "--no-sign", "-m", "Another maintainer's notes", "other-tag")
  expect(foreign).toBe("")
  const foreignTag = await f.git("rev-parse", "refs/tags/other-tag")
  await f.tool("editor", `cat "$TMPDIR/notes" > "$1"
# Another maintainer creates the same version tag while the notes editor is open.
${JSON.stringify(realGit)} push origin refs/tags/other-tag:refs/tags/v0.0.0`)
  const result = await f.release("0.0.0")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain("different tag")
  expect(result.out).not.toContain("Pushed v0.0.0")
  expect(await f.git("--git-dir", f.remote, "rev-parse", "refs/tags/v0.0.0")).toBe(foreignTag)
  expect(await f.git("tag", "--list", "v0.0.0")).toBe("")
  expect(result.error).toContain("Your notes are kept")
}, 15_000)

test.each([false, true])("a lost push acknowledgement preserves the accepted release (verification unavailable: %s)", async unavailable => {
  const f = await fixture()
  await f.tool("git", `
if [ "$1" = push ]; then
  ${JSON.stringify(realGit)} "$@"
  echo 'connection lost after push' >&2
  exit 1
fi
${unavailable ? `if [ "$1" = ls-remote ]; then echo 'still offline' >&2; exit 128; fi` : ""}
exec ${JSON.stringify(realGit)} "$@"`)
  const result = await f.release("0.0.1")
  const localTag = await f.git("rev-parse", "refs/tags/v0.0.1")
  expect(await f.git("--git-dir", f.remote, "rev-parse", "refs/tags/v0.0.1")).toBe(localTag)
  const localHead = await f.git("rev-parse", "HEAD")
  expect(localHead).not.toBe(f.head)
  expect(await f.git("--git-dir", f.remote, "rev-parse", "refs/heads/main")).toBe(localHead)
  expect(JSON.parse(await readFile(join(f.repo, "package.json"), "utf8")).version).toBe("0.0.1")
  if (unavailable) {
    expect(result.code).not.toBe(0)
    expect(result.error).toContain("could not verify")
    expect(result.error).not.toContain("Nothing was released")
    expect(result.out).not.toContain("Pushed v0.0.1")
    expect(result.error).toContain("Your notes are kept")
  } else {
    expect(result, result.error).toMatchObject({ code: 0 })
    expect(result.out).toContain("Pushed v0.0.1")
  }
}, 15_000)

test("a local tag created while notes were open is not deleted when tag creation fails", async () => {
  const f = await fixture()
  await f.tool("editor", `cat "$TMPDIR/notes" > "$1"
${JSON.stringify(realGit)} tag --annotate --no-sign -m 'Created elsewhere' v0.0.1`)
  const result = await f.release("0.0.1")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain("already exists")
  expect(await f.git("rev-parse", "HEAD")).toBe(f.head)
  expect(await f.git("rev-parse", "v0.0.1^{commit}")).toBe(f.head)
  expect(await f.git("for-each-ref", "--format=%(contents)", "refs/tags/v0.0.1")).toBe("Created elsewhere")
  expect(await f.git("--git-dir", f.remote, "tag")).toBe("")
}, 15_000)

for (const keepInstructions of ["none", "LF", "CRLF"] as const) {
  test(`release notes preserve Markdown verbatim (generated instructions: ${keepInstructions})`, async () => {
    const f = await fixture()
    const notes = '    opengh owner/repo\n    opengh owner/repo#123\n\n<!-- Author comment -->\n\n- Fixed `<!-- comments -->`.\n\n```html\n<!-- literal comment -->\n```\n\nHard break.  \nNext line.\n\n'.replaceAll("\n", keepInstructions === "CRLF" ? "\r\n" : "\n")
    await writeFile(join(f.directory, "notes"), notes)
    if (keepInstructions !== "none") await f.tool("editor", `
sed -n '1,/^-->$/p' "$1" > "$TMPDIR/instructions"
{ ${keepInstructions === "CRLF" ? "while IFS= read -r line; do printf '%s\\r\\n' \"$line\"; done < \"$TMPDIR/instructions\"; printf '\\r\\n'" : "cat \"$TMPDIR/instructions\"; printf '\\n'"}; cat "$TMPDIR/notes"; } > "$1"`)
    const result = await f.release("0.0.0")
    expect(result, result.error).toMatchObject({ code: 0 })
    const tag = await f.run([realGit, "--git-dir", f.remote, "cat-file", "tag", "refs/tags/v0.0.0"])
    expect(tag.code).toBe(0)
    expect(tag.out.slice(tag.out.indexOf("\n\n") + 2)).toBe(notes)
  }, 15_000)
}

test("notes without a final newline are not reformatted", async () => {
  const f = await fixture()
  const notes = "    indented code\n\nA final line with two spaces.  "
  await writeFile(join(f.directory, "notes"), notes)
  expect((await f.release("0.0.0")).code).toBe(0)
  const tag = await f.run([realGit, "--git-dir", f.remote, "cat-file", "tag", "refs/tags/v0.0.0"])
  expect(tag.code).toBe(0)
  expect(tag.out.slice(tag.out.indexOf("\n\n") + 2)).toBe(notes)
}, 15_000)

test.each(["", "\n", "\n\n   \n\t\n"])("only generated instructions and blank notes cancel without creating a tag (tail: %j)", async tail => {
  const f = await fixture()
  await writeFile(join(f.directory, "tail"), tail)
  await f.tool("editor", `instructions=$(sed -n '1,/^-->$/p' "$1")
{ printf '%s' "$instructions"; cat "$TMPDIR/tail"; } > "$1"`)
  const result = await f.release("0.0.0")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain("notes are empty")
  expect(await f.git("tag")).toBe("")
  expect(await f.git("--git-dir", f.remote, "tag")).toBe("")
}, 15_000)

test("an editor failure preserves saved notes verbatim and aborts before committing or tagging", async () => {
  const f = await fixture()
  const notes = "    Saved code block\n\n<!-- Keep my comment -->\nUnfinished release notes.  "
  await writeFile(join(f.directory, "notes"), notes)
  await f.tool("editor", 'cat "$TMPDIR/notes" > "$1"\nexit 1')
  const result = await f.release("0.0.1")
  expect(result.code).not.toBe(0)
  expect(result.error).toContain("editor did not exit cleanly")
  const notesPath = result.error.match(/Your notes are kept in (.+)/)?.[1]
  expect(notesPath).toBeDefined()
  expect(await readFile(notesPath!, "utf8")).toBe(notes)
  expect(await f.git("rev-parse", "HEAD")).toBe(f.head)
  expect(await f.git("status", "--porcelain")).toBe("")
  expect(await f.git("tag")).toBe("")
  expect(await f.git("--git-dir", f.remote, "rev-parse", "refs/heads/main")).toBe(f.head)
  expect(await f.git("--git-dir", f.remote, "tag")).toBe("")
}, 15_000)
