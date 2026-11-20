import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkForUpdate } from "../src/update-check"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function options() {
  const directory = await mkdtemp(join(tmpdir(), "opengh-update-check-"))
  directories.push(directory)
  return {
    source: false,
    cachePath: join(directory, "update-check.json"),
    currentVersion: "1.0.0",
    now: 100_000_000,
    latest: async () => ({ version: "1.2.3" }),
    instruction: async () => "Run: opengh update",
  }
}

test("announces a newer stable release and caches the validated result for 24 hours", async () => {
  const settings = await options()
  let requests = 0
  settings.latest = async () => {
    requests++
    return { version: "1.2.3" }
  }
  const expected = { currentVersion: "1.0.0", latestVersion: "1.2.3", instruction: "Run: opengh update" }
  expect(await checkForUpdate(settings)).toEqual(expected)
  expect(JSON.parse(await readFile(settings.cachePath, "utf8"))).toEqual({ checkedAt: settings.now, version: "1.2.3" })
  expect(await checkForUpdate({ ...settings, now: settings.now + 86_400_000 - 1 })).toEqual(expected)
  expect(requests).toBe(1)
  await checkForUpdate({ ...settings, now: settings.now + 86_400_000 })
  expect(requests).toBe(2)
})

test.each(["1.2.3", "2.0.0", "2.0.0-beta.1"])("does not announce an equal or older release to %s", async (currentVersion) => {
  expect(await checkForUpdate({ ...(await options()), currentVersion })).toBeUndefined()
})

test("a beta installation can discover a newer stable release", async () => {
  expect(await checkForUpdate({ ...(await options()), currentVersion: "1.2.3-beta.4" })).toMatchObject({ latestVersion: "1.2.3" })
})

test.each(["1.3.0-beta.1", "1.3.0-rc.1", "01.3.0", "1.3.0\n"])("never announces or caches a non-stable version %s", async (version) => {
  const settings = await options()
  expect(await checkForUpdate({ ...settings, latest: async () => ({ version }) })).toBeUndefined()
  expect(JSON.parse(await readFile(settings.cachePath, "utf8"))).toEqual({ checkedAt: settings.now })
})

test.each([
  "{broken json",
  JSON.stringify({ checkedAt: 100_000_000, version: "2.0.0-beta.1" }),
  JSON.stringify({ checkedAt: 100_000_001, version: "2.0.0" }),
  JSON.stringify({ checkedAt: "100000000", version: "2.0.0" }),
])("ignores corrupt, prerelease or future caches", async (cache) => {
  const settings = await options()
  await writeFile(settings.cachePath, cache)
  expect(await checkForUpdate(settings)).toMatchObject({ latestVersion: "1.2.3" })
})

test("never checks when running from a source checkout", async () => {
  const settings = await options()
  let requests = 0
  settings.latest = async () => {
    requests++
    return { version: "1.2.3" }
  }
  expect(await checkForUpdate({ ...settings, source: true })).toBeUndefined()
  expect(requests).toBe(0)
  await expect(readFile(settings.cachePath)).rejects.toThrow()
})

test("a failed check is silent and remembered for 24 hours", async () => {
  const settings = await options()
  let requests = 0
  settings.latest = async () => {
    requests++
    throw new Error("Offline")
  }
  expect(await checkForUpdate(settings)).toBeUndefined()
  expect(JSON.parse(await readFile(settings.cachePath, "utf8"))).toEqual({ checkedAt: settings.now })
  expect(await checkForUpdate({ ...settings, now: settings.now + 86_400_000 - 1 })).toBeUndefined()
  expect(requests).toBe(1)
  settings.latest = async () => {
    requests++
    return { version: "1.2.3" }
  }
  expect(await checkForUpdate({ ...settings, now: settings.now + 86_400_000 })).toMatchObject({ latestVersion: "1.2.3" })
  expect(requests).toBe(2)
})

test("cache write failure does not hide an available update", async () => {
  const settings = await options()
  // An existing directory cannot be replaced with a regular cache file.
  expect(await checkForUpdate({ ...settings, cachePath: directories.at(-1)! })).toMatchObject({ latestVersion: "1.2.3" })
})
