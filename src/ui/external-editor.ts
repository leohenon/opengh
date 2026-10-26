import type { CliRenderer } from "@opentui/core"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export async function editMarkdownExternally(renderer: CliRenderer, text: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opengh-draft-"))
  const path = join(directory, "draft.md")
  let suspended = false
  try {
    await writeFile(path, text, { mode: 0o600 })
    await renderer.suspend()
    suspended = true
    const editor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || "vi"
    // Editor commands may include arguments. Pass the filename separately, never
    // interpolate draft contents or paths into the user's shell command.
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/bin/sh", ["-c", `${editor} "$1"`, "opengh-editor", path], { stdio: "inherit" })
      child.once("error", reject)
      child.once("exit", (code, signal) => {
        if (code === 0) resolve()
        else reject(new Error(`Editor ${signal ? `stopped by ${signal}` : `exited with status ${code}`}. Draft kept unchanged.`))
      })
    })
    return await readFile(path, "utf8")
  } finally {
    try {
      if (suspended && !renderer.isDestroyed) await renderer.resume()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
