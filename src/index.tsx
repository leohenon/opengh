import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { Root } from "./root"
import { stopGitHubProcesses } from "./github/process"
import { saveConfig } from "./config"
import { rememberRepository } from "./github/repository"

const pendingSaves = new Set<Promise<void>>()

function trackSave(save: Promise<void>) {
  pendingSaves.add(save)
  void save.then(
    () => pendingSaves.delete(save),
    () => pendingSaves.delete(save),
  )
  return save
}

const repositoryArgument = process.argv[2] && !process.argv[2].startsWith("-")
  ? process.argv[2]
  : undefined

const renderer = await createCliRenderer({
  targetFps: 30,
  exitOnCtrlC: false,
  useMouse: false,
  onDestroy: () => {
    // Unlike the destroy event, this runs after terminal restoration and native cleanup.
    void Promise.allSettled([
      stopGitHubProcesses(),
      ...pendingSaves,
    ]).then(() => process.exit(process.exitCode ?? 0))
  },
})

try {
  await render(() => (
    <Root
      repositoryArgument={repositoryArgument}
      cwd={process.cwd()}
      services={{
        saveConfig: (config) => trackSave(saveConfig(config)),
        rememberRepository: (repository) => trackSave(rememberRepository(repository)),
      }}
    />
  ), renderer)
} catch (error) {
  process.exitCode = 1
  renderer.destroy()
  throw error
}
