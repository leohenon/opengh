import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { loadConfig } from "../src/config"

describe("config", () => {
  test("hides scrollbars by default", async () => {
    expect(await loadConfig("/path/that/does/not/exist.json")).toEqual({ showScrollbars: false })
  })

  test("allows scrollbars to be enabled", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const path = join(directory, "config.json")
    await Bun.write(path, JSON.stringify({ showScrollbars: true }))
    expect(await loadConfig(path)).toEqual({ showScrollbars: true })
  })
})
