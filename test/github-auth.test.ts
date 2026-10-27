import { expect, spyOn, test } from "bun:test"
import { repositoryFromDirectory } from "../src/github/repository"
import { GitHubApiError, GitHubRequestNotSentError, createGitHubTransport } from "../src/github/transport"

test("network errors use simple messages without request URLs", () => {
  const url = "https://api.github.com/repos/owner/repo/pulls/9"
  for (const detail of ["net/http: TLS handshake timeout", "context deadline exceeded", "Request timed out"])
    expect(new GitHubApiError("pulls/9", `Get "${url}": ${detail}`).message).toBe("GitHub request timed out.")
  for (const detail of ["dial tcp: lookup api.github.com: no such host", "connection refused", "connection reset by peer"])
    expect(new GitHubApiError("pulls/9", `Get "${url}": ${detail}`).message).toBe("Could not connect to GitHub.")
})

function result(output = "", error = "", code = 0) {
  return {
    stdout: new Response(output).body!,
    stderr: new Response(error).body!,
    exited: Promise.resolve(code),
    kill() {},
  } as unknown as Bun.Subprocess
}

test("repository discovery preserves CLI failures and rejects non-GitHub.com remotes", async () => {
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => result(JSON.stringify({
    nameWithOwner: "owner/repo", url: "https://github.com/owner/repo",
  })))
  try {
    expect(await repositoryFromDirectory("/repo")).toBe("owner/repo")
    expect(spawn.mock.calls[0]?.[0]).toEqual(["gh", "repo", "view", "--json", "nameWithOwner,url"])
    spawn.mockImplementation(() => result("", "Bad credentials (HTTP 401)", 1))
    await expect(repositoryFromDirectory("/repo")).rejects.toBeInstanceOf(GitHubApiError)
    spawn.mockImplementation(() => result(JSON.stringify({
      nameWithOwner: "owner/repo", url: "https://github.example.com/owner/repo",
    })))
    await expect(repositoryFromDirectory("/repo")).rejects.toThrow("Only GitHub.com repositories are supported")
  } finally {
    spawn.mockRestore()
  }
})

test("API requests pin GitHub.com and distinguish authentication, permissions, and rate limits", async () => {
  const keys = ["GH_HOST", "GH_TOKEN", "GITHUB_TOKEN", "GH_DEBUG", "DEBUG", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_REPO"] as const
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  process.env.GH_HOST = "github.example.com"
  process.env.GH_DEBUG = "api"
  process.env.DEBUG = "api"
  process.env.GH_ENTERPRISE_TOKEN = "enterprise-test-token"
  process.env.GITHUB_ENTERPRISE_TOKEN = "enterprise-test-token"
  process.env.GH_REPO = "github.example.com/other/repo"
  delete process.env.GH_TOKEN
  delete process.env.GITHUB_TOKEN
  const githubTransport = createGitHubTransport()
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => result('{"id":1,"login":"viewer"}'))
  try {
    expect(await githubTransport.json<{ id: number; login: string }>("user")).toEqual({ id: 1, login: "viewer" })
    expect(spawn.mock.calls[0]?.[0]).toEqual(["gh", "api", "--hostname", "github.com", "user"])
    const env = (spawn.mock.calls[0]?.[1] as { env: NodeJS.ProcessEnv }).env
    expect(env.GH_HOST).toBe("github.com")
    expect(env.GH_PROMPT_DISABLED).toBe("1")
    for (const key of keys.slice(3)) expect(env[key]).toBeUndefined()
    for (const [message, code, guidance] of [
      ["Bad credentials (HTTP 401)", 1, "gh auth login --hostname github.com"],
      ["Authentication required", 4, "gh auth login --hostname github.com"],
      ["Resource not accessible by personal access token (HTTP 403)", 1, "token permissions"],
      ["API rate limit exceeded (HTTP 403)", 1, "wait before retrying"],
    ] as const) {
      spawn.mockImplementation(() => result("", message, code))
      await expect(githubTransport.json("user")).rejects.toThrow(guidance)
    }
    process.env.GH_TOKEN = "invalid-test-token"
    spawn.mockImplementation(() => result("", "Bad credentials (HTTP 401)", 1))
    await expect(githubTransport.json("user")).rejects.toThrow("Update or unset GH_TOKEN")
  } finally {
    spawn.mockRestore()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("a missing gh executable gives installation and login instructions", async () => {
  const githubTransport = createGitHubTransport()
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
    throw Object.assign(new Error("Executable not found"), { code: "ENOENT" })
  })
  const which = spyOn(Bun, "which").mockReturnValue(null)
  try {
    await expect(githubTransport.json("user")).rejects.toThrow("GitHub CLI (gh) was not found on PATH")
    await expect(repositoryFromDirectory("/repo")).rejects.toThrow("gh auth login --hostname github.com")
  } finally {
    spawn.mockRestore()
    which.mockRestore()
  }
})

test("unsafe API endpoints and anonymous-page destinations never reach the network", async () => {
  const transport = createGitHubTransport()
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => result())
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => new Response("public page"), { preconnect() {} }))
  try {
    for (const path of ["https://evil.invalid/api", "http://localhost/api", "//evil.invalid/api", "--hostname=evil.invalid",
      "repos/a/../issues", "repos/a/%2e%2e/issues", "repos/a/%2f..%2fissues", "repos\\a\\b", "repos/a/b#fragment"]) {
      await expect(transport.json(path)).rejects.toThrow("endpoint")
      await expect(transport.mutate!(path, "POST", { body: "private" })).rejects.toThrow("endpoint")
    }
    for (const url of ["https://evil.invalid/repo", "http://github.com/owner/repo", "https://user:password@github.com/owner/repo"])
      await expect(transport.page!(url)).rejects.toThrow("GitHub.com")
    expect(spawn).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(await transport.page!("https://github.com/owner/repo")).toBe("public page")
    const options = fetch.mock.calls[0]?.[1]
    expect(options?.redirect).toBe("error")
    const headers = new Headers(options?.headers)
    expect(headers.has("Authorization")).toBe(false)
    expect(headers.has("Cookie")).toBe(false)
  } finally {
    spawn.mockRestore()
    fetch.mockRestore()
  }
})

test("cancelling an initial request stops waiting without killing another caller's identity probe", async () => {
  const transport = createGitHubTransport()
  const controller = new AbortController()
  const reason = new Error("Diff cancelled")
  let finishProbe!: () => void
  const exited = new Promise<number>((resolve) => { finishProbe = () => resolve(0) })
  let kills = 0
  const endpoints: string[] = []
  const spawn = spyOn(Bun, "spawn").mockImplementation((args) => {
    const endpoint = (args as string[])[4]!
    endpoints.push(endpoint)
    return endpoint === "user"
      ? { ...result('{"id":1,"login":"viewer"}'), exited, kill() { kills++ } } as unknown as Bun.Subprocess
      : result("patch")
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  let retained: Promise<string> | undefined
  try {
    const cancelled = transport.text("repos/owner/repo/commits/old", undefined, { signal: controller.signal })
    retained = transport.text("repos/owner/repo/commits/new")
    const rejected = cancelled.then(() => false, (error) => { expect(error).toBe(reason); return true })
    controller.abort(reason)
    const deadline = new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), 200) })
    expect(await Promise.race([rejected, deadline])).toBe(true)
    expect(endpoints).toEqual(["user"])
    expect(kills).toBe(0)
    finishProbe()
    expect(await retained).toBe("patch")
    expect(endpoints).toEqual(["user", "repos/owner/repo/commits/new"])
  } finally {
    clearTimeout(timeout)
    finishProbe()
    await retained?.catch(() => {})
    spawn.mockRestore()
  }
})

test("initial login failures are retryable but changed accounts cannot send writes or GraphQL requests", async () => {
  const transport = createGitHubTransport()
  let authenticated = false
  let account = 1
  const endpoints: string[] = []
  const spawn = spyOn(Bun, "spawn").mockImplementation((args) => {
    const endpoint = (args as string[])[4]!
    endpoints.push(endpoint)
    if (!authenticated) return result("", "Bad credentials (HTTP 401)", 1)
    return result(JSON.stringify(endpoint === "user" ? { id: account, login: `viewer${account}` } : { ok: true }))
  })
  try {
    await expect(transport.json("repos/owner/repo")).rejects.toBeInstanceOf(GitHubApiError)
    authenticated = true
    expect(await transport.json<{ ok: boolean }>("repos/owner/repo")).toEqual({ ok: true })
    endpoints.length = 0
    account = 2
    await expect(transport.mutate!("repos/owner/repo/issues/1/comments", "POST", { body: "private" })).rejects.toBeInstanceOf(GitHubRequestNotSentError)
    await expect(transport.graphql!("mutation { harmlessPlaceholder }", {})).rejects.toThrow("account changed")
    expect(endpoints).toEqual(["user", "user"])
    account = 1
    expect(await transport.mutate!<{ ok: boolean }>("repos/owner/repo/issues/1/comments", "POST", { body: "private" })).toEqual({ ok: true })
    expect(endpoints).toEqual(["user", "user", "user", "repos/owner/repo/issues/1/comments"])
  } finally {
    spawn.mockRestore()
  }
})
