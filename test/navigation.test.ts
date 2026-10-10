import { describe, expect, test } from "bun:test"
import { back, navigate, openDetail, type NavigationState } from "../src/navigation"

describe("navigation", () => {
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

  test("back clears only the active tab's detail and is otherwise a no-op", () => {
    const commits = openDetail({ page: "commits" }, { kind: "commit", sha: "abc" })
    const issues = openDetail(commits, { kind: "issue", number: 42 })
    const closed = back(issues)
    expect(closed).toEqual({ page: "issues", details: commits.details })
    expect(back(closed)).toBe(closed)
    expect(back(navigate(closed, "commits"))).toEqual({ page: "commits" })
    const state: NavigationState = { page: "issues" }
    expect(back(state)).toBe(state)
  })
})
