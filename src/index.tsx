import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { Root } from "./root"
import { initializeHunk } from "./ui/hunk-host"
import { stopGitHubProcesses } from "./github/process"
import { stopClipboardProcesses } from "./clipboard"
import { stopCommandProcesses } from "./command-actions"
import { saveRepositoryTabs } from "./repository-tabs"
import { saveConfig } from "./config"
import { rememberRepository } from "./github/repository"
import { launchUsage, parseLaunchArguments, type LaunchOptions } from "./launch-target"

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
if (launch.help) {
  console.log(launchUsage)
  process.exit(0)
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

const renderer = await createCliRenderer({
  targetFps: 30,
  exitOnCtrlC: false,
  useMouse: true,
  enableMouseMovement: true,
  onDestroy: () => {
    // Host cleanup can finish before native teardown and terminal output settle.
    void Promise.allSettled([
      renderer.closed,
      stopGitHubProcesses(),
      stopClipboardProcesses(),
      stopCommandProcesses(),
      ...pendingSaves,
    ]).then(() => process.exit(process.exitCode ?? 0))
  },
})

try {
  initializeHunk(renderer)
  await render(() => (
    <Root
      repositoryArgument={launch.repositoryArgument}
      initialPage={launch.initialPage}
      initialDetail={launch.initialDetail}
      standalone={launch.standalone}
      cwd={cwd}
      services={{
        saveConfig: (config) => trackSave(saveConfig(config)),
        saveRepositoryTabs: (tabs) => trackSave(saveRepositoryTabs(tabs)),
        rememberRepository: (repository) => trackSave(rememberRepository(repository)),
      }}
    />
  ), renderer)
} catch (error) {
  process.exitCode = 1
  renderer.destroy()
  throw error
}
