import { expect, test } from "bun:test"
import type { CliRenderer } from "@opentui/core"
import { editMarkdownExternally } from "../src/ui/external-editor"

test("external editing imports saved Markdown and restores the terminal on failure", async () => {
  const previous = process.env.VISUAL
  const calls: string[] = []
  const renderer = {
    isDestroyed: false,
    suspend: async () => { calls.push("suspend") },
    resume: async () => { calls.push("resume") },
  } as unknown as CliRenderer
  try {
    process.env.VISUAL = "printf '# Edited\\n' >"
    expect(await editMarkdownExternally(renderer, "Original draft")).toBe("# Edited\n")
    process.env.VISUAL = "exit 7; #"
    await expect(editMarkdownExternally(renderer, "Keep this draft")).rejects.toThrow("Draft kept unchanged")
    expect(calls).toEqual(["suspend", "resume", "suspend", "resume"])
  } finally {
    if (previous === undefined) delete process.env.VISUAL
    else process.env.VISUAL = previous
  }
})
