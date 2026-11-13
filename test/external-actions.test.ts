import { expect, test } from "bun:test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { disableExternalTools, expandExternalCommand, openExternalDiff, resolveDiffViewerCommand, terminalHandoff, validateExternalCommand } from "../src/external-actions"
import { defaultConfig, loadConfig, saveConfig } from "../src/config"

const terminal = () => {
  const events: string[] = []
  return { events, isDestroyed: false, suspend() { events.push("suspend") }, resume() { events.push("resume") } }
}

test("patch expansion is literal, nonrecursive and never shell-parsed", () => {
  const patch = '/tmp/a $(touch evil); "{patch}"'
  expect(expandExternalCommand(["viewer", "{patch}", "{patch}:{patch}", "{unknown}"], patch))
    .toEqual(["viewer", patch, `${patch}:${patch}`, "{unknown}"])
  for (const invalid of [[], "hunk", [""], ["viewer", 3], ["viewer", "a\0b"], ["sh", "-c", "cat {patch}"]])
    expect(() => validateExternalCommand(invalid)).toThrow()
  for (const placeholder of ["repo", "base", "head", "file", "line"])
    expect(() => validateExternalCommand(["viewer", `{${placeholder}}`])).toThrow("checkout placeholders")
  expect(validateExternalCommand(["sh", "-c", 'cat "$1"', "tool", "{patch}"])).toHaveLength(5)
})

test("viewer defaults to installed Hunk, with explicit config taking precedence and no pager fallback", () => {
  const found = (name: string) => name === "hunk" ? "/tools/hunk" : null
  expect(resolveDiffViewerCommand(undefined, found)).toEqual(["/tools/hunk", "patch", "{patch}"])
  const noLookup = () => { throw new Error("Explicit config must not search PATH") }
  expect(resolveDiffViewerCommand(["custom-viewer", "{patch}"], noLookup)).toEqual(["custom-viewer", "{patch}"])
  expect(() => resolveDiffViewerCommand([], found)).toThrow("argument arrays")
  const pagerOnly = (name: string) => name === "less" ? "/tools/less" : null
  expect(() => resolveDiffViewerCommand(undefined, pagerOnly))
    .toThrow("Install hunk or set diffViewerCommand in config.json.")
})

test("viewer commands survive config roundtrip and settings-style saves", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengh-config-"))
  const path = join(directory, "config.json")
  try {
    const config = { ...defaultConfig, diffViewerCommand: ["hunk", "patch", "{patch}"] }
    await saveConfig(config, path)
    expect(await loadConfig(path)).toEqual(config)
    await saveConfig({ ...await loadConfig(path), showScrollbars: true }, path)
    expect((await loadConfig(path)).diffViewerCommand).toEqual(config.diffViewerCommand)
    await writeFile(path, JSON.stringify({ diffViewerCommand: "hunk" }))
    await expect(loadConfig(path)).rejects.toThrow("argument arrays")
    await expect(saveConfig({ ...config, diffViewerCommand: [] }, path)).rejects.toThrow("argument arrays")
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("terminal handoff resumes after success, launch and suspend failures; blocks races", async () => {
  for (const fail of [false, true]) {
    const term = terminal()
    const promise = terminalHandoff(term, launch => launch(["fake"], "/"), async () => { term.events.push("run"); if (fail) throw new Error("failed") })
    if (fail) await expect(promise).rejects.toThrow("failed")
    else await promise
    expect(term.events).toEqual(["suspend", "run", "resume"])
  }
  const term = terminal()
  term.suspend = () => { throw new Error("suspend failed") }
  await expect(terminalHandoff(term, launch => launch(["fake"], "/"))).rejects.toThrow("suspend failed")
  expect(term.events).toEqual(["resume"])
  let release!: () => void
  const pending = terminalHandoff(term, async () => await new Promise<void>(done => { release = done }))
  await expect(terminalHandoff(term, async () => {})).rejects.toThrow("already running")
  release(); await pending
})

test("embedded sessions can block external tools before preparation or terminal handoff", async () => {
  const term = terminal()
  disableExternalTools(term, "Viewer disabled in this session")
  let prepared = false
  let launched = false
  await expect(terminalHandoff(term, async launch => {
    prepared = true
    await launch(["viewer"], "/")
  }, async () => { launched = true })).rejects.toThrow("Viewer disabled in this session")
  await expect(openExternalDiff({ terminal: term, command: ["viewer", "{patch}"],
    content: { kind: "patch", patch: "loaded patch" } }, async () => { launched = true }))
    .rejects.toThrow("Viewer disabled in this session")
  expect(prepared).toBe(false)
  expect(launched).toBe(false)
  expect(term.events).toEqual([])

  const other = terminal()
  await terminalHandoff(other, launch => launch(["viewer"], "/"), async () => { other.events.push("run") })
  expect(other.events).toEqual(["suspend", "run", "resume"])
})

test("viewers receive the exact private patch without a checkout and clean up after success or failure", async () => {
  for (const failure of [undefined, "viewer"]) {
    const term = terminal()
    let patchPath = ""
    const promise = openExternalDiff({ terminal: term, command: ["viewer", "{patch}"],
      content: { kind: "patch", patch: "exact loaded patch\n" } }, async (args, cwd) => {
      patchPath = args[1]!
      expect(await Bun.file(patchPath).text()).toBe("exact loaded patch\n")
      expect((await stat(patchPath)).mode & 0o777).toBe(0o600)
      expect(cwd).toBe(dirname(patchPath))
      if (failure === "viewer") throw new Error("viewer failed")
    })
    if (failure) await expect(promise).rejects.toThrow(`${failure} failed`)
    else await promise
    if (patchPath) {
      expect(await Bun.file(patchPath).exists()).toBe(false)
      await expect(stat(dirname(patchPath))).rejects.toThrow()
    }
    expect(term.events.at(-1)).toBe("resume")
  }
})

test("missing patch placeholders and patches fail before terminal handoff", async () => {
  const term = terminal()
  await expect(openExternalDiff({ terminal: term, command: ["viewer"] })).rejects.toThrow("Add {patch}")
  for (const content of [undefined, { kind: "files" as const, files: [], truncated: false }])
    await expect(openExternalDiff({ terminal: term, command: ["viewer", "{patch}"], content })).rejects.toThrow("Reload the full diff")
  expect(term.events).toEqual([])
})
