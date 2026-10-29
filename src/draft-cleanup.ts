import { lstatSync, readdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"

// Only abandoned atomic-write files are disposable. Never expire saved drafts
// or submission markers, which may be needed to prevent duplicate posts.
export function cleanupDraftTemporaryFiles(directory: string) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  let names: string[]
  try { names = readdirSync(directory) } catch { return }
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json(?:\.submission)?\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/.test(name)) continue
    try {
      const path = join(directory, name)
      const stat = lstatSync(path)
      if (stat.isFile() && stat.mtimeMs < cutoff) unlinkSync(path)
    } catch {
      // Housekeeping must not prevent loading or saving the user's drafts.
    }
  }
}
