import { describe, expect, spyOn, test } from "bun:test"
import { ago, calendarDay, fitText } from "../src/ui/format"

test("commit batches keep local calendar-day boundaries", () => {
  const before = new Date(2026, 9, 5, 23, 50).toISOString()
  const after = new Date(2026, 9, 6, 0, 10).toISOString()
  expect(calendarDay(before)).not.toBe(calendarDay(after))
  expect(calendarDay("invalid")).toBe("unknown")
})

test("relative ages retain minute precision instead of showing just now for the entire first hour", () => {
  const now = Date.parse("2026-10-05T12:00:00Z")
  const clock = spyOn(Date, "now").mockReturnValue(now)
  try {
    expect(ago(new Date(now - 30_000).toISOString())).toBe("just now")
    expect(ago(new Date(now - 60_000).toISOString())).toBe("1m ago")
    expect(ago(new Date(now - 59 * 60_000).toISOString())).toBe("59m ago")
    expect(ago(new Date(now - 60 * 60_000).toISOString())).toBe("1h ago")
    expect(ago("invalid")).toBe("Unknown time")
  } finally { clock.mockRestore() }
})

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
