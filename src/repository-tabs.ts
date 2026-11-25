import { opendir } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "./navigation"
import { configDirectory } from "./paths"
import { atomicPrivateWrite, ensureTrustedDirectory, readPrivateJson, trustedReadDirectory } from "./filesystem"
import { normalizeRepository } from "./repository-name"

export type RepositoryTabs = Record<string, Page>
export type RepositoryTabBarHidden = Record<string, boolean>

const isPage = (value: unknown): value is Page =>
  value === "overview" || value === "commits" || value === "issues" || value === "pulls" || value === "actions"
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean"

function normalizeValues<T>(input: unknown, valid: (value: unknown) => value is T): Record<string, T> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  const values: Record<string, T> = {}
  for (const [key, value] of Object.entries(input)) {
    const repository = normalizeRepository(key)?.toLowerCase()
    if (repository && valid(value)) values[repository] = value
  }
  return values
}

async function readValues<T>(path: string, valid: (value: unknown) => value is T, maxBytes = 1024 * 1024): Promise<Record<string, T>> {
  try {
    return normalizeValues(await readPrivateJson(path, { maxBytes }), valid)
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) return {}
    throw error
  }
}

async function loadRepositoryValues<T>(path: string, valid: (value: unknown) => value is T): Promise<Record<string, T>> {
  // Keep the original aggregate file readable; per-repository updates override it.
  const values = await readValues(path, valid)
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
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return values
    throw error
  }
  for (const file of files) {
    const saved = await readValues(join(directory, file), valid, 4096)
    for (const [repository, value] of Object.entries(saved)) {
      if (file === `${encodeURIComponent(repository)}.json`) values[repository] = value
    }
  }
  return values
}

// Save only changed repositories. Separate atomic files avoid cross-process
// read/merge/write races and never overwrite another repository's history.
async function saveRepositoryValues<T>(values: Record<string, T>, path: string, valid: (value: unknown) => value is T): Promise<void> {
  const directory = `${path}.d`
  await ensureTrustedDirectory(directory)
  for (const [repository, value] of Object.entries(normalizeValues(values, valid))) {
    const destination = join(directory, `${encodeURIComponent(repository)}.json`)
    await atomicPrivateWrite(destination, JSON.stringify({ [repository]: value }, null, 2) + "\n")
  }
}

export function loadRepositoryTabs(path = join(configDirectory(), "repository-state.json")): Promise<RepositoryTabs> {
  return loadRepositoryValues(path, isPage)
}

export function saveRepositoryTabs(tabs: RepositoryTabs, path = join(configDirectory(), "repository-state.json")): Promise<void> {
  return saveRepositoryValues(tabs, path, isPage)
}

export function loadRepositoryTabBarHidden(path = join(configDirectory(), "repository-tab-bar.json")): Promise<RepositoryTabBarHidden> {
  return loadRepositoryValues(path, isBoolean)
}

export function saveRepositoryTabBarHidden(
  hidden: RepositoryTabBarHidden,
  path = join(configDirectory(), "repository-tab-bar.json"),
): Promise<void> {
  return saveRepositoryValues(hidden, path, isBoolean)
}
