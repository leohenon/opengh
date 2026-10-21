import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "./navigation"
import { configDirectory } from "./paths"
import { normalizeRepository } from "./repository-name"

export type RepositoryTabs = Record<string, Page>

function normalizeTabs(value: unknown): RepositoryTabs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const tabs: RepositoryTabs = {}
  for (const [key, page] of Object.entries(value)) {
    const repository = normalizeRepository(key)?.toLowerCase()
    if (repository && (page === "overview" || page === "commits" || page === "issues" || page === "pulls" || page === "actions")) {
      tabs[repository] = page
    }
  }
  return tabs
}

async function readTabs(path: string): Promise<RepositoryTabs> {
  try {
    return normalizeTabs(JSON.parse(await readFile(path, "utf8")))
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) return {}
    throw error
  }
}

export async function loadRepositoryTabs(path = join(configDirectory(), "repository-state.json")): Promise<RepositoryTabs> {
  // Keep the original aggregate file readable; per-repository updates override it.
  const tabs = await readTabs(path)
  const directory = `${path}.d`
  const files = await readdir(directory).catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  })
  for (const file of files.filter((file) => file.endsWith(".json"))) {
    const saved = await readTabs(join(directory, file))
    for (const [repository, page] of Object.entries(saved)) {
      if (file === `${encodeURIComponent(repository)}.json`) tabs[repository] = page
    }
  }
  return tabs
}

// Save only changed repositories. Separate atomic files avoid cross-process
// read/merge/write races and never overwrite another repository's history.
export async function saveRepositoryTabs(tabs: RepositoryTabs, path = join(configDirectory(), "repository-state.json")): Promise<void> {
  const directory = `${path}.d`
  await mkdir(directory, { recursive: true })
  for (const [repository, page] of Object.entries(normalizeTabs(tabs))) {
    const destination = join(directory, `${encodeURIComponent(repository)}.json`)
    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify({ [repository]: page }, null, 2) + "\n", { flag: "wx" })
      await rename(temporary, destination)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }
}
