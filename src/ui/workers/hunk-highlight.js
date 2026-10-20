/*
Generated from hunkdiff v0.24.0 packages/hunk/src/highlightWorkerEntry.ts
Bun 1.3.14 --target bun --format esm --packages external

MIT License

Copyright (c) Modem Labs Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// @bun
// hunkdiff-v0.24.0/packages/hunk/src/ui/diff/worker/highlightHast.ts
import { cleanLastNewline } from "@pierre/diffs";
var EMPTY_STYLE_VALUES = new Map;
var parsedStyleValueCache = new Map;
function parseStyleValue(styleValue) {
  if (typeof styleValue !== "string") {
    return EMPTY_STYLE_VALUES;
  }
  const cached = parsedStyleValueCache.get(styleValue);
  if (cached) {
    return cached;
  }
  const styles = new Map;
  for (const segment of styleValue.split(";")) {
    const separator = segment.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (key && value) {
      styles.set(key, value);
    }
  }
  parsedStyleValueCache.set(styleValue, styles);
  return styles;
}
function appendRun(target, next) {
  if (next.text.length === 0) {
    return;
  }
  const previous = target[target.length - 1];
  if (previous && previous.fg === next.fg && previous.wordDiff === next.wordDiff) {
    previous.text += next.text;
    return;
  }
  target.push(next);
}
function collectHastHighlightRuns(node, appearance) {
  if (!node) {
    return [];
  }
  const runs = [];
  const colorVariable = appearance === "light" ? "--diffs-token-light" : "--diffs-token-dark";
  const visit = (current, inherited) => {
    if (!current) {
      return;
    }
    if (current.type === "text") {
      appendRun(runs, {
        text: cleanLastNewline(current.value),
        fg: inherited.fg,
        wordDiff: inherited.wordDiff
      });
      return;
    }
    const styles = parseStyleValue(current.properties?.style);
    const nextStyle = {
      fg: styles.get(colorVariable) ?? styles.get("color") ?? inherited.fg,
      wordDiff: Object.hasOwn(current.properties ?? {}, "data-diff-span") || inherited.wordDiff
    };
    for (const child of current.children ?? []) {
      visit(child, nextStyle);
    }
  };
  visit(node, { wordDiff: false });
  return runs;
}

// hunkdiff-v0.24.0/packages/hunk/src/ui/diff/worker/highlightCompact.ts
var COMPACT_PALETTE_COLOR_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
var COMPACT_HIGHLIGHT_PROTOCOL_VERSION = 1;
var COMPACT_HIGHLIGHT_FLAG_WORD_DIFF = 1;
function createMutableSide() {
  return {
    lineOffsets: [0],
    starts: [],
    ends: [],
    styleIds: [],
    flags: []
  };
}
function compactPaletteId(foreground, foregroundPalette, paletteIds) {
  if (!foreground) {
    return 0;
  }
  if (!COMPACT_PALETTE_COLOR_PATTERN.test(foreground)) {
    throw new Error("Compact syntax palette contains an invalid color.");
  }
  const normalizedForeground = foreground.toLowerCase();
  const existingId = paletteIds.get(normalizedForeground);
  if (existingId !== undefined) {
    return existingId;
  }
  if (foregroundPalette.length === 65535) {
    throw new Error("Compact syntax palette exceeded Uint16 style IDs.");
  }
  foregroundPalette.push(foreground);
  const styleId = foregroundPalette.length;
  paletteIds.set(normalizedForeground, styleId);
  return styleId;
}
function encodeSide({
  lines,
  appearance,
  foregroundPalette,
  paletteIds,
  preserveWordDiff
}) {
  const side = createMutableSide();
  for (const line of lines) {
    let sourceColumn = 0;
    for (const run of collectHastHighlightRuns(line, appearance)) {
      const start = sourceColumn;
      sourceColumn += run.text.length;
      const end = sourceColumn;
      if (end === start) {
        continue;
      }
      const styleId = compactPaletteId(run.fg, foregroundPalette, paletteIds);
      side.starts.push(start);
      side.ends.push(end);
      side.styleIds.push(styleId);
      side.flags.push(preserveWordDiff && run.wordDiff ? COMPACT_HIGHLIGHT_FLAG_WORD_DIFF : 0);
    }
    side.lineOffsets.push(side.starts.length);
  }
  return {
    lineOffsets: Uint32Array.from(side.lineOffsets),
    starts: Uint32Array.from(side.starts),
    ends: Uint32Array.from(side.ends),
    styleIds: Uint16Array.from(side.styleIds),
    flags: Uint8Array.from(side.flags)
  };
}
function encodeCompactHighlightedDocument(lines, appearance) {
  const foregroundPalette = [];
  return {
    version: COMPACT_HIGHLIGHT_PROTOCOL_VERSION,
    foregroundPalette,
    document: encodeSide({
      lines,
      appearance,
      foregroundPalette,
      paletteIds: new Map,
      preserveWordDiff: false
    })
  };
}
function encodeCompactHighlightedDiff(code, appearance) {
  const foregroundPalette = [];
  const paletteIds = new Map;
  return {
    version: COMPACT_HIGHLIGHT_PROTOCOL_VERSION,
    foregroundPalette,
    deletion: encodeSide({
      lines: code.deletionLines,
      appearance,
      foregroundPalette,
      paletteIds,
      preserveWordDiff: true
    }),
    addition: encodeSide({
      lines: code.additionLines,
      appearance,
      foregroundPalette,
      paletteIds,
      preserveWordDiff: true
    })
  };
}
function sideTransferList(side) {
  return [
    side.lineOffsets.buffer,
    side.starts.buffer,
    side.ends.buffer,
    side.styleIds.buffer,
    side.flags.buffer
  ];
}
function compactHighlightedDocumentTransferList(payload) {
  return sideTransferList(payload.document);
}
function compactHighlightTransferList(payload) {
  return [...sideTransferList(payload.deletion), ...sideTransferList(payload.addition)];
}
function cloneSide(side) {
  return {
    lineOffsets: side.lineOffsets.slice(),
    starts: side.starts.slice(),
    ends: side.ends.slice(),
    styleIds: side.styleIds.slice(),
    flags: side.flags.slice()
  };
}
function cloneCompactHighlightedDocument(payload) {
  return {
    version: payload.version,
    foregroundPalette: [...payload.foregroundPalette],
    document: cloneSide(payload.document)
  };
}
function cloneCompactHighlightedDiff(payload) {
  return {
    version: payload.version,
    foregroundPalette: [...payload.foregroundPalette],
    deletion: cloneSide(payload.deletion),
    addition: cloneSide(payload.addition)
  };
}
function paletteByteLength(foregroundPalette) {
  return new TextEncoder().encode(JSON.stringify(foregroundPalette)).byteLength;
}
function compactHighlightedDocumentByteLength(payload) {
  const numericBytes = compactHighlightedDocumentTransferList(payload).reduce((total, buffer) => total + buffer.byteLength, 0);
  return numericBytes + paletteByteLength(payload.foregroundPalette);
}
function compactHighlightedDiffByteLength(payload) {
  const numericBytes = compactHighlightTransferList(payload).reduce((total, buffer) => total + buffer.byteLength, 0);
  return numericBytes + paletteByteLength(payload.foregroundPalette);
}
function validateSide({
  side,
  paletteLength,
  lineLengths,
  name,
  allowWordDiff
}) {
  if (!side || typeof side !== "object" || !(side.lineOffsets instanceof Uint32Array) || !(side.starts instanceof Uint32Array) || !(side.ends instanceof Uint32Array) || !(side.styleIds instanceof Uint16Array) || !(side.flags instanceof Uint8Array)) {
    throw new Error(`Compact ${name} highlight fields must be typed arrays.`);
  }
  const runCount = side.starts.length;
  if (side.ends.length !== runCount || side.styleIds.length !== runCount || side.flags.length !== runCount || side.lineOffsets.length === 0) {
    throw new Error(`Compact ${name} highlight run arrays disagree.`);
  }
  if (lineLengths && lineLengths.length !== side.lineOffsets.length - 1) {
    throw new Error(`Compact ${name} highlight line count does not match its source.`);
  }
  if (side.lineOffsets[0] !== 0) {
    throw new Error(`Compact ${name} highlight offsets must start at zero.`);
  }
  let previousOffset = 0;
  for (let lineIndex = 0;lineIndex < side.lineOffsets.length; lineIndex += 1) {
    const offset = side.lineOffsets[lineIndex];
    if (offset < previousOffset || offset > runCount) {
      throw new Error(`Compact ${name} highlight offsets are invalid.`);
    }
    previousOffset = offset;
  }
  if (previousOffset !== runCount) {
    throw new Error(`Compact ${name} highlight final offset does not reach its runs.`);
  }
  for (let lineIndex = 0;lineIndex < side.lineOffsets.length - 1; lineIndex += 1) {
    const startOffset = side.lineOffsets[lineIndex];
    const endOffset = side.lineOffsets[lineIndex + 1];
    let previousEnd = 0;
    const lineLength = lineLengths?.[lineIndex];
    for (let runIndex = startOffset;runIndex < endOffset; runIndex += 1) {
      const start = side.starts[runIndex];
      const end = side.ends[runIndex];
      const styleId = side.styleIds[runIndex];
      const flags = side.flags[runIndex];
      if (start !== previousEnd || end <= start || lineLength !== undefined && end > lineLength) {
        throw new Error(`Compact ${name} highlight ranges are invalid at line ${lineIndex}.`);
      }
      if (styleId > paletteLength) {
        throw new Error(`Compact ${name} highlight style ID is outside its palette.`);
      }
      if ((flags & ~COMPACT_HIGHLIGHT_FLAG_WORD_DIFF) !== 0 || !allowWordDiff && flags !== 0) {
        throw new Error(`Compact ${name} highlight contains unsupported flags.`);
      }
      previousEnd = end;
    }
    if (startOffset < endOffset && lineLength !== undefined && previousEnd !== lineLength) {
      throw new Error(`Compact ${name} highlight ranges do not cover line ${lineIndex}.`);
    }
  }
}
function validatePayloadEnvelope(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Compact highlight payload must be an object.");
  }
  if (payload.version !== COMPACT_HIGHLIGHT_PROTOCOL_VERSION) {
    throw new Error(`Unsupported compact highlight protocol version: ${String(payload.version)}`);
  }
  if (!Array.isArray(payload.foregroundPalette) || payload.foregroundPalette.length > 65535 || payload.foregroundPalette.some((color) => typeof color !== "string" || !COMPACT_PALETTE_COLOR_PATTERN.test(color))) {
    throw new Error("Compact syntax palette contains an invalid color.");
  }
}
function validateCompactHighlightedDocument(payload, lineLengths) {
  validatePayloadEnvelope(payload);
  validateSide({
    side: payload.document,
    paletteLength: payload.foregroundPalette.length,
    lineLengths,
    name: "document",
    allowWordDiff: false
  });
}
function validateCompactHighlightedDiff(payload, lineLengths) {
  validatePayloadEnvelope(payload);
  validateSide({
    side: payload.deletion,
    paletteLength: payload.foregroundPalette.length,
    lineLengths: lineLengths?.deletion,
    name: "deletion",
    allowWordDiff: true
  });
  validateSide({
    side: payload.addition,
    paletteLength: payload.foregroundPalette.length,
    lineLengths: lineLengths?.addition,
    name: "addition",
    allowWordDiff: true
  });
}

// hunkdiff-v0.24.0/packages/hunk/src/ui/diff/worker/highlightWorkerCache.ts
var MAX_WORKER_HIGHLIGHT_CACHE_BYTES = 8 * 1024 * 1024;
var MAX_WORKER_HIGHLIGHT_CACHE_ENTRIES = 512;
function isDocumentPayload(payload) {
  return "document" in payload;
}
function clonePayload(payload) {
  return isDocumentPayload(payload) ? cloneCompactHighlightedDocument(payload) : cloneCompactHighlightedDiff(payload);
}
function payloadByteLength(payload) {
  return isDocumentPayload(payload) ? compactHighlightedDocumentByteLength(payload) : compactHighlightedDiffByteLength(payload);
}

class HighlightWorkerCache {
  entries = new Map;
  maxBytes;
  maxEntries;
  cachedBytes = 0;
  constructor(maxBytes = MAX_WORKER_HIGHLIGHT_CACHE_BYTES, maxEntries = MAX_WORKER_HIGHLIGHT_CACHE_ENTRIES) {
    this.maxBytes = Number.isFinite(maxBytes) ? Math.max(1, Math.floor(maxBytes)) : 1;
    this.maxEntries = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 1;
  }
  get(cacheKey) {
    const entry = this.entries.get(cacheKey);
    if (!entry) {
      return;
    }
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    return clonePayload(entry.payload);
  }
  set(cacheKey, payload) {
    const entry = { bytes: payloadByteLength(payload), payload };
    if (entry.bytes > this.maxBytes) {
      return false;
    }
    const previous = this.entries.get(cacheKey);
    if (previous) {
      this.cachedBytes -= previous.bytes;
      this.entries.delete(cacheKey);
    }
    this.entries.set(cacheKey, entry);
    this.cachedBytes += entry.bytes;
    while (this.cachedBytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const leastRecentlyUsed = this.entries.entries().next().value;
      if (!leastRecentlyUsed) {
        return false;
      }
      const [key, evicted] = leastRecentlyUsed;
      this.entries.delete(key);
      this.cachedBytes -= evicted.bytes;
    }
    return true;
  }
  getCachedBytes() {
    return this.cachedBytes;
  }
  getEntryCount() {
    return this.entries.size;
  }
}

// hunkdiff-v0.24.0/packages/hunk/src/ui/diff/worker/highlightWorkerRuntime.ts
import {
  getHighlighterOptions,
  getResolvedOrResolveLanguage,
  getResolvedOrResolveTheme,
  getSharedHighlighter,
  renderDiffWithHighlighter,
  renderFileWithHighlighter
} from "@pierre/diffs";

// hunkdiff-v0.24.0/packages/hunk/src/ui/diff/highlightRenderOptions.ts
var DOCUMENT_HIGHLIGHT_MAX_LINE_LENGTH = 1000;
function pierreHighlightRenderOptions(themeName) {
  return {
    theme: themeName,
    useTokenTransformer: false,
    tokenizeMaxLineLength: DOCUMENT_HIGHLIGHT_MAX_LINE_LENGTH,
    lineDiffType: "word-alt",
    maxLineDiffLength: 1e4
  };
}

// hunkdiff-v0.24.0/packages/hunk/src/ui/diff/worker/highlightContext.ts
function aliasContextHighlightLines(metadata, highlighted) {
  for (const hunk of metadata.hunks) {
    let deletionLineIndex = hunk.deletionLineIndex;
    let additionLineIndex = hunk.additionLineIndex;
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let offset = 0;offset < content.lines; offset += 1) {
          const sharedLine = highlighted.additionLines[additionLineIndex + offset] ?? highlighted.deletionLines[deletionLineIndex + offset];
          if (!sharedLine) {
            continue;
          }
          highlighted.deletionLines[deletionLineIndex + offset] = sharedLine;
          highlighted.additionLines[additionLineIndex + offset] = sharedLine;
        }
        deletionLineIndex += content.lines;
        additionLineIndex += content.lines;
        continue;
      }
      deletionLineIndex += content.deletions;
      additionLineIndex += content.additions;
    }
  }
  return highlighted;
}

// hunkdiff-v0.24.0/packages/hunk/src/ui/diff/worker/highlightWorkerIdentity.ts
import { createHash } from "crypto";
var HIGHLIGHT_WORKER_CACHE_REVISION = 2;
function highlightWorkerCacheKey(input) {
  return createHash("sha256").update(JSON.stringify({
    ...input,
    revision: HIGHLIGHT_WORKER_CACHE_REVISION
  })).digest("hex");
}

// hunkdiff-v0.24.0/packages/hunk/src/ui/diff/worker/highlightWorkerProtocol.ts
var HIGHLIGHT_WORKER_PROTOCOL_VERSION = 5;
var MAX_WORKER_DOCUMENT_TEXT_LENGTH = 1e6;
var MAX_WORKER_DOCUMENT_LINES = 1e4;
var WORKER_DOCUMENT_TOKENIZE_MAX_LINE_LENGTH = DOCUMENT_HIGHLIGHT_MAX_LINE_LENGTH;
var HIGHLIGHT_WORKER_FAILURE_CODES = new Set([
  "invalid-request",
  "unsupported-language",
  "unsupported-theme",
  "highlight-failed"
]);
function isHighlightWorkerFailureRetryable(code) {
  return code === "highlight-failed";
}
var HIGHLIGHT_WORKER_REQUEST_KINDS = new Set([
  "diff",
  "document",
  "preload"
]);
function isHighlightWorkerRequestKind(value) {
  return typeof value === "string" && HIGHLIGHT_WORKER_REQUEST_KINDS.has(value);
}
function describeHighlightWorkerPreloadIssue({
  language,
  theme
}) {
  if (typeof language !== "string" || language.length === 0 || language.length > 100) {
    return "Preload language must be a bounded non-empty string.";
  }
  if (typeof theme !== "string" || theme.length === 0 || theme.length > 256) {
    return "Preload theme must be a bounded non-empty string.";
  }
  return;
}
function highlightWorkerDocumentLineLengths(text) {
  if (text.length === 0)
    return [];
  const lengths = [];
  let lineLength = 0;
  for (let index = 0;index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lengths.push(lineLength);
      lineLength = 0;
    } else {
      lineLength += 1;
    }
  }
  if (!text.endsWith(`
`))
    lengths.push(lineLength);
  return lengths;
}
function describeHighlightWorkerDocumentIssue({
  language,
  path,
  text,
  theme
}) {
  if (typeof text !== "string" || text.length > MAX_WORKER_DOCUMENT_TEXT_LENGTH) {
    return `Document text exceeds ${MAX_WORKER_DOCUMENT_TEXT_LENGTH} characters.`;
  }
  if (text.includes("\r")) {
    return "Document text must use normalized LF newlines.";
  }
  let lineCount = 0;
  let lineLength = 0;
  for (let index = 0;index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lineCount += 1;
      lineLength = 0;
      if (lineCount > MAX_WORKER_DOCUMENT_LINES) {
        return `Document text exceeds ${MAX_WORKER_DOCUMENT_LINES} lines.`;
      }
    } else {
      lineLength += 1;
      if (lineLength >= WORKER_DOCUMENT_TOKENIZE_MAX_LINE_LENGTH) {
        return `Document lines must be shorter than ${WORKER_DOCUMENT_TOKENIZE_MAX_LINE_LENGTH} characters.`;
      }
    }
  }
  if (text.length > 0 && !text.endsWith(`
`) && lineCount === MAX_WORKER_DOCUMENT_LINES) {
    return `Document text exceeds ${MAX_WORKER_DOCUMENT_LINES} lines.`;
  }
  if (typeof path !== "string" || path.length === 0 || path.length > 4096) {
    return "Document path must be a bounded non-empty string.";
  }
  if (typeof language !== "string" || language.length === 0 || language.length > 100) {
    return "Document language must be a bounded non-empty string.";
  }
  if (typeof theme !== "string" || theme.length === 0 || theme.length > 256) {
    return "Document theme must be a bounded non-empty string.";
  }
  return;
}

// hunkdiff-v0.24.0/packages/hunk/src/ui/diff/worker/highlightWorkerRuntime.ts
var PRELOAD_SAMPLE = [
  "// comment",
  "/* block */",
  "# comment",
  'import { name } from "module";',
  "export function sample(value: number): string {",
  "  const text = `template ${value}`;",
  `  return value > 1 ? 'one' : "two";`,
  "}",
  ""
].join(`
`);

class HighlightWorkerRuntimeFailure extends Error {
  code;
  retryable;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "HighlightWorkerRuntimeFailure";
    this.retryable = isHighlightWorkerFailureRetryable(code);
  }
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function classifiedFailure(error) {
  return error instanceof HighlightWorkerRuntimeFailure ? error : new HighlightWorkerRuntimeFailure("highlight-failed", errorMessage(error));
}
function normalizedHighlightedDocumentLines(text, lines) {
  if (text.length === 0)
    return [];
  return text.endsWith(`
`) ? lines.slice(0, -1) : lines;
}
function failureResponse(request, error) {
  const envelope = request && typeof request === "object" ? request : {};
  return {
    version: HIGHLIGHT_WORKER_PROTOCOL_VERSION,
    id: "id" in envelope && typeof envelope.id === "number" ? envelope.id : -1,
    kind: "kind" in envelope && isHighlightWorkerRequestKind(envelope.kind) ? envelope.kind : "diff",
    ok: false,
    code: error.code,
    retryable: error.retryable,
    message: error.message
  };
}
function invalidRequest(message) {
  throw new HighlightWorkerRuntimeFailure("invalid-request", message);
}
function validateRequest(request) {
  if (!request || typeof request !== "object") {
    invalidRequest("Highlight worker request must be an object.");
  }
  const candidate = request;
  if (candidate.version !== HIGHLIGHT_WORKER_PROTOCOL_VERSION) {
    invalidRequest(`Unsupported highlight worker protocol version: ${String(candidate.version)}`);
  }
  if (!Number.isSafeInteger(candidate.id) || candidate.id < 0) {
    invalidRequest("Highlight worker request has an invalid id.");
  }
  if (!isHighlightWorkerRequestKind(candidate.kind)) {
    invalidRequest("Highlight worker request has an invalid kind.");
  }
  if (candidate.kind === "preload") {
    const issue = describeHighlightWorkerPreloadIssue({
      language: candidate.language,
      theme: candidate.theme
    });
    if (issue)
      invalidRequest(issue);
    return;
  }
  if (candidate.appearance !== "dark" && candidate.appearance !== "light") {
    invalidRequest("Highlight worker request has an invalid appearance.");
  }
  if (typeof candidate.language !== "string" || candidate.language.length === 0 || typeof candidate.theme !== "string" || candidate.theme.length === 0) {
    invalidRequest("Highlight worker request has invalid syntax inputs.");
  }
  if (candidate.kind === "diff") {
    if (typeof candidate.aliasContext !== "boolean" || !candidate.metadata || typeof candidate.metadata !== "object" || Array.isArray(candidate.metadata)) {
      invalidRequest("Highlight worker diff request is malformed.");
    }
  } else {
    const issue = describeHighlightWorkerDocumentIssue({
      language: candidate.language,
      path: candidate.path,
      text: candidate.text,
      theme: candidate.theme
    });
    if (issue)
      invalidRequest(issue);
  }
}
function payloadMatchesKind(payload, kind) {
  return kind === "document" ? "document" in payload : ("deletion" in payload);
}
function isPlainLanguage(language) {
  return language === "text" || language === "ansi";
}
async function resolveWorkerLanguage(language) {
  if (isPlainLanguage(language))
    return;
  try {
    await getResolvedOrResolveLanguage(language);
  } catch (error) {
    throw new HighlightWorkerRuntimeFailure("unsupported-language", `Unsupported syntax language "${language}": ${errorMessage(error)}`);
  }
}
async function resolveWorkerTheme(theme) {
  try {
    await getResolvedOrResolveTheme(theme);
  } catch (error) {
    throw new HighlightWorkerRuntimeFailure("unsupported-theme", `Unsupported syntax theme "${theme}": ${errorMessage(error)}`);
  }
}
function workerHighlighter(language, theme) {
  return getSharedHighlighter({
    ...getHighlighterOptions(language, { theme }),
    preferredHighlighter: "shiki-wasm"
  });
}
async function preloadRequest(request) {
  await resolveWorkerTheme(request.theme);
  if (isPlainLanguage(request.language))
    return;
  await resolveWorkerLanguage(request.language);
  const highlighter = await workerHighlighter(request.language, request.theme);
  renderFileWithHighlighter({
    name: `preload.${request.language}`,
    contents: PRELOAD_SAMPLE,
    lang: request.language,
    cacheKey: `preload:${request.theme}:${request.language}`
  }, highlighter, pierreHighlightRenderOptions(request.theme));
}
async function renderRequest(request, cacheKey) {
  await resolveWorkerLanguage(request.language);
  await resolveWorkerTheme(request.theme);
  const highlighter = await workerHighlighter(request.language, request.theme);
  if (request.kind === "diff") {
    const result2 = renderDiffWithHighlighter(request.metadata, highlighter, pierreHighlightRenderOptions(request.theme));
    const highlighted = result2.code;
    const payload2 = encodeCompactHighlightedDiff(request.aliasContext ? aliasContextHighlightLines(request.metadata, highlighted) : highlighted, request.appearance);
    validateCompactHighlightedDiff(payload2);
    return payload2;
  }
  const result = renderFileWithHighlighter({
    name: request.path,
    contents: request.text,
    lang: request.language,
    cacheKey
  }, highlighter, pierreHighlightRenderOptions(request.theme));
  const payload = encodeCompactHighlightedDocument(normalizedHighlightedDocumentLines(request.text, result.code), request.appearance);
  validateCompactHighlightedDocument(payload, highlightWorkerDocumentLineLengths(request.text));
  return payload;
}
async function processHighlightWorkerRequest(value, cache) {
  try {
    validateRequest(value);
    const request = value;
    if (request.kind === "preload") {
      await preloadRequest(request);
      return {
        version: HIGHLIGHT_WORKER_PROTOCOL_VERSION,
        id: request.id,
        kind: "preload",
        ok: true
      };
    }
    const { id, version: _version, ...identity } = request;
    const cacheKey = highlightWorkerCacheKey(identity);
    let code = cache.get(cacheKey);
    if (code && !payloadMatchesKind(code, request.kind)) {
      throw new Error("Highlight worker cache returned the wrong payload kind.");
    }
    if (!code) {
      const cachedCode = await renderRequest(request, cacheKey);
      code = cache.set(cacheKey, cachedCode) ? request.kind === "document" ? cloneCompactHighlightedDocument(cachedCode) : cloneCompactHighlightedDiff(cachedCode) : cachedCode;
    }
    if (request.kind === "document") {
      return {
        version: HIGHLIGHT_WORKER_PROTOCOL_VERSION,
        id,
        kind: "document",
        ok: true,
        code
      };
    }
    return {
      version: HIGHLIGHT_WORKER_PROTOCOL_VERSION,
      id,
      kind: "diff",
      ok: true,
      code
    };
  } catch (error) {
    return failureResponse(value, classifiedFailure(error));
  }
}

// hunkdiff-v0.24.0/packages/hunk/src/ui/diff/worker/highlightWorker.ts
var highlightCache = new HighlightWorkerCache;
function responseTransferList(response) {
  if (!response.ok || response.kind === "preload")
    return [];
  return response.kind === "document" ? compactHighlightedDocumentTransferList(response.code) : compactHighlightTransferList(response.code);
}
self.onmessage = async (event) => {
  const response = await processHighlightWorkerRequest(event.data, highlightCache);
  self.postMessage(response, responseTransferList(response));
};
