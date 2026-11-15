import { expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import { choosePage } from "../src/page-menu"

function fixture() {
  const input = Object.assign(new PassThrough(), { isTTY: true })
  const output = Object.assign(new PassThrough(), { isTTY: true })
  let text = ""
  output.on("data", (chunk) => {
    text += chunk.toString()
  })
  return { input, output, text: () => text }
}

for (const [index, page] of (["overview", "issues", "pulls", "commits", "actions"] as const).entries()) {
  test(`shell menu opens ${page} immediately after pressing ${index + 1}`, async () => {
    const view = fixture()
    const result = choosePage(view.input, view.output)
    expect(view.text()).toStartWith("1  Overview\n")
    expect(view.text()).not.toContain("Choose [1-5]")
    expect(view.text()).toContain("5  Actions")
    expect(view.text()).not.toContain("\x1b[?1049h")
    view.input.write(`${index + 1}`)
    expect(await result).toBe(page)
    expect(view.text()).toEndWith("5  Actions\n\n")
    await Bun.sleep(0)
    expect(view.input.listenerCount("keypress")).toBe(0)
  })
}

test("invalid choices reprompt instead of opening a page", async () => {
  const view = fixture()
  const result = choosePage(view.input, view.output)
  view.input.write("9\r")
  expect(view.text()).toContain("Choose a number from 1 to 5.")
  view.input.write("2")
  expect(await result).toBe("issues")
})

for (const key of ["\r", "\x1b", "\x03", "\x04"]) {
  test(`shell menu cancels on ${JSON.stringify(key)}`, async () => {
    const view = fixture()
    const result = choosePage(view.input, view.output)
    view.input.write(key)
    expect(await result).toBeUndefined()
    await Bun.sleep(0)
    expect(view.input.listenerCount("keypress")).toBe(0)
  })
}

test("shell menu rejects noninteractive input without printing a menu", async () => {
  const view = fixture()
  view.input.isTTY = false
  await expect(choosePage(view.input, view.output)).rejects.toThrow("requires a terminal")
  expect(view.text()).toBe("")
})
