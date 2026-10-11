import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { copyToHostClipboard } from "../src/clipboard"

const envKeys = ["SSH_TTY", "SSH_CONNECTION", "SSH_CLIENT", "WAYLAND_DISPLAY", "WAYLAND_SOCKET", "XDG_SESSION_TYPE", "DISPLAY"]
const platform = Object.getOwnPropertyDescriptor(process, "platform")!
let savedEnv: Record<string, string | undefined>
let which: ReturnType<typeof spyOn<typeof Bun, "which">>
let spawn: ReturnType<typeof spyOn<typeof Bun, "spawn">>

beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  for (const key of envKeys) delete process.env[key]
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" })
  which = spyOn(Bun, "which").mockReturnValue("/fake/pbcopy")
  // Never let any test invoke the real clipboard, even if its setup is wrong.
  spawn = spyOn(Bun, "spawn").mockImplementation(() => {
    throw new Error("Unexpected clipboard spawn")
  })
})

afterEach(() => {
  which.mockRestore()
  spawn.mockRestore()
  Object.defineProperty(process, "platform", platform)
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

function fakeChild(exited: Promise<number>, kill = () => {}) {
  return { exited, kill } as unknown as Bun.Subprocess
}

test("passes literal UTF-8 stdin and waits for successful completion", async () => {
  let finish!: (code: number) => void
  spawn.mockReturnValue(fakeChild(new Promise((resolve) => { finish = resolve })))
  const text = "héllo 世界\n$(not-a-shell-command) ' \""
  let completed = false
  const copying = copyToHostClipboard(text).then((result) => { completed = true; return result })
  await Promise.resolve()
  expect(completed).toBe(false)
  expect(which).toHaveBeenCalledWith("pbcopy")
  expect(spawn).toHaveBeenCalledWith(["/fake/pbcopy"], {
    stdin: new TextEncoder().encode(text), stdout: "ignore", stderr: "ignore",
  })
  finish(0)
  expect(await copying).toBe(true)
})

test("skips all native tools over SSH and returns false when unavailable", async () => {
  for (const key of ["SSH_TTY", "SSH_CONNECTION", "SSH_CLIENT"]) {
    process.env[key] = "remote"
    expect(await copyToHostClipboard("text")).toBe(false)
    delete process.env[key]
  }
  expect(which).not.toHaveBeenCalled()
  which.mockReturnValue(null)
  expect(await copyToHostClipboard("text")).toBe(false)
  expect(spawn).not.toHaveBeenCalled()
})

test("Linux selects available desktop tools in preference order", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" })
  expect(await copyToHostClipboard("text")).toBe(false)
  expect(which).not.toHaveBeenCalled()
  process.env.WAYLAND_DISPLAY = "wayland-0"
  process.env.DISPLAY = ":0"
  spawn.mockImplementation(() => fakeChild(Promise.resolve(0)))
  for (const [available, args] of [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
  ] as const) {
    which.mockImplementation((command) => command === available ? `/fake/${command}` : null)
    expect(await copyToHostClipboard("text")).toBe(true)
    expect(spawn.mock.calls.at(-1)?.[0]).toEqual([`/fake/${available}`, ...args])
  }
})

test("nonzero exit rejects instead of reporting success", async () => {
  spawn.mockReturnValue(fakeChild(Promise.resolve(7)))
  await expect(copyToHostClipboard("text")).rejects.toThrow("pbcopy failed (exit code 7)")
})

test("shutdown kills active copies and prevents new ones", async () => {
  // Isolate the permanent shutdown state from other tests importing the service.
  const modulePath = "../src/clipboard.ts?shutdown-test"
  const clipboard = await import(modulePath)
  let finish!: (code: number) => void
  let killed = false
  const exited = new Promise<number>((resolve) => { finish = resolve })
  spawn.mockReturnValue(fakeChild(exited, () => { killed = true; finish(137) }))
  const copying = clipboard.copyToHostClipboard("text").catch((error: Error) => error)
  await clipboard.stopClipboardProcesses()
  expect(await copying).toBeInstanceOf(Error)
  expect((await copying as Error).message).toContain("exit code 137")
  expect(killed).toBe(true)
  await expect(clipboard.copyToHostClipboard("text")).rejects.toThrow("shutting down")
  expect(spawn).toHaveBeenCalledTimes(1)
})

test("timeout kills the process and rejects", async () => {
  let finish!: (code: number) => void
  let killed = false
  const exited = new Promise<number>((resolve) => { finish = resolve })
  spawn.mockReturnValue(fakeChild(exited, () => { killed = true; finish(137) }))
  await expect(copyToHostClipboard("text")).rejects.toThrow("pbcopy timed out after 3 seconds")
  expect(killed).toBe(true)
})
