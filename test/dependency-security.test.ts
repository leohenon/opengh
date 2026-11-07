import { expect, test } from "bun:test"
import { dirname, join } from "node:path"
import { runInNewContext } from "node:vm"
import { quote } from "shell-quote"

test("shell quoting rejects comment/newline injection in installed and bundled dependencies", async () => {
  const root = dirname(Bun.resolveSync("hunkdiff/package.json", import.meta.dir))
  const source = await Bun.file(join(root, "dist/npm/main.js")).text()
  const start = source.indexOf("// node_modules/shell-quote/quote.js")
  const end = source.indexOf("// node_modules/shell-quote/parse.js", start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  // Load only the dependency's quote module, not the standalone CLI entry point.
  const bundledQuote = runInNewContext(`${source.slice(start, end)}\nrequire_quote()`, {
    __commonJS: (factory: (exports: object, module: { exports: unknown }) => void) => () => {
      const module = { exports: {} }
      factory(module.exports, module)
      return module.exports
    },
  }) as typeof quote
  for (const stringify of [quote, bundledQuote]) {
    expect(stringify(["git", "diff", "a path"])).toBe("git diff 'a path'")
    expect(() => stringify(["echo", "ok", { comment: "x" }, "a\nsecurity-marker;#"]))
      .toThrow("a token after a `comment` must not contain line terminators")
  }
})
