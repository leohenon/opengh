# Bundled Markdown code-fence parsers

Import `../markdown-parsers.ts` for its registration side effect **before** a Tree-sitter client initializes. It registers JSON, Bash (`sh`, `shell`), YAML (`yml`), diff (`patch`, `udiff`), Python (`py`), and Rust (`rs`). Bun `type: "file"` imports include the assets in future bundles; paths resolve relative to the importing module, not the working directory. Ship all emitted asset files alongside a Bun JS bundle. No runtime downloads are used for these parsers.

## Pinned upstream assets

All files are unmodified upstream assets. Each directory contains the release WASM, the same tag's `queries/highlights.scm`, and its MIT `LICENSE` (including upstream copyright notices).

| Directory | GitHub repository | Tag |
| --- | --- | --- |
| `json` | [tree-sitter/tree-sitter-json](https://github.com/tree-sitter/tree-sitter-json/tree/v0.24.8) | `v0.24.8` |
| `bash` | [tree-sitter/tree-sitter-bash](https://github.com/tree-sitter/tree-sitter-bash/tree/v0.25.1) | `v0.25.1` |
| `yaml` | [tree-sitter-grammars/tree-sitter-yaml](https://github.com/tree-sitter-grammars/tree-sitter-yaml/tree/v0.7.2) | `v0.7.2` |
| `diff` | [tree-sitter-grammars/tree-sitter-diff](https://github.com/tree-sitter-grammars/tree-sitter-diff/tree/v0.2.0) | `v0.2.0` |
| `python` | [tree-sitter/tree-sitter-python](https://github.com/tree-sitter/tree-sitter-python/tree/v0.25.0) | `v0.25.0` |
| `rust` | [tree-sitter/tree-sitter-rust](https://github.com/tree-sitter/tree-sitter-rust/tree/v0.24.2) | `v0.24.2` |

Exact download URL patterns, substituting the table's `repository`, `tag`, and directory as `language`:

- WASM: `https://github.com/{repository}/releases/download/{tag}/tree-sitter-{language}.wasm`
- Query: `https://raw.githubusercontent.com/{repository}/{tag}/queries/highlights.scm`
- License: `https://raw.githubusercontent.com/{repository}/{tag}/LICENSE`

WASM SHA-256:

```text
json d2119fb98d5912719b13f9458574f8608d2d29dfbe45f6be1f860ea1fe2a2405
bash 8292919c88a0f7d3fb31d0cd0253ca5a9531bc1ede82b0537f2c63dd8abe6a7a
yaml 0a0e5ebcfeb0b2bf272d071396eeed107b2c4b2617b69d5959b13f78b357a4d6
diff 81235a285f2964d33767cc76e9511c6694050b73a099afe4c3e401e5f87f9587
python 16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47
rust 24c89bd9252255e4aebbcbd7d2d308bd92c86dd95a130fdc80efa49577b8d738
```

## Capture keys for syntax styles

Full keys available in the bundled queries (a particular snippet will only emit a subset):

- JSON: `comment`, `constant.builtin`, `escape`, `number`, `string`, `string.special.key`.
- Bash: `comment`, `constant`, `embedded`, `function`, `keyword`, `number`, `operator`, `property`, `string`.
- YAML: `attribute`, `boolean`, `comment`, `constant.builtin`, `label`, `number`, `property`, `punctuation.bracket`, `punctuation.delimiter`, `punctuation.special`, `string`, `type`.
- Diff: `attribute`, `comment`, `constant`, `diff.delta`, `diff.minus`, `diff.plus`, `function`, `keyword`, `label`, `number`, `punctuation.special`, `spell`, `string.special`, `string.special.path`, `variable.parameter`.

- Python: `comment`, `constant`, `constant.builtin`, `constructor`, `embedded`, `escape`, `function`, `function.builtin`, `function.method`, `keyword`, `number`, `operator`, `property`, `punctuation.special`, `string`, `type`, `variable`.
- Rust: `attribute`, `comment`, `comment.documentation`, `constant`, `constant.builtin`, `constructor`, `escape`, `function`, `function.macro`, `function.method`, `keyword`, `label`, `operator`, `property`, `punctuation.bracket`, `punctuation.delimiter`, `string`, `type`, `type.builtin`, `variable.builtin`, `variable.parameter`.

Public `TreeSitterClient.highlightOnce` smoke checks passed with OpenTUI 0.4.5 and Bun 1.3.14, both from source and from a Bun JS bundle run with a different working directory. All four grammars and all five aliases returned nonempty highlights without warnings/errors. The JSON sample emitted every key except `comment`; the unified-diff sample emitted `attribute`, `constant`, `diff.minus`, `diff.plus`, `function`, `keyword`, `number`, `punctuation.special`, `string.special.path`, and `variable.parameter`. Targeted TypeScript checking of the registration module and asset declarations also passed.

Additional source-level `highlightOnce` checks passed with Bun 1.3.14 for Python, `py`, Rust, and `rs`, using a fresh temporary client data directory and no warnings/errors. The actual qdrant README sample was:

```python
from qdrant_client import QdrantClient

client = QdrantClient(url="http://localhost:6333")
```

Both Python names returned identical captures: `constructor`, `function`, `keyword`, `operator`, `string`, `variable`. Rust and `rs` also returned identical captures for `fn main() { let client: &str = "qdrant"; println!("{}", client); }`: `function`, `function.macro`, `keyword`, `operator`, `punctuation.bracket`, `punctuation.delimiter`, `string`, `type.builtin`. These additions were verified from source; the earlier bundle and TypeScript checks above describe the original four parsers.
