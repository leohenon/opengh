import { describe, expect, test } from "bun:test"
import { chmod, lstat, mkdir, readdir, readlink, rm, stat, symlink } from "node:fs/promises"
import { userInfo } from "node:os"
import { join } from "node:path"
import { configDirectory } from "../src/paths"
import { ConfigFileError, defaultConfig, loadConfig, saveConfig } from "../src/config"

describe("config", () => {
  test("ignores relative config roots and falls back to the OS home", () => {
    const originalXdg = process.env.XDG_CONFIG_HOME
    const originalHome = process.env.HOME
    try {
      process.env.XDG_CONFIG_HOME = "relative-config"
      process.env.HOME = "/absolute-home"
      expect(configDirectory()).toBe("/absolute-home/.config/opengh")
      process.env.HOME = "relative-home"
      expect(configDirectory()).toBe(join(userInfo().homedir, ".config", "opengh"))
      delete process.env.HOME
      expect(configDirectory()).toBe(join(userInfo().homedir, ".config", "opengh"))
      process.env.XDG_CONFIG_HOME = "/absolute-config"
      expect(configDirectory()).toBe("/absolute-config/opengh")
    } finally {
      if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = originalXdg
      if (originalHome === undefined) delete process.env.HOME
      else process.env.HOME = originalHome
    }
  })

  test("uses defaults when the config file does not exist", async () => {
    expect(await loadConfig("/path/that/does/not/exist.json")).toEqual({ showScrollbars: false, theme: "opengh", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", diffLayout: "auto", diffWrap: false, diffFullscreen: true, showStatusBarHints: false, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "nerd" })
  })

  test("bounds config reads, rejects unsafe parents, and never creates missing directories", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const path = join(directory, "config.json")
    try {
      expect(await loadConfig(join(directory, "missing", "config.json"))).toEqual(defaultConfig)
      expect(await readdir(directory)).toEqual([])
      await Bun.write(path, JSON.stringify({ unused: "x".repeat(64 * 1024) }))
      await expect(loadConfig(path)).rejects.toThrow("byte limit")
      await Bun.write(path, "private-config-marker")
      try { await loadConfig(path); throw new Error("Invalid config accepted") }
      catch (error) {
        expect(error).toBeInstanceOf(ConfigFileError)
        expect((error as Error).message).not.toContain("private-config-marker")
      }
      await Bun.write(path, "{}")
      await chmod(directory, 0o777)
      await expect(loadConfig(path)).rejects.toThrow("Untrusted writable directory")
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test.skipIf(process.platform === "win32")("rejects FIFO config inputs promptly, including through a settings symlink", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const application = join(directory, "opengh")
    await mkdir(application)
    const path = join(application, "config.json")
    const fifo = join(application, "input.fifo")
    await Bun.$`mkfifo ${fifo}`
    const script = `import {loadConfig, ConfigFileError} from ${JSON.stringify(import.meta.resolve("../src/config.ts"))};
      try { await loadConfig(); console.log("accepted"); process.exitCode = 1 }
      catch (error) { if (!(error instanceof ConfigFileError) || error.operation !== "load" || !error.message.includes("regular file")) throw error; console.log("rejected") }`
    try {
      for (const linked of [true, false]) {
        if (linked) await symlink("input.fifo", path)
        else { await rm(path); await Bun.$`mkfifo ${path}` }
        const child = Bun.spawn([process.execPath, "-e", script], {
          env: { ...process.env, XDG_CONFIG_HOME: directory }, stdout: "pipe", stderr: "pipe",
        })
        const output = new Response(child.stdout).text()
        const error = new Response(child.stderr).text()
        let timedOut = false
        const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL") }, 2000)
        try {
          expect(await child.exited).toBe(0)
          expect(timedOut).toBe(false)
          expect(await output).toContain("rejected")
          expect(await error).toBe("")
        } finally {
          clearTimeout(timeout)
          if (child.exitCode === null) child.kill("SIGKILL")
          await child.exited
        }
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test("loads valid fields and defaults invalid fields", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const enabledPath = join(directory, "enabled.json")
    const invalidPath = join(directory, "invalid.json")
    await Bun.write(enabledPath, "\ufeff" + JSON.stringify({ showScrollbars: true, theme: "nord", colorMode: "system", reducedMotion: true, markdownStyle: "minimal", showTabShortcuts: false, showTabCounts: false, hideDocumentsTab: true, compactHeader: true, detailsPlacement: "inline", iconStyle: "none", diffLayout: "unified", diffWrap: true, unknown: "ignored" }))
    await Bun.write(invalidPath, JSON.stringify({ showScrollbars: "yes", theme: "unknown", colorMode: "system", reducedMotion: "yes", markdownStyle: "invalid", detailLayout: "invalid", detailsPlacement: "invalid", showStatusBarHints: "no", iconStyle: "invalid", compactHeader: "yes", showTabShortcuts: "yes", showTabCounts: "yes", hideDocumentsTab: "yes", diffLayout: "stacked", diffWrap: "yes" }))

    expect(await loadConfig(enabledPath)).toEqual({ showScrollbars: true, theme: "nord", colorMode: "system", reducedMotion: true, markdownStyle: "minimal", detailLayout: "centered", detailsPlacement: "inline", diffLayout: "unified", diffWrap: true, diffFullscreen: true, showStatusBarHints: false, showTabShortcuts: false, showTabCounts: false, hideDocumentsTab: true, compactHeader: true, iconStyle: "none" })
    expect(await loadConfig(invalidPath)).toEqual({ showScrollbars: false, theme: "opengh", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", diffLayout: "auto", diffWrap: false, diffFullscreen: true, showStatusBarHints: false, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "nerd" })
  })

  test("fullscreen diffs default on, reject non-boolean values, and preserve an explicit off value on save", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const path = join(directory, "config.json")
    try {
      for (const diffFullscreen of [undefined, "false", 0, null]) {
        await Bun.write(path, JSON.stringify({ diffFullscreen }))
        expect((await loadConfig(path)).diffFullscreen).toBe(true)
      }
      for (const diffFullscreen of [false, true]) {
        await Bun.write(path, JSON.stringify({ diffFullscreen }))
        const config = await loadConfig(path)
        expect(config.diffFullscreen).toBe(diffFullscreen)
        await saveConfig({ ...config, showScrollbars: true }, path)
        expect((await loadConfig(path)).diffFullscreen).toBe(diffFullscreen)
        expect((await Bun.file(path).json()).diffFullscreen).toBe(diffFullscreen)
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test("migrates github-light and persists explicit color modes", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const path = join(directory, "config.json")
    try {
      await Bun.write(path, JSON.stringify({ theme: "github-light" }))
      expect(await loadConfig(path)).toMatchObject({ theme: "github", colorMode: "light" })
      for (const colorMode of ["system", "dark", "light"] as const) {
        const config = { ...await loadConfig(path), colorMode }
        await saveConfig(config, path)
        expect(await loadConfig(path)).toEqual(config)
      }
      await Bun.write(path, JSON.stringify({ colorMode: "invalid" }))
      expect((await loadConfig(path)).colorMode).toBe("system")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
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

    await saveConfig({ showScrollbars: false, theme: "github", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", diffLayout: "auto", diffWrap: false, diffFullscreen: true, showStatusBarHints: true, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }, path)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(directory, "nested"))).mode & 0o777).toBe(0o700)
    const enabled = { ...await loadConfig(path), reducedMotion: true, markdownStyle: "minimal" as const, detailsPlacement: "inline" as const }
    await saveConfig(enabled, path)
    expect(await loadConfig(path)).toEqual(enabled)
    for (const mode of [0o600, 0o660]) {
      await chmod(path, mode)
      await saveConfig({ showScrollbars: true, theme: "dracula", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "wide", detailsPlacement: "auto", diffLayout: "auto", diffWrap: false, diffFullscreen: true, showStatusBarHints: false, showTabShortcuts: true, showTabCounts: false, hideDocumentsTab: false, compactHeader: false, iconStyle: "nerd" }, path)
      expect((await stat(path)).mode & 0o777).toBe(mode)
    }

    expect(await readdir(join(directory, "nested"))).toEqual(["config.json"])
    expect(await loadConfig(path)).toEqual({ showScrollbars: true, theme: "dracula", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "wide", detailsPlacement: "auto", diffLayout: "auto", diffWrap: false, diffFullscreen: true, showStatusBarHints: false, showTabShortcuts: true, showTabCounts: false, hideDocumentsTab: false, compactHeader: false, iconStyle: "nerd" })
    expect(await Bun.file(path).text()).toBe('{\n  "showScrollbars": true,\n  "theme": "dracula",\n  "colorMode": "system",\n  "reducedMotion": false,\n  "markdownStyle": "rich",\n  "detailLayout": "wide",\n  "detailsPlacement": "auto",\n  "diffLayout": "auto",\n  "diffWrap": false,\n  "diffFullscreen": true,\n  "showStatusBarHints": false,\n  "showTabShortcuts": true,\n  "showTabCounts": false,\n  "hideDocumentsTab": false,\n  "compactHeader": false,\n  "iconStyle": "nerd"\n}\n')
  })

  test("saves through relative symlinks without replacing them", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const target = join(directory, "nested", "config.json")
    const link = join(directory, "config.json")
    try {
      await saveConfig({ showScrollbars: false, theme: "github", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", diffLayout: "auto", diffWrap: false, diffFullscreen: true, showStatusBarHints: true, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }, target)
      await chmod(target, 0o600)
      await chmod(join(directory, "nested"), 0o755)
      await symlink(join("nested", "config.json"), link)
      const config = { showScrollbars: true, theme: "nord" as const, colorMode: "system" as const, reducedMotion: false, markdownStyle: "rich" as const, detailLayout: "centered" as const, detailsPlacement: "auto" as const, diffLayout: "auto" as const, diffWrap: false, diffFullscreen: true, showStatusBarHints: true, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" as const }
      await saveConfig(config, link)

      expect((await lstat(link)).isSymbolicLink()).toBe(true)
      expect(await readlink(link)).toBe(join("nested", "config.json"))
      expect(await loadConfig(target)).toEqual(config)
      expect(await loadConfig(link)).toEqual(config)
      expect((await stat(target)).mode & 0o777).toBe(0o600)
      expect(await readdir(join(directory, "nested"))).toEqual(["config.json"])
      await chmod(target, 0o660)
      await saveConfig(config, link)
      expect((await stat(target)).mode & 0o777).toBe(0o660)
      expect((await stat(join(directory, "nested"))).mode & 0o777).toBe(0o755)
      await chmod(join(directory, "nested"), 0o777)
      await expect(saveConfig({ ...config, theme: "github" }, link)).rejects.toMatchObject({ operation: "save", path: link })
      await expect(loadConfig(link)).rejects.toMatchObject({ operation: "load", path: link })
      expect(await Bun.file(target).json()).toEqual(config)
      expect((await lstat(link)).isSymbolicLink()).toBe(true)
      await chmod(join(directory, "nested"), 0o755)
      const shared = join(directory, "shared")
      await mkdir(shared)
      await chmod(shared, 0o777)
      await symlink(join(directory, "nested"), join(shared, "trusted-link"))
      await expect(saveConfig({ ...config, theme: "github" }, join(shared, "trusted-link", "config.json"))).rejects.toBeInstanceOf(ConfigFileError)
      const hop = join(shared, "hop.json")
      await symlink(target, hop)
      const chain = join(directory, "chain.json")
      await symlink(hop, chain)
      await expect(saveConfig({ ...config, theme: "github" }, chain)).rejects.toBeInstanceOf(ConfigFileError)
      expect(await loadConfig(target)).toEqual(config)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("reports config write failures and cleans up failed replacements", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const parent = join(directory, "not-a-directory")
    const path = join(parent, "config.json")
    await Bun.write(parent, "file")

    const save = saveConfig({ showScrollbars: false, theme: "github", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", diffLayout: "auto", diffWrap: false, diffFullscreen: true, showStatusBarHints: true, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }, path)
    await expect(save).rejects.toBeInstanceOf(ConfigFileError)
    await expect(save).rejects.toMatchObject({ operation: "save", path })

    const destination = join(directory, "config.json")
    await mkdir(destination)
    await Bun.write(join(destination, "keep"), "untouched")
    await expect(saveConfig({ showScrollbars: true, theme: "nord", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", diffLayout: "auto", diffWrap: false, diffFullscreen: true, showStatusBarHints: true, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }, destination))
      .rejects.toMatchObject({ operation: "save", path: destination })
    expect(await Bun.file(join(destination, "keep")).text()).toBe("untouched")
    expect((await readdir(directory)).sort()).toEqual(["config.json", "not-a-directory"])

    const brokenLink = join(directory, "broken.json")
    await symlink("missing.json", brokenLink)
    await expect(saveConfig({ showScrollbars: false, theme: "github", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", diffLayout: "auto", diffWrap: false, diffFullscreen: true, showStatusBarHints: true, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }, brokenLink))
      .rejects.toMatchObject({ operation: "save", path: brokenLink })
    expect((await lstat(brokenLink)).isSymbolicLink()).toBe(true)
    expect(await readlink(brokenLink)).toBe("missing.json")
    expect((await readdir(directory)).sort()).toEqual(["broken.json", "config.json", "not-a-directory"])
  })
})
