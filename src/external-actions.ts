import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { commandEnvironment } from "./command-actions"
import type { DiffContent } from "./models"

export function validateExternalCommand(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.some(arg => typeof arg !== "string" || arg.includes("\0")) || !value[0].trim())
    throw new TypeError("Use JSON argument arrays with a nonempty executable and no NUL bytes")
  if (value.some(arg => /\{(repo|base|head|file|line)\}/.test(arg)))
    throw new TypeError("Use {patch}; checkout placeholders are not supported")
  if (["sh", "bash", "zsh", "dash", "ksh", "fish"].includes(basename(value[0]))) {
    const index = value.findIndex((arg, index) => index > 0 && /^-[a-z]*c[a-z]*$/.test(arg))
    if (index >= 0 && /\{patch\}/.test(value[index + 1] ?? ""))
      throw new TypeError("Pass placeholders as shell arguments, not script source")
  }
  return [...value]
}
export function expandExternalCommand(command: string[], patch: string) {
  return validateExternalCommand(command).map(arg => arg.replace(/\{patch\}/g, () => patch))
}

export function resolveDiffViewerCommand(command?: string[], findExecutable = Bun.which): string[] {
  if (command !== undefined) return validateExternalCommand(command)
  const hunk = findExecutable("hunk")
  if (hunk) return [hunk, "patch", "{patch}"]
  throw new Error("Install hunk or set diffViewerCommand in config.json.")
}

export type Terminal = { suspend(): void | Promise<void>; resume(): void | Promise<void>; isDestroyed: boolean }
const busy = new WeakSet<Terminal>()
// Acquire before any async preparation, so repeated keys cannot race terminal suspension.
export async function terminalHandoff<T>(terminal: Terminal, work: (launch: (args: string[], cwd: string) => Promise<void>) => Promise<T>, runner = runExternal) {
  if (busy.has(terminal)) throw new Error("An external tool is already running")
  busy.add(terminal)
  let suspended = false
  try {
    return await work(async (args, cwd) => {
      if (terminal.isDestroyed) throw new Error("Terminal closed before external tool launch")
      suspended = true
      await terminal.suspend()
      if (terminal.isDestroyed) throw new Error("Terminal closed before external tool launch")
      await runner(args, cwd)
    })
  } finally {
    try { if (suspended && !terminal.isDestroyed) await terminal.resume() }
    finally { busy.delete(terminal) }
  }
}
export async function runExternal(args: string[], cwd: string) {
  await new Promise<void>((done, reject) => {
    const child = spawn(args[0]!, args.slice(1), { cwd, env: commandEnvironment(), stdio: "inherit" })
    child.once("error", reject)
    child.once("close", (code, signal) => code === 0 ? done() : reject(new Error(`External tool ${signal ? `stopped by ${signal}` : `exited with status ${code}`}`)))
  })
}
export async function openExternalDiff(options: {
  terminal: Terminal; command?: string[]; content?: DiffContent
}, runner = runExternal) {
  return terminalHandoff(options.terminal, async launch => {
    const command = resolveDiffViewerCommand(options.command)
    if (!command.some(arg => arg.includes("{patch}"))) throw new Error("Add {patch} to diffViewerCommand.")
    if (options.content?.kind !== "patch") throw new Error("Patch unavailable. Reload the full diff.")
    const directory = await mkdtemp(join(tmpdir(), "opengh-diff-"))
    try {
      const patch = join(directory, "diff.patch")
      await writeFile(patch, options.content.patch, { mode: 0o600 })
      await launch(expandExternalCommand(command, patch), directory)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }, runner)
}
