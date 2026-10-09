import { render } from "@opentui/solid"
import { Root } from "./root"

const repositoryArgument = process.argv[2] && !process.argv[2].startsWith("-")
  ? process.argv[2]
  : undefined

await render(() => <Root repositoryArgument={repositoryArgument} cwd={process.cwd()} />, {
  targetFps: 30,
  exitOnCtrlC: false,
  useMouse: false,
})
