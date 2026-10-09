import { join } from "node:path"

export function configDirectory() {
  const configHome = process.env.XDG_CONFIG_HOME || join(process.env.HOME || ".", ".config")
  return join(configHome, "opengh")
}
