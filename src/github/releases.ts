import { createGitHubTransport, GitHubApiError, type GitHubTransport } from "./transport"

export type StableRelease = { version: string }
const latestReleasePath = "repos/leohenon/opengh/releases/latest"

export async function loadLatestStableRelease(transport: GitHubTransport = createGitHubTransport()): Promise<StableRelease> {
  let value: unknown
  try {
    value = await transport.json<unknown>(latestReleasePath)
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404 && error.path === latestReleasePath)
      throw new Error("No stable opengh release is available to this GitHub account.")
    throw error
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid opengh release response")
  const release = value as Record<string, unknown>
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string"
    || release.tag_name !== release.tag_name.trim() || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name))
    throw new Error("GitHub did not return a published stable opengh release")
  return { version: release.tag_name.slice(1) }
}
