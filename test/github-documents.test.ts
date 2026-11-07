import { expect, test } from "bun:test"
import { createGitHubDocuments } from "../src/github/documents"
import { GitHubApiError, type GitHubTransport } from "../src/github/transport"
import type { Repo } from "../src/models"

const repo: Repo = {
  id: 71, nodeId: "R_A",
  nameWithOwner: "owner/repo", url: "https://github.com/owner/repo/", visibility: "PUBLIC",
  defaultBranch: "main", description: "", stars: 0, forks: 0, watchers: 0,
  language: "Rust", license: "MIT", updatedAt: "",
}
const branch = "topic/docs"
const query = "?ref=topic%2Fdocs"
const base = "repositories/71"
function file(path: string, preferredFileType: string, tabName: string, repoName = "repo", refName = branch) {
  return { displayName: path.split("/").at(-1), repoName, refName, path, preferredFileType, tabName,
    richText: "", loaded: false, timedOut: false, errorMessage: null, headerInfo: null }
}
function page(files: unknown, key = "codeViewTreeRoute", path = "/", ref = branch, id: number | undefined = repo.id) {
  return `<html><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
    payload: { codeViewLayoutRoute: { repo: { id } }, [key]: { path, refInfo: { name: ref }, overview: { overviewFiles: files } } },
  })}</script></html>`
}
function transport(html?: string | Error, responses: Record<string, unknown> = {}) {
  const calls: string[] = []
  const client: GitHubTransport = {
    async json<T>(path: string) {
      calls.push(path)
      if (!(path in responses)) throw new GitHubApiError(path, "Missing", 404)
      const value = responses[path]
      if (value instanceof Error) throw value
      return value as T
    },
    async text(path, accept) { calls.push(`${path} ${accept}`); return "body" },
  }
  if (html !== undefined) client.page = async url => {
    calls.push(url)
    if (html instanceof Error) throw html
    return html
  }
  return { api: createGitHubDocuments(client), calls }
}

test("uses exact overview ordering, labels, multiple license identities and inherited refs", async () => {
  const files = [file("README.md", "readme", "README"), file("docs/CONTRIBUTING.md", "contributing", "Contributing"),
    file("LICENSE-APACHE", "license", "Apache-2.0"), file("LICENSE-MIT", "license", "MIT license"),
    file("license-metadata.json", "license", "License"), file("SECURITY.md", "security", "Security", ".github", "main"),
    file("Future.md", "future_kind", "Future tab")]
  for (const key of ["codeViewRepoRoute", "codeViewTreeRoute"]) {
    const { api, calls } = transport(page(files, key, key === "codeViewTreeRoute" ? "/" : ""))
    const documents = await api.documents(repo, branch)
    expect(documents.map(document => document.label)).toEqual([
      "README", "Contributing", "Apache-2.0 license", "MIT license", "License", "Security", "Future tab",
    ])
    expect(documents.map(document => document.id)).toEqual(files.map(entry => `owner/${entry.repoName}:${entry.path}`))
    expect(documents[5]).toMatchObject({ repository: "owner/.github", ref: "main", path: "SECURITY.md" })
    expect(calls).toEqual(["https://github.com/owner/repo/tree/topic%2Fdocs"])
  }
})

test("fetches content separately with encoded path/ref and rejects unsafe sources", async () => {
  const { api, calls } = transport(page([file("docs/A #?.md", "future", "A", ".github", "release/docs")]))
  const [document] = await api.documents(repo, branch)
  expect(await api.document(repo, document!)).toBe("body")
  expect(calls[1]).toBe("repos/owner/.github/contents/docs/A%20%23%3F.md?ref=release%2Fdocs application/vnd.github.raw+json")
  for (const change of [{ path: "../README.md" }, { repository: "https://example.com/repo" }, { path: "docs\\README.md" }]) {
    await expect(api.document(repo, { ...document!, ...change })).rejects.toThrow()
  }
  expect(calls).toHaveLength(2)
})

test("empty overview is authoritative; malformed, wrong-route and unavailable pages fall back", async () => {
  const empty = transport(page([]))
  expect(await empty.api.documents(repo, branch)).toEqual([])
  expect(empty.calls).toHaveLength(1)
  for (const html of [page({}), page([file("../bad", "readme", "README")]), page([], "codeViewTreeRoute", "docs"),
    page([], "codeViewTreeRoute", "", "wrong"), page([], "codeViewTreeRoute", "/", branch, 72), page([], "codeViewTreeRoute", "/", branch, 0), "<script>not data</script>", new Error("HTTP 503")]) {
    const { api, calls } = transport(html, { [`${base}/readme${query}`]: { path: "README.rst" } })
    expect((await api.documents(repo, branch)).map(document => document.path)).toEqual(["README.rst"])
    expect(calls).toContain(`${base}/readme${query}`)
  }
})

test("private fallback respects directory priority, semantic labels and only ignores API 404", async () => {
  const entry = (path: string) => ({ type: "file", name: path.split("/").at(-1), path })
  const responses = {
    [`${base}/license${query}`]: { path: "LICENSE", license: { spdx_id: "NOASSERTION" } },
    [`${base}/contents/.github${query}`]: [entry(".github/cOnTrIbUtInG.markdown")],
    [`${base}/contents/${query}`]: [entry("CONTRIBUTING.md"), entry("SECURITY.txt")],
    [`${base}/contents/docs${query}`]: [entry("docs/SECURITY.md"), entry("docs/CODE_OF_CONDUCT.rst"), entry("docs/Accessibility")],
  }
  const { api, calls } = transport(new Error("must not fetch private pages"), responses)
  expect(await api.documents({ ...repo, visibility: "PRIVATE" }, branch)).toEqual([
    ["docs/CODE_OF_CONDUCT.rst", "Code of conduct"], [".github/cOnTrIbUtInG.markdown", "Contributing"],
    ["LICENSE", "License"], ["SECURITY.txt", "Security"], ["docs/Accessibility", "Accessibility"],
  ].map(([path, label]) => ({ id: `owner/repo:${path}`, repository: "owner/repo", ref: branch, path, label })))
  expect(calls.some(call => call.startsWith("https:"))).toBe(false)
  const variants = transport(undefined, { [`${base}/contents/docs${query}`]: [entry("docs/LICENSE-MIT"), entry("docs/LICENSE-APACHE")] })
  expect((await variants.api.documents(repo, branch)).map(document => document.path)).toEqual(["docs/LICENSE-MIT", "docs/LICENSE-APACHE"])
  for (const error of [new GitHubApiError("readme", "Forbidden", 403), new Error("network failure")]) {
    const failed = transport(undefined, { [`${base}/readme${query}`]: error })
    await expect(failed.api.documents(repo, branch)).rejects.toBe(error)
  }
})

test("public discovery and content remain on A when its old name now belongs to B", async () => {
  const { api, calls } = transport(page([file("B.md", "readme", "README")], "codeViewTreeRoute", "/", branch, 72), {
    [`${base}/readme${query}`]: { path: "docs/A #?.md" },
    [`repos/owner/repo/readme${query}`]: { path: "B.md" },
  })
  const [document] = await api.documents(repo, branch)
  expect(document?.path).toBe("docs/A #?.md")
  expect(await api.document(repo, document!)).toBe("body")
  expect(calls.at(-1)).toBe(`${base}/contents/docs/A%20%23%3F.md${query} application/vnd.github.raw+json`)
  expect(calls.filter(call => !call.startsWith("https:")).every(call => call.startsWith(base))).toBe(true)
  for (const change of [{ path: "../README.md" }, { repository: "https://example.com/repo" }, { path: "docs\\README.md" }]) {
    await expect(api.document(repo, { ...document!, ...change })).rejects.toThrow()
  }
})
