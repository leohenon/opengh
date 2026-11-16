import { expect, spyOn, test } from "bun:test"
import { join } from "node:path"
import { GitHubRequestScheduler } from "../src/github/request-scheduler"
import { createGitHubTransport } from "../src/github/transport"
import { createGitHubWrites } from "../src/github/writes"

test("the write tracker settles only once every write, including later ones, has finished", async () => {
  const writes = createGitHubWrites()
  await writes.settled()
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  void writes.track(first.promise)
  expect(writes.active()).toBe(1)
  let settled = false
  void writes.settled().then(() => (settled = true))
  void writes.track(second.promise.catch(() => {}))
  first.resolve()
  await Bun.sleep(0)
  expect(settled).toBe(false)
  second.reject(new Error("rejected writes count as finished"))
  await Bun.sleep(0)
  expect(settled).toBe(true)
  expect(writes.active()).toBe(0)
})

test("the transport tracks writes, not reads", async () => {
  const writes = createGitHubWrites()
  const transport = createGitHubTransport(new GitHubRequestScheduler(), writes)
  const release = Promise.withResolvers<void>()
  const spawn = spyOn(Bun, "spawn").mockImplementation((args) => {
    const endpoint = (args as string[])[4]!
    const body = endpoint === "user" ? '{"id":1,"login":"viewer"}' : '{"ok":true}'
    return {
      stdout: new Response(body).body!,
      stderr: new Response("").body!,
      exited: endpoint.endsWith("/comments") ? release.promise.then(() => 0) : Promise.resolve(0),
      kill() {},
    } as unknown as Bun.Subprocess
  })
  try {
    await transport.json("repos/owner/repo")
    expect(writes.active()).toBe(0)
    const posting = transport.mutate!("repos/owner/repo/issues/1/comments", "POST", { body: "hi" })
    expect(writes.active()).toBe(1)
    release.resolve()
    await posting
    expect(writes.active()).toBe(0)
  } finally {
    spawn.mockRestore()
  }
})

// Shutdown is process-wide, so it runs in a separate process.
test("shutdown stops reads at once but lets writes finish, unless they were abandoned", async () => {
  const script = `
    const { abandonGitHubWrites, spawnGitHub, stopGitHubProcesses } = await import(${JSON.stringify(join(import.meta.dir, "../src/github/process.ts"))})
    const children = []
    Bun.spawn = () => {
      let finish
      const child = { exited: new Promise((resolve) => (finish = resolve)), killed: false, finish, kill() { this.killed = true; finish(137) } }
      children.push(child)
      return child
    }
    const read = spawnGitHub(["api", "read"])
    const write = spawnGitHub(["api", "write"], undefined, "{}", true)
    let stopped = false
    const stopping = stopGitHubProcesses().then(() => (stopped = true))
    await Bun.sleep(10)
    const result = { readKilled: children[0].killed, writeKilled: children[1].killed, stoppedEarly: stopped }
    children[1].finish(0)
    await stopping
    result.writeFinished = !children[1].killed
    console.log(JSON.stringify(result))
  `
  const abandoned = `
    const { abandonGitHubWrites, spawnGitHub, stopGitHubProcesses } = await import(${JSON.stringify(join(import.meta.dir, "../src/github/process.ts"))})
    let killed = false
    Bun.spawn = () => {
      let finish
      return { exited: new Promise((resolve) => (finish = resolve)), kill() { killed = true; finish(137) } }
    }
    spawnGitHub(["api", "write"], undefined, "{}", true)
    abandonGitHubWrites()
    await stopGitHubProcesses()
    console.log(JSON.stringify({ killed }))
  `
  const run = async (source: string) => {
    const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
    return JSON.parse(stdout)
  }
  expect(await run(script)).toEqual({ readKilled: true, writeKilled: false, stoppedEarly: false, writeFinished: true })
  expect(await run(abandoned)).toEqual({ killed: true })
})
