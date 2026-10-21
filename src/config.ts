import { chmod, lstat, mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { configDirectory } from "./paths"
import { defaultTheme, isThemeName, type ThemeName } from "./theme"

export type ColorMode = "system" | "dark" | "light"

export type AboutSidebar = "auto" | "show" | "hide"
export type DetailLayout = "centered" | "wide"
export type MarkdownStyle = "rich" | "minimal"
export type IconStyle = "unicode" | "nerd"

export type Config = {
  showScrollbars: boolean
  theme: ThemeName
  colorMode: ColorMode
  reducedMotion: boolean
  markdownStyle: MarkdownStyle
  aboutSidebar: AboutSidebar
  detailLayout: DetailLayout
  showStatusBarHints: boolean
  iconStyle: IconStyle
  compactHeader: boolean
  hideDocumentsTab: boolean
  showTabCounts: boolean
}

export const defaultConfig: Config = {
  showScrollbars: false,
  theme: defaultTheme,
  colorMode: "system",
  reducedMotion: false,
  markdownStyle: "rich",
  aboutSidebar: "auto",
  detailLayout: "centered",
  showStatusBarHints: false,
  iconStyle: "nerd",
  compactHeader: false,
  hideDocumentsTab: false,
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
    aboutSidebar: input.aboutSidebar === "auto" || input.aboutSidebar === "show" || input.aboutSidebar === "hide"
      ? input.aboutSidebar
      : defaultConfig.aboutSidebar,
    detailLayout: input.detailLayout === "centered" || input.detailLayout === "wide"
      ? input.detailLayout
      : defaultConfig.detailLayout,
    showStatusBarHints: typeof input.showStatusBarHints === "boolean"
      ? input.showStatusBarHints
      : defaultConfig.showStatusBarHints,
    iconStyle: input.iconStyle === "unicode" || input.iconStyle === "nerd" ? input.iconStyle : defaultConfig.iconStyle,
    compactHeader: typeof input.compactHeader === "boolean" ? input.compactHeader : defaultConfig.compactHeader,
    hideDocumentsTab: typeof input.hideDocumentsTab === "boolean" ? input.hideDocumentsTab : defaultConfig.hideDocumentsTab,
    showTabCounts: typeof input.showTabCounts === "boolean" ? input.showTabCounts : defaultConfig.showTabCounts,
  }
}

export async function loadConfig(path = configPath()): Promise<Config> {
  try {
    return normalizeConfig(await Bun.file(path).json())
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { ...defaultConfig }
    throw new ConfigFileError("load", path, error)
  }
}

export async function saveConfig(config: Config, path = configPath()): Promise<void> {
  let temporary: string | undefined
  try {
    const entry = await lstat(path).catch((error) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw error
    })
    // Replace the target, never the link; dangling links fail without being overwritten.
    const destination = entry?.isSymbolicLink() ? await realpath(path) : path
    const existing = entry?.isSymbolicLink() ? await stat(destination) : entry
    const mode = existing ? existing.mode & 0o777 : undefined
    await mkdir(dirname(destination), { recursive: true })
    temporary = `${destination}.${crypto.randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode })
    // Restore any permission bits masked by umask before replacing the existing file.
    if (mode !== undefined) await chmod(temporary, mode)
    await rename(temporary, destination)
  } catch (error) {
    if (temporary) await rm(temporary, { force: true }).catch(() => {})
    throw new ConfigFileError("save", path, error)
  }
}
