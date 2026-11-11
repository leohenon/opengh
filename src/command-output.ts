// Bound both text storage and the number of native rows in command scrollback.
export const MAX_COMMAND_OUTPUT_CHARS = 64 * 1024
export const MAX_COMMAND_OUTPUT_LINES = 2_000
const TRUNCATED = "[Earlier command output omitted]\n"

/** Streaming terminal-control removal. Incomplete escapes retain only parser
 * state, never their payload, so a split or unterminated OSC cannot grow memory. */
export function createCommandOutputBuffer() {
  let state: "text" | "escape" | "csi" | "string" | "string-escape" = "text"
  let afterCR = false
  let output = ""
  let truncated = false
  return {
    append(chunk: string) {
      // Batch sanitized runs before touching retained scrollback. A newline-rich
      // chunk must not copy the entire tail once for every character/control.
      const parts: string[] = []
      let pendingChars = 0
      const flush = () => {
        if (!pendingChars) return
        if (output.length + pendingChars > MAX_COMMAND_OUTPUT_CHARS) truncated = true
        const text = parts.join("")
        output = (output + text.slice(-MAX_COMMAND_OUTPUT_CHARS)).slice(-MAX_COMMAND_OUTPUT_CHARS)
        parts.length = 0
        pendingChars = 0
      }
      const emit = (text: string) => {
        if (!text) return
        parts.push(text)
        pendingChars += text.length
        if (pendingChars >= 4096) flush()
      }
      let start = 0
      for (let index = 0; index < chunk.length; index++) {
        const code = chunk.charCodeAt(index)
        if (state === "text" && code >= 32 && !(code >= 127 && code <= 159)) {
          afterCR = false
          continue
        }
        if (state === "text") {
          emit(chunk.slice(start, index))
          if (code === 27) state = "escape"
          else if (code === 155) state = "csi"
          else if ([144, 152, 157, 158, 159].includes(code)) state = "string"
          else if (code === 13) emit("\n")
          else if (code === 10 && !afterCR) emit("\n")
          else if (code === 9) emit("\t")
          afterCR = code === 13
        } else if (state === "escape") {
          if (code === 91) state = "csi"
          else if ([93, 80, 88, 94, 95].includes(code)) state = "string"
          else if (code >= 48 && code <= 126) state = "text"
          // Intermediate ESC bytes (e.g. ESC ( B) stay inside the escape.
        } else if (state === "csi") {
          if (code >= 64 && code <= 126) state = "text"
          else if (code === 27) state = "escape"
        } else if (state === "string") {
          if (code === 7 || code === 156) state = "text"
          else if (code === 27) state = "string-escape"
        } else {
          if (code === 92 || code === 7 || code === 156) state = "text"
          else if (code !== 27) state = "string"
        }
        start = index + 1
      }
      if (state === "text") emit(chunk.slice(start))
      flush()
      let position = output.length
      for (let lines = 0; lines < MAX_COMMAND_OUTPUT_LINES; lines++) {
        // JS clamps a negative fromIndex to zero; stop before searching the
        // first newline repeatedly and falsely claiming that output was lost.
        position = position > 0 ? output.lastIndexOf("\n", position - 1) : -1
        if (position < 0) break
      }
      if (position >= 0) { output = output.slice(position + 1); truncated = true }
      // Do not expose a low surrogate if the character limit split a pair.
      if (output.charCodeAt(0) >= 0xdc00 && output.charCodeAt(0) <= 0xdfff) output = output.slice(1)
      return (truncated ? TRUNCATED : "") + output
    },
  }
}
