import { join } from "node:path"
import { validateExternalCommand } from "./external-actions"
import { configDirectory } from "./paths"
import { normalizeKeybindings, type KeybindingOverrides } from "./keybindings"
import { atomicPrivateWrite, readPrivateJson, trustedConfigDestination } from "./filesystem"
import { defaultTheme, isThemeName, type ThemeName } from "./theme"

export type ColorMode = "system" | "dark" | "light"

export type DetailLayout = "centered" | "wide"
export type DiffLayout = "auto" | "split" | "unified"
export type DetailsPlacement = "auto" | "inline"
export type MarkdownStyle = "rich" | "minimal"
export type IconStyle = "unicode" | "nerd" | "none"

export type Config = {
  showScrollbars: boolean
  theme: ThemeName
  colorMode: ColorMode
  reducedMotion: boolean
  markdownStyle: MarkdownStyle
  detailLayout: DetailLayout
  detailsPlacement: DetailsPlacement
  diffLayout: DiffLayout
  diffWrap: boolean
  showStatusBarHints: boolean
  iconStyle: IconStyle
  compactHeader: boolean
  hideDocumentsTab: boolean
  showTabShortcuts: boolean
  showTabCounts: boolean
  diffViewerCommand?: string[]
  keybindings?: KeybindingOverrides
}

export const defaultConfig: Config = {
  showScrollbars: false,
  theme: defaultTheme,
  colorMode: "system",
  reducedMotion: false,
  markdownStyle: "rich",
  detailLayout: "centered",
  detailsPlacement: "auto",
  diffLayout: "auto",
  diffWrap: false,
  showStatusBarHints: false,
  iconStyle: "nerd",
  compactHeader: false,
  hideDocumentsTab: false,
  showTabShortcuts: true,
  showTabCounts: true,
}

export class ConfigFileError extends Error {
  readonly operation: "load" | "save"
  readonly path: string
  override readonly cause: unknown

  constructor(operation: "load" | "save", path: string, cause: unknown) {
    const detail = cause instanceof Error ? `: ${cause.message}` : ""
    super(`Config ${operation} failed at ${path}${detail}`)
    this.name = "ConfigFileError"
    this.operation = operation
    this.path = path
    this.cause = cause
  }
}

export function configPath() {
  return join(configDirectory(), "config.json")
}

// Files may omit fields; consumers receive resolved defaults. Unknown fields are not preserved on save.
function normalizeConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Config must be a JSON object")
  }
  const input = value as Record<string, unknown>
  return {
    showScrollbars: typeof input.showScrollbars === "boolean"
      ? input.showScrollbars
      : defaultConfig.showScrollbars,
    theme: input.theme === "github-light" ? "github" : isThemeName(input.theme) ? input.theme : defaultConfig.theme,
    colorMode: input.colorMode === "system" || input.colorMode === "dark" || input.colorMode === "light"
      ? input.colorMode
      : input.theme === "github-light" ? "light" : defaultConfig.colorMode,
    reducedMotion: typeof input.reducedMotion === "boolean" ? input.reducedMotion : defaultConfig.reducedMotion,
    markdownStyle: input.markdownStyle === "rich" || input.markdownStyle === "minimal" ? input.markdownStyle : defaultConfig.markdownStyle,
    detailLayout: input.detailLayout === "centered" || input.detailLayout === "wide"
      ? input.detailLayout
      : defaultConfig.detailLayout,
    detailsPlacement: input.detailsPlacement === "auto" || input.detailsPlacement === "inline"
      ? input.detailsPlacement
      : defaultConfig.detailsPlacement,
    diffLayout: input.diffLayout === "auto" || input.diffLayout === "split" || input.diffLayout === "unified"
      ? input.diffLayout
      : defaultConfig.diffLayout,
    diffWrap: typeof input.diffWrap === "boolean" ? input.diffWrap : defaultConfig.diffWrap,
    showStatusBarHints: typeof input.showStatusBarHints === "boolean"
      ? input.showStatusBarHints
      : defaultConfig.showStatusBarHints,
    iconStyle: input.iconStyle === "unicode" || input.iconStyle === "nerd" || input.iconStyle === "none" ? input.iconStyle : defaultConfig.iconStyle,
    compactHeader: typeof input.compactHeader === "boolean" ? input.compactHeader : defaultConfig.compactHeader,
    hideDocumentsTab: typeof input.hideDocumentsTab === "boolean" ? input.hideDocumentsTab : defaultConfig.hideDocumentsTab,
    showTabShortcuts: typeof input.showTabShortcuts === "boolean" ? input.showTabShortcuts : defaultConfig.showTabShortcuts,
    showTabCounts: typeof input.showTabCounts === "boolean" ? input.showTabCounts : defaultConfig.showTabCounts,
    ...(input.diffViewerCommand === undefined ? {} : { diffViewerCommand: validateExternalCommand(input.diffViewerCommand) }),
    ...(input.keybindings === undefined ? {} : { keybindings: normalizeKeybindings(input.keybindings) }),
  }
}

export async function loadConfig(path = configPath()): Promise<Config> {
  try {
    return normalizeConfig(await readPrivateJson(path, { maxBytes: 64 * 1024, configSymlinks: true }))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { ...defaultConfig }
    throw new ConfigFileError("load", path, error)
  }
}

export async function saveConfig(config: Config, path = configPath()): Promise<void> {
  try {
    // Follow intentional config links only through trusted intermediate paths.
    const destination = await trustedConfigDestination(path)
    const output = { ...config,
      ...(config.keybindings === undefined ? {} : { keybindings: normalizeKeybindings(config.keybindings) }),
      ...(config.diffViewerCommand === undefined ? {} : { diffViewerCommand: validateExternalCommand(config.diffViewerCommand) }),
    }
    await atomicPrivateWrite(destination, JSON.stringify(output, null, 2) + "\n", true)
  } catch (error) {
    throw new ConfigFileError("save", path, error)
  }
}
