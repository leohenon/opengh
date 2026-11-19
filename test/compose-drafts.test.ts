import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createComposeDrafts, createComposeDraftStorage, type ComposeDraftStorage } from "../src/compose-drafts"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), "opengh-compose-drafts-"))
  directories.push(directory)
  return join(directory, "drafts")
}

describe("compose drafts", () => {
  test("saves per repository ID, reloads in a new instance, and removes the file when cleared", async () => {
    const directory = temporary()
    const drafts = createComposeDrafts({ storage: createComposeDraftStorage(directory), delay: 1 })
    expect(await drafts.load({ repositoryId: 123 })).toEqual({ title: "", body: "" })
    drafts.set({ repositoryId: 123 }, { title: " Crash ", body: "Steps\n" })
    drafts.set({ repositoryId: 456 }, { title: "Other", body: "" })
    await drafts.flush()
    expect(readdirSync(directory).sort()).toEqual(["123.json", "456.json"])

    const reopened = createComposeDrafts({ storage: createComposeDraftStorage(directory) })
    expect(await reopened.load({ repositoryId: 123 })).toEqual({ title: " Crash ", body: "Steps\n" })
    reopened.set({ repositoryId: 123 }, { title: "", body: "" })
    await reopened.flush()
    expect(readdirSync(directory)).toEqual(["456.json"])
    expect(await createComposeDrafts({ storage: createComposeDraftStorage(directory) }).load({ repositoryId: 123 })).toEqual({
      title: "",
      body: "",
    })
  })

  test("keeps a separate draft per head branch", async () => {
    const directory = temporary()
    const drafts = createComposeDrafts({ storage: createComposeDraftStorage(directory), delay: 1 })
    drafts.set({ repositoryId: 123, head: "feature/a" }, { title: "A", body: "" })
    drafts.set({ repositoryId: 123, head: "feature/b" }, { title: "B", body: "" })
    drafts.set({ repositoryId: 123 }, { title: "Issue", body: "" })
    await drafts.flush()
    const hash = (head: string) => createHash("sha256").update(head).digest("hex")
    expect(readdirSync(directory).sort()).toEqual(["123.json", `123-${hash("feature/a")}.json`, `123-${hash("feature/b")}.json`].sort())
    const reopened = createComposeDrafts({ storage: createComposeDraftStorage(directory) })
    expect(await reopened.load({ repositoryId: 123, head: "feature/a" })).toEqual({ title: "A", body: "" })
    expect(await reopened.load({ repositoryId: 123, head: "feature/b" })).toEqual({ title: "B", body: "" })
    expect(await reopened.load({ repositoryId: 123, head: "feature/c" })).toEqual({ title: "", body: "" })
  })

  test("refuses invalid repository IDs and blank branch names", async () => {
    const storage = createComposeDraftStorage(temporary())
    for (const repositoryId of [0, -1, 1.5, Number.NaN])
      await expect(storage.load({ repositoryId })).rejects.toThrow("Repository ID must be a positive safe integer.")
    await expect(storage.load({ repositoryId: 123, head: "" })).rejects.toThrow("Branch name must not be blank.")
  })

  test("keeps failed saves in memory, reports them, and retries on the next flush", async () => {
    let failing = true
    const saved: string[] = []
    const storage: ComposeDraftStorage = {
      load: async () => undefined,
      save: async (_key, draft) => {
        if (failing) throw new Error("disk full")
        saved.push(draft.title)
      },
      remove: async () => {},
    }
    const drafts = createComposeDrafts({ storage, delay: 1000 })
    drafts.set({ repositoryId: 123 }, { title: "Crash", body: "" })
    await expect(drafts.flush()).rejects.toThrow("disk full")
    expect(drafts.error()).toContain("Draft was not saved; it is kept in memory: disk full")
    expect(await drafts.load({ repositoryId: 123 })).toEqual({ title: "Crash", body: "" })
    failing = false
    await drafts.flush()
    expect(saved).toEqual(["Crash"])
    expect(drafts.error()).toBeUndefined()
  })

  test("reports an unreadable draft and starts empty", async () => {
    const drafts = createComposeDrafts({
      storage: {
        load: async () => {
          throw new Error("Invalid saved draft")
        },
        save: async () => {},
        remove: async () => {},
      },
    })
    expect(await drafts.load({ repositoryId: 123 })).toEqual({ title: "", body: "" })
    expect(drafts.error()).toBe("Draft could not be loaded: Invalid saved draft")
  })
})
