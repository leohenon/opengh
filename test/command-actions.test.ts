import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { homedir } from "node:os"
import { cloneCommand, matchesLocalRepository, plainCommandOutput, resolveLocalRepository, runCommand } from "../src/command-actions"

const cwd = import.meta.dir

test("local identity comes from git origin, not GH_REPO, including nested cwd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengh-command-"))
  const previous = process.env.GH_REPO
  const git = async (...args: string[]) => {
    const child = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd: directory, stdout: "ignore", stderr: "pipe" })
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

test("streams both pipes and retains failed command output", async () => {
  let output = ""
  const task = runCommand({ cwd, args: [process.execPath, "-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)"] }, (chunk) => { output += chunk })
  expect(await task.result).toEqual({ exitCode: 7, cancelled: false })
  expect(output).toContain("out")
  expect(output).toContain("err")
})

test("cancellation kills descendants, including a child ignoring SIGTERM", async () => {
  let resolveStarted!: () => void
  const started = new Promise<void>((done) => { resolveStarted = done })
  let output = ""
  const script = "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)\"],{stdio:['ignore','pipe','pipe']}); child.stdout.on('data', b=>process.stdout.write(child.pid+':'+b)); setInterval(()=>{},1000)"
  const task = runCommand({ cwd, args: [process.execPath, "-e", script] }, (chunk) => { output += chunk; if (output.includes("ready")) resolveStarted() })
  await started
  const pid = Number(output.split(":")[0])
  task.cancel()
  expect((await task.result).cancelled).toBe(true)
  let alive = true
  for (let attempt = 0; attempt < 40 && alive; attempt++) {
    try { process.kill(pid, 0); await Bun.sleep(25) } catch { alive = false }
  }
  expect(alive).toBe(false)
})

test("clone arguments cannot turn destination into flags and expand home paths", () => {
  const local = { directory: cwd, repository: "cli/cli" }
  expect(matchesLocalRepository(local, "CLI/cli")).toBe(true)
  expect(cloneCommand("cli/cli", "--evil; echo hi", cwd).args).toEqual(["gh", "repo", "clone", "cli/cli", `${cwd}/--evil; echo hi`, "--", "--progress"])
  expect(cloneCommand("cli/cli", "~/dev/cli", cwd).args[4]).toBe(join(homedir(), "dev/cli"))
  expect(plainCommandOutput("\x1b[31mprogress\rnext\x1b[0m\r\n")).toBe("progress\nnext\n")
})
