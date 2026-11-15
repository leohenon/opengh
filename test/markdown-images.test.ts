import { expect, test } from "bun:test"
import { fitImageFilename, imageFilename } from "../src/ui/markdown-images"

test("image filenames exclude queries and fragments and decode URL paths safely", () => {
  expect(imageFilename("https://example.com/images/screen%20shot.png?token=secret#preview")).toBe("screen shot.png")
  expect(imageFilename("../images/%E7%95%8C.png")).toBe("界.png")
  expect(imageFilename("https://example.com/")).toBe("")
  expect(imageFilename("https://example.com/?filename=not-a-path.png")).toBe("")
  expect(imageFilename("https://example.com/line%0Abreak.png")).toBe("line break.png")
  expect(imageFilename("https://example.com/invalid%zz.png")).toBe("invalid%zz.png")
})

test("filename middle truncation fits terminal columns without splitting graphemes or extensions", () => {
  expect(fitImageFilename("short.png", 9)).toBe("short.png")
  expect(fitImageFilename("long-name.png", 0)).toBe("")
  expect(fitImageFilename("long-name.png", 1)).toBe("…")
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
  for (const name of ["screenshot-of-the-full-review.png", "界".repeat(20) + ".png", "e\u0301".repeat(20) + ".png", "👩‍💻".repeat(20) + ".png"]) {
    const allowed = new Set([...segmenter.segment(name + "…")].map(({ segment }) => segment))
    for (let width = 0; width <= 40; width++) {
      const result = fitImageFilename(name, width)
      expect(Bun.stringWidth(result)).toBeLessThanOrEqual(width)
      for (const { segment } of segmenter.segment(result)) expect(allowed.has(segment)).toBe(true)
      if (width >= 5) expect(result.endsWith(".png")).toBe(true)
      if (width >= Bun.stringWidth(name)) expect(result).toBe(name)
      else if (width) expect(result).toContain("…")
    }
  }
})
