import { expect, spyOn, test } from "bun:test"
import { openUrl } from "../src/open-url"

test("opens URLs as process data and rejects unsafe schemes before spawning", async () => {
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => ({
    stderr: new ReadableStream({ start(controller) { controller.close() } }),
    exited: Promise.resolve(0), kill() {},
  }) as unknown as Bun.Subprocess)
  try {
    const url = "https://example.com/?q=';$()&x=1#part"
    await openUrl(url)
    const [command, options] = spawn.mock.calls[0]!
    if (process.platform === "win32") {
      expect(options?.env?.OPENGH_OPEN_URL).toBe(url)
      expect(command).not.toContain(url)
    } else expect(command).toEqual([process.platform === "darwin" ? "open" : "xdg-open", url])
    await expect(openUrl("javascript:alert(1)")).rejects.toThrow("safe absolute")
    expect(spawn).toHaveBeenCalledTimes(1)
  } finally { spawn.mockRestore() }
})
