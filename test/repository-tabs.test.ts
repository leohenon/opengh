import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadRepositoryTabs, saveRepositoryTabs } from "../src/repository-tabs"

const directories: string[] = []

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "opengh-repository-tabs-"))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("repository tabs", () => {
  test("returns an empty map for missing, corrupt, or non-object files", async () => {
    const path = join(await temporaryDirectory(), "repository-state.json")
    expect(await loadRepositoryTabs(path)).toEqual({})
    for (const content of ["{not json", "null", "[]", '"string"', "42"]) {
      await writeFile(path, content)
      expect(await loadRepositoryTabs(path)).toEqual({})
    }
  })

  test("normalizes repository names and ignores invalid names and pages", async () => {
    const path = join(await temporaryDirectory(), "repository-state.json")
    await writeFile(path, JSON.stringify({
      " Owner/Repo ": "overview",
      "https://github.com/Owner/Commits.git": "commits",
      "Owner/Issues": "issues",
      "Owner/Pulls": "pulls",
      "Owner/Actions": "actions",
      "not-a-repository": "issues",
      "owner/repo/extra": "pulls",
      "owner/invalid-page": "documents",
      "owner/null": null,
      "owner/number": 1,
      "owner/object": { page: "issues" },
    }))
    expect(await loadRepositoryTabs(path)).toEqual({
      "owner/repo": "overview",
      "owner/commits": "commits",
      "owner/issues": "issues",
      "owner/pulls": "pulls",
      "owner/actions": "actions",
    })
  })

  test("round trips lowercase keys and updates only the changed repository", async () => {
    const path = join(await temporaryDirectory(), "nested", "repository-state.json")
    await saveRepositoryTabs({ "Owner/Repo": "issues", "Owner/Other": "actions" }, path)
    const expected = { "owner/repo": "issues", "owner/other": "actions" } as const
    expect(JSON.parse(await readFile(join(`${path}.d`, "owner%2Frepo.json"), "utf8"))).toEqual({ "owner/repo": "issues" })
    expect(await loadRepositoryTabs(path)).toEqual(expected)
    const destination = join(`${path}.d`, "owner%2Frepo.json")
    expect((await stat(`${path}.d`)).mode & 0o777).toBe(0o700)
    expect((await stat(destination)).mode & 0o777).toBe(0o600)
    await chmod(destination, 0o644)
    await saveRepositoryTabs({ "Owner/Repo": "pulls" }, path)
    expect((await stat(destination)).mode & 0o777).toBe(0o600)
    expect(await loadRepositoryTabs(path)).toEqual({ "owner/repo": "pulls", "owner/other": "actions" })
    expect((await readdir(`${path}.d`)).sort()).toEqual(["owner%2Fother.json", "owner%2Frepo.json"])
  })

  test("rejects symlink and oversized state inputs before parsing", async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, "repository-state.json")
    const target = join(directory, "target.json")
    await writeFile(target, JSON.stringify({ "owner/repo": "issues" }))
    await symlink(target, path)
    await expect(loadRepositoryTabs(path)).rejects.toThrow("regular file")
    await rm(path)
    await writeFile(path, JSON.stringify({ "owner/repo": "issues", padding: "x".repeat(1024 * 1024) }))
    await expect(loadRepositoryTabs(path)).rejects.toThrow("byte limit")
    await rm(path)
    await saveRepositoryTabs({ "owner/repo": "issues" }, path)
    await writeFile(join(`${path}.d`, "owner%2Frepo.json"), JSON.stringify({ "owner/repo": "issues", padding: "x".repeat(4096) }))
    await expect(loadRepositoryTabs(path)).rejects.toThrow("byte limit")
  })

  test("propagates save failures and removes temporary files after a failed rename", async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, "repository-state.json")
    const destination = join(`${path}.d`, "owner%2Frepo.json")
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, "keep"), "untouched")
    await expect(saveRepositoryTabs({ "owner/repo": "issues" }, path)).rejects.toBeInstanceOf(Error)
    expect(await readdir(`${path}.d`)).toEqual(["owner%2Frepo.json"])
    expect(await readFile(join(destination, "keep"), "utf8")).toBe("untouched")
  })
})


test("concurrent saves retain independent repositories and override legacy history without deleting it", async () => {
  const path = join(await temporaryDirectory(), "repository-state.json")
  await writeFile(path, JSON.stringify({ "owner/a": "overview", "owner/legacy": "commits" }))
  await Promise.all([
    saveRepositoryTabs({ "owner/a": "issues" }, path),
    saveRepositoryTabs({ "owner/b": "pulls" }, path),
  ])
  expect(await loadRepositoryTabs(path)).toEqual({
    "owner/a": "issues", "owner/b": "pulls", "owner/legacy": "commits",
  })
  await saveRepositoryTabs({ "owner/a": "actions" }, path)
  expect(await loadRepositoryTabs(path)).toEqual({
    "owner/a": "actions", "owner/b": "pulls", "owner/legacy": "commits",
  })
})
