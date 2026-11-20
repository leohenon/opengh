import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { homedir } from "node:os"
import {
  checkMerge,
  cloneCommand,
  matchesLocalRepository,
  plainCommandOutput,
  readLocalBranch,
  resolveLocalRepository,
  runCommand,
} from "../src/command-actions"

const cwd = import.meta.dir

async function gitIn(directory: string, ...args: string[]) {
  const child = Bun.spawn(
    [
      "git",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      ...args,
    ],
    { cwd: directory, stdout: "pipe", stderr: "pipe" },
  )
  expect(await child.exited).toBe(0)
  return (await new Response(child.stdout).text()).trim()
}

test("local identity comes from git origin, not GH_REPO, including nested cwd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengh-command-"))
  const previous = process.env.GH_REPO
  const git = async (...args: string[]) => {
    const child = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
      cwd: directory,
      stdout: "ignore",
      stderr: "pipe",
    })
    expect(await child.exited).toBe(0)
  }
  try {
    await git("init", "--initial-branch=main")
    await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "fixture")
    await git("remote", "add", "origin", "git@github.com:cli/cli.git")
    await mkdir(join(directory, "nested"))
    process.env.GH_REPO = "wrong/repository"
    const local = await resolveLocalRepository(join(directory, "nested"))
    expect(local?.repository).toBe("cli/cli")
    expect(matchesLocalRepository(local, "wrong/repository")).toBe(false)
    await git("remote", "set-url", "origin", "https://example.com/cli/cli.git")
    expect(await resolveLocalRepository(directory)).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.GH_REPO
    else process.env.GH_REPO = previous
    await rm(directory, { recursive: true, force: true })
  }
})

test("reads the local branch, ignoring a detached HEAD and directories outside git", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengh-branch-"))
  const git = async (...args: string[]) => {
    const child = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
      cwd: directory,
      stdout: "ignore",
      stderr: "pipe",
    })
    expect(await child.exited).toBe(0)
  }
  try {
    expect(await readLocalBranch(directory)).toBeUndefined()
    await git("init", "--initial-branch=main")
    await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "fixture")
    expect(await readLocalBranch(directory)).toBe("main")
    await git("switch", "-c", "feature/new-pull")
    expect(await readLocalBranch(directory)).toBe("feature/new-pull")
    await git("switch", "--detach")
    expect(await readLocalBranch(directory)).toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("checks whether branches merge cleanly, after fetching them, without touching the checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "opengh-merge-"))
  const git = gitIn
  const remote = join(root, "remote.git")
  const work = join(root, "work")
  const local = join(root, "local")
  try {
    await mkdir(remote)
    await git(remote, "init", "--bare", "--initial-branch=main")
    await git(root, "clone", "--quiet", remote, work)
    await Bun.write(join(work, "shared.txt"), "one\ntwo\nthree\n")
    await git(work, "add", ".")
    await git(work, "commit", "--quiet", "-m", "base")
    await git(work, "push", "--quiet", "origin", "HEAD:main")
    await git(work, "switch", "--quiet", "-c", "feature/clean")
    await Bun.write(join(work, "new.txt"), "new\n")
    await git(work, "add", ".")
    await git(work, "commit", "--quiet", "-m", "clean")
    await git(work, "push", "--quiet", "origin", "feature/clean")
    await git(work, "switch", "--quiet", "-c", "feature/conflict", "main")
    await Bun.write(join(work, "shared.txt"), "one\nTWO\nthree\n")
    await git(work, "commit", "--quiet", "-am", "conflict")
    await git(work, "push", "--quiet", "origin", "feature/conflict")
    await git(work, "switch", "--quiet", "main")
    await Bun.write(join(work, "shared.txt"), "one\n2\nthree\n")
    await git(work, "commit", "--quiet", "-am", "main moves on")
    await git(work, "push", "--quiet", "origin", "main")

    await git(root, "clone", "--quiet", remote, local)
    const before = await git(local, "status", "--porcelain=v2", "--branch")
    const main = { branch: "main" }
    expect(await checkMerge(local, main, { branch: "feature/clean" })).toEqual({ status: "clean" })
    expect(await checkMerge(local, main, { branch: "feature/conflict" })).toEqual({ status: "conflicts", files: ["shared.txt"] })
    expect(await checkMerge(local, main, { branch: "feature/missing" })).toEqual({
      status: "unavailable",
      reason: "couldn't fetch the branches from GitHub",
    })
    expect(await checkMerge(local, main, { branch: "-x" })).toEqual({ status: "unavailable", reason: "unsupported branch name" })
    expect(await git(local, "status", "--porcelain=v2", "--branch")).toBe(before)
    expect(await Bun.file(join(local, ".git", "FETCH_HEAD")).exists()).toBe(false)
    expect(await git(local, "rev-parse", "refs/remotes/origin/feature/conflict")).toBe(await git(remote, "rev-parse", "feature/conflict"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("fetches a branch from another repository by its GitHub URL in origin's style, leaving nothing behind", async () => {
  const root = await mkdtemp(join(tmpdir(), "opengh-merge-fork-"))
  const git = gitIn
  const github = join(root, "github")
  const upstream = join(github, "upstream", "repo.git")
  const fork = join(github, "you", "repo.git")
  const work = join(root, "work")
  const commit = async (file: string, text: string, message: string) => {
    await Bun.write(join(work, file), text)
    await git(work, "add", ".")
    await git(work, "commit", "--quiet", "-m", message)
  }
  // A checkout whose origin is a GitHub URL, which git rewrites to the local repositories (as `insteadOf` can for anyone).
  const checkout = async (name: string, source: string, origin: string, style: string) => {
    const directory = join(root, name)
    await git(root, "clone", "--quiet", source, directory)
    await git(directory, "remote", "set-url", "origin", origin)
    await git(directory, "config", `url.${github}/.insteadOf`, style)
    return directory
  }
  try {
    await mkdir(upstream, { recursive: true })
    await git(upstream, "init", "--bare", "--initial-branch=main")
    await git(root, "clone", "--quiet", upstream, work)
    await commit("shared.txt", "one\ntwo\nthree\n", "base")
    await git(work, "push", "--quiet", "origin", "HEAD:main")
    await mkdir(join(github, "you"))
    await git(root, "clone", "--quiet", "--bare", upstream, fork)
    await git(work, "switch", "--quiet", "-c", "clean")
    await commit("new.txt", "new\n", "clean")
    await git(work, "push", "--quiet", fork, "clean")
    await git(work, "switch", "--quiet", "-c", "conflict", "main")
    await commit("shared.txt", "one\nTWO\nthree\n", "conflict")
    await git(work, "push", "--quiet", fork, "conflict")
    await git(work, "switch", "--quiet", "main")
    await commit("shared.txt", "one\n2\nthree\n", "main moves on")
    await git(work, "push", "--quiet", "origin", "main")

    const original = await checkout("original", upstream, "https://github.com/upstream/repo.git", "https://github.com/")
    const before = await git(original, "status", "--porcelain=v2", "--branch")
    const main = { branch: "main" }
    expect(await checkMerge(original, main, { branch: "clean", repository: "you/repo" })).toEqual({ status: "clean" })
    expect(await checkMerge(original, main, { branch: "conflict", repository: "you/repo" })).toEqual({
      status: "conflicts",
      files: ["shared.txt"],
    })
    const unfetched = { status: "unavailable", reason: "couldn't fetch the branches from GitHub" } as const
    expect(await checkMerge(original, main, { branch: "missing", repository: "you/repo" })).toEqual(unfetched)
    expect(await checkMerge(original, main, { branch: "clean", repository: "nobody/repo" })).toEqual(unfetched)
    expect(await checkMerge(original, main, { branch: "clean", repository: "not a repo" })).toEqual({
      status: "unavailable",
      reason: "unsupported repository name",
    })

    const forked = await checkout("forked", fork, "git@github.com:you/repo.git", "git@github.com:")
    const upstreamMain = { branch: "main", repository: "upstream/repo" }
    expect(await checkMerge(forked, upstreamMain, { branch: "conflict" })).toEqual({ status: "conflicts", files: ["shared.txt"] })
    expect(await checkMerge(forked, upstreamMain, { branch: "clean" })).toEqual({ status: "clean" })
    expect(await checkMerge(forked, upstreamMain, upstreamMain)).toEqual({ status: "clean" })

    expect(await git(original, "status", "--porcelain=v2", "--branch")).toBe(before)
    for (const directory of [original, forked]) {
      expect(await git(directory, "for-each-ref", "refs/opengh")).toBe("")
      expect(await git(directory, "remote")).toBe("origin")
      expect(await Bun.file(join(directory, ".git", "FETCH_HEAD")).exists()).toBe(false)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("streams both pipes and retains failed command output", async () => {
  let output = ""
  const task = runCommand(
    { cwd, args: [process.execPath, "-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)"] },
    (chunk) => {
      output += chunk
    },
  )
  expect(await task.result).toEqual({ exitCode: 7, cancelled: false })
  expect(output).toContain("out")
  expect(output).toContain("err")
})

test("cancellation kills descendants, including a child ignoring SIGTERM", async () => {
  let resolveStarted!: () => void
  const started = new Promise<void>((done) => {
    resolveStarted = done
  })
  let output = ""
  const script =
    "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)\"],{stdio:['ignore','pipe','pipe']}); child.stdout.on('data', b=>process.stdout.write(child.pid+':'+b)); setInterval(()=>{},1000)"
  const task = runCommand({ cwd, args: [process.execPath, "-e", script] }, (chunk) => {
    output += chunk
    if (output.includes("ready")) resolveStarted()
  })
  await started
  const pid = Number(output.split(":")[0])
  task.cancel()
  expect((await task.result).cancelled).toBe(true)
  let alive = true
  for (let attempt = 0; attempt < 40 && alive; attempt++) {
    try {
      process.kill(pid, 0)
      await Bun.sleep(25)
    } catch {
      alive = false
    }
  }
  expect(alive).toBe(false)
})

for (const parentExits of [false, true]) {
  test.skipIf(process.platform === "win32")(
    `shutdown drains command groups before exit (parent exits early: ${parentExits})`,
    async () => {
      // Keep the process-wide shutdown latch out of this test runner.
      const descendant = "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"
      const parent = `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'pipe', 'inherit'] });
      child.stdout.once('data', () => {
        console.log(process.pid + ':' + child.pid + ':ready');
        ${parentExits ? "process.exit(0)" : ""}
      });
      setInterval(() => {}, 1000);
    `
      // Inherited stderr keeps the command open even after the parent exits.
      const script = `
      import { runCommand, stopCommandProcesses } from ${JSON.stringify(join(import.meta.dir, "../src/command-actions.ts"))};
      import assert from 'node:assert/strict';
      const deadline = setTimeout(() => process.exit(3), 5000);
      let ready;
      const started = new Promise(resolve => ready = resolve);
      let output = '';
      const task = runCommand({ cwd: ${JSON.stringify(cwd)}, args: [process.execPath, '-e', ${JSON.stringify(parent)}] }, chunk => {
        output += chunk;
        if (output.includes(':ready')) ready();
      });
      await started;
      process.stdout.write(output);
      ${parentExits ? "await Bun.sleep(100);" : "task.cancel();"}
      const stopped = stopCommandProcesses();
      assert.equal(stopCommandProcesses(), stopped);
      assert.throws(() => runCommand({ cwd: ${JSON.stringify(cwd)}, args: [process.execPath, '-e', 'process.exit(9)'] }, () => {}), /shutting down/);
      await stopped;
      assert.equal((await task.result).cancelled, true);
      await stopCommandProcesses();
      clearTimeout(deadline);
      process.exit(0);
    `
      const owner = Bun.spawn([process.execPath, "-e", script], { cwd, stdout: "pipe", stderr: "pipe" })
      let group = 0,
        pid = 0
      try {
        const output = await new Response(owner.stdout).text()
        group = Number(output.split(":")[0])
        pid = Number(output.split(":")[1])
        const error = await new Response(owner.stderr).text()
        expect({ code: await owner.exited, error }).toEqual({ code: 0, error: "" })
        expect(pid).toBeGreaterThan(0)
        let alive = true
        for (let attempt = 0; attempt < 40 && alive; attempt++) {
          try {
            process.kill(pid, 0)
            await Bun.sleep(25)
          } catch {
            alive = false
          }
        }
        expect(alive).toBe(false)
      } finally {
        owner.kill()
        if (group > 0) {
          try {
            process.kill(-group, "SIGKILL")
          } catch {}
        }
        if (pid > 0) {
          try {
            process.kill(pid, "SIGKILL")
          } catch {}
        }
      }
    },
    10000,
  )
}

test("clone arguments cannot turn destination into flags and expand home paths", () => {
  const local = { directory: cwd, repository: "cli/cli" }
  expect(matchesLocalRepository(local, "CLI/cli")).toBe(true)
  expect(cloneCommand("cli/cli", "--evil; echo hi", cwd).args).toEqual([
    "gh",
    "repo",
    "clone",
    "github.com/cli/cli",
    `${cwd}/--evil; echo hi`,
    "--",
    "--progress",
  ])
  expect(cloneCommand("cli/cli", "~/dev/cli", cwd).args[4]).toBe(join(homedir(), "dev/cli"))
  expect(plainCommandOutput("\x1b[31mprogress\rnext\x1b[0m\r\n")).toBe("progress\nnext\n")
})
