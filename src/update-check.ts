import { join } from "node:path"
import { version } from "../package.json"
import { atomicPrivateWrite, readPrivateJson } from "./filesystem"
import { loadLatestStableRelease, type StableRelease } from "./github/releases"
import { configDirectory } from "./paths"
import { isSourceCheckout, updateInstruction } from "./update"

export type UpdateNotice = { currentVersion: string; latestVersion: string; instruction: string }
const cacheLifetime = 24 * 60 * 60 * 1000
const isStableVersion = (value: unknown): value is string =>
  typeof value === "string" && value === value.trim() && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)

// Optional startup enrichment: neither network nor local storage failures should
// interfere with opening a repository. Cache only validated stable releases, and
// remember a failed check too, so GitHub is asked at most once a day.
export async function checkForUpdate(
  options: {
    source?: boolean
    currentVersion?: string
    cachePath?: string
    now?: number
    latest?: () => Promise<StableRelease>
    instruction?: () => Promise<string>
  } = {},
): Promise<UpdateNotice | undefined> {
  if (options.source ?? isSourceCheckout()) return
  try {
    const path = options.cachePath ?? join(configDirectory(), "update-check.json")
    const now = options.now ?? Date.now()
    const remember = (version?: string) =>
      atomicPrivateWrite(path, JSON.stringify({ checkedAt: now, ...(version ? { version } : {}) }) + "\n").catch(() => {})
    let latestVersion: string | undefined
    try {
      const cached = await readPrivateJson(path, { maxBytes: 4096 })
      if (cached && typeof cached === "object" && !Array.isArray(cached)) {
        const { checkedAt, version } = cached as Record<string, unknown>
        if (typeof checkedAt === "number" && Number.isFinite(checkedAt) && now >= checkedAt && now - checkedAt < cacheLifetime) {
          if (version === undefined) return
          if (isStableVersion(version)) latestVersion = version
        }
      }
    } catch {
      // A missing, malformed, or unreadable cache is not a startup failure.
    }
    if (!latestVersion) {
      const latest = await (options.latest ?? loadLatestStableRelease)().catch(() => undefined)
      if (!latest || !isStableVersion(latest.version)) {
        await remember()
        return
      }
      latestVersion = latest.version
      await remember(latestVersion)
    }
    const currentVersion = options.currentVersion ?? version
    if (Bun.semver.order(latestVersion, currentVersion) <= 0) return
    return {
      currentVersion,
      latestVersion,
      instruction: await (options.instruction ?? updateInstruction)(),
    }
  } catch {
    return undefined
  }
}
