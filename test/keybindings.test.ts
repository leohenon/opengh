import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultConfig, loadConfig, saveConfig } from "../src/config"
import {
  canonicalKey, formatBinding, formatHints, matchesKey, normalizeKeybindings,
  keybindingContexts, resolveKeybindings, validateKeybindingConflicts,
} from "../src/keybindings"

describe("keybindings", () => {
  test("normalizes aliases and matches exact modifiers across legacy and Kitty events", () => {
    expect(canonicalKey("Control+Return")).toBe("ctrl+enter")
    expect(canonicalKey("option+Esc")).toBe("alt+escape")
    expect(canonicalKey("G")).toBe("shift+g")
    expect(canonicalKey("ctrl+plus")).toBe("ctrl++")
    expect(canonicalKey("É")).toBe("É")
    expect(matchesKey({ name: "", sequence: "É" }, "É")).toBe(true)
    expect(matchesKey({ name: "", sequence: "é" }, "É")).toBe(false)
    for (const event of [{ name: "G", sequence: "G" }, { name: "g", shift: true, sequence: "g" }]) {
      expect(matchesKey(event, "G")).toBe(true)
      expect(matchesKey(event, "g")).toBe(false)
    }
    expect(matchesKey({ name: "?", sequence: "?", shift: true }, "?")).toBe(true)
    for (const modifier of [{ ctrl: true }, { meta: true }, { super: true }, { hyper: true }]) {
      const prefix = modifier.ctrl ? "ctrl" : modifier.meta ? "alt" : modifier.super ? "super" : "hyper"
      expect(matchesKey({ name: "/", sequence: "?", shift: true, ...modifier }, `${prefix}+?`)).toBe(true)
    }
    expect(matchesKey({ name: "/", sequence: "?", shift: true }, "?")).toBe(true)
    expect(matchesKey({ name: "return" }, "enter")).toBe(true)
    expect(matchesKey({ name: "kpenter" }, "enter")).toBe(true)
    expect(matchesKey({ name: "tab", shift: true }, "shift+tab")).toBe(true)
    expect(matchesKey({ name: "s", ctrl: true }, "s")).toBe(false)
    expect(matchesKey({ name: "s", meta: true }, "alt+s")).toBe(true)
    expect(matchesKey({ name: "s", option: true }, "alt+s")).toBe(true)
    expect(matchesKey({ name: "s", super: true }, "s")).toBe(false)
    expect(matchesKey({ name: "s", hyper: true }, "s")).toBe(false)
    expect(matchesKey({ name: "f12" }, "F12")).toBe(true)
    expect(matchesKey({ name: "q", eventType: "release" }, "q")).toBe(false)
  })

  test("replaces defaults, deduplicates aliases, hides disabled hints, and preserves unrelated actions", () => {
    const overrides = normalizeKeybindings({ "global.help": ["F1", "f1"], "global.quit": [], "navigation.down": ["m", "down"] })
    const bindings = resolveKeybindings(overrides)
    expect(bindings["global.help"]).toEqual(["f1"])
    expect(bindings["global.quit"]).toEqual([])
    expect(bindings["navigation.up"]).toEqual(["up", "k"])
    expect(formatBinding(bindings, "global.help")).toBe("f1")
    expect(formatBinding(bindings, "navigation.down", true)).toBe("m/↓")
    expect(formatHints(bindings, [["global.quit", "quit"], ["global.help", "help"]])).toBe("f1 help")
  })

  test("rejects invalid keys/actions and ambiguous simultaneous actions, not disjoint scopes", () => {
    expect(() => validateKeybindingConflicts(resolveKeybindings())).not.toThrow()
    for (const invalid of [null, [], { nope: [] }, { "global.help": "f1" }, { "global.help": [42] }, { "global.help": ["ctrl+wat"] }, { "global.help": [" "] }, { "global.help": ["shift+6"] }, { "global.help": ["ctrl+"] }, { "global.help": ["\u0000"] }]) {
      expect(() => normalizeKeybindings(invalid)).toThrow()
    }
    expect(() => normalizeKeybindings({ "navigation.down": ["k"] })).toThrow("navigation.up")
    expect(() => normalizeKeybindings({ "global.help": ["j"] })).toThrow("navigation.down")
    expect(() => normalizeKeybindings({ "diff.panLeft": ["r"] })).toThrow("view.refresh")
    expect(() => normalizeKeybindings({ "picker.accept": ["ctrl+s"] })).toThrow("dialog.submit")
    expect(() => normalizeKeybindings({ "picker.accept": ["j"] })).not.toThrow()
    expect(() => normalizeKeybindings({ "settings.nextValue": ["u"] })).not.toThrow()
    expect(() => normalizeKeybindings({ "overview.nextDocument": ["enter"] })).not.toThrow()
    expect(() => normalizeKeybindings({ "diff.nextHunk": ["y"] })).not.toThrow()
  })

  test("search defaults distinguish n/N, support remapping/disabling, and conflict only in browsing scopes", () => {
    const defaults = resolveKeybindings()
    expect(defaults["search.start"]).toEqual(["/"])
    expect(defaults["search.next"]).toEqual(["n"])
    expect(defaults["search.previous"]).toEqual(["N"])
    for (const event of [{ name: "N", sequence: "N" }, { name: "n", shift: true }]) {
      expect(matchesKey(event, defaults["search.previous"][0]!)).toBe(true)
      expect(matchesKey(event, defaults["search.next"][0]!)).toBe(false)
    }
    expect(matchesKey({ name: "n" }, defaults["search.next"][0]!)).toBe(true)
    for (const action of ["search.start", "search.next", "search.previous"] as const) {
      for (const [context, actions] of Object.entries(keybindingContexts)) {
        const browsing = ["overview", "commits", "work", "actions", "commit", "issue", "pull", "run", "diffFiles", "diffBody", "settings"].includes(context)
        expect(actions.includes(action)).toBe(browsing)
      }
    }
    expect(() => normalizeKeybindings({ "navigation.down": ["n"] })).toThrow("search.next")
    expect(() => normalizeKeybindings({ "search.start": ["j"] })).toThrow("navigation.down")
    expect(() => normalizeKeybindings({ "settings.nextValue": ["n"] })).toThrow("settings")
    expect(() => normalizeKeybindings({ "search.next": ["shift+n"] })).toThrow("search.previous")
    expect(() => normalizeKeybindings({ "dialog.close": ["ctrl+a"] })).toThrow("searchInput")
    expect(() => normalizeKeybindings({ "input.submit": ["esc"] })).toThrow("searchInput")
    expect(() => normalizeKeybindings({ "search.start": ["esc"] })).toThrow("navigation.back")
    const remapped = resolveKeybindings(normalizeKeybindings({
      "search.start": ["f3"], "search.next": [], "search.previous": ["f4"], "navigation.down": ["n"],
    }))
    expect(formatBinding(remapped, "search.start")).toBe("f3")
    expect(formatHints(remapped, [["search.next", "next"], ["search.previous", "previous"]])).toBe("f4 previous")
    expect(() => normalizeKeybindings({ "picker.down": ["n"], "editor.move-down": ["n"] })).not.toThrow()
  })

  test("config round trips overrides and rejects invalid saves without replacing the last good file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opengh-keybindings-"))
    const path = join(directory, "config.json")
    try {
      const keybindings = { "global.help": ["f1"], "global.quit": [] }
      await saveConfig({ ...defaultConfig, keybindings }, path)
      const loaded = await loadConfig(path)
      expect(loaded.keybindings).toEqual(keybindings)
      await saveConfig({ ...loaded, showScrollbars: true }, path)
      expect((await loadConfig(path)).keybindings).toEqual(keybindings)
      const previous = await Bun.file(path).text()
      await expect(saveConfig({ ...loaded, keybindings: { "global.help": ["q"] } }, path)).rejects.toMatchObject({ operation: "save" })
      expect(await Bun.file(path).text()).toBe(previous)
      await Bun.write(path, JSON.stringify({ keybindings: { "not.an.action": [] } }))
      await expect(loadConfig(path)).rejects.toMatchObject({ operation: "load" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
