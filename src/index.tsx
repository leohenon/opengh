import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import { Root } from "./root"
import { initializeHunk } from "./ui/hunk-host"
import { stopGitHubProcesses } from "./github/process"
import { githubWrites } from "./github/writes"
import { stopClipboardProcesses } from "./clipboard"
import { stopCommandProcesses } from "./command-actions"
import { saveRepositoryTabBarHidden, saveRepositoryTabs } from "./repository-tabs"
import { createResumeWriter, loadResume, saveResume } from "./resume"
import { defaultConfig, loadConfig, saveConfig } from "./config"
import { rememberRepository } from "./github/repository"
import { launchUsage, parseLaunchArguments, updateUsage, type LaunchOptions } from "./launch-target"
import { version } from "../package.json"

const pendingSaves = new Set<Promise<void>>()

function trackSave(save: Promise<void>) {
  pendingSaves.add(save)
  void save.then(
    () => pendingSaves.delete(save),
    () => pendingSaves.delete(save),
  )
  return save
}

const cwd = process.env.OPENGH_LAUNCH_CWD ?? process.cwd()
delete process.env.OPENGH_LAUNCH_CWD

let launch: LaunchOptions
try {
  launch = parseLaunchArguments(process.argv.slice(2))
} catch (error) {
  console.error(`opengh: ${error instanceof Error ? error.message : "Invalid arguments"}\nRun opengh --help for usage.`)
  process.exit(1)
}
if (launch.version) {
  console.log(`opengh ${version}`)
  process.exit(0)
}
if (launch.help) {
  console.log(launch.update ? updateUsage : launchUsage)
  process.exit(0)
}

if (launch.update) {
  try {
    const { runUpdate } = await import("./update")
    await runUpdate()
  } catch (error) {
    console.error(`opengh: ${error instanceof Error ? error.message : "Could not update"}`)
    process.exitCode ||= 1
  } finally {
    await stopGitHubProcesses()
  }
  process.exit(process.exitCode ?? 0)
}

if (launch.inline) {
  try {
    const { printInline } = await import("./inline")
    await printInline(launch, cwd)
  } catch (error) {
    console.error(`opengh: ${error instanceof Error ? error.message : "Could not print page"}`)
    process.exitCode = 1
  } finally {
    await stopGitHubProcesses()
  }
  process.exit(process.exitCode ?? 0)
}

if (launch.interactive) {
  try {
    const { choosePage } = await import("./page-menu")
    const page = await choosePage()
    if (!page) process.exit(0)
    launch.initialPage = page
  } catch (error) {
    console.error(`opengh: ${error instanceof Error ? error.message : "Could not choose a page"}`)
    process.exit(1)
  }
}

const resumeLocation = launch.resume ? await loadResume() : undefined
const resumeWriter = createResumeWriter(saveResume)

// Resolve preferences before mounting the first loading frame.
let initialConfig = defaultConfig
let initialConfigError = ""
try {
  initialConfig = await loadConfig()
} catch (error) {
  initialConfigError = error instanceof Error ? error.message : "Could not load config"
}

// OPENGH_DEBUG=1 opens OpenTUI's console instead of the notice.
const debug = process.env.OPENGH_DEBUG === "1"
const [unexpectedError, setUnexpectedError] = createSignal<string>()
if (!debug) {
  const report = (error: unknown) => setUnexpectedError(error instanceof Error ? error.message : String(error))
  process.on("uncaughtException", report)
  process.on("unhandledRejection", report)
}

const renderer = await createCliRenderer({
  targetFps: 30,
  exitOnCtrlC: false,
  openConsoleOnError: debug,
  useMouse: true,
  enableMouseMovement: true,
  onDestroy: () => {
    // Host cleanup can finish before native teardown and terminal output settle.
    void Promise.allSettled([
      renderer.closed,
      resumeWriter.flush(),
      stopGitHubProcesses(),
      // Writes in flight finish first; their requests are bounded.
      Promise.race([githubWrites.settled(), Bun.sleep(35_000)]),
      stopClipboardProcesses(),
      stopCommandProcesses(),
      ...pendingSaves,
    ]).then(() => process.exit(process.exitCode ?? 0))
  },
})

try {
  // Resolved from the entry module: this path is the same from source and inside a compiled
  // executable, where scripts/build.ts embeds the worker as a second entry point.
  initializeHunk(renderer, new URL("./ui/workers/hunk-highlight.js", import.meta.url))
  await render(
    () => (
      <Root
        repositoryArgument={launch.repositoryArgument}
        initialPage={launch.initialPage}
        initialDetail={launch.initialDetail}
        focus={launch.focus}
        resumeLocation={resumeLocation}
        onNavigationChange={resumeWriter.remember}
        cwd={cwd}
        initialConfig={initialConfig}
        initialConfigError={initialConfigError}
        unexpectedError={unexpectedError}
        onDismissUnexpectedError={() => setUnexpectedError(undefined)}
        onShutdownWork={(work) => void trackSave(work.then(() => {}))}
        services={{
          saveConfig: (config) => trackSave(saveConfig(config)),
          saveRepositoryTabs: (tabs) => trackSave(saveRepositoryTabs(tabs)),
          saveRepositoryTabBarHidden: (hidden) => trackSave(saveRepositoryTabBarHidden(hidden)),
          rememberRepository: (repository) => trackSave(rememberRepository(repository)),
        }}
      />
    ),
    renderer,
  )
} catch (error) {
  process.exitCode = 1
  renderer.destroy()
  throw error
}
