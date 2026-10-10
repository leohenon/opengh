import { useRenderer } from "@opentui/solid"
import { defaultConfig } from "../config"
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
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
  const resolved = createMemo(() => resolveTheme(selected()))
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
