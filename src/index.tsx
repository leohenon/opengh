import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { Root } from "./root"

const repositoryArgument = process.argv[2] && !process.argv[2].startsWith("-")
  ? process.argv[2]
  : undefined

const renderer = await createCliRenderer({
  targetFps: 30,
  exitOnCtrlC: false,
  useMouse: false,
})

try {
  await render(() => <Root repositoryArgument={repositoryArgument} cwd={process.cwd()} />, renderer)
} catch (error) {
  renderer.destroy()
  throw error
}
