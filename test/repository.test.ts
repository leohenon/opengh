import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { loadRecentRepositories, rememberRepository, resolveRepository } from "../src/github/repository"
import { normalizeRepository } from "../src/repository-name"

describe("repository resolution", () => {
  test("normalizes repository names and GitHub URLs", () => {
    expect(normalizeRepository("anomalyco/opentui")).toBe("anomalyco/opentui")
    expect(normalizeRepository("https://github.com/anomalyco/opentui.git")).toBe("anomalyco/opentui")
    expect(normalizeRepository("not-a-repository")).toBeUndefined()
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
    await rememberRepository("anomalyco/opentui", path)
    await rememberRepository("cli/cli", path)
    expect(await loadRecentRepositories(path)).toEqual(["cli/cli", "anomalyco/opentui"])
  })
})
