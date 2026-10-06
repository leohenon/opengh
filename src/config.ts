import { join } from "node:path"

export type Config = {
  showScrollbars: boolean
}

export const defaultConfig: Config = {
  showScrollbars: false,
}

export function configPath() {
  const configHome = process.env.XDG_CONFIG_HOME || join(process.env.HOME || ".", ".config")
  return join(configHome, "opengh", "config.json")
}

export async function loadConfig(path = configPath()): Promise<Config> {
  try {
    const value = await Bun.file(path).json() as { showScrollbars?: unknown }
    return { showScrollbars: value.showScrollbars === true }
  } catch {
    return { ...defaultConfig }
  }
}
