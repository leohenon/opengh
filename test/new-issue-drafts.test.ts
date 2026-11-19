import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNewIssueDrafts, createNewIssueDraftStorage, type NewIssueDraftStorage } from "../src/new-issue-drafts"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), "opengh-new-issue-drafts-"))
  directories.push(directory)
  return join(directory, "drafts")
}

describe("new issue drafts", () => {
  test("saves per repository ID, reloads in a new instance, and removes the file when cleared", async () => {
    const directory = temporary()
    const drafts = createNewIssueDrafts({ storage: createNewIssueDraftStorage(directory), delay: 1 })
    expect(await drafts.load(123)).toEqual({ title: "", body: "" })
    drafts.set(123, { title: " Crash ", body: "Steps\n" })
    drafts.set(456, { title: "Other", body: "" })
    await drafts.flush()
    expect(readdirSync(directory).sort()).toEqual(["123.json", "456.json"])

    const reopened = createNewIssueDrafts({ storage: createNewIssueDraftStorage(directory) })
    expect(await reopened.load(123)).toEqual({ title: " Crash ", body: "Steps\n" })
    reopened.set(123, { title: "", body: "" })
    await reopened.flush()
    expect(readdirSync(directory)).toEqual(["456.json"])
    expect(await createNewIssueDrafts({ storage: createNewIssueDraftStorage(directory) }).load(123)).toEqual({ title: "", body: "" })
  })

  test("refuses invalid repository IDs", async () => {
    const storage = createNewIssueDraftStorage(temporary())
    for (const id of [0, -1, 1.5, Number.NaN])
      await expect(storage.load(id)).rejects.toThrow("Repository ID must be a positive safe integer.")
  })

  test("keeps failed saves in memory, reports them, and retries on the next flush", async () => {
    let failing = true
    const saved: string[] = []
    const storage: NewIssueDraftStorage = {
      load: async () => undefined,
      save: async (_repository, draft) => {
        if (failing) throw new Error("disk full")
        saved.push(draft.title)
      },
      remove: async () => {},
    }
    const drafts = createNewIssueDrafts({ storage, delay: 1000 })
    drafts.set(123, { title: "Crash", body: "" })
    await expect(drafts.flush()).rejects.toThrow("disk full")
    expect(drafts.error()).toContain("Issue draft was not saved; it is kept in memory: disk full")
    expect(await drafts.load(123)).toEqual({ title: "Crash", body: "" })
    failing = false
    await drafts.flush()
    expect(saved).toEqual(["Crash"])
    expect(drafts.error()).toBeUndefined()
  })

  test("reports an unreadable draft and starts empty", async () => {
    const drafts = createNewIssueDrafts({
      storage: {
        load: async () => {
          throw new Error("Invalid saved issue draft")
        },
        save: async () => {},
        remove: async () => {},
      },
    })
    expect(await drafts.load(123)).toEqual({ title: "", body: "" })
    expect(drafts.error()).toBe("Issue draft could not be loaded: Invalid saved issue draft")
  })
})
