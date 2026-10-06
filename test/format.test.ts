import { describe, expect, test } from "bun:test"
import { fitText } from "../src/ui/format"

describe("terminal text fitting", () => {
  test("marks truncated text with three dots", () => {
    expect(fitText("a long issue title", 10)).toBe("a long ...")
    expect(Bun.stringWidth(fitText("a long issue title", 10))).toBe(10)
  })

  test("keeps complete text unchanged", () => {
    expect(fitText("short", 10)).toBe("short")
  })

  test("accounts for wide characters", () => {
    const fitted = fitText("🤖 automated change", 10)
    expect(Bun.stringWidth(fitted)).toBeLessThanOrEqual(10)
    expect(fitted.endsWith("...")).toBe(true)
  })
})
