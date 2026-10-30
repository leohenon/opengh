export type DetailCacheOptions = {
  maxEntries?: number
  maxBytes?: number
  freshMs?: number
  retainMs?: number
  now?: () => number
  budget?: CacheBudget
  // Values larger than this are never retained, even when the budget would allow it.
  maxValueBytes?: number
}

type Entry<T> = { value: T; bytes: number; loadedAt: number; usedAt: number }
// A stale entry is older than any clock reading, so staleness never depends on the clock's origin.
const STALE = Number.NEGATIVE_INFINITY

const MAX_MEASURED_BYTES = 64 * 1024 * 1024

/** One memory budget shared by every cache in a session, so caches cannot each use the full limit. */
type Member = { oldest(except?: string): number | undefined; evictOldest(except?: string): boolean; sweep(time: number): void }
export type CacheBudget = { maxBytes: number; used: number; register(member: Member): void; fit(owner: Member, protectedKey: string, time: number): void }
export function createCacheBudget(maxBytes = 32 * 1024 * 1024): CacheBudget {
  const members: Member[] = []
  return {
    maxBytes, used: 0,
    register(member) { members.push(member) },
    fit(owner, protectedKey, time) {
      for (const member of members) member.sweep(time)
      // Evict the least recently used entry across all caches, never the one being stored.
      while (this.used > this.maxBytes) {
        let victim: Member | undefined
        let oldest = Infinity
        for (const member of members) {
          const usedAt = member.oldest(member === owner ? protectedKey : undefined)
          if (usedAt !== undefined && usedAt < oldest) { oldest = usedAt; victim = member }
        }
        if (!victim?.evictOldest(victim === owner ? protectedKey : undefined)) return
      }
    },
  }
}

// Estimated retained UTF-16 payload; walks each stored value once per retention, bounded by the budget.
export function estimateBytes(value: unknown, budget = MAX_MEASURED_BYTES): number {
  let total = 0
  const seen = new Set<object>()
  const stack: unknown[] = [value]
  while (stack.length) {
    const current = stack.pop()
    if (total > budget) return budget + 1
    if (typeof current === "string") { total += current.length * 2; continue }
    if (typeof current !== "object" || current === null) { total += 8; continue }
    if (seen.has(current)) continue
    seen.add(current)
    total += 16
    if (Array.isArray(current)) { for (const item of current) stack.push(item); continue }
    for (const [key, item] of Object.entries(current)) { total += key.length * 2; stack.push(item) }
  }
  return total
}

/** Bounded LRU for recently visited detail data. Values are shared, never cloned. */
export function createDetailCache<T>(options: DetailCacheOptions = {}) {
  const maxEntries = options.maxEntries ?? 24
  const budget = options.budget ?? createCacheBudget(options.maxBytes)
  const maxBytes = Math.min(options.maxBytes ?? budget.maxBytes, budget.maxBytes)
  const maxValueBytes = Math.min(options.maxValueBytes ?? maxBytes, maxBytes)
  const freshMs = options.freshMs ?? 30_000
  const retainMs = options.retainMs ?? 10 * 60_000
  const now = options.now ?? Date.now
  const entries = new Map<string, Entry<T>>()
  let totalBytes = 0
  const remove = (key: string) => {
    const entry = entries.get(key)
    if (!entry) return
    totalBytes -= entry.bytes
    budget.used -= entry.bytes
    entries.delete(key)
  }
  // Map order is recency order: get() and set() move entries to the end.
  const first = (except?: string) => { for (const [key, entry] of entries) if (key !== except) return [key, entry] as const }
  const member: Member = {
    oldest: (except) => first(except)?.[1].usedAt,
    evictOldest(except) { const found = first(except); if (!found) return false; remove(found[0]); return true },
    sweep(time) { for (const [key, entry] of entries) if (time - entry.usedAt > retainMs) remove(key) },
  }
  budget.register(member)
  const trim = (protectedKey: string) => {
    const time = now()
    member.sweep(time)
    while ((entries.size > maxEntries || totalBytes > maxBytes) && member.evictOldest(protectedKey)) { /* bounded by entries */ }
    budget.fit(member, protectedKey, time)
  }
  return {
    get(key: string): { value: T; stale: boolean } | undefined {
      const entry = entries.get(key)
      if (!entry) return undefined
      const time = now()
      if (time - entry.usedAt > retainMs) { remove(key); return undefined }
      entry.usedAt = time
      entries.delete(key)
      entries.set(key, entry)
      return { value: entry.value, stale: time - entry.loadedAt > freshMs }
    },
    set(key: string, value: T, fresh = true) {
      const previous = entries.get(key)
      const bytes = estimateBytes(value, maxValueBytes)
      const time = now()
      remove(key)
      // Oversized values stay usable while active but are never retained for later.
      if (bytes > maxValueBytes) return
      entries.set(key, { value, bytes, loadedAt: fresh ? time : previous?.loadedAt ?? STALE, usedAt: time })
      totalBytes += bytes
      budget.used += bytes
      trim(key)
    },
    // Marks one key, or every key matching a predicate, as needing revalidation before reuse.
    markStale(match: string | ((key: string) => boolean)) {
      if (typeof match === "string") { const entry = entries.get(match); if (entry) entry.loadedAt = STALE; return }
      for (const [key, entry] of entries) if (match(key)) entry.loadedAt = STALE
    },
    get size() { return entries.size },
    get bytes() { return totalBytes },
  }
}
