import { fileURLToPath } from "node:url"
import { addDefaultParsers } from "@opentui/core"
import bashWasm from "./parsers/bash/tree-sitter-bash.wasm" with { type: "file" }
import bashHighlights from "./parsers/bash/highlights.scm" with { type: "file" }
import diffWasm from "./parsers/diff/tree-sitter-diff.wasm" with { type: "file" }
import diffHighlights from "./parsers/diff/highlights.scm" with { type: "file" }
import jsonWasm from "./parsers/json/tree-sitter-json.wasm" with { type: "file" }
import jsonHighlights from "./parsers/json/highlights.scm" with { type: "file" }
import pythonWasm from "./parsers/python/tree-sitter-python.wasm" with { type: "file" }
import pythonHighlights from "./parsers/python/highlights.scm" with { type: "file" }
import rustWasm from "./parsers/rust/tree-sitter-rust.wasm" with { type: "file" }
import rustHighlights from "./parsers/rust/highlights.scm" with { type: "file" }
import yamlWasm from "./parsers/yaml/tree-sitter-yaml.wasm" with { type: "file" }
import yamlHighlights from "./parsers/yaml/highlights.scm" with { type: "file" }

// Bun emits relative file-import paths when bundling; keep them independent of cwd.
const assetPath = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// Import before the Tree-sitter client initializes. Assets and licenses: ./parsers/README.md.
addDefaultParsers([
  { filetype: "json", wasm: assetPath(jsonWasm), queries: { highlights: [assetPath(jsonHighlights)] } },
  { filetype: "bash", aliases: ["sh", "shell"], wasm: assetPath(bashWasm), queries: { highlights: [assetPath(bashHighlights)] } },
  { filetype: "yaml", aliases: ["yml"], wasm: assetPath(yamlWasm), queries: { highlights: [assetPath(yamlHighlights)] } },
  { filetype: "diff", aliases: ["patch", "udiff"], wasm: assetPath(diffWasm), queries: { highlights: [assetPath(diffHighlights)] } },
  { filetype: "python", aliases: ["py"], wasm: assetPath(pythonWasm), queries: { highlights: [assetPath(pythonHighlights)] } },
  { filetype: "rust", aliases: ["rs"], wasm: assetPath(rustWasm), queries: { highlights: [assetPath(rustHighlights)] } },
])
