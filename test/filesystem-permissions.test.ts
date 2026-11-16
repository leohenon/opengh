import { expect, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureTrustedDirectory, isPrivateGroup } from "../src/filesystem"

const user = { uid: 1000, gid: 1000, username: "ada" }
const groups = (members = "") => [["ada", "x", "1000", members]]
const users = (...extra: string[][]) => [["ada", "x", "1000", "1000", "", "/home/ada", "/bin/sh"], ...extra]

test("a user private group trusts group-writable directories", () => {
  expect(isPrivateGroup(1000, user, groups(), users())).toBe(true)
  expect(isPrivateGroup(1000, user, groups("ada"), users())).toBe(true)
})

test("shared or unknown groups do not trust group-writable directories", () => {
  // Not the user's primary group.
  expect(isPrivateGroup(1001, user, [["staff", "x", "1001", ""]], users())).toBe(false)
  // Another supplementary member.
  expect(isPrivateGroup(1000, user, groups("ada,bob"), users())).toBe(false)
  // Another account with the same primary group.
  expect(isPrivateGroup(1000, user, groups(), users(["bob", "x", "1001", "1000"]))).toBe(false)
  // The group cannot be resolved.
  expect(isPrivateGroup(1000, user, [], users())).toBe(false)
})

test.skipIf(process.platform === "win32")("world-writable directories are always rejected with a fix", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengh-permissions-"))
  try {
    await chmod(directory, 0o777)
    await expect(ensureTrustedDirectory(join(directory, "nested"))).rejects.toThrow("chmod go-w")
    await chmod(directory, 0o700)
    await ensureTrustedDirectory(join(directory, "nested"))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
