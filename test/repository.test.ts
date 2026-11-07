import { describe, expect, test } from "bun:test"
import { chmod, lstat, mkdir, readdir, rm, stat, symlink } from "node:fs/promises"
import { join } from "node:path"
import { loadRecentRepositories, rememberRepository, resolveRepository } from "../src/github/repository"
import { normalizeRepository } from "../src/repository-name"

describe("repository resolution", () => {
  test("normalizes repository names and GitHub URLs", () => {
    expect(normalizeRepository("anomalyco/opentui")).toBe("anomalyco/opentui")
    expect(normalizeRepository("https://github.com/anomalyco/opentui.git")).toBe("anomalyco/opentui")
    expect(normalizeRepository("not-a-repository")).toBeUndefined()
    for (const repository of ["../repo", "owner/..", "./repo"])
      expect(normalizeRepository(repository)).toBeUndefined()
  })

  test("explicit repository wins without inspecting the directory", async () => {
    expect(await resolveRepository("cli/cli", "/path/that/does/not/exist")).toBe("cli/cli")
  })

  test("no argument opens the repository picker without inspecting the directory", async () => {
    let inspectedDirectory = false
    const resolved = await resolveRepository(undefined, "/repo", async () => {
      inspectedDirectory = true
      return "cli/cli"
    })

    expect(resolved).toBeUndefined()
    expect(inspectedDirectory).toBe(false)
  })

  test("a dot resolves the repository from the current directory", async () => {
    const resolved = await resolveRepository(".", "/repo", async (cwd) => {
      expect(cwd).toBe("/repo")
      return "cli/cli"
    })

    expect(resolved).toBe("cli/cli")
  })

  test("stores unique recent repositories in newest-first order", async () => {
    const directory = await Bun.$`mktemp -d`.text()
    const path = join(directory.trim(), "nested", "recent.json")
    await rememberRepository("cli/cli", path)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(directory.trim(), "nested"))).mode & 0o777).toBe(0o700)
    await chmod(path, 0o644)
    await rememberRepository("anomalyco/opentui", path)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await rememberRepository("cli/cli", path)
    expect(await loadRecentRepositories(path)).toEqual(["cli/cli", "anomalyco/opentui"])

    const repositories = Array.from({ length: 110 }, (_, index) => `owner/repo-${index}`)
    await Bun.write(path, JSON.stringify([repositories[0], "OWNER/REPO-0", ...repositories.slice(1)]))
    expect(await loadRecentRepositories(path)).toEqual(repositories.slice(0, 100))
    await rememberRepository("owner/new-repo", path)
    expect(await loadRecentRepositories(path)).toEqual(["owner/new-repo", ...repositories.slice(0, 99)])
    await Bun.write(path, JSON.stringify(["owner/" + "x".repeat(64 * 1024)]))
    expect(await loadRecentRepositories(path)).toEqual([])
  })

  test("rejects symlink and nonregular recent-history destinations without overwriting targets", async () => {
    const directory = (await Bun.$`mktemp -d`.text()).trim()
    const path = join(directory, "recent.json")
    const target = join(directory, "keep.json")
    try {
      await Bun.write(target, '["owner/keep"]')
      await symlink("keep.json", path)
      expect(await loadRecentRepositories(path)).toEqual([])
      await expect(rememberRepository("owner/new", path)).rejects.toBeInstanceOf(Error)
      expect(await Bun.file(target).text()).toBe('["owner/keep"]')
      expect((await lstat(path)).isSymbolicLink()).toBe(true)
      expect((await readdir(directory)).sort()).toEqual(["keep.json", "recent.json"])
      await rm(path)
      await mkdir(path)
      await expect(rememberRepository("owner/new", path)).rejects.toBeInstanceOf(Error)
      expect(await readdir(path)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
