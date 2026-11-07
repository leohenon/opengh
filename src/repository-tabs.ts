import { opendir } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "./navigation"
import { configDirectory } from "./paths"
import { atomicPrivateWrite, ensureTrustedDirectory, readPrivateJson, trustedReadDirectory } from "./filesystem"
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

async function readTabs(path: string, maxBytes = 1024 * 1024): Promise<RepositoryTabs> {
  try {
    return normalizeTabs(await readPrivateJson(path, { maxBytes }))
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) return {}
    throw error
  }
}

export async function loadRepositoryTabs(path = join(configDirectory(), "repository-state.json")): Promise<RepositoryTabs> {
  // Keep the original aggregate file readable; per-repository updates override it.
  const tabs = await readTabs(path)
  let directory: string
  const files: string[] = []
  try {
    directory = await trustedReadDirectory(`${path}.d`)
    const entries = await opendir(directory)
    let count = 0
    for await (const entry of entries) {
      if (++count > 10_000) throw new Error("Repository state directory exceeds the 10,000 file limit")
      if (entry.name.endsWith(".json")) files.push(entry.name)
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return tabs
    throw error
  }
  for (const file of files) {
    const saved = await readTabs(join(directory, file), 4096)
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
  await ensureTrustedDirectory(directory)
  for (const [repository, page] of Object.entries(normalizeTabs(tabs))) {
    const destination = join(directory, `${encodeURIComponent(repository)}.json`)
    await atomicPrivateWrite(destination, JSON.stringify({ [repository]: page }, null, 2) + "\n")
  }
}
