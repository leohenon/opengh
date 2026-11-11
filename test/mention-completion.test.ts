import { expect, test } from "bun:test"
import { detectMention, mentionCursorIndex, mergeMentionUsers } from "../src/ui/mention-completion"

test("detects prose mentions at the caret and replaces the whole containing username", () => {
  for (const prefix of ["", "Hello ", "(ping ", "界 ", "🙂 ", "one\ntwo "]) {
    const text = `${prefix}@alICE!`
    expect(detectMention(text, prefix.length + 3)).toEqual({ start: prefix.length, end: prefix.length + 6, query: "al" })
  }
  expect(detectMention("@", 1)).toEqual({ start: 0, end: 1, query: "" })
  expect(detectMention("Hello @a-b", 10)?.query).toBe("a-b")
})

test("does not complete emails, URLs, escaped mentions, code or invalid/oversized tokens", () => {
  for (const text of ["user@ali", "person.name@ali", "https://user:@ali", "\\@ali", "    @ali", "`code @ali", "``code ` @ali", "`code\n@ali", "```ts\n@ali", "~~~\n@ali", "@" + "a".repeat(40), "@@ali", "@ali_", "@ali/"]) {
    expect(detectMention(text, text.length)).toBeUndefined()
  }
  expect(detectMention("`code` @ali", 11)?.query).toBe("ali")
  const closed = "```ts\ncode\n```\n@ali"
  expect(detectMention(closed, closed.length)?.query).toBe("ali")
  const tilde = "~~~\n`code\n~~~\n@ali"
  expect(detectMention(tilde, tilde.length)?.query).toBe("ali")
  expect(detectMention("@ali", -1)).toBeUndefined()
  expect(detectMention("@ali", 100)).toBeUndefined()
})

test("maps UTF-16 cursor indices using native grapheme widths, tabs and newline offsets", () => {
  const text = "界\t👩‍💻 @ali\nsecond @bob"
  const measure = (value: string) => value === "\t" ? 4 : Bun.stringWidth(value)
  expect(mentionCursorIndex(text, 0, 13, measure)).toBe(text.indexOf("\n"))
  expect(mentionCursorIndex(text, 1, 11, measure)).toBe(text.length)
  expect(mentionCursorIndex(text, 0, 3, measure)).toBeUndefined()
  expect(mentionCursorIndex(text, 2, 0, measure)).toBeUndefined()
  expect(mentionCursorIndex("é @a", 0, 4, measure)).toBe("é @a".length)
})

test("prioritizes matching participants, deduplicates safely and bounds remote suggestions", () => {
  expect(mergeMentionUsers(["Alice", "alex", "bob", "alice", "bad name"], ["ALICE", "albert", "jane"], "al"))
    .toEqual(["Alice", "alex", "albert", "jane"])
  expect(mergeMentionUsers([], Array.from({ length: 40 }, (_, i) => `user${i}`), "")).toHaveLength(30)
  expect(mergeMentionUsers(["dependabot[bot]", "-bad"], [], "")).toEqual(["dependabot[bot]"])
})

test("replacement ranges include an existing bot suffix without counting it against the login limit", () => {
  const text = "Ping @dependabot[bot]!"
  for (const cursor of [8, text.indexOf("[bot]")]) {
    const token = detectMention(text, cursor)!
    expect(token.start).toBe(5)
    expect(token.end).toBe(text.length - 1)
    expect(text.slice(0, token.start) + "@dependabot[bot]" + text.slice(token.end)).toBe(text)
  }
  const maximum = `@${"a".repeat(39)}[BoT]`
  expect(detectMention(maximum, 40)?.end).toBe(maximum.length)
})
