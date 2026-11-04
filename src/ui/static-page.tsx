import { PassThrough, Writable } from "node:stream"
import { BoxRenderable, CliRenderer, CodeRenderable, RGBA, ScrollBoxRenderable, TextAttributes, type CapturedLine, type Renderable } from "@opentui/core"
import { render } from "@opentui/solid"
import type { JSX } from "solid-js"
import type { Config } from "../config"
import type { AppColors } from "../theme"
import { IconProvider } from "./icon-style"
import { KeybindingsProvider } from "./keybindings"
import { MarkdownProvider } from "./markdown-preferences"
import { MotionProvider } from "./motion"
import { ThemeProvider, useTheme } from "./theme"

function descendants(root: Renderable): Renderable[] {
  return root.getChildren().flatMap(child => [child, ...descendants(child)])
}

function StaticRoot(props: { bind: (root: BoxRenderable, colors: AppColors) => void; width: number; children: JSX.Element }) {
  const { colors } = useTheme()
  return <box ref={value => props.bind(value, colors)} position="absolute" left={0} top={0} width={props.width} height={64}
    flexDirection="column" backgroundColor={colors.canvas}>{props.children}</box>
}

function sameRGB(left: RGBA, right: RGBA): boolean {
  return left.r === right.r && left.g === right.g && left.b === right.b
}

function serializeLine(line: CapturedLine, color: boolean, palette: { text: RGBA; muted: RGBA }): string {
  if (!color) return line.spans.map(span => span.text).join("").trimEnd()
  return line.spans.map(span => {
    const codes = [0]
    for (const [attribute, code] of [
      [TextAttributes.BOLD, 1], [TextAttributes.DIM, 2], [TextAttributes.ITALIC, 3],
      [TextAttributes.UNDERLINE, 4], [TextAttributes.BLINK, 5],
      [TextAttributes.HIDDEN, 8], [TextAttributes.STRIKETHROUGH, 9],
    ] as const) if (span.attributes & attribute) codes.push(code)
    if (sameRGB(span.fg, palette.text) || sameRGB(span.fg, palette.muted)) {
      // Neutral text follows the terminal's foreground for light/dark contrast.
      codes.push(39)
      if (sameRGB(span.fg, palette.muted) && !(span.attributes & TextAttributes.DIM)) codes.push(2)
    } else codes.push(38, 2, ...span.fg.toInts().slice(0, 3))
    // All inline surfaces use the terminal background, including code and comments.
    codes.push(49)
    return `\x1b[${codes.join(";")}m${span.text}`
  }).join("") + "\x1b[0m"
}

// No terminal setup: all rendering and input use private, in-memory streams.
// The full-height page moves behind a small capture window, keeping frame buffers
// bounded even for long discussions. This is not an interactive scroll viewport.
export async function renderStaticPage(
  node: () => JSX.Element,
  options: { width: number; config: Config; color?: boolean },
): Promise<string> {
  const width = Math.max(1, Math.floor(options.width || 80))
  const stdin = Object.assign(new PassThrough(), { isTTY: false, setRawMode: () => stdin })
  const stdout = Object.assign(new Writable({ write(_chunk, _encoding, done) { done() } }), {
    columns: width, rows: 64, isTTY: false,
  })
  const renderer = new CliRenderer(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream, width, 64, {
    bufferedOutput: "memory", screenMode: "main-screen", externalOutputMode: "passthrough",
    consoleMode: "disabled", useMouse: false, exitSignals: [], exitOnCtrlC: false, remote: true,
  })
  let root!: BoxRenderable
  let colors!: AppColors
  let renderError: Error | undefined
  renderer.on("render:error", error => { renderError = error })
  const idle = async () => {
    await renderer.idle()
    if (renderError) throw renderError
  }
  const settle = async () => {
    let previous = -1
    for (let pass = 0; pass < 10; pass++) {
      await idle()
      const code = descendants(root).filter((node): node is CodeRenderable => node instanceof CodeRenderable)
      await Promise.all(code.map(node => node.highlightingDone))
      await idle()
      const count = descendants(root).length
      if (count === previous) return
      previous = count
    }
    throw new Error("Inline page did not finish rendering.")
  }
  try {
    const config = options.config
    await render(() => <ThemeProvider name={config.theme} mode={config.colorMode}>
      <IconProvider style={config.iconStyle}>
        <MarkdownProvider style={config.markdownStyle}>
          <MotionProvider reduced>
            <KeybindingsProvider>
              <StaticRoot bind={(value, palette) => { root = value; colors = palette }} width={width}>{node()}</StaticRoot>
            </KeybindingsProvider>
          </MotionProvider>
        </MarkdownProvider>
      </IconProvider>
    </ThemeProvider>, renderer)
    let height = 64
    for (let pass = 0; pass < 10; pass++) {
      await settle()
      const overflow = Math.max(0, ...descendants(root).filter((node): node is ScrollBoxRenderable => node instanceof ScrollBoxRenderable)
        .map(scroll => scroll.scrollHeight - scroll.viewport.height))
      if (overflow <= 0) break
      height += Math.ceil(overflow)
      root.height = height
      if (pass === 9) throw new Error("Inline page layout did not settle.")
    }
    const lines: CapturedLine[] = []
    for (let offset = 0; offset < height; offset += 64) {
      root.top = -offset
      await idle()
      lines.push(...renderer.currentRenderBuffer.getSpanLines().slice(0, Math.min(64, height - offset)))
    }
    while (lines.length && lines.at(-1)!.spans.every(span => !span.text.trim())) lines.pop()
    const palette = { text: RGBA.fromHex(colors.text), muted: RGBA.fromHex(colors.muted) }
    return lines.map(line => serializeLine(line, options.color !== false, palette)).join("\n") + "\n\n"
  } finally {
    renderer.destroy()
    try {
      await renderer.closed
    } finally {
      stdin.destroy()
      stdout.destroy()
    }
  }
}
