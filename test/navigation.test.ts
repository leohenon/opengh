import { describe, expect, test } from "bun:test"
import { atRepositoryEntry, back, navigate, openDetail, openDiff, openPage, type NavigationState } from "../src/navigation"

describe("navigation", () => {
  test("tab switches preserve each diff and back closes only the active tab's diff", () => {
    const origin = openDetail({ page: "commits" }, { kind: "commit", sha: "abc" })
    const diff = openDiff(origin, { kind: "commit", sha: "abc" })
    expect(back(diff)).toEqual(origin)
    const away = navigate(diff, "pulls")
    expect(away.diffs?.commits).toEqual({ kind: "commit", sha: "abc" })
    expect(navigate(away, "commits")).toEqual(diff)
    expect(back(away)).toBe(away)
    const both = openDiff(away, { kind: "pull", number: 42 })
    expect(back(both)).toEqual(away)
    const pullDetail = openDetail(away, { kind: "pull", number: 42 })
    expect(back(pullDetail).diffs).toEqual(diff.diffs)
    const pulls: NavigationState = { page: "pulls" }
    expect(back(openDiff(pulls, { kind: "pull", number: 42 }))).toEqual(pulls)
  })
  test("page navigation retains each tab's detail", () => {
    const state = openDetail({ page: "overview" }, { kind: "commit", sha: "abc" })
    const issues = openDetail(navigate(state, "issues"), { kind: "issue", number: 42 })
    expect(navigate(issues, "commits")).toEqual({
      page: "commits",
      details: { commits: { kind: "commit", sha: "abc" }, issues: { kind: "issue", number: 42 } },
    })
    expect(navigate(state, "commits")).toEqual(state)
  })

  test("detail targets select their owning pages", () => {
    expect(openDetail({ page: "overview" }, { kind: "commit", sha: "abc" }).page).toBe("commits")
    expect(openDetail({ page: "overview" }, { kind: "issue", number: 1 }).page).toBe("issues")
    expect(openDetail({ page: "overview" }, { kind: "pull", number: 2 }).page).toBe("pulls")
    expect(openDetail({ page: "overview" }, { kind: "run", id: 3 }).page).toBe("actions")
  })

  test("back unwinds linked details across kinds and repeated visits to the same tab", () => {
    const targets = [
      { kind: "issue", number: 1 },
      { kind: "issue", number: 2 },
      { kind: "pull", number: 3 },
      { kind: "issue", number: 4 },
      { kind: "commit", sha: "abc" },
    ] as const
    let state: NavigationState = { page: "issues" }
    for (const target of targets) state = openDetail(state, target)
    expect(openDetail(state, { kind: "commit", sha: "abc" })).toBe(state)
    const diff = openDiff(state, { kind: "commit", sha: "abc" })
    expect(back(diff)).toEqual(state)
    for (const target of targets.slice(0, -1).reverse()) {
      state = back(state)
      expect(state.details?.[state.page]).toEqual(target)
    }
    expect(back(state)).toEqual({ page: "issues" })
  })

  test("tab switches retain linked history without adding steps or discarding unrelated tabs", () => {
    const commit = openDetail({ page: "commits" }, { kind: "commit", sha: "abc" })
    const issue = openDetail(navigate(commit, "issues"), { kind: "issue", number: 1 })
    const linked = openDetail(issue, { kind: "pull", number: 2 })
    const run = openDetail(navigate(linked, "actions"), { kind: "run", id: 3 })
    const restored = back(navigate(run, "pulls"))
    expect(restored.page).toBe("issues")
    expect(restored.details?.issues).toEqual({ kind: "issue", number: 1 })
    expect(restored.details?.commits).toEqual({ kind: "commit", sha: "abc" })
    expect(restored.details?.actions).toEqual({ kind: "run", id: 3 })
    expect(back(restored).details?.issues).toBeUndefined()
  })

  test("back clears only the active tab's detail and is otherwise a no-op", () => {
    const commits = openDetail({ page: "commits" }, { kind: "commit", sha: "abc" })
    const issues = openDetail(navigate(commits, "issues"), { kind: "issue", number: 42 })
    const closed = back(issues)
    expect(closed).toEqual({ page: "issues", details: commits.details })
    expect(back(closed)).toBe(closed)
    expect(back(navigate(closed, "commits"))).toEqual({ page: "commits" })
    const state: NavigationState = { page: "issues" }
    expect(back(state)).toBe(state)
  })
  test("linked lists/documents restore their origin after local details unwind", () => {
    const first = openDetail({ page: "issues" }, { kind: "issue", number: 1 })
    const origin = openDetail(first, { kind: "issue", number: 2 })
    const list = openPage(origin, "issues")
    const detail = openDetail(list, { kind: "issue", number: 3 })
    expect(back(detail)).toEqual(list)
    expect(back(back(detail))).toBe(origin)
    expect(back(origin)).toEqual(first)
    const document = openPage(origin, "overview", "readme")
    expect(document.document).toBe("readme")
    expect(back(document)).toBe(origin)
    expect(atRepositoryEntry(origin, origin)).toBe(true)
    expect(atRepositoryEntry(detail, origin)).toBe(false)
    expect(atRepositoryEntry(openDiff(origin, { kind: "pull", number: 3 }), origin)).toBe(false)
  })

})
