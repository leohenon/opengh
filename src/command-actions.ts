import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { homedir } from "node:os"
import { githubEnvironment } from "./github/process"

export type LocalRepository = { directory: string; repository: string }
export type CommandSpec = { args: string[]; cwd: string }
export type CommandResult = { exitCode: number | null; cancelled: boolean }
export type CommandTask = { cancel(): void; result: Promise<CommandResult> }

// Never inherit repository overrides: local commands must refer to the actual cwd.
function commandEnvironment() {
  const env = githubEnvironment()
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") || key === "GH_REPO") delete env[key]
  return { ...env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false", SSH_ASKPASS: "/usr/bin/false", GIT_SSH_COMMAND: "ssh -oBatchMode=yes" }
}

export function runCommand(spec: CommandSpec, onOutput: (chunk: string) => void): CommandTask {
  const child = spawn(spec.args[0]!, spec.args.slice(1), {
    cwd: spec.cwd, env: commandEnvironment(), stdio: ["ignore", "pipe", "pipe"], detached: true,
  })
  let cancelled = false
  let finished = false
  let escalation: ReturnType<typeof setTimeout> | undefined
  const kill = (signal: NodeJS.Signals) => {
    if (!child.pid) return
    try { process.kill(-child.pid, signal) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") onOutput(`\nCould not signal command: ${String(error)}\n`)
    }
  }
  const cancel = () => {
    if (cancelled || finished) return
    cancelled = true
    kill("SIGTERM")
    escalation = setTimeout(() => kill("SIGKILL"), 1000)
  }
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", onOutput)
  child.stderr.on("data", onOutput)
  const result = new Promise<CommandResult>((done) => {
    child.on("error", (error) => onOutput(`\n${error.message}\n`))
    child.on("close", (exitCode) => {
      finished = true
      // The parent may exit before its descendants. Finish cancellation of the entire group.
      if (escalation) { clearTimeout(escalation); kill("SIGKILL") }
      done({ exitCode, cancelled })
    })
  })
  return { cancel, result }
}

async function git(cwd: string, args: string[]) {
  let output = ""
  const result = await runCommand({ args: ["git", ...args], cwd }, (chunk) => { output += chunk }).result
  if (result.exitCode !== 0) throw new Error(output.trim() || "Could not inspect local repository")
  return output.trim()
}

export async function resolveLocalRepository(cwd: string): Promise<LocalRepository | undefined> {
  try {
    const directory = await git(cwd, ["rev-parse", "--show-toplevel"])
    const remote = await git(directory, ["remote", "get-url", "origin"])
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(remote)
    if (!match) return undefined
    return { directory, repository: match[1]! }
  } catch { return undefined }
}

export function matchesLocalRepository(local: LocalRepository | undefined, repository: string) {
  return local?.repository.toLowerCase() === repository.toLowerCase()
}

export function cloneDestination(destination: string, cwd: string) {
  if (!destination.trim() || destination.includes("\0")) throw new Error("Enter a destination directory")
  const expanded = destination === "~" ? homedir() : destination.startsWith("~/") ? resolve(homedir(), destination.slice(2)) : destination
  return resolve(cwd, expanded)
}

export function cloneCommand(repository: string, destination: string, cwd: string): CommandSpec {
  return { args: ["gh", "repo", "clone", `github.com/${repository}`, cloneDestination(destination, cwd), "--", "--progress"], cwd }
}

// Progress uses CR rewrites; render it as lines rather than letting control bytes affect the TUI.
export function plainCommandOutput(output: string) {
  return output.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
}
