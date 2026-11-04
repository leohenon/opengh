import { expect, spyOn, test } from "bun:test"
import { repositoryFromDirectory } from "../src/github/repository"
import { GitHubRequestScheduler } from "../src/github/request-scheduler"
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

test("API requests pin GitHub.com and distinguish authentication and permissions", async () => {
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
    expect(spawn.mock.calls[0]?.[0]).toEqual(["gh", "api", "--hostname", "github.com", "user", "--include"])
    const env = (spawn.mock.calls[0]?.[1] as { env: NodeJS.ProcessEnv }).env
    expect(env.GH_HOST).toBe("github.com")
    expect(env.GH_PROMPT_DISABLED).toBe("1")
    for (const key of keys.slice(3)) expect(env[key]).toBeUndefined()
    for (const [message, code, guidance] of [
      ["Bad credentials (HTTP 401)", 1, "gh auth login --hostname github.com"],
      ["Authentication required", 4, "gh auth login --hostname github.com"],
      ["Resource not accessible by personal access token (HTTP 403)", 1, "token permissions"],
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

test("read-only GraphQL skips redundant probes but changed accounts cannot send REST or GraphQL mutations", async () => {
  const scheduler = new GitHubRequestScheduler()
  const transport = createGitHubTransport(scheduler)
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
    for (const query of ["query { viewer { login } }", "  { viewer { login } }"])
      expect(await transport.graphql!<{ ok: boolean }>(query, {})).toEqual({ ok: true })
    expect(endpoints).toEqual(["graphql", "graphql"])
    endpoints.length = 0
    await expect(transport.mutate!("repos/owner/repo/issues/1/comments", "POST", { body: "private" })).rejects.toBeInstanceOf(GitHubRequestNotSentError)
    for (const query of ["mutation { harmlessPlaceholder }", "# comment\nmutation { harmlessPlaceholder }", "query Read { viewer { login } } mutation Write { harmlessPlaceholder }"])
      await expect(transport.graphql!(query, {})).rejects.toThrow("account changed")
    expect(endpoints).toEqual(["user", "user", "user", "user"])
    account = 1
    expect(await transport.mutate!<{ ok: boolean }>("repos/owner/repo/issues/1/comments", "POST", { body: "private" })).toEqual({ ok: true })
    expect(await transport.graphql!<{ ok: boolean }>("mutation { harmlessPlaceholder }", {})).toEqual({ ok: true })
    expect(endpoints.slice(4)).toEqual(["user", "repos/owner/repo/issues/1/comments", "user", "graphql"])
    await transport.graphql!("query { viewer { login } }", { query: "mutation { harmlessPlaceholder }" })
    const args = spawn.mock.calls.at(-1)![0] as string[]
    expect(args).toContain("query=query { viewer { login } }")
    expect(args).not.toContain("query=mutation { harmlessPlaceholder }")

    const release = Promise.withResolvers<void>(), started = Promise.withResolvers<void>()
    let active = 0
    const occupied = Array.from({ length: 4 }, () => scheduler.run("read", () => {
      if (++active === 4) started.resolve()
      return release.promise
    }))
    await started.promise
    endpoints.length = 0
    const queued = transport.mutate!("repos/owner/repo/issues/1/comments", "POST", { body: "private" }).catch(error => error)
    try {
      await Promise.resolve()
      expect(endpoints).toEqual([])
      account = 2
    } finally { release.resolve() }
    await Promise.all(occupied)
    expect(await queued).toBeInstanceOf(GitHubRequestNotSentError)
    expect(endpoints).toEqual(["user"])
    spawn.mockImplementation(() => result("", "Request timed out", 1))
    await expect(transport.mutate!("repos/owner/repo/issues/1/comments", "POST", { body: "private" })).rejects.toBeInstanceOf(GitHubRequestNotSentError)
  } finally {
    spawn.mockRestore()
  }
})

function apiResult(body: unknown, headers: Record<string, string> = {}, status = 200, error = "", code = 0) {
  const text = typeof body === "string" ? body : JSON.stringify(body)
  return result(`HTTP/2.0 ${status}\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}\r\n`).join("")}\r\n${text}`, error, code)
}

test("API response headers are removed without changing raw or jq output and size limits", async () => {
  const transport = createGitHubTransport(new GitHubRequestScheduler())
  const patch = "diff --git a/file b/file\n+hello\n\n"
  const spawn = spyOn(Bun, "spawn").mockImplementation((args) => (args as string[])[4] === "user"
    ? apiResult({ id: 1, login: "viewer" })
    : apiResult(patch, { "X-Ratelimit-Remaining": "100" }))
  try {
    expect(await transport.text("repos/o/r/commits/sha", "application/vnd.github.diff", { maxBytes: Buffer.byteLength(patch) })).toBe(patch)
    await expect(transport.text("repos/o/r/commits/sha", undefined, { maxBytes: 1 })).rejects.toThrow("viewing limit")
    spawn.mockImplementation(() => apiResult('{"head":"abc","base":"def"}\n'))
    expect(await transport.text("repos/o/r/pulls/1", undefined, { jq: "{head: .head.sha, base: .base.sha}" })).toBe('{"head":"abc","base":"def"}\n')
    expect(spawn.mock.calls.at(-1)![0]).toContain("--jq")
  } finally { spawn.mockRestore() }
})

test("exhausted budgets pause polling, GraphQL, and pages across transports until reset", async () => {
  const scheduler = new GitHubRequestScheduler()
  const transport = createGitHubTransport(scheduler)
  const other = createGitHubTransport(scheduler)
  let now = 1_800_000_000_000
  const clock = spyOn(Date, "now").mockImplementation(() => now)
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => apiResult({ id: 1, login: "viewer" }))
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => new Response("page"), { preconnect() {} }))
  try {
    await transport.json("repos/o/r")
    spawn.mockImplementation(() => apiResult({ ok: true }, {
      "X-Ratelimit-Remaining": "0", "X-Ratelimit-Reset": String(now / 1000 + 120),
    }))
    expect(await transport.json<{ ok: boolean }>("repos/o/r/actions/runs/1")).toEqual({ ok: true })
    const sent = spawn.mock.calls.length
    for (let poll = 0; poll < 3; poll++) {
      now += 5000
      await expect(transport.json("repos/o/r/actions/runs/1")).rejects.toThrow("paused until")
    }
    await expect(other.graphql!("query { viewer { login } }", {})).rejects.toThrow("paused until")
    await expect(transport.mutate!("repos/o/r/issues/1/comments", "POST", { body: "hello" })).rejects.toThrow("paused until")
    await expect(other.page!("https://github.com/o/r")).rejects.toThrow("paused until")
    expect(spawn.mock.calls.length).toBe(sent)
    expect(fetch).not.toHaveBeenCalled()
    now = 1_800_000_121_001
    spawn.mockImplementation(() => apiResult({ ok: true }, { "x-ratelimit-remaining": "10" }))
    expect(await transport.json<{ ok: boolean }>("repos/o/r/actions/runs/1")).toEqual({ ok: true })
    expect(spawn.mock.calls.length).toBe(sent + 1)
  } finally {
    clock.mockRestore()
    spawn.mockRestore()
    fetch.mockRestore()
  }
})

test("rate-limit failures honor Retry-After, distinguish permission errors, and back off without replaying requests", async () => {
  let now = 1_800_000_000_000
  const clock = spyOn(Date, "now").mockImplementation(() => now)
  const spawn = spyOn(Bun, "spawn")
  try {
    const cases: { body: unknown; status: number; headers: Record<string, string>; seconds: number }[] = [
      { body: {}, status: 429, headers: { "Retry-After": "90" }, seconds: 90 },
      { body: {}, status: 429, headers: { "Retry-After": new Date(now + 90_000).toUTCString() }, seconds: 90 },
      { body: { message: "Secondary rate limit exceeded" }, status: 403, headers: {}, seconds: 60 },
      { body: { message: "API rate limit exceeded" }, status: 403, headers: { "X-Ratelimit-Remaining": "0", "X-Ratelimit-Reset": String(now / 1000 + 120) }, seconds: 121 },
      { body: { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }, status: 200, headers: {}, seconds: 60 },
    ]
    for (const limited of cases) {
      const transport = createGitHubTransport(new GitHubRequestScheduler())
      spawn.mockImplementation(() => apiResult({ id: 1, login: "viewer" }))
      await transport.json("repos/o/r")
      // An ordinary permission error must not start a cooldown.
      spawn.mockImplementation(() => apiResult({ message: "Resource not accessible" }, {}, 403, "Forbidden (HTTP 403)", 1))
      await expect(transport.json("repos/o/r/private")).rejects.toThrow("token permissions")
      const start = now
      spawn.mockImplementation(() => apiResult(limited.body, limited.headers, limited.status, "", limited.status === 200 ? 0 : 1))
      await expect(transport.graphql!("query { viewer { login } }", {})).rejects.toThrow("wait before retrying")
      const sent = spawn.mock.calls.length
      now += limited.seconds * 1000 - 1
      await expect(transport.json("repos/o/r")).rejects.toThrow("paused until")
      expect(spawn.mock.calls.length).toBe(sent)
      now = start + limited.seconds * 1000 + 1
      spawn.mockImplementation(() => apiResult({ ok: true }))
      expect(await transport.json<{ ok: boolean }>("repos/o/r")).toEqual({ ok: true })
      expect(spawn.mock.calls.length).toBe(sent + 1)
      now = 1_800_000_000_000
    }
    const transport = createGitHubTransport(new GitHubRequestScheduler())
    spawn.mockImplementation(() => apiResult({ id: 1, login: "viewer" }))
    await transport.json("repos/o/r")
    spawn.mockImplementation(() => result("", "API rate limit exceeded (HTTP 403)", 1))
    for (const wait of [60_000, 120_000]) {
      await expect(transport.json("repos/o/r")).rejects.toThrow("wait before retrying")
      const sent = spawn.mock.calls.length
      now += wait - 1
      await expect(transport.json("repos/o/r")).rejects.toThrow("paused until")
      expect(spawn.mock.calls.length).toBe(sent)
      now++
    }
  } finally {
    clock.mockRestore()
    spawn.mockRestore()
  }
})

test("the default shared queue caps REST, GraphQL, probes, and pages at four", async () => {
  const first = createGitHubTransport(), second = createGitHubTransport()
  const release = Promise.withResolvers<void>()
  const firstBatch = Promise.withResolvers<void>()
  let started = 0, active = 0, maximum = 0
  const held = () => {
    started++
    maximum = Math.max(maximum, ++active)
    if (started === 4) firstBatch.resolve()
    return release.promise.finally(() => { active-- })
  }
  const spawn = spyOn(Bun, "spawn").mockImplementation((args) => {
    const path = (args as string[])[4]!
    return {
      ...apiResult(path === "user" ? { id: 1, login: "viewer" } : { ok: true }, {}, path === "repos/o/bad" ? 500 : 200),
      exited: held().then(() => path === "repos/o/bad" ? 1 : 0),
    } as unknown as Bun.Subprocess
  })
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => {
    await held()
    return new Response("page")
  }, { preconnect() {} }))
  const pending = [
    first.json("repos/o/bad"), second.graphql!("query { viewer { login } }", {}),
    first.page!("https://github.com/o/r"), second.page!("https://github.com/o/r/wiki"),
    ...Array.from({ length: 6 }, () => first.json("repos/o/r")),
  ]
  const completed = Promise.allSettled(pending)
  try {
    await firstBatch.promise
    expect(started).toBe(4)
    release.resolve()
    const results = await completed
    expect(results.filter(item => item.status === "rejected")).toHaveLength(1)
    expect(maximum).toBe(4)
    expect(active).toBe(0)
  } finally {
    release.resolve()
    await completed
    spawn.mockRestore()
    fetch.mockRestore()
  }
})

test("a newly observed cooldown rejects queued writes as not sent and discards queued polls", async () => {
  const scheduler = new GitHubRequestScheduler()
  const release = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  let active = 0
  const occupied = Array.from({ length: 4 }, () => scheduler.run("read", () => {
    if (++active === 4) started.resolve()
    return release.promise
  }))
  await started.promise
  let sent = 0
  const controller = new AbortController()
  const cancelled = scheduler.run("cancelled", async () => { sent++ }, controller.signal).catch(error => error)
  controller.abort(new Error("cancelled"))
  expect((await cancelled).message).toBe("cancelled")
  const write = scheduler.run("write", async () => { sent++ }, undefined, true)
  const read = scheduler.run("poll", async () => { sent++ })
  const rejectedWrite = write.catch(error => error)
  const rejectedRead = read.catch(error => error)
  scheduler.observe(new Headers({ "retry-after": "120" }), true)
  release.resolve()
  await Promise.all(occupied)
  expect(await rejectedWrite).toBeInstanceOf(GitHubRequestNotSentError)
  expect((await rejectedRead).message).toContain("paused until")
  expect(sent).toBe(0)
})

test("failed response streams retain their slots until gh actually exits", async () => {
  const transport = createGitHubTransport(new GitHubRequestScheduler())
  const release = Promise.withResolvers<number>(), killed = Promise.withResolvers<void>()
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => apiResult({ id: 1, login: "viewer" }))
  let kills = 0
  let pending: Promise<unknown>[] = []
  let next: Promise<string> | undefined
  try {
    await transport.json("repos/o/r")
    spawn.mockImplementation(() => ({
      ...result(),
      stdout: new ReadableStream({ start(controller) { controller.error(new Error("stream failed")) } }),
      exited: release.promise,
      kill() { if (++kills === 4) killed.resolve() },
    }) as unknown as Bun.Subprocess)
    pending = Array.from({ length: 4 }, () => transport.text("repos/o/r/commits/failed").catch(error => error))
    await killed.promise
    const sent = spawn.mock.calls.length
    spawn.mockImplementation(() => apiResult("next"))
    next = transport.text("repos/o/r/commits/next")
    await Promise.resolve()
    await Promise.resolve()
    expect(spawn.mock.calls.length).toBe(sent)
    release.resolve(1)
    for (const error of await Promise.all(pending)) expect((error as Error).message).toBe("stream failed")
    expect(await next).toBe("next")
    expect(spawn.mock.calls.length).toBe(sent + 1)
  } finally {
    release.resolve(1)
    await Promise.allSettled([...pending, ...(next ? [next] : [])])
    spawn.mockRestore()
  }
})
