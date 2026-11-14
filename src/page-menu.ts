import { createInterface } from "node:readline"
import type { Readable, Writable } from "node:stream"
import type { Page } from "./navigation"

const pages = [
  { page: "overview", label: "Overview" },
  { page: "issues", label: "Issues" },
  { page: "pulls", label: "Pull requests" },
  { page: "commits", label: "Commits" },
  { page: "actions", label: "Actions" },
] as const

export function choosePage(
  input: Readable & { isTTY?: boolean } = process.stdin,
  output: Writable & { isTTY?: boolean } = process.stderr,
): Promise<Page | undefined> {
  if (!input.isTTY || !output.isTTY)
    return Promise.reject(new Error("--interactive requires a terminal. Use opengh issues, pulls, or actions instead."))

  output.write(`${pages.map((item, index) => `${index + 1}  ${item.label}`).join("\n")}\n\n`)
  const menu = createInterface({ input, terminal: true })
  return new Promise((resolve) => {
    const finish = (page?: Page) => {
      input.removeListener("keypress", onKey)
      menu.removeListener("close", onClose)
      menu.close()
      resolve(page)
    }
    const onKey = (_text: string, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (!key.ctrl && !key.meta && /^[1-5]$/.test(key.name ?? "")) {
        finish(pages[Number(key.name) - 1]!.page)
      } else if (key.name === "escape") {
        output.write("\n")
        finish()
      }
    }
    const onClose = () => finish()
    input.on("keypress", onKey)
    menu.on("SIGINT", () => { output.write("\n"); finish() })
    menu.on("close", onClose)
    menu.on("line", (line) => {
      const choice = line.trim()
      if (!choice) return finish()
      output.write("Choose a number from 1 to 5.\n")
    })
  })
}
