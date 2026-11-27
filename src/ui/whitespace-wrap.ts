import { CliRenderEvents, OptimizedBuffer, RGBA, type CliRenderer, type TextBufferRenderable, type TextChunk } from "@opentui/core"

const BREAKS = ".,:;!?-/\\()[]{}"
const FIRST_PLACEHOLDER = 0xfdd0
const PLACEHOLDERS = Array.from(BREAKS, (_, index) => String.fromCharCode(FIRST_PLACEHOLDER + index))
const breakable = /[.,:;!?\-/\\()[\]{}]/g
const reserved = /[\ufdd0-\ufdde]/g
const unattached = /^(?:$|[\s\p{M}\u200d\ufe00-\ufe0f])/u

const decoders = new WeakMap<CliRenderer, boolean>()
const wrapped = new WeakSet<TextBufferRenderable>()

function encode(text: string, following: string) {
  const source = text.replace(reserved, "\ufffd")
  return source.replace(breakable, (char, offset: number) =>
    unattached.test(offset + 1 < source.length ? source.slice(offset + 1, offset + 3) : following)
      ? char
      : PLACEHOLDERS[BREAKS.indexOf(char)]!,
  )
}

function encodeChunks(chunks: TextChunk[]) {
  return chunks.map((chunk, index) => {
    const text = encode(chunk.text, chunks[index + 1]?.text ?? "")
    return text === chunk.text ? chunk : { ...chunk, text }
  })
}

function installDecoder(renderer: CliRenderer) {
  const installed = decoders.get(renderer)
  if (installed !== undefined) return installed
  let ready = false
  try {
    const scratch = OptimizedBuffer.create(BREAKS.length, 1, renderer.widthMethod, { owner: renderer.nativeScene })
    scratch.drawText(PLACEHOLDERS.join(""), 0, 0, RGBA.fromValues(1, 1, 1, 1), RGBA.fromValues(0, 0, 0, 1))
    const cells = scratch.withBuffers((planes) => Array.from(planes.char.subarray(0, BREAKS.length)))
    const pooled = cells.every((cell) => cell > 0x7f && cell >>> 16 === cells[0]! >>> 16)
    if (pooled && new Set(cells).size === BREAKS.length) {
      const codes = new Map(cells.map((cell, index) => [cell, BREAKS.charCodeAt(index)]))
      const decode = (buffer: OptimizedBuffer) => {
        const chars = buffer.buffers.char
        for (let index = 0; index < chars.length; index++) {
          const cell = chars[index]!
          if (cell <= 0x7f) continue
          const code = codes.get(cell)
          if (code !== undefined) chars[index] = code
        }
      }
      renderer.addPostProcessFn(decode)
      renderer.once(CliRenderEvents.DESTROY, () => {
        renderer.removePostProcessFn(decode)
        decoders.delete(renderer)
        try {
          scratch.destroy()
        } catch {}
      })
      ready = true
    } else scratch.destroy()
  } catch {}
  decoders.set(renderer, ready)
  return ready
}

export function wrapAtWhitespace(renderer: CliRenderer, node: TextBufferRenderable) {
  if (wrapped.has(node) || !installDecoder(renderer)) return
  wrapped.add(node)
  const selectedText = node.getSelectedText.bind(node)
  node.getSelectedText = () => decodeWrappedText(selectedText())
  let owner: object | null = node
  let plainText: PropertyDescriptor | undefined
  while (owner && !plainText) {
    plainText = Object.getOwnPropertyDescriptor(owner, "plainText")
    owner = Object.getPrototypeOf(owner)
  }
  if (plainText?.get) {
    const read = plainText.get
    Object.defineProperty(node, "plainText", { configurable: true, get: () => decodeWrappedText(read.call(node)) })
  }
  const previous = node.textDecorator
  node.textDecorator = previous ? (chunks) => encodeChunks(previous(chunks)) : encodeChunks
}

function decodeWrappedText(text: string) {
  return text.replace(reserved, (char) => BREAKS[char.charCodeAt(0) - FIRST_PLACEHOLDER]!)
}
