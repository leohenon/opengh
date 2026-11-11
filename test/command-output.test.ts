import { expect, test } from "bun:test"
import { createCommandOutputBuffer, MAX_COMMAND_OUTPUT_CHARS, MAX_COMMAND_OUTPUT_LINES } from "../src/command-output"

test("command scrollback sanitizes split escapes and CRLF without retaining control payloads", () => {
  const source = "\x1b[31mred\x1b[0m\r\nnext\rprogress\t界🙂\x1b]0;hidden title\x1b\\end\x1bPprivate\x1b\\!"
  const expected = "red\nnext\nprogress\t界🙂end!"
  for (let split = 0; split <= source.length; split++) {
    const buffer = createCommandOutputBuffer()
    buffer.append(source.slice(0, split))
    expect(buffer.append(source.slice(split))).toBe(expected)
  }
  const buffer = createCommandOutputBuffer()
  buffer.append("visible\x1b]")
  for (let i = 0; i < 50; i++) expect(buffer.append("hidden".repeat(10_000))).toBe("visible")
  expect(buffer.append("\x07done")).toBe("visibledone")
})

test("leading blank lines are preserved until the actual line limit is exceeded", () => {
  for (const text of ["\n", "\nhello", "\nerror\n", "\n".repeat(MAX_COMMAND_OUTPUT_LINES - 1)]) {
    const buffer = createCommandOutputBuffer()
    expect(buffer.append(text)).toBe(text)
    expect(buffer.append("")).toBe(text)
  }
  const buffer = createCommandOutputBuffer()
  expect(buffer.append("\n".repeat(MAX_COMMAND_OUTPUT_LINES))).toBe(
    "[Earlier command output omitted]\n" + "\n".repeat(MAX_COMMAND_OUTPUT_LINES - 1))
})

test("newline-heavy chunks batch retained-tail copies instead of copying per control", () => {
  const original = String.prototype.slice
  let tailCopies = 0
  let output = ""
  // Count the actual retained-buffer slicing work, without a timing assertion
  // or a spy that retains every large intermediate string.
  String.prototype.slice = function (this: string, start?: number, end?: number) {
    if (this.length > MAX_COMMAND_OUTPUT_CHARS && start === -MAX_COMMAND_OUTPUT_CHARS) tailCopies++
    return original.call(this, start, end)
  }
  try { output = createCommandOutputBuffer().append("x\n".repeat(100_000)) }
  finally { String.prototype.slice = original }
  expect(tailCopies).toBeGreaterThan(0)
  expect(tailCopies).toBeLessThan(100)
  expect(output).toStartWith("[Earlier command output omitted]\n")
  expect(output).toEndWith("x\n")
  expect(output.split("\n").length).toBeLessThanOrEqual(MAX_COMMAND_OUTPUT_LINES + 1)
})

test("command scrollback retains a bounded tail and reports omitted output", () => {
  const buffer = createCommandOutputBuffer()
  const output = buffer.append("x".repeat(MAX_COMMAND_OUTPUT_CHARS * 3) + "latest")
  expect(output).toStartWith("[Earlier command output omitted]\n")
  expect(output).toEndWith("latest")
  expect(output.length).toBeLessThanOrEqual(MAX_COMMAND_OUTPUT_CHARS + 40)
  const lines = buffer.append(Array.from({ length: 5_000 }, (_, i) => `${i}\n`).join(""))
  expect(lines.split("\n").length).toBeLessThanOrEqual(MAX_COMMAND_OUTPUT_LINES + 1)
  expect(lines).toEndWith("4999\n")
  expect(lines).not.toContain("\n100\n")
})
