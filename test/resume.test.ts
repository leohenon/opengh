import { expect, test } from "bun:test"
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createResumeWriter, loadResume, resumeLocation, saveResume, type ResumeLocation } from "../src/resume"
import type { NavigationState } from "../src/navigation"

test("resume storage keeps only the active route and ignores missing, corrupt, unsafe, and invalid state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opengh-resume-"))
  const path = join(directory, "resume.json")
  try {
    expect(await loadResume(path)).toBeUndefined()
    const states: NavigationState[] = [
      { page: "overview", document: "readme" },
      { page: "issues", details: { issues: { kind: "issue", number: 42 } } },
      { page: "pulls", details: { pulls: { kind: "pull", number: 12 } }, diffs: { pulls: { kind: "pull", number: 12 } } },
      { page: "commits", diffs: { commits: { kind: "commit", sha: "abc1234" } } },
      { page: "actions", details: { actions: { kind: "run", id: 123 } } },
    ]
    for (const state of states) {
      await saveResume(resumeLocation("owner/repo", { ...state,
        history: { issues: [{ kind: "issue", number: 1 }] }, pageOrigin: { page: "overview", state: { page: "overview" } },
        details: { ...state.details, ...(state.page !== "commits" ? { commits: { kind: "commit", sha: "def5678" } } : {}) },
      }), path)
      expect(await loadResume(path)).toEqual({ repository: "owner/repo", state })
      expect((await lstat(path)).mode & 0o777).toBe(0o600)
    }
    for (const value of ["{broken", "x".repeat(4097), JSON.stringify({ repository: "../bad", state: { page: "overview" } }),
      JSON.stringify({ repository: "owner/repo", state: { page: "constructor" } }),
      JSON.stringify({ repository: "owner/repo", state: { page: "issues", details: { issues: { kind: "issue", number: -1 } } } }),
      JSON.stringify({ repository: "owner/repo", state: { page: "pulls", diffs: { pulls: { kind: "commit", sha: "not-a-hash" } } } }),
    ]) {
      await writeFile(path, value)
      expect(await loadResume(path)).toBeUndefined()
    }
    const target = join(directory, "target.json")
    await writeFile(target, JSON.stringify({ repository: "owner/repo", state: { page: "overview" } }))
    const original = await readFile(target, "utf8")
    await rm(path)
    await symlink(target, path)
    expect(await loadResume(path)).toBeUndefined()
    await expect(saveResume(resumeLocation("owner/repo", { page: "overview" }), path)).rejects.toThrow()
    expect(await readFile(target, "utf8")).toBe(original)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("resume writes coalesce navigation, serialize in-flight updates, and retry failed saves on flush", async () => {
  const saved: ResumeLocation[] = []
  let release!: () => void
  const first = new Promise<void>((resolve) => { release = resolve })
  let fail = false
  const writer = createResumeWriter(async (location) => {
    if (!saved.length) await first
    if (fail) throw new Error("Storage unavailable")
    saved.push(location)
  })
  writer.remember(resumeLocation("owner/repo", { page: "overview" }))
  writer.remember(resumeLocation("owner/repo", { page: "issues" }))
  const pending = writer.flush()
  await Promise.resolve()
  writer.remember(resumeLocation("other/repo", { page: "pulls", diffs: { pulls: { kind: "pull", number: 42 } } }))
  const latest = writer.flush()
  release()
  await Promise.all([pending, latest])
  expect(saved.map((location) => location.repository)).toEqual(["owner/repo", "other/repo"])
  expect(saved[0]!.state.page).toBe("issues")
  expect(saved[1]!.state.diffs?.pulls).toEqual({ kind: "pull", number: 42 })
  writer.remember(saved[1]!)
  await writer.flush()
  expect(saved).toHaveLength(2)
  fail = true
  writer.remember(resumeLocation("owner/repo", { page: "commits" }))
  await writer.flush()
  expect(saved).toHaveLength(2)
  fail = false
  await writer.flush()
  expect(saved.at(-1)).toEqual(resumeLocation("owner/repo", { page: "commits" }))
})
