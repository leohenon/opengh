import type { CliRenderer } from "@opentui/core"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { terminalHandoff } from "../external-actions"

export async function editMarkdownExternally(renderer: CliRenderer, text: string): Promise<string> {
  return terminalHandoff(renderer, async launch => {
    const directory = await mkdtemp(join(tmpdir(), "opengh-draft-"))
    const path = join(directory, "draft.md")
    try {
      await writeFile(path, text, { mode: 0o600 })
      const editor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || "vi"
      // Preserve the existing draft-editor command behavior; data remains positional.
      try {
        await launch(["/bin/sh", "-c", `${editor} "$1"`, "opengh-editor", path], process.cwd())
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}. Draft kept unchanged.`)
      }
      return await readFile(path, "utf8")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
