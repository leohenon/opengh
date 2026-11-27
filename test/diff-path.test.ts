import { expect, test } from "bun:test"
import { fitDiffPath, fitRename } from "../src/ui/diff-path"
import { fitMiddle } from "../src/ui/format"

test("sidebar paths preserve the filename and shorten directory context first", () => {
  expect(fitDiffPath("src/very-long-directory/important.test.ts", 26)).toBe(".../important.test.ts")
  expect(fitDiffPath("src/nested/important.test.ts", 24)).toBe(".../important.test.ts")
  expect(fitDiffPath("src/nested/important.test.ts", 30)).toBe("src/nested/important.test.ts")
  expect(fitDiffPath("src/nested/important.test.ts", 17)).toBe("important.test.ts")
  expect(fitDiffPath("src/nested/important.test.ts", 8)).toBe("i...t.ts")
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

test("file names too long for the width keep both ends, so similar names stay distinct", () => {
  const names = [12, 13].map((number) => fitDiffPath(`src/components/VeryDescriptiveComponentNameNumber${number}.tsx`, 28))
  expect(names).toEqual(["VeryDescript...eNumber12.tsx", "VeryDescript...eNumber13.tsx"])
  for (const name of names) expect(Bun.stringWidth(name)).toBeLessThanOrEqual(28)
  expect(fitMiddle("abcdefghij", 7)).toBe("ab...ij")
  expect(fitMiddle("short", 10)).toBe("short")
  expect(fitMiddle("anything", 2)).toBe("..")
})

test("renames keep the arrow and both file names", () => {
  expect(fitRename("test/keys.test.ts", "test/input.test.ts", 60)).toBe("test/keys.test.ts → test/input.test.ts")
  expect(fitRename("test/keys.test.ts", "test/input.test.ts", 30)).toBe("keys.test.ts → input.test.ts")
  const long = fitRename(
    "packages/application-frontend/src/legacy/NotificationRendererImplementation.tsx",
    "packages/application-frontend/src/features/NotificationPreferencesModernPanelRendererImplementation.new.tsx",
    70,
  )
  expect(long).toContain(" → ")
  expect(long).toEndWith(".new.tsx")
  expect(Bun.stringWidth(long)).toBeLessThanOrEqual(70)
  expect(fitRename("a/old-name.ts", "a/new-name.ts", 12)).toBe("new-name.ts")
})
