import { expect, test } from "bun:test"
import type { PullReviewThread } from "../src/models"
import { reviewSnippet } from "../src/ui/review-snippet"

const thread: PullReviewThread = {
  kind: "review-thread", id: "thread", path: "example.ts", line: 99, originalLine: 11,
  diffSide: "LEFT", isResolved: false, isOutdated: true,
  comments: [{ id: "root", author: "alice", authorAssociation: "MEMBER", body: "Explain this line",
    createdAt: "2026-01-01", updatedAt: "2026-01-01", url: "https://github.com/o/r/pull/1",
    diffHunk: "@@ -10,3 +20,4 @@\n context\n-old\n+new one\n+new two\n tail\n\\ No newline at end of file" }],
}

test("thread snippets retain historical old/new line numbers and highlight the correct side and range", () => {
  const removed = reviewSnippet(thread)
  expect(removed.find(line => line.highlighted)).toMatchObject({ oldLine: 11, newLine: undefined, text: "old", prefix: "-" })
  const added = reviewSnippet({ ...thread, diffSide: "RIGHT", originalLine: 22, originalStartLine: 21 })
  expect(added.filter(line => line.highlighted).map(line => [line.newLine, line.text])).toEqual([[21, "new one"], [22, "new two"]])
  expect(added.at(-1)).toMatchObject({ newLine: 22, text: "new two" })
  expect(reviewSnippet({ ...thread, diffSide: "RIGHT", originalLine: 20 }).find(line => line.highlighted)?.text).toBe("context")
  expect(reviewSnippet({ ...thread, comments: [] })).toEqual([])
})

test("snippets stay compact around the commented line rather than rendering the entire hunk", () => {
  const diffHunk = "@@ -1,100 +1,100 @@\n" + Array.from({ length: 100 }, (_, index) => ` line ${index + 1}`).join("\n")
  const lines = reviewSnippet({ ...thread, originalLine: 50, comments: [{ ...thread.comments[0]!, diffHunk }] })
  expect(lines.length).toBeLessThanOrEqual(7)
  expect(lines.find(line => line.highlighted)?.oldLine).toBe(50)
})
