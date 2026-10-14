import { describe, expect, test } from "bun:test"
import { chmod, lstat, mkdir, readdir, readlink, rm, stat, symlink } from "node:fs/promises"
import { join } from "node:path"
import { ConfigFileError, loadConfig, saveConfig } from "../src/config"

describe("config", () => {
  test("uses defaults when the config file does not exist", async () => {
    expect(await loadConfig("/path/that/does/not/exist.json")).toEqual({ showScrollbars: false, theme: "github", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: false, compactHeader: false, iconStyle: "nerd" })
  })

  test("loads valid fields and defaults invalid fields", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const enabledPath = join(directory, "enabled.json")
    const invalidPath = join(directory, "invalid.json")
    await Bun.write(enabledPath, JSON.stringify({ showScrollbars: true, theme: "nord", aboutSidebar: "hide", compactHeader: true, unknown: "ignored" }))
    await Bun.write(invalidPath, JSON.stringify({ showScrollbars: "yes", theme: "unknown", aboutSidebar: "sometimes", detailLayout: "invalid", showStatusBarHints: "no", iconStyle: "invalid", compactHeader: "yes" }))

    expect(await loadConfig(enabledPath)).toEqual({ showScrollbars: true, theme: "nord", aboutSidebar: "hide", detailLayout: "centered", showStatusBarHints: false, compactHeader: true, iconStyle: "nerd" })
    expect(await loadConfig(invalidPath)).toEqual({ showScrollbars: false, theme: "github", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: false, compactHeader: false, iconStyle: "nerd" })
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

  test("round trips config, creates directories, and preserves permissions", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const path = join(directory, "nested", "config.json")

    await saveConfig({ showScrollbars: false, theme: "github", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: true, compactHeader: false, iconStyle: "unicode" }, path)
    for (const mode of [0o600, 0o660]) {
      await chmod(path, mode)
      await saveConfig({ showScrollbars: true, theme: "dracula", aboutSidebar: "show", detailLayout: "wide", showStatusBarHints: false, compactHeader: false, iconStyle: "nerd" }, path)
      expect((await stat(path)).mode & 0o777).toBe(mode)
    }

    expect(await readdir(join(directory, "nested"))).toEqual(["config.json"])
    expect(await loadConfig(path)).toEqual({ showScrollbars: true, theme: "dracula", aboutSidebar: "show", detailLayout: "wide", showStatusBarHints: false, compactHeader: false, iconStyle: "nerd" })
    expect(await Bun.file(path).text()).toBe('{\n  "showScrollbars": true,\n  "theme": "dracula",\n  "aboutSidebar": "show",\n  "detailLayout": "wide",\n  "showStatusBarHints": false,\n  "compactHeader": false,\n  "iconStyle": "nerd"\n}\n')
  })

  test("saves through relative symlinks without replacing them", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const target = join(directory, "nested", "config.json")
    const link = join(directory, "config.json")
    try {
      await saveConfig({ showScrollbars: false, theme: "github", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: true, compactHeader: false, iconStyle: "unicode" }, target)
      await chmod(target, 0o600)
      await symlink(join("nested", "config.json"), link)
      const config = { showScrollbars: true, theme: "nord" as const, aboutSidebar: "hide" as const, detailLayout: "centered" as const, showStatusBarHints: true, compactHeader: false, iconStyle: "unicode" as const }
      await saveConfig(config, link)

      expect((await lstat(link)).isSymbolicLink()).toBe(true)
      expect(await readlink(link)).toBe(join("nested", "config.json"))
      expect(await loadConfig(target)).toEqual(config)
      expect(await loadConfig(link)).toEqual(config)
      expect((await stat(target)).mode & 0o777).toBe(0o600)
      expect(await readdir(join(directory, "nested"))).toEqual(["config.json"])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("reports config write failures and cleans up failed replacements", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const parent = join(directory, "not-a-directory")
    const path = join(parent, "config.json")
    await Bun.write(parent, "file")

    const save = saveConfig({ showScrollbars: false, theme: "github", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: true, compactHeader: false, iconStyle: "unicode" }, path)
    await expect(save).rejects.toBeInstanceOf(ConfigFileError)
    await expect(save).rejects.toMatchObject({ operation: "save", path })

    const destination = join(directory, "config.json")
    await mkdir(destination)
    await Bun.write(join(destination, "keep"), "untouched")
    await expect(saveConfig({ showScrollbars: true, theme: "nord", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: true, compactHeader: false, iconStyle: "unicode" }, destination))
      .rejects.toMatchObject({ operation: "save", path: destination })
    expect(await Bun.file(join(destination, "keep")).text()).toBe("untouched")
    expect((await readdir(directory)).sort()).toEqual(["config.json", "not-a-directory"])

    const brokenLink = join(directory, "broken.json")
    await symlink("missing.json", brokenLink)
    await expect(saveConfig({ showScrollbars: false, theme: "github", aboutSidebar: "auto", detailLayout: "centered", showStatusBarHints: true, compactHeader: false, iconStyle: "unicode" }, brokenLink))
      .rejects.toMatchObject({ operation: "save", path: brokenLink })
    expect((await lstat(brokenLink)).isSymbolicLink()).toBe(true)
    expect(await readlink(brokenLink)).toBe("missing.json")
    expect((await readdir(directory)).sort()).toEqual(["broken.json", "config.json", "not-a-directory"])
  })
})
