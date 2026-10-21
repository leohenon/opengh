import { expect, spyOn, test } from "bun:test"
import { openGitHub } from "../src/github/browser"

test("workflow runs use gh run view while existing browse and diff targets stay unchanged", async () => {
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => ({
    stdout: new ReadableStream({ start(controller) { controller.close() } }),
    stderr: new ReadableStream({ start(controller) { controller.close() } }),
    exited: Promise.resolve(0),
    kill() {},
  }) as unknown as Bun.Subprocess)
  try {
    for (const [target, view, args] of [
      ["actions/runs/39596198737", undefined, ["run", "view", "39596198737", "--web"]],
      [undefined, undefined, ["browse"]],
      [42, undefined, ["browse", "42"]],
      ["abcdef123456", undefined, ["browse", "abcdef123456"]],
      [42, "diff", ["pr", "diff", "42", "--web"]],
    ] as const) {
      await openGitHub("owner/repo", target, view)
      expect(spawn.mock.calls.at(-1)?.[0]).toEqual(["gh", ...args, "--repo", "owner/repo"])
    }
  } finally {
    spawn.mockRestore()
  }
})
