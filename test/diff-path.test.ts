import { expect, test } from "bun:test"
import { fitDiffPath } from "../src/ui/diff-path"

test("sidebar paths preserve the filename and shorten directory context first", () => {
  expect(fitDiffPath("src/very-long-directory/important.test.ts", 26)).toBe(".../important.test.ts")
  expect(fitDiffPath("src/nested/important.test.ts", 24)).toBe(".../important.test.ts")
  expect(fitDiffPath("src/nested/important.test.ts", 30)).toBe("src/nested/important.test.ts")
  expect(fitDiffPath("src/nested/important.test.ts", 17)).toBe("important.test.ts")
  expect(fitDiffPath("src/nested/important.test.ts", 8)).toBe("impor...")
})

test("path fitting measures Unicode cells without splitting a grapheme", () => {
  const path = "folder/界面/👩‍💻-café.ts"
  for (let width = 1; width <= 26; width++) {
    const display = fitDiffPath(path, width)
    expect(Bun.stringWidth(display)).toBeLessThanOrEqual(width)
    expect(display).not.toContain("\ufffd")
  }
  expect(fitDiffPath(path, Bun.stringWidth("👩‍💻-café.ts"))).toBe("👩‍💻-café.ts")
})
