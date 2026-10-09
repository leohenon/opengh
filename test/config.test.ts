import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { ConfigFileError, loadConfig, saveConfig } from "../src/config"

describe("config", () => {
  test("uses defaults when the config file does not exist", async () => {
    expect(await loadConfig("/path/that/does/not/exist.json")).toEqual({ showScrollbars: false, theme: "github" })
  })

  test("loads valid fields and defaults invalid fields", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const enabledPath = join(directory, "enabled.json")
    const invalidPath = join(directory, "invalid.json")
    await Bun.write(enabledPath, JSON.stringify({ showScrollbars: true, theme: "nord", unknown: "ignored" }))
    await Bun.write(invalidPath, JSON.stringify({ showScrollbars: "yes", theme: "unknown" }))

    expect(await loadConfig(enabledPath)).toEqual({ showScrollbars: true, theme: "nord" })
    expect(await loadConfig(invalidPath)).toEqual({ showScrollbars: false, theme: "github" })
  })

  test("reports malformed config files", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const path = join(directory, "config.json")
    await Bun.write(path, "{not json")

    await expect(loadConfig(path)).rejects.toMatchObject({
      name: "ConfigFileError",
      operation: "load",
      path,
    })
  })

  test("creates parent directories and round trips saved config", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const path = join(directory, "nested", "config.json")

    await saveConfig({ showScrollbars: true, theme: "dracula" }, path)

    expect(await loadConfig(path)).toEqual({ showScrollbars: true, theme: "dracula" })
    expect(await Bun.file(path).text()).toBe('{\n  "showScrollbars": true,\n  "theme": "dracula"\n}\n')
  })

  test("reports config write failures", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const parent = join(directory, "not-a-directory")
    const path = join(parent, "config.json")
    await Bun.write(parent, "file")

    const save = saveConfig({ showScrollbars: false, theme: "github" }, path)
    await expect(save).rejects.toBeInstanceOf(ConfigFileError)
    await expect(save).rejects.toMatchObject({ operation: "save", path })
  })
})
