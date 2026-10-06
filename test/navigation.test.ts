import { describe, expect, test } from "bun:test"
import { back, navigate, openDetail, type NavigationState } from "../src/navigation"

describe("navigation", () => {
  test("page navigation clears details", () => {
    const state: NavigationState = { page: "issues", detail: { kind: "issue", number: 42 } }
    expect(navigate(state, "commits")).toEqual({ page: "commits" })
  })

  test("detail targets select their owning pages", () => {
    expect(openDetail({ page: "overview" }, { kind: "commit", sha: "abc" }).page).toBe("commits")
    expect(openDetail({ page: "overview" }, { kind: "issue", number: 1 }).page).toBe("issues")
    expect(openDetail({ page: "overview" }, { kind: "pull", number: 2 }).page).toBe("pulls")
    expect(openDetail({ page: "overview" }, { kind: "run", id: 3 }).page).toBe("actions")
  })

  test("back clears details and is otherwise a no-op", () => {
    expect(back({ page: "issues", detail: { kind: "issue", number: 42 } })).toEqual({ page: "issues" })
    const state: NavigationState = { page: "issues" }
    expect(back(state)).toBe(state)
  })
})
