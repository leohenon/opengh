import { expect, test } from "bun:test"
import { loadLatestStableRelease } from "../src/github/releases"
import { GitHubApiError, type GitHubTransport } from "../src/github/transport"

function transport(value: unknown): GitHubTransport {
  return {
    async json<T>(path: string) {
      expect(path).toBe("repos/leohenon/opengh/releases/latest")
      return value as T
    },
    async text() { throw new Error("Unexpected text request") },
  }
}

const release = { tag_name: "v1.2.3", draft: false, prerelease: false }

test("latest release uses the fixed repository and maps a stable version", async () => {
  expect(await loadLatestStableRelease(transport(release))).toEqual({ version: "1.2.3" })
})

test.each([
  null, [], {}, { ...release, draft: true }, { ...release, prerelease: true },
  { ...release, tag_name: "v1.2.3-rc.1" }, { ...release, tag_name: "1.2.3" },
  { ...release, tag_name: "v01.2.3" }, { ...release, tag_name: "v1.2.3\n" },
  { ...release, tag_name: "v1.2.3/../../other" }, { ...release, draft: undefined },
])("invalid or non-stable release metadata is rejected: %j", async value => {
  await expect(loadLatestStableRelease(transport(value))).rejects.toThrow()
})

test("a missing stable release has an actionable message without hiding other API failures", async () => {
  const api = transport(release)
  api.json = async () => { throw new GitHubApiError("repos/leohenon/opengh/releases/latest", "Not Found", 404) }
  await expect(loadLatestStableRelease(api)).rejects.toThrow("No stable opengh release is available")
  const denied = new GitHubApiError("repos/leohenon/opengh/releases/latest", "Forbidden", 403)
  api.json = async () => { throw denied }
  await expect(loadLatestStableRelease(api)).rejects.toBe(denied)
  const account = new GitHubApiError("user", "Not Found", 404)
  api.json = async () => { throw account }
  await expect(loadLatestStableRelease(api)).rejects.toBe(account)
})
