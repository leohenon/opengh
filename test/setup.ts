import { afterAll } from "bun:test"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Services a test does not inject fall back to the real ones, which read and write the config directory.
// A throwaway directory keeps every run independent of, and harmless to, the developer's own opengh state.
const directory = realpathSync(mkdtempSync(join(tmpdir(), "opengh-test-config-")))
process.env.XDG_CONFIG_HOME = directory
afterAll(() => rmSync(directory, { recursive: true, force: true }))
