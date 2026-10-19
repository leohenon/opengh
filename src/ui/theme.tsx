import { CliRenderEvents, type TerminalColors } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { defaultConfig } from "../config"
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type ParentProps,
} from "solid-js"
import {
  appColors,
  isThemeName,
  resolveTheme,
  type AppColors,
  type ResolvedTheme,
  type ThemeName,
} from "../theme"

type ThemeContextValue = {
  colors: AppColors
  theme: ResolvedTheme
  selected: () => ThemeName
  preview: (name?: ThemeName) => void
}

function reactiveProxy<T extends object>(value: () => T): T {
  return new Proxy({} as T, {
    get: (_target, property) => value()[property as keyof T],
    ownKeys: () => Reflect.ownKeys(value()),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  })
}

const defaultTheme = resolveTheme(defaultConfig.theme)
const standalone: ThemeContextValue = {
  colors: appColors(defaultTheme),
  theme: defaultTheme,
  selected: () => defaultConfig.theme,
  preview: () => {},
}

const ThemeContext = createContext<ThemeContextValue>(standalone)

export function ThemeProvider(props: ParentProps<{ name: string }>) {
  const renderer = useRenderer()
  const [preview, setPreview] = createSignal<ThemeName>()
  const selected = createMemo<ThemeName>(() => preview() ?? (isThemeName(props.name) ? props.name : defaultConfig.theme))
  const [terminalColors, setTerminalColors] = createSignal<TerminalColors>()
  let paletteRequested = false
  let disposed = false
  const updatePalette = (palette: TerminalColors) => {
    if (!disposed) setTerminalColors(palette)
  }
  renderer.on(CliRenderEvents.PALETTE, updatePalette)
  onCleanup(() => {
    disposed = true
    renderer.off(CliRenderEvents.PALETTE, updatePalette)
  })
  createEffect(() => {
    if ((selected() !== "terminal-minimal" && selected() !== "terminal-native") || paletteRequested) return
    paletteRequested = true
    // Unsupported terminals retain the neutral fallback palette.
    void renderer.getPalette({ size: 16 }).then(updatePalette).catch(() => {})
  })
  const resolved = createMemo(() => resolveTheme(selected(), "dark", terminalColors()))
  const resolvedColors = createMemo(() => appColors(resolved()))
  const colors = reactiveProxy(resolvedColors)
  const theme = reactiveProxy(resolved)

  createEffect(() => renderer.setBackgroundColor(colors.canvas))

  const value: ThemeContextValue = {
    colors,
    theme,
    selected,
    preview: setPreview,
  }

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
