import { existsSync, readFileSync } from "node:fs"
import { mkdir, realpath, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { version } from "../package.json"
import { loadLatestStableRelease, type StableRelease } from "./github/releases"

// Replaced with immutable literals by scripts/build.ts; absent when running from source.
declare const OPENGH_BUILD_TARGET: string
declare const OPENGH_INSTALL_SCRIPT: string

const buildTarget = typeof OPENGH_BUILD_TARGET === "string" ? OPENGH_BUILD_TARGET : undefined
const installScript = typeof OPENGH_INSTALL_SCRIPT === "string" ? OPENGH_INSTALL_SCRIPT : undefined

type InstallerOptions = { cwd: string; env: NodeJS.ProcessEnv }
type UpdateOptions = {
  executable?: string
  currentVersion?: string
  target?: string
  installer?: string
  latest?: () => Promise<StableRelease>
  install?: (script: string, options: InstallerOptions) => number | Promise<number>
  log?: (message: string) => void
}

export async function runUpdateInstaller(script: string, options: InstallerOptions, timeoutMs = 300_000): Promise<number> {
  const child = Bun.spawn(["sh", "-c", script], {
    ...options, stdin: "ignore", stdout: "inherit", stderr: "inherit", detached: true,
  })
  const state: { stopped?: "timeout" | "SIGINT" | "SIGTERM" | "SIGHUP" } = {}
  const stop = (reason: NonNullable<typeof state.stopped>) => {
    if (state.stopped) return
    state.stopped = reason
    // A shell's TERM trap can wait forever for its foreground command. Kill its entire
    // isolated process group, including hung probes/downloaders, without waiting for traps.
    try { process.kill(-child.pid, "SIGKILL") } catch { child.kill("SIGKILL") }
  }
  const interrupt = () => stop("SIGINT")
  const terminate = () => stop("SIGTERM")
  const hangup = () => stop("SIGHUP")
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", terminate)
  process.once("SIGHUP", hangup)
  const timeout = setTimeout(() => stop("timeout"), timeoutMs)
  try {
    const code = await child.exited
    if (state.stopped === "timeout")
      throw new Error("Update timed out; installer processes were stopped. Check opengh --version before retrying.")
    if (state.stopped) {
      process.exitCode = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[state.stopped]
      throw new Error("Update interrupted; installer processes were stopped. Check opengh --version before retrying.")
    }
    return code
  } finally {
    clearTimeout(timeout)
    process.off("SIGINT", interrupt)
    process.off("SIGTERM", terminate)
    process.off("SIGHUP", hangup)
  }
}

function isJavaScriptInstallation(executable: string) {
  if (executable.split("/").includes("node_modules")) return true
  // npm/workspace links can resolve the native package outside node_modules.
  const path = join(dirname(dirname(executable)), "package.json")
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return false
    throw new Error(`Cannot inspect installation metadata at ${path}. Use the original installation method to update.`)
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw new Error(`Invalid installation metadata at ${path}. Use the original installation method to update.`)
  const name = (manifest as Record<string, unknown>).name
  return typeof name === "string" && (name === "opengh" || name === "@leohenon/opengh"
    || /^opengh-(?:darwin-(?:arm64|x64)|linux-(?:arm64|x64)(?:-musl)?)$/.test(name))
}

export function installationUpdateHint(executable: string) {
  if (executable.startsWith("/nix/store/"))
    return "This installation is managed by Nix. Find its entry with nix profile list, then update it with nix profile upgrade."
  if (isJavaScriptInstallation(executable))
    return "This installation is managed by a JavaScript package manager. Use the manager that installed it; for a global npm install: npm install --global @leohenon/opengh"
  if (executable.includes("/Cellar/opengh/") || existsSync(join(dirname(dirname(executable)), "INSTALL_RECEIPT.json")))
    return "This installation is managed by Homebrew. Run: brew update && brew upgrade leohenon/tap/opengh"
}

export async function runUpdate(options: UpdateOptions = {}): Promise<void> {
  const target = options.target ?? buildTarget
  if (!target)
    throw new Error("This is a source checkout. Pull the desired changes, then run bun install --frozen-lockfile in that checkout.")
  const installer = options.installer ?? installScript
  if (!installer) throw new Error("This build has no bundled installer. Reinstall opengh using its original installation method.")
  const executable = await realpath(options.executable ?? process.execPath)
  const managed = installationUpdateHint(executable)
  if (managed) throw new Error(managed)

  const lock = `${executable}.update-lock`
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(`An update lock already exists at ${lock}. Ensure no update is running; remove it if a previous attempt was interrupted.`)
    throw new Error(`Cannot update ${executable}: its directory must be writable. ${(error as Error).message}`)
  }

  try {
    const currentVersion = options.currentVersion ?? version
    const latest = await (options.latest ?? loadLatestStableRelease)()
    const order = Bun.semver.order(latest.version, currentVersion)
    const log = options.log ?? console.log
    if (order <= 0) {
      log(order === 0 ? `opengh ${currentVersion} is up to date.`
        : `opengh ${currentVersion} is newer than the latest stable release (${latest.version}); nothing changed.`)
      return
    }
    log(`Updating opengh ${currentVersion} → ${latest.version}…`)
    const code = await (options.install ?? runUpdateInstaller)(installer, {
      // No commands run in the caller's untrusted checkout. Explicit values override ambient installer settings.
      cwd: lock,
      env: {
        ...process.env,
        OPENGH_VERSION: latest.version,
        OPENGH_INSTALL_DIR: dirname(executable),
        OPENGH_INSTALL_NAME: basename(executable),
        OPENGH_UPDATE_FROM: currentVersion,
        OPENGH_DOWNLOAD_BASE_URL: "",
        // Force-killing the installer bypasses its EXIT trap; keep all temporary files
        // in this owned, same-filesystem workspace so our finally block can remove them.
        TMPDIR: lock,
        OPENGH_UPDATE_STAGE_DIR: lock,
      },
    })
    if (code !== 0) throw new Error("Update did not complete successfully. Check opengh --version before retrying.")
    log(`Updated to opengh ${latest.version}.`)
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}
