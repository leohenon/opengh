export function normalizeRepository(value: string): string | undefined {
  const normalized = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "")

  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(normalized)) return undefined
  return normalized
}
