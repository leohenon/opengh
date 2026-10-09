import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { configDirectory } from "./paths"
import { isThemeName, type ThemeName } from "./theme"

export type Config = {
  showScrollbars: boolean
  theme: ThemeName
}

export const defaultConfig: Config = {
  showScrollbars: false,
  theme: "github",
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

function normalizeConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Config must be a JSON object")
  }
  const input = value as Record<string, unknown>
  return {
    showScrollbars: typeof input.showScrollbars === "boolean"
      ? input.showScrollbars
      : defaultConfig.showScrollbars,
    theme: isThemeName(input.theme) ? input.theme : defaultConfig.theme,
  }
}

export async function loadConfig(path = configPath()): Promise<Config> {
  const file = Bun.file(path)
  if (!await file.exists()) return { ...defaultConfig }

  try {
    return normalizeConfig(await file.json())
  } catch (error) {
    throw new ConfigFileError("load", path, error)
  }
}

export async function saveConfig(config: Config, path = configPath()): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, JSON.stringify(config, null, 2) + "\n")
  } catch (error) {
    throw new ConfigFileError("save", path, error)
  }
}
